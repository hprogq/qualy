import { ORPCError } from '@orpc/server'
import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { AccessProfile, Principal } from '@qualy/rbac-contract'
import type { PermissionRegistry } from './permission-registry.ts'

// authorization checks. Every query enforces the grant channel declared on
// the permission row (grant_to_user_type / grant_to_role) as defence in
// depth: a grant written through a bare-sql path against the channel rules
// never produces effective permission.
export class Authorization {
  constructor(
    private ctx: Context,
    private registry: PermissionRegistry,
  ) {}

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
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select exists(
        select 1
        from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
        join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
        join permissions p on p.id = rp.permission_id and p.enabled and p.grant_to_role
          and p.scope = 'org' and p.code = ${code} and p.plugin = ${def.plugin}
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

  // for the manifest: which active codes does the user hold from any source
  async getProfile(principal: Principal): Promise<AccessProfile> {
    const result = await this.ctx.db.drizzle.execute<{
      code: string
      scope: string
      plugin: string
    }>(sql`
      select distinct p.code, p.scope, p.plugin
      from permissions p
      where p.enabled and (
        (p.grant_to_user_type and exists(
          select 1 from users u
          join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
          join user_type_permissions utp on utp.tenant_id = u.tenant_id
            and utp.user_type_id = u.user_type_id and utp.permission_id = p.id
          where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
        ))
        or (p.grant_to_role and exists(
          select 1 from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
          join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
            and rp.permission_id = p.id
          where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
            and (p.scope = 'org' or r.kind = 'tenant')
        ))
      )`)
    const tenantPermissions: string[] = []
    const orgPermissions: string[] = []
    for (const row of result.rows) {
      if (this.registry.get(row.code)?.plugin !== row.plugin) continue
      if (row.scope === 'tenant') tenantPermissions.push(row.code)
      else orgPermissions.push(row.code)
    }
    return { tenantPermissions: tenantPermissions.sort(), orgPermissions: orgPermissions.sort() }
  }

  private async hasTenantPermission(
    principal: Principal,
    def: { code: string; plugin: string },
  ): Promise<boolean> {
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select (
        exists(
          select 1 from users u
          join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
          join user_type_permissions utp on utp.tenant_id = u.tenant_id
            and utp.user_type_id = u.user_type_id
          join permissions p on p.id = utp.permission_id and p.enabled and p.grant_to_user_type
            and p.scope = 'tenant' and p.code = ${def.code} and p.plugin = ${def.plugin}
          where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
        )
        or exists(
          select 1 from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
            and r.enabled and r.kind = 'tenant'
          join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
          join permissions p on p.id = rp.permission_id and p.enabled and p.grant_to_role
            and p.scope = 'tenant' and p.code = ${def.code} and p.plugin = ${def.plugin}
          where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
        )
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }

  private async hasAnyOrgPermission(
    principal: Principal,
    def: { code: string; plugin: string },
  ): Promise<boolean> {
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select exists(
        select 1 from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
        join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
        join permissions p on p.id = rp.permission_id and p.enabled and p.grant_to_role
          and p.scope = 'org' and p.code = ${def.code} and p.plugin = ${def.plugin}
        where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }
}
