import { ORPCError } from '@orpc/server'
import { sql, type SQL } from 'drizzle-orm'
import {
  REACHES_EVERY_NODE,
  authorizedScopeQuery,
  canAtQuery,
  carries,
  foldScope,
  hasTenantPermissionQuery,
  heldRoles,
  type ScopeRow,
} from './queries.ts'

// re-exported because the diagnostics endpoint explains a decision with the
// same predicate that made it
export { REACHES_EVERY_NODE } from './queries.ts'
import type { Context } from 'cordis'
import type {
  AccessProfile,
  ActivePermission,
  AuthorizationScope,
  Principal,
  RbacDbHandle,
} from '@qualy/rbac-contract'
import type { PermissionRegistry } from './permission-registry.ts'

// how far one grant carries, weakest first; a bind may never hand out more
// than the actor holds
export type Reach = 'self' | 'subtree' | 'tenant'
export const REACH_RANK: Record<Reach, number> = { self: 0, subtree: 1, tenant: 2 }

// The one role that reaches every node of its tenant. Exported because
// authorization, the profile projection and the diagnostics all have to
// answer this identically: three copies of "which roles reach everywhere" is
// how an explanation ends up disagreeing with the decision it explains.
// An ordinary tenant role does not qualify — it may only hold tenant-target
// capabilities, which have no node to reach.

// Authorization.
//
// A person holds roles one way and permissions one way: a grant gives them a
// role, a role carries permissions, and nothing else does either. User types
// classify who someone is and where they may stand; they confer no
// authority, so they appear nowhere below.
//
// Two earlier shapes are gone from this file, and both were the same mistake
// at different depths: user types holding permissions directly, then user
// types holding roles. Each made "why does this person have this" a union of
// sources, and each needed its own rules about which capabilities were
// allowed to travel that way.
//
// Reach follows the role's kind, strictly. A tenant role holds tenant-target
// capabilities and applies across the tenant; an org role holds org-target
// ones and reaches exactly what its grant covers. Exactly one role escapes
// that split: the canonical administrator, whose all-active mode holds every
// capability and reaches every node.
//
// The split is not tidiness. An org role is anchored by its grant, so a
// tenant-wide capability inside it would have nowhere to apply; a tenant
// role is not anchored at all, so an org capability inside it would silently
// mean "at every node" without anyone having said so. A tenant-wide
// organization administrator is expressed as an org role granted at the root
// with subtree coverage, which says exactly that and can be read off the
// grant.
//
// Every query still pins the permission row to what the registry verified
// (code, owning plugin, target), so a row edited out of band stops
// authorizing rather than starting to.

export class Authorization {
  constructor(
    private ctx: Context,
    private registry: PermissionRegistry,
  ) {}

  private db(handle?: RbacDbHandle) {
    return (handle ?? this.ctx.db.drizzle) as Context['db']['drizzle']
  }

  private heldRoles(principal: Principal): SQL {
    return heldRoles(principal)
  }

  // whether an active role carries this exact permission: either it holds
  private carries(def: ActivePermission): SQL {
    return carries(def)
  }



  // every code the registry currently serves; the escalation guard needs it
  // to reason about a role that holds all of them
  activeCodes(): string[] {
    return this.registry.list().map((definition) => definition.code)
  }

  definitionOf(code: string): ActivePermission | undefined {
    return this.registry.get(code)
  }

  async hasPermission(principal: Principal, code: string): Promise<boolean> {
    const def = this.registry.get(code)
    if (!def) return false
    if (def.target === 'tenant') return this.hasTenantPermission(principal, def)
    const scope = await this.authorizedScope(principal, def)
    return scope.tenantWide || scope.anchors.length > 0
  }

  async require(principal: Principal | undefined, code: string): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    const def = this.registry.get(code)
    if (!def) throw new ORPCError('FORBIDDEN')
    if (def.target !== 'tenant') {
      throw new Error(`require() got an org-node permission ${code}, use requireAt()`)
    }
    if (!(await this.hasTenantPermission(principal, def))) throw new ORPCError('FORBIDDEN')
  }

  private async hasTenantPermission(
    principal: Principal,
    def: ActivePermission,
    handle?: RbacDbHandle,
  ): Promise<boolean> {
    // a tenant capability comes only from a tenant role: an org role is
    // anchored somewhere, and tenant-wide authority has nowhere to anchor
    const result = await this.db(handle).execute<{ allowed: boolean }>(
      hasTenantPermissionQuery(principal, def),
    )
    return result.rows[0]?.allowed ?? false
  }

  // the handle lets a caller holding the tenant lock re-decide authorization
  // on its own connection: the router's check ran before the lock, and a
  // concurrent move can re-anchor the target in between
  async canAt(
    principal: Principal,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<boolean> {
    const def = this.registry.get(code)
    if (!def) return false
    if (def.target !== 'org-node') {
      throw new Error(`canAt() got a tenant permission ${code}, use require()`)
    }
    const result = await this.db(handle).execute<{ allowed: boolean }>(
      canAtQuery(principal, def, targetOrgNodeId),
    )
    return result.rows[0]?.allowed ?? false
  }

  async requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    if (!this.registry.has(code)) throw new ORPCError('FORBIDDEN')
    if (!(await this.canAt(principal, code, targetOrgNodeId, handle))) {
      throw new ORPCError('FORBIDDEN')
    }
  }

  // how far one org-node permission reaches for this principal
  async listAuthorizedScope(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationScope> {
    const def = this.registry.get(code)
    if (!def || def.target !== 'org-node') return { tenantWide: false, anchors: [] }
    return this.authorizedScope(principal, def, handle)
  }

  private async authorizedScope(
    principal: Principal,
    def: ActivePermission,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationScope> {
    const result = await this.db(handle).execute<ScopeRow>(authorizedScopeQuery(principal, def))
    return foldScope(result.rows)
  }

  // for the manifest: which active codes this viewer holds from any source.
  // The decision is made against the registry, so a stored row that no
  // longer matches its definition contributes nothing.
  async getProfile(principal: Principal): Promise<AccessProfile> {
    // "anywhere at all", not "here": the manifest asks what this viewer may
    // discover, and an org capability held at one college is discoverable
    // even though it applies at no other node
    const rows = await this.effectiveRows(principal, 'anywhere')
    const tenantPermissions: string[] = []
    const orgPermissions: string[] = []
    for (const { def, roleKind } of rows) {
      if (def.target === 'tenant') {
        if (roleKind === 'tenant') tenantPermissions.push(def.code)
      } else {
        orgPermissions.push(def.code)
      }
    }
    return {
      tenantPermissions: [...new Set(tenantPermissions)].sort(),
      orgPermissions: [...new Set(orgPermissions)].sort(),
    }
  }

  // Every permission this principal effectively holds. With a node, the
  // answer is what they hold AT that node; without one, only what they hold
  // tenant-wide. The escalation guard asks this to decide whether a role
  // being defined or granted stays inside the actor's own authority.
  async effectiveCodes(
    principal: Principal,
    target?: { orgNodeId: string },
    handle?: RbacDbHandle,
  ): Promise<Set<string>> {
    const rows = await this.effectiveRows(principal, target, handle)
    return new Set(rows.map(({ def }) => def.code))
  }

  // The strongest reach the actor has for each permission at one node.
  // A bind guard needs more than "do they hold it here": granting subtree
  // coverage from a self anchor would hand out more than the actor has.
  async reachAt(
    principal: Principal,
    orgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<Map<string, Reach>> {
    const result = await this.db(handle).execute<{
      code: string
      plugin: string
      target_kind: string
      kind: 'tenant' | 'org'
      every_node: boolean
      coverage: 'self' | 'subtree' | null
    }>(sql`
      select distinct p.code, p.plugin, p.target_kind, r.kind,
        (${REACHES_EVERY_NODE}) as every_node, held.coverage
      from (${this.heldRoles(principal)}) held
      join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
        and r.status = 'active'
      join org_nodes node on node.tenant_id = ${principal.tenantId}
        and node.id = ${orgNodeId}
      left join org_nodes anchor on anchor.tenant_id = ${principal.tenantId}
        and anchor.id = held.org_node_id
      join permissions p on r.permission_mode = 'all-active'
        or exists (
          select 1 from role_permissions rp
          where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_id = p.id
        )
      where ${REACHES_EVERY_NODE}
        or (held.coverage = 'self' and held.org_node_id = ${orgNodeId})
        or (held.coverage = 'subtree' and node.path <@ anchor.path)`)
    const reach = new Map<string, Reach>()
    for (const row of result.rows) {
      const def = this.registry.get(row.code)
      if (!def || row.plugin !== def.plugin || row.target_kind !== def.target) continue
      const here: Reach = row.every_node ? 'tenant' : (row.coverage ?? 'self')
      const known = reach.get(def.code)
      if (known === undefined || REACH_RANK[here] > REACH_RANK[known]) reach.set(def.code, here)
    }
    return reach
  }

  private async effectiveRows(
    principal: Principal,
    target: { orgNodeId: string } | 'anywhere' | undefined,
    handle?: RbacDbHandle,
  ): Promise<{ def: ActivePermission; roleKind: 'tenant' | 'org' }[]> {
    // Three questions, deliberately distinct. With a node: what does this
    // person hold AT it. Without one: what do they hold tenant-wide, which
    // is what an escalation guard must compare against. 'anywhere': what do
    // they hold at all, which is what surface discovery asks — a capability
    // held at one college is discoverable even though it applies nowhere
    // else.
    const at = typeof target === 'object' ? target : undefined
    const reach = at
      ? sql`(
          ${REACHES_EVERY_NODE}
          or (held.coverage = 'self' and held.org_node_id = ${at.orgNodeId})
          or (held.coverage = 'subtree' and node.path <@ anchor.path)
        )`
      : target === 'anywhere'
        ? sql`true`
        : sql`r.kind = 'tenant'`
    const result = await this.db(handle).execute<{
      code: string
      plugin: string
      target_kind: string
      kind: 'tenant' | 'org'
    }>(sql`
      select distinct p.code, p.plugin, p.target_kind, r.kind
      from (${this.heldRoles(principal)}) held
      join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
        and r.status = 'active'
      left join org_nodes anchor on anchor.tenant_id = ${principal.tenantId}
        and anchor.id = held.org_node_id
      left join org_nodes node on node.tenant_id = ${principal.tenantId}
        and node.id = ${at?.orgNodeId ?? null}
      join permissions p on r.permission_mode = 'all-active'
        or exists (
          select 1 from role_permissions rp
          where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_id = p.id
        )
      where ${reach}`)
    const rows: { def: ActivePermission; roleKind: 'tenant' | 'org' }[] = []
    for (const row of result.rows) {
      const def = this.registry.get(row.code)
      if (!def || row.plugin !== def.plugin || row.target_kind !== def.target) continue
      rows.push({ def, roleKind: row.kind })
    }
    return rows
  }
}
