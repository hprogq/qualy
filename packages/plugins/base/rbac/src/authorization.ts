import { ORPCError } from '@orpc/server'
import { sql, type SQL } from 'drizzle-orm'
import type { Context } from 'cordis'
import type {
  AccessProfile,
  AuthorizationAnchor,
  Principal,
  RbacDbHandle,
} from '@qualy/rbac-contract'
import type { PermissionRegistry } from './permission-registry.ts'

type ActivePermission = NonNullable<ReturnType<PermissionRegistry['get']>>

// authorization checks. Every query pins the permission row to the complete
// stable semantics verified at activation (owner, scope, both grant
// channels, defaultTenantAdmin), and a channel the active definition
// declares closed never opens a query branch: flipping a database flag out
// of band therefore only ever narrows authorization, never widens it.
export class Authorization {
  constructor(
    private ctx: Context,
    private registry: PermissionRegistry,
  ) {}

  // the row must still match everything verification saw; any out-of-band
  // change kills the code's grants at read time
  private pinned(def: ActivePermission): SQL {
    return sql`p.enabled and p.code = ${def.code} and p.plugin = ${def.plugin}
      and p.scope = ${def.scope}
      and p.grant_to_user_type = ${def.grantToUserType}
      and p.grant_to_role = ${def.grantToRole}
      and p.default_tenant_admin = ${def.defaultTenantAdmin}`
  }

  async hasPermission(principal: Principal, code: string): Promise<boolean> {
    const def = this.registry.get(code)
    if (!def) return false
    return def.scope === 'tenant'
      ? this.hasTenantPermission(principal, def)
      : this.hasAnyOrgPermission(principal, def)
  }

  // tenant-scope gate: user-type grants and tenant-role grants, unioned
  async require(principal: Principal | undefined, code: string): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    const def = this.registry.get(code)
    if (!def) throw new ORPCError('FORBIDDEN')
    if (def.scope !== 'tenant') {
      throw new Error(`require() got org-scope permission ${code}, use requireAt()`)
    }
    if (!(await this.hasTenantPermission(principal, def))) throw new ORPCError('FORBIDDEN')
  }

  async canAt(principal: Principal, code: string, targetOrgNodeId: string): Promise<boolean> {
    const def = this.registry.get(code)
    if (!def) return false
    if (def.scope !== 'org') {
      throw new Error(`canAt() got tenant-scope permission ${code}, use require()`)
    }
    if (!def.grantToRole) return false
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select exists(
        select 1
        from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
        join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
        join permissions p on p.id = rp.permission_id and ${this.pinned(def)}
        join org_nodes target on target.tenant_id = a.tenant_id and target.id = ${targetOrgNodeId}
        join org_nodes anchor on anchor.tenant_id = a.tenant_id and anchor.id = a.org_node_id
        where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
          and (
            (a.scope = 'self' and a.org_node_id = ${targetOrgNodeId})
            or (a.scope = 'subtree' and target.path <@ anchor.path)
          )
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }

  async requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
  ): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    if (!this.registry.has(code)) throw new ORPCError('FORBIDDEN')
    if (!(await this.canAt(principal, code, targetOrgNodeId))) throw new ORPCError('FORBIDDEN')
  }

  // for the manifest: which active codes does the user hold from any source.
  // The sql reports raw reachability per channel plus the stored stable
  // fields; the decision (stable semantics match and the channel is open in
  // the active definition) happens against the registry
  async getProfile(principal: Principal): Promise<AccessProfile> {
    const result = await this.ctx.db.drizzle.execute<{
      code: string
      plugin: string
      scope: string
      grant_to_user_type: boolean
      grant_to_role: boolean
      default_tenant_admin: boolean
      via_user_type: boolean
      via_role: boolean
    }>(sql`
      select * from (
        select p.code, p.plugin, p.scope, p.grant_to_user_type, p.grant_to_role,
          p.default_tenant_admin,
          exists(
            select 1 from users u
            join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
            join user_type_permissions utp on utp.tenant_id = u.tenant_id
              and utp.user_type_id = u.user_type_id and utp.permission_id = p.id
            where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
          ) as via_user_type,
          exists(
            select 1 from user_role_assignments a
            join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
            join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
            join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
              and rp.permission_id = p.id
            where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
              and (p.scope = 'org' or r.kind = 'tenant')
          ) as via_role
        from permissions p
        where p.enabled
      ) candidates
      where via_user_type or via_role`)
    const tenantPermissions: string[] = []
    const orgPermissions: string[] = []
    for (const row of result.rows) {
      const def = this.registry.get(row.code)
      if (
        !def ||
        row.plugin !== def.plugin ||
        row.scope !== def.scope ||
        row.grant_to_user_type !== def.grantToUserType ||
        row.grant_to_role !== def.grantToRole ||
        row.default_tenant_admin !== def.defaultTenantAdmin
      ) {
        continue
      }
      const reachable =
        (row.via_user_type && def.grantToUserType) || (row.via_role && def.grantToRole)
      if (!reachable) continue
      if (def.scope === 'tenant') tenantPermissions.push(def.code)
      else orgPermissions.push(def.code)
    }
    return { tenantPermissions: tenantPermissions.sort(), orgPermissions: orgPermissions.sort() }
  }

  // assignment anchors granting one org-scope code, pinned like every
  // other read; consumers use them to project subtree coverage. The handle
  // lets a caller that holds a lock run the read on its own connection.
  async listAuthorizedAnchors(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationAnchor[]> {
    const def = this.registry.get(code)
    if (!def || def.scope !== 'org' || !def.grantToRole) return []
    const db = (handle ?? this.ctx.db.drizzle) as Context['db']['drizzle']
    const result = await db.execute<{
      org_node_id: string
      scope: 'self' | 'subtree'
    }>(sql`
      select distinct a.org_node_id, a.scope
      from user_role_assignments a
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
      join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
      join permissions p on p.id = rp.permission_id and ${this.pinned(def)}
      where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}`)
    return result.rows.map((row) => ({ orgNodeId: row.org_node_id, scope: row.scope }))
  }

  private async hasTenantPermission(
    principal: Principal,
    def: ActivePermission,
  ): Promise<boolean> {
    // each branch opens only when the active definition allows the channel;
    // the database flags alone can never open one
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select (
        (${def.grantToUserType} and exists(
          select 1 from users u
          join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
          join user_type_permissions utp on utp.tenant_id = u.tenant_id
            and utp.user_type_id = u.user_type_id
          join permissions p on p.id = utp.permission_id and ${this.pinned(def)}
          where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
        ))
        or (${def.grantToRole} and exists(
          select 1 from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
            and r.enabled and r.kind = 'tenant'
          join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
          join permissions p on p.id = rp.permission_id and ${this.pinned(def)}
          where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
        ))
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }

  private async hasAnyOrgPermission(
    principal: Principal,
    def: ActivePermission,
  ): Promise<boolean> {
    if (!def.grantToRole) return false
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select exists(
        select 1 from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
        join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
        join permissions p on p.id = rp.permission_id and ${this.pinned(def)}
        where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }
}
