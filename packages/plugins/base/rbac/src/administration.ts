import { sql, type SQL } from 'drizzle-orm'
import type { Context } from 'cordis'
import { AccessDeniedError, isAccessDeniedError, isDomainError } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import {
  isCanonicalTenantAdmin,
  scopeCoverage,
  type AuthorizationScope,
  type GrantTarget,
  type Principal,
  type RbacDbHandle,
} from '@qualy/rbac-contract'
import { REACH_RANK, REACHES_EVERY_NODE, type Authorization } from './authorization.ts'
import { assertGrantEligible } from './eligibility.ts'
import { assertMayDefineRole, assertMayGrantRole } from './escalation.ts'
import { accessErrors } from './errors.ts'

// The refusals that mean "this role is not offerable here", as distinct
// from everything else, which means something is broken or absent. A
// missing user or node is deliberately not in this set: it says the request
// named something that does not exist, which is an answer of its own and
// must not be flattened into an empty list of options.
const GRANT_REFUSALS = new Set([
  'GRANT_NOT_ELIGIBLE',
  'GRANT_ESCALATION_REFUSED',
  'TENANT_ADMIN_REQUIRED',
])
const isGrantRefusal = (error: unknown) =>
  isAccessDeniedError(error) || (isDomainError(error) && GRANT_REFUSALS.has(error.code))
import { assertTenantKeepsAdministrator, CANONICAL_ADMIN_ROLE } from './invariants.ts'

// Role and grant administration. Every mutation runs in one transaction that
// first locks the tenant row — the same lock org structural writes and
// identity writes take — so an eligibility change and the grants it must stay
// compatible with can never race. Authorization is re-decided on that same
// locked connection: the router's fast-path check ran before the lock, and
// the org tree can move underneath it.
//
// A role is configured while it is a draft and checked for completeness when
// it is activated. That is what makes "created complete" enforceable without
// demanding every decision in one request, and it is why an active role that
// grants nothing cannot exist.

type Drizzle = Context['db']['drizzle']
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0]

const translateDbError: (error: unknown) => never = createConstraintTranslator({
  uq_roles_tenant_code: () => accessErrors.create('ROLE_CONFLICT'),
  uq_roles_tenant_name: () => accessErrors.create('ROLE_CONFLICT', 'that role name is taken'),
  uq_role_grants_anchored: () => accessErrors.create('GRANT_EXISTS'),
  uq_role_grants_tenant_wide: () => accessErrors.create('GRANT_EXISTS'),
})

export type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  kind: 'tenant' | 'org'
  status: 'draft' | 'active' | 'disabled'
  permission_mode: 'explicit' | 'all-active'
  system_key: string | null
  assignable: boolean
  version: number
  grant_count: number
  permissions: string[]
  allowed_user_types: string[]
  allowed_org_types: string[]
}

export type GrantRow = {
  id: string
  user_id: string
  user_display_name: string
  role_id: string
  role_code: string
  role_name: string
  role_kind: 'tenant' | 'org'
  org_node_id: string | null
  org_node_name: string | null
  coverage: 'self' | 'subtree' | null
  manageable: boolean
}

export class Administration {
  constructor(
    private ctx: Context,
    private authorization: Authorization,
  ) {}

  private get db() {
    return this.ctx.db.drizzle
  }

  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work)
    } catch (error) {
      translateDbError(error)
    }
  }

  private async lockTenant(tx: Tx, tenantId: string) {
    const row = (await tx.execute(sql`select 1 from tenants where id = ${tenantId} for update`))
      .rows[0]
    if (!row) throw new Error(`tenant ${tenantId} does not exist`)
  }

  // --- roles ---

  private roleProjection(where: SQL) {
    return sql`
      select r.id, r.code, r.name, r.description, r.kind, r.status, r.permission_mode,
        r.system_key, r.assignable, r.version,
        (select count(*)::int from role_grants g
         where g.tenant_id = r.tenant_id and g.role_id = r.id) as grant_count,
        coalesce((select array_agg(p.code order by p.code)
          from role_permissions rp join permissions p on p.id = rp.permission_id
          where rp.tenant_id = r.tenant_id and rp.role_id = r.id), '{}') as permissions,
        coalesce((select array_agg(t.user_type_id::text)
          from role_allowed_user_types t
          where t.tenant_id = r.tenant_id and t.role_id = r.id), '{}') as allowed_user_types,
        coalesce((select array_agg(t.org_type_id::text)
          from role_allowed_org_types t
          where t.tenant_id = r.tenant_id and t.role_id = r.id), '{}') as allowed_org_types
      from roles r
      where ${where}
      order by r.kind, r.code`
  }

  async listRoles(tenantId: string): Promise<RoleRow[]> {
    return (await this.db.execute<RoleRow>(this.roleProjection(sql`r.tenant_id = ${tenantId}`)))
      .rows
  }

  async getRole(tenantId: string, roleId: string): Promise<RoleRow> {
    const row = (
      await this.db.execute<RoleRow>(
        this.roleProjection(sql`r.tenant_id = ${tenantId} and r.id = ${roleId}`),
      )
    ).rows[0]
    if (!row) throw accessErrors.create('ROLE_NOT_FOUND')
    return row
  }

  // What a role actually grants, and what it merely names. A configured code
  // whose plugin is no longer loaded authorizes nothing, so presenting it as
  // effective would tell an administrator the role does something it does
  // not. They are reported separately rather than blended.
  permissionsOfRole(role: RoleRow): { active: string[]; unavailable: string[] } {
    if (role.permission_mode === 'all-active') {
      return { active: this.authorization.activeCodes(), unavailable: [] }
    }
    const active = new Set(this.authorization.activeCodes())
    return {
      active: role.permissions.filter((code) => active.has(code)),
      unavailable: role.permissions.filter((code) => !active.has(code)),
    }
  }

  // the ordinary management api creates draft roles only; a role becomes
  // usable through activation, which is where completeness is checked
  createRole(
    tenantId: string,
    input: { code: string; name: string; description?: string; kind: 'tenant' | 'org' },
  ): Promise<string> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into roles (tenant_id, code, name, description, kind, status, permission_mode)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null},
          ${input.kind}, 'draft', 'explicit')
        returning id`)
      return created.rows[0]!.id
    })
  }

  updateRole(
    tenantId: string,
    roleId: string,
    fields: { name?: string; description?: string | null; assignable?: boolean },
    expectedVersion: number,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId, expectedVersion)
      // the administrator role keeps its assignability: making it
      // unassignable is a lockout by another name
      if (role.system_key !== null && fields.assignable === false) {
        throw accessErrors.create('ROLE_IS_SYSTEM')
      }
      await tx.execute(sql`
        update roles set
          name = coalesce(${fields.name ?? null}, name),
          description = ${fields.description === undefined ? sql`description` : fields.description},
          assignable = coalesce(${fields.assignable ?? null}, assignable),
          version = version + 1,
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${role.id}`)
      return role.version + 1
    })
  }

  // activation is the completeness gate: everything a usable role needs is
  // checked here, once, instead of being demanded field by field at creation
  setRoleStatus(
    tenantId: string,
    roleId: string,
    status: 'active' | 'disabled',
    expectedVersion: number,
    actor?: Principal,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId, expectedVersion)
      if (role.system_key !== null && status === 'disabled') {
        throw accessErrors.create('ROLE_IS_SYSTEM')
      }
      if (status === 'active' && role.status !== 'active') {
        if (role.status !== 'draft' && role.status !== 'disabled') {
          throw accessErrors.create('ROLE_NOT_DRAFT')
        }
        await this.assertComplete(tx, tenantId, role)
        const { codes } = await this.permissionCodesOf(tx, tenantId, role.id)
        await assertMayDefineRole(this.authorization, actor, codes, tx)
      }
      // a request that changes nothing must not invalidate every open editor
      if (role.status === status) return role.version
      await tx.execute(sql`
        update roles set status = ${status}, version = version + 1, updated_at = now()
        where tenant_id = ${tenantId} and id = ${role.id}`)
      // a role losing its permissions can remove the last administrator
      if (status === 'disabled') await assertTenantKeepsAdministrator(tx, tenantId)
      return role.version + 1
    })
  }

  private async assertComplete(tx: Tx, tenantId: string, role: { id: string; kind: string }) {
    const missing: ('permissions' | 'user-types' | 'org-types')[] = []
    const { codes } = await this.permissionCodesOf(tx, tenantId, role.id)
    // a role whose only capabilities come from an unloaded plugin grants
    // nothing, so it is as incomplete as one with no rows at all
    const active = new Set(this.authorization.activeCodes())
    if (codes.filter((code) => active.has(code)).length === 0) missing.push('permissions')
    const counts = (
      await tx.execute<{ user_types: number; org_types: number }>(sql`
        select
          (select count(*)::int from role_allowed_user_types
           where tenant_id = ${tenantId} and role_id = ${role.id}) as user_types,
          (select count(*)::int from role_allowed_org_types
           where tenant_id = ${tenantId} and role_id = ${role.id}) as org_types`)
    ).rows[0]!
    // every role says who may hold it, whatever its kind: a role nobody is
    // eligible for is as inert as one with no permissions, and leaving the
    // set empty for tenant roles was what let the grant check skip it
    if (counts.user_types === 0) missing.push('user-types')
    // only an anchored role needs to say what it may anchor to
    if (role.kind === 'org' && counts.org_types === 0) missing.push('org-types')
    if (missing.length > 0) throw accessErrors.create('ROLE_INCOMPLETE', { missing })
  }

  private async permissionCodesOf(tx: Tx, tenantId: string, roleId: string) {
    const rows = (
      await tx.execute<{ code: string }>(sql`
        select p.code from role_permissions rp
        join permissions p on p.id = rp.permission_id
        where rp.tenant_id = ${tenantId} and rp.role_id = ${roleId}`)
    ).rows
    return { codes: rows.map((row) => row.code) }
  }

  deleteRole(tenantId: string, roleId: string, expectedVersion: number) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId, expectedVersion)
      if (role.system_key !== null) throw accessErrors.create('ROLE_IS_SYSTEM')
      const grants = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from role_grants
          where tenant_id = ${tenantId} and role_id = ${role.id}`)
      ).rows[0]!.count
      if (grants > 0) throw accessErrors.create('ROLE_IN_USE', { grantCount: grants })
      await tx.execute(sql`delete from roles where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  // The kinds do not overlap. A tenant role holds tenant-target
  // capabilities; an org role holds org-target ones, applying wherever its
  // grant reaches. An org capability inside a tenant role would apply at
  // every node without any grant having said so, and reaching every node is
  // the canonical administrator's alone.
  syncRolePermissions(
    tenantId: string,
    roleId: string,
    codes: readonly string[],
    expectedVersion: number,
    actor?: Principal,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId, expectedVersion)
      if (role.permission_mode === 'all-active') throw accessErrors.create('ROLE_IS_SYSTEM')
      const wanted = [...new Set(codes)]
      // only codes the registry currently serves; a row left behind by an
      // unloaded plugin is not something anyone may grant
      const active = new Map(
        this.authorization
          .activeCodes()
          .map((code) => [code, this.authorization.definitionOf(code)!] as const),
      )
      const unknown = wanted.filter((code) => !active.has(code))
      if (unknown.length > 0) {
        throw accessErrors.create('PERMISSION_NOT_FOUND', { permissions: unknown.sort() })
      }
      const wantedTarget = role.kind === 'org' ? 'org-node' : 'tenant'
      const mismatched = wanted.filter((code) => active.get(code)!.target !== wantedTarget)
      if (mismatched.length > 0) {
        throw accessErrors.create('ROLE_TARGET_MISMATCH', { permissions: mismatched.sort() })
      }
      await assertMayDefineRole(this.authorization, actor, wanted, tx)
      // Replace only within what the registry currently serves. A row whose
      // plugin is unloaded was never on offer, so the caller did not decline
      // it by omitting it, and deleting it would quietly discard authority
      // that unloading a plugin is meant to suspend rather than destroy.
      // Removing one is a separate decision that needs its own operation.
      const offered = [...active.keys()]
      await tx.execute(sql`
        delete from role_permissions
        where tenant_id = ${tenantId} and role_id = ${role.id}
          and permission_id in (
            select id from permissions
            where code = any(string_to_array(${offered.join(',')}, ',')))
          and permission_id not in (
            select id from permissions
            where code = any(string_to_array(${wanted.join(',')}, ',')))`)
      if (wanted.length > 0) {
        await tx.execute(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${tenantId}, ${role.id}, p.id from permissions p
          where p.code = any(string_to_array(${wanted.join(',')}, ','))
          on conflict do nothing`)
      }
      await this.bump(tx, tenantId, role.id)
      // an active role that just lost everything would be a live role that
      // grants nothing, so activation's completeness rule applies here too
      if (role.status === 'active') await this.assertComplete(tx, tenantId, role)
      await assertTenantKeepsAdministrator(tx, tenantId)
      return role.version + 1
    })
  }

  // which user types may hold the role and at which org node types it may be
  // anchored; narrowing must not strand grants that already exist
  syncRoleEligibility(
    tenantId: string,
    roleId: string,
    sets: { userTypeIds: readonly string[]; orgTypeIds: readonly string[] },
    expectedVersion: number,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId, expectedVersion)
      // the canonical administrator is grantable to whoever the tenant
      // designates; everything else declares who may hold it
      if (isCanonicalTenantAdmin(role)) throw accessErrors.create('ROLE_IS_SYSTEM')
      const userTypeIds = [...new Set(sets.userTypeIds)]
      // A tenant role reaches the whole tenant, so it anchors to nothing and
      // admits no org types: the field is simply not part of its policy, and
      // the editor does not offer it.
      const orgTypeIds = role.kind === 'org' ? [...new Set(sets.orgTypeIds)] : []
      if (
        role.status === 'active' &&
        (userTypeIds.length === 0 || (role.kind === 'org' && orgTypeIds.length === 0))
      ) {
        throw accessErrors.create('ROLE_NEEDS_ELIGIBILITY')
      }
      await this.replaceEligibility(tx, tenantId, role.id, { userTypeIds, orgTypeIds })

      // The sets and the grants are checked together under one lock, so a
      // narrowing that would orphan a grant fails as a whole. The node is
      // joined outward because a tenant grant has none: an inner join
      // dropped every one of them, so narrowing a tenant role's user types
      // would have stranded its holders silently.
      const stranded = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count
          from role_grants g
          join users u on u.tenant_id = g.tenant_id and u.id = g.user_id
          left join org_nodes n on n.tenant_id = g.tenant_id and n.id = g.org_node_id
          where g.tenant_id = ${tenantId} and g.role_id = ${role.id}
            and (not exists (
                  select 1 from role_allowed_user_types t
                  where t.tenant_id = g.tenant_id and t.role_id = g.role_id
                    and t.user_type_id = u.user_type_id)
              or (n.id is not null and not exists (
                  select 1 from role_allowed_org_types t
                  where t.tenant_id = g.tenant_id and t.role_id = g.role_id
                    and t.org_type_id = n.org_type_id)))`)
      ).rows[0]!.count
      if (stranded > 0) throw accessErrors.create('GRANT_STRANDED', { grantCount: stranded })
      await this.bump(tx, tenantId, role.id)
      return role.version + 1
    })
  }

  private async replaceEligibility(
    tx: Tx,
    tenantId: string,
    roleId: string,
    sets: { userTypeIds?: readonly string[]; orgTypeIds?: readonly string[] },
  ) {
    const replace = async (
      table: 'role_allowed_user_types' | 'role_allowed_org_types',
      column: 'user_type_id' | 'org_type_id',
      source: 'user_types' | 'org_types',
      ids: readonly string[],
    ) => {
      await this.requireAll(tx, tenantId, source, ids)
      const list = sql.raw(uuidArray(ids))
      await tx.execute(sql`
        delete from ${sql.raw(table)}
        where tenant_id = ${tenantId} and role_id = ${roleId}
          and ${sql.raw(column)} <> all(${list})`)
      if (ids.length > 0) {
        await tx.execute(sql`
          insert into ${sql.raw(table)} (tenant_id, role_id, ${sql.raw(column)})
          select ${tenantId}, ${roleId}, id from unnest(${list}) as id
          on conflict do nothing`)
      }
    }
    if (sets.userTypeIds) {
      await replace('role_allowed_user_types', 'user_type_id', 'user_types', sets.userTypeIds)
    }
    if (sets.orgTypeIds) {
      await replace('role_allowed_org_types', 'org_type_id', 'org_types', sets.orgTypeIds)
    }
  }

  // the user types and node types a role's eligibility may name, read here so
  // the role screen does not need permissions belonging to other domains
  async listEligibilityOptions(tenantId: string): Promise<{
    userTypes: { id: string; code: string; name: string }[]
    orgTypes: { id: string; code: string; name: string }[]
  }> {
    const [userTypes, orgTypes] = await Promise.all([
      this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from user_types where tenant_id = ${tenantId}
        order by sort_order, code`),
      this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from org_types where tenant_id = ${tenantId}
        order by sort_order, code`),
    ])
    return { userTypes: userTypes.rows, orgTypes: orgTypes.rows }
  }

  // --- diagnostics ---

  // Why someone holds what they hold. Answering "allowed?" is the easy half;
  // the reason is what makes a wrong answer fixable, and what an audit needs.
  // Every source is a grant now — there is no second channel to explain.
  async explainEffectivePermissions(
    tenantId: string,
    userId: string,
    orgNodeId?: string,
  ): Promise<
    {
      code: string
      name: string
      target: 'tenant' | 'org-node'
      sources: {
        roleId: string
        roleCode: string
        grantId: string
        target:
          | { kind: 'tenant' }
          | {
              kind: 'org-node'
              orgNodeId: string
              orgNodeName: string
              coverage: 'self' | 'subtree'
            }
      }[]
    }[]
  > {
    const user = (
      await this.db.execute(sql`
        select 1 from users where tenant_id = ${tenantId} and id = ${userId}`)
    ).rows[0]
    if (!user) throw accessErrors.create('GRANT_USER_NOT_FOUND')
    if (orgNodeId !== undefined) {
      const node = (
        await this.db.execute(sql`
          select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`)
      ).rows[0]
      // an unknown node has no authority to explain, and answering as though
      // it did would disagree with canAt, which refuses it
      if (!node) throw accessErrors.create('GRANT_NODE_NOT_FOUND')
    }
    // the same predicate the decision uses, not a second copy of it
    const reach = orgNodeId
      ? sql`(
          ${REACHES_EVERY_NODE}
          or (held.coverage = 'self' and held.org_node_id = ${orgNodeId})
          or (held.coverage = 'subtree' and node.path <@ anchor.path)
        )`
      : sql`r.kind = 'tenant'`
    const rows = (
      await this.db.execute<{
        code: string
        plugin: string
        target_kind: 'tenant' | 'org-node'
        name: string
        role_id: string
        role_code: string
        grant_id: string
        org_node_id: string | null
        org_node_name: string | null
        coverage: 'self' | 'subtree' | null
      }>(sql`
        with held as (
          select g.role_id, g.org_node_id, g.coverage, g.id as grant_id
          from role_grants g
          join users u on u.tenant_id = g.tenant_id and u.id = g.user_id and u.enabled
          join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id and t.enabled
          where g.tenant_id = ${tenantId} and g.user_id = ${userId}
        )
        select p.code, p.plugin, p.target_kind, p.name, r.id as role_id,
          r.code as role_code, held.grant_id,
          held.org_node_id, anchor.name as org_node_name, held.coverage
        from held
        join roles r on r.tenant_id = ${tenantId} and r.id = held.role_id and r.status = 'active'
        left join org_nodes anchor on anchor.tenant_id = ${tenantId}
          and anchor.id = held.org_node_id
        left join org_nodes node on node.tenant_id = ${tenantId}
          and node.id = ${orgNodeId ?? null}
        join permissions p on r.permission_mode = 'all-active'
          or exists (
            select 1 from role_permissions rp
            where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_id = p.id
          )
        where ${reach}
        order by p.code`)
    ).rows

    const out = new Map<
      string,
      { code: string; name: string; target: 'tenant' | 'org-node'; sources: unknown[] }
    >()
    for (const row of rows) {
      // the registry is the authority on what a code means; a stored row that
      // drifted from its definition explains nothing
      const definition = this.authorization.definitionOf(row.code)
      if (!definition || definition.plugin !== row.plugin || definition.target !== row.target_kind) {
        continue
      }
      // a tenant capability only ever arrives through a tenant role
      if (definition.target === 'tenant' && row.coverage !== null) continue
      const entry =
        out.get(row.code) ??
        (() => {
          const created = {
            code: definition.code,
            name: definition.name,
            target: definition.target,
            sources: [] as unknown[],
          }
          out.set(row.code, created)
          return created
        })()
      entry.sources.push({
        roleId: row.role_id,
        roleCode: row.role_code,
        grantId: row.grant_id,
        target:
          row.org_node_id === null
            ? { kind: 'tenant' as const }
            : {
                kind: 'org-node' as const,
                orgNodeId: row.org_node_id,
                orgNodeName: row.org_node_name ?? '',
                coverage: row.coverage ?? 'self',
              },
      })
    }
    return [...out.values()] as never
  }

  // --- grants ---

  // only the grants the caller may read; the filter is pushed into the
  // statement instead of being applied row by row afterwards
  async listGrants(
    tenantId: string,
    filter: { userId?: string; orgNodeId?: string },
    scope?: {
      read: AuthorizationScope
      manage: AuthorizationScope
      tenantGrants: { read: boolean; manage: boolean }
    },
    page?: { after?: string; limit: number },
  ): Promise<GrantRow[]> {
    // a tenant-wide grant has no node, so node coverage cannot decide it:
    // reading those is its own tenant permission
    const visible = scope
      ? sql`case when g.org_node_id is null then ${scope.tenantGrants.read}
                 else ${scopeCoverage(scope.read, 'n')} end`
      : sql`true`
    const manageable = scope
      ? sql`case when g.org_node_id is null then ${scope.tenantGrants.manage}
                 else ${scopeCoverage(scope.manage, 'n')} end`
      : sql`true`
    const result = await this.db.execute<GrantRow>(sql`
      select g.id, g.user_id, u.display_name as user_display_name,
        g.role_id, r.code as role_code, r.name as role_name, r.kind as role_kind,
        g.org_node_id, n.name as org_node_name, g.coverage,
        ${manageable} as manageable
      from role_grants g
      join users u on u.tenant_id = g.tenant_id and u.id = g.user_id
      join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id
      left join org_nodes n on n.tenant_id = g.tenant_id and n.id = g.org_node_id
      where g.tenant_id = ${tenantId}
        and (${filter.userId ?? null}::uuid is null or g.user_id = ${filter.userId ?? null})
        and (${filter.orgNodeId ?? null}::uuid is null
             or g.org_node_id = ${filter.orgNodeId ?? null})
        and (${page?.after ?? null}::uuid is null or g.id > ${page?.after ?? null}::uuid)
        and ${visible}
      order by g.id
      ${page ? sql`limit ${page.limit}` : sql``}`)
    return result.rows
  }

  async getGrant(tenantId: string, grantId: string): Promise<GrantRow> {
    const row = (await this.listGrants(tenantId, {})).find((entry) => entry.id === grantId)
    if (!row) throw accessErrors.create('GRANT_NOT_FOUND')
    return row
  }

  // The roles that could be granted to this person here, right now. Each
  // candidate goes through the same eligibility and escalation checks the
  // write performs, so the list cannot promise something the write refuses.
  async grantOptions(
    tenantId: string,
    request: { userId: string; target: GrantTarget },
    actor?: Principal,
  ): Promise<{ id: string; code: string; name: string; kind: 'tenant' | 'org' }[]> {
    // Asked once, up front, so a request naming somebody who is not there
    // gets told so. Per-candidate probing treats every refusal alike, and a
    // mistyped id used to come back as "no role can be offered here", which
    // reads as a permission answer rather than a missing record.
    const user = (
      await this.db.execute(
        sql`select 1 from users where tenant_id = ${tenantId} and id = ${request.userId}`,
      )
    ).rows[0]
    if (!user) throw accessErrors.create('GRANT_USER_NOT_FOUND')
    if (request.target.kind === 'org-node') {
      const node = (
        await this.db.execute(
          sql`select 1 from org_nodes
              where tenant_id = ${tenantId} and id = ${request.target.orgNodeId}`,
        )
      ).rows[0]
      if (!node) throw accessErrors.create('GRANT_NODE_NOT_FOUND')
    }
    const wantedKind = request.target.kind === 'tenant' ? 'tenant' : 'org'
    const candidates = (await this.listRoles(tenantId)).filter(
      (role) => role.kind === wantedKind && role.status === 'active' && role.assignable,
    )
    const offered: { id: string; code: string; name: string; kind: 'tenant' | 'org' }[] = []
    for (const role of candidates) {
      try {
        await this.db.transaction(async (tx) => {
          await assertGrantEligible(tx, tenantId, {
            userId: request.userId,
            roleId: role.id,
            target: request.target,
          })
          await this.assertMayAdministerRole(tx, actor, tenantId, role.id)
          await assertMayGrantRole(
            this.authorization,
            actor,
            tenantId,
            role.id,
            request.target,
            tx,
          )
        })
        offered.push({ id: role.id, code: role.code, name: role.name, kind: role.kind })
      } catch (error) {
        // Only a refusal removes a candidate. Anything else is a fault, and
        // swallowing it would render an empty list and call that an answer.
        if (!isGrantRefusal(error)) throw error
      }
    }
    return offered
  }

  // One grant, created on its own. Replacing a whole set looked tidier until
  // the set a caller could see was smaller than the set that existed: then
  // "replace with what I see" silently proposed deleting what they could
  // not. Every rule the set version enforced still runs, in one place.
  grant(
    tenantId: string,
    input: { userId: string; roleId: string; target: GrantTarget },
    actor?: Principal,
  ): Promise<string> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      await this.assertMayAdministerGrantsAt(tx, actor, input.target)
      await this.assertMayAdministerRole(tx, actor, tenantId, input.roleId)
      await assertGrantEligible(tx, tenantId, input)
      await assertMayGrantRole(this.authorization, actor, tenantId, input.roleId, input.target, tx)
      const anchor =
        input.target.kind === 'org-node'
          ? { nodeId: input.target.orgNodeId, coverage: input.target.coverage }
          : { nodeId: null, coverage: null }
      const created = await tx.execute<{ id: string }>(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${tenantId}, ${input.userId}, ${input.roleId}, ${anchor.nodeId}, ${anchor.coverage})
        returning id`)
      return created.rows[0]!.id
    })
  }

  revoke(tenantId: string, grantId: string, actor?: Principal): Promise<void> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const grant = (
        await tx.execute<{
          role_id: string
          org_node_id: string | null
          coverage: 'self' | 'subtree' | null
        }>(sql`
          select role_id, org_node_id, coverage from role_grants
          where tenant_id = ${tenantId} and id = ${grantId}`)
      ).rows[0]
      if (!grant) throw accessErrors.create('GRANT_NOT_FOUND')
      const target: GrantTarget =
        grant.org_node_id === null
          ? { kind: 'tenant' }
          : { kind: 'org-node', orgNodeId: grant.org_node_id, coverage: grant.coverage! }
      await this.assertMayAdministerGrantsAt(tx, actor, target)
      await this.assertMayAdministerRole(tx, actor, tenantId, grant.role_id)
      await tx.execute(sql`
        delete from role_grants where tenant_id = ${tenantId} and id = ${grantId}`)
      // checked against the state the removal actually leaves behind
      await assertTenantKeepsAdministrator(tx, tenantId)
    })
  }

  // authority over the grant itself: which grants you may touch. Separate
  // from how much power the grant carries, which the escalation guard
  // decides — being allowed to edit someone's grants says nothing about how
  // strong a role you may put in them.
  private async assertMayAdministerGrantsAt(
    tx: Tx,
    actor: Principal | undefined,
    target: GrantTarget,
  ) {
    if (!actor) return
    if (target.kind === 'tenant') {
      const codes = await this.authorization.effectiveCodes(actor, undefined, tx)
      if (!codes.has('iam.tenant-grant.manage')) {
        throw new AccessDeniedError('not allowed to administer tenant-wide grants')
      }
      return
    }
    // Coverage matters here, not just the node. Someone who administers
    // grants at one node alone must not be able to create — or quietly
    // revoke — a grant that reaches its whole subtree.
    const reach = await this.authorization.reachAt(actor, target.orgNodeId, tx)
    const mine = reach.get('iam.grant.manage')
    if (mine === undefined || REACH_RANK[mine] < REACH_RANK[target.coverage]) {
      throw new AccessDeniedError('not allowed to administer grants of that reach')
    }
  }

  // Granting or revoking the administrator role is reserved for someone who
  // already holds it. The generic escalation rule nearly covers this — an
  // all-active role carries everything, so only someone with everything
  // passes the comparison — but the bind escape hatch is a single tenant-wide
  // permission, and it must not be a route to becoming superuser.
  private async assertMayAdministerRole(
    tx: Tx,
    actor: Principal | undefined,
    tenantId: string,
    roleId: string,
  ) {
    if (!actor) return
    const role = (
      await tx.execute<{ system_key: string | null }>(sql`
        select system_key from roles where tenant_id = ${tenantId} and id = ${roleId}`)
    ).rows[0]
    if (!role) throw accessErrors.create('ROLE_NOT_FOUND')
    if (role.system_key !== CANONICAL_ADMIN_ROLE) return
    const holder = (
      await tx.execute(sql`
        select 1 from role_grants g
        join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id
          and r.system_key = ${CANONICAL_ADMIN_ROLE} and r.status = 'active'
        join users u on u.tenant_id = g.tenant_id and u.id = g.user_id and u.enabled
        where g.tenant_id = ${tenantId} and g.user_id = ${actor.userId}`)
    ).rows[0]
    if (!holder) throw accessErrors.create('TENANT_ADMIN_REQUIRED')
  }

  // org-kind grants at the node whose role does not allow the given org
  // type; a lock-holding caller must pass its own transaction handle (a
  // second pool connection under a held lock can deadlock the pool)
  async grantsBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: RbacDbHandle,
  ): Promise<string[]> {
    const db = (handle ?? this.db) as Drizzle
    const result = await db.execute<{ code: string }>(sql`
      select distinct r.code
      from role_grants g
      join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id and r.kind = 'org'
      where g.tenant_id = ${tenantId} and g.org_node_id = ${orgNodeId}
        and not exists (
          select 1 from role_allowed_org_types t
          where t.tenant_id = g.tenant_id and t.role_id = g.role_id
            and t.org_type_id = ${orgTypeId}
        )
      order by r.code`)
    return result.rows.map((row) => row.code)
  }

  // --- shared guards ---

  private async requireRole(
    tx: Tx,
    tenantId: string,
    roleId: string,
    expectedVersion?: number,
  ) {
    const row = (
      await tx.execute<{
        id: string
        code: string
        kind: 'tenant' | 'org'
        status: 'draft' | 'active' | 'disabled'
        permission_mode: 'explicit' | 'all-active'
        system_key: string | null
        assignable: boolean
        version: number
      }>(sql`
        select id, code, kind, status, permission_mode, system_key, assignable, version
        from roles where tenant_id = ${tenantId} and id = ${roleId} for update`)
    ).rows[0]
    if (!row) throw accessErrors.create('ROLE_NOT_FOUND')
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw accessErrors.create('ROLE_VERSION_CONFLICT', { currentVersion: row.version })
    }
    return row
  }

  private async bump(tx: Tx, tenantId: string, roleId: string) {
    await tx.execute(sql`
      update roles set version = version + 1, updated_at = now()
      where tenant_id = ${tenantId} and id = ${roleId}`)
  }

  private async requireAll(
    tx: Tx,
    tenantId: string,
    table: 'user_types' | 'org_types',
    ids: readonly string[],
  ) {
    if (ids.length === 0) return
    const list = sql.raw(uuidArray(ids))
    const found = (
      await tx.execute<{ count: number }>(
        table === 'user_types'
          ? sql`select count(*)::int as count from user_types
                where tenant_id = ${tenantId} and id = any(${list})`
          : sql`select count(*)::int as count from org_types
                where tenant_id = ${tenantId} and id = any(${list})`,
      )
    ).rows[0]!.count
    if (found !== new Set(ids).size) {
      throw accessErrors.create(
        table === 'user_types' ? 'ROLE_USER_TYPE_NOT_FOUND' : 'ROLE_ORG_TYPE_NOT_FOUND',
      )
    }
  }
}

export { CANONICAL_ADMIN_ROLE }

// uuid lists reach postgres as an array literal rather than as a joined
// string, so an empty set stays an empty array instead of a one-element list
// containing the empty string. Every id is re-validated first: these come
// from request input, and sql.raw does not parameterize.
function uuidArray(ids: readonly string[]): string {
  const unique = [...new Set(ids)]
  for (const id of unique) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw accessErrors.create('ROLE_NOT_FOUND', `malformed identifier ${id}`)
    }
  }
  return unique.length === 0 ? `'{}'::uuid[]` : `array['${unique.join("','")}']::uuid[]`
}
