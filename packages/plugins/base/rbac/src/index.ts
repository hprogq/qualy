import { ORPCError } from '@orpc/server'
import { sql } from 'drizzle-orm'
import { Context, Service } from 'cordis'
import type { AuthPrincipal } from '@qualy/plugin-server'
import { rbacPermissions } from './permissions.ts'

declare module 'cordis' {
  interface Context {
    rbac: Rbac
  }
}

export interface PermissionDefinition {
  code: string
  name: string
  description?: string
  groupKey?: string
  scope: 'tenant' | 'org'
  grantToUserType: boolean
  grantToRole: boolean
  defaultTenantAdmin: boolean
}

export interface AccessProfile {
  tenantPermissions: string[]
  orgPermissions: string[]
}

export interface AssignmentInput {
  tenantId: string
  userId: string
  roleId: string
  orgNodeId: string
  scope: 'self' | 'subtree'
}

const PERMISSION_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

// authorization core. Plugins declare their permission catalogs; the active
// in-memory registry gates every check (a deactivated plugin's codes fail
// closed while database rows and grants survive), and a serial background
// task mirrors definitions into the permissions table. tenant-admin gets
// every defaultTenantAdmin code idempotently — there is no bypass anywhere,
// admins go through real role permissions.
export default class Rbac extends Service {
  static inject = ['db']

  private active = new Map<string, PermissionDefinition & { plugin: string }>()
  // stable box: reassigning service properties from caller-traceable
  // closures does not stick (see notes/cordis.md)
  private syncBox: { chain: Promise<void> } = { chain: Promise.resolve() }

  constructor(ctx: Context) {
    super(ctx, 'rbac')
    this.definePermissions('rbac', rbacPermissions)
  }

  // -- permission registry ------------------------------------------------

  definePermissions(plugin: string, definitions: readonly PermissionDefinition[]) {
    for (const def of definitions) {
      if (!PERMISSION_CODE.test(def.code)) {
        throw new Error(`permission code "${def.code}" must be dotted lower-case`)
      }
      if (def.grantToUserType && def.scope !== 'tenant') {
        throw new Error(`permission ${def.code}: only tenant scope may grant to user types`)
      }
    }
    return this.ctx.effect(() => {
      for (const def of definitions) {
        const existing = this.active.get(def.code)
        if (existing) {
          throw new Error(
            `permission code conflict: ${def.code} (already active via ${existing.plugin})`,
          )
        }
      }
      for (const def of definitions) this.active.set(def.code, { ...def, plugin })
      this.queueSync(plugin, definitions)
      return () => {
        for (const def of definitions) {
          if (this.active.get(def.code)?.plugin === plugin) this.active.delete(def.code)
        }
      }
    }, `permissions:${plugin}`)
  }

  // resolves when every queued definition has been mirrored to the database
  whenSynced(): Promise<void> {
    return this.syncBox.chain
  }

  private queueSync(plugin: string, definitions: readonly PermissionDefinition[]) {
    const box = this.syncBox
    box.chain = box.chain
      .then(() => this.syncDefinitions(plugin, definitions))
      .catch((error) => this.ctx.logger.error(error))
  }

  private async syncDefinitions(plugin: string, definitions: readonly PermissionDefinition[]) {
    const db = this.ctx.db.drizzle
    for (const def of definitions) {
      const existing = (
        await db.execute<{
          scope: string
          grant_to_user_type: boolean
          grant_to_role: boolean
        }>(sql`select scope, grant_to_user_type, grant_to_role from permissions
               where code = ${def.code}`)
      ).rows[0]
      if (!existing) {
        await db.execute(sql`
          insert into permissions (code, plugin, name, description, group_key, scope,
            grant_to_user_type, grant_to_role, default_tenant_admin)
          values (${def.code}, ${plugin}, ${def.name},
            ${def.description ?? null}, ${def.groupKey ?? null}, ${def.scope},
            ${def.grantToUserType}, ${def.grantToRole}, ${def.defaultTenantAdmin})
          on conflict (code) do nothing`)
      } else if (
        existing.scope !== def.scope ||
        existing.grant_to_user_type !== def.grantToUserType ||
        existing.grant_to_role !== def.grantToRole
      ) {
        // stable semantics drifted: a changed meaning needs a NEW code. The
        // definition leaves the active set so authorization fails closed.
        this.ctx.logger.error(
          'permission %s definition conflicts with its database row, disabling it ' +
            '(create a new code instead of changing semantics)',
          def.code,
        )
        this.active.delete(def.code)
        continue
      } else {
        await db.execute(sql`
          update permissions set name = ${def.name}, description = ${def.description ?? null},
            group_key = ${def.groupKey ?? null}, default_tenant_admin = ${def.defaultTenantAdmin},
            updated_at = now()
          where code = ${def.code}`)
      }
      if (def.defaultTenantAdmin) {
        // every tenant's system tenant-admin role picks the code up idempotently
        await db.execute(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select r.tenant_id, r.id, p.id
          from roles r, permissions p
          where r.code = 'tenant-admin' and r.is_system and p.code = ${def.code}
          on conflict do nothing`)
      }
    }
  }

  // -- authorization ------------------------------------------------------

  async hasPermission(principal: AuthPrincipal, code: string): Promise<boolean> {
    const def = this.active.get(code)
    if (!def) return false
    return def.scope === 'tenant'
      ? this.hasTenantPermission(principal, code)
      : this.hasAnyOrgPermission(principal, code)
  }

  // tenant-scope gate: user-type grants and tenant-role grants, unioned
  async require(principal: AuthPrincipal | undefined, code: string): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    const def = this.active.get(code)
    if (!def) throw new ORPCError('FORBIDDEN')
    if (def.scope !== 'tenant') {
      throw new Error(`require() got org-scope permission ${code}, use requireAt()`)
    }
    if (!(await this.hasTenantPermission(principal, code))) throw new ORPCError('FORBIDDEN')
  }

  async canAt(principal: AuthPrincipal, code: string, targetOrgNodeId: string): Promise<boolean> {
    const def = this.active.get(code)
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
        join permissions p on p.id = rp.permission_id and p.enabled
          and p.scope = 'org' and p.code = ${code}
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
    principal: AuthPrincipal | undefined,
    code: string,
    targetOrgNodeId: string,
  ): Promise<void> {
    if (!principal) throw new ORPCError('AUTH_REQUIRED')
    if (!this.active.has(code)) throw new ORPCError('FORBIDDEN')
    if (!(await this.canAt(principal, code, targetOrgNodeId))) throw new ORPCError('FORBIDDEN')
  }

  // for the manifest: which active codes does the user hold from any source
  async getProfile(principal: AuthPrincipal): Promise<AccessProfile> {
    const result = await this.ctx.db.drizzle.execute<{ code: string; scope: string }>(sql`
      select distinct p.code, p.scope
      from permissions p
      where p.enabled and (
        exists(
          select 1 from users u
          join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
          join user_type_permissions utp on utp.tenant_id = u.tenant_id
            and utp.user_type_id = u.user_type_id and utp.permission_id = p.id
          where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
        )
        or exists(
          select 1 from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
          join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
            and rp.permission_id = p.id
          where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
            and (p.scope = 'org' or r.kind = 'tenant')
        )
      )`)
    const tenantPermissions: string[] = []
    const orgPermissions: string[] = []
    for (const row of result.rows) {
      if (!this.active.has(row.code)) continue
      if (row.scope === 'tenant') tenantPermissions.push(row.code)
      else orgPermissions.push(row.code)
    }
    return { tenantPermissions: tenantPermissions.sort(), orgPermissions: orgPermissions.sort() }
  }

  private async hasTenantPermission(principal: AuthPrincipal, code: string): Promise<boolean> {
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select (
        exists(
          select 1 from users u
          join user_types ut on ut.tenant_id = u.tenant_id and ut.id = u.user_type_id and ut.enabled
          join user_type_permissions utp on utp.tenant_id = u.tenant_id
            and utp.user_type_id = u.user_type_id
          join permissions p on p.id = utp.permission_id and p.enabled
            and p.scope = 'tenant' and p.code = ${code}
          where u.id = ${principal.userId} and u.tenant_id = ${principal.tenantId} and u.enabled
        )
        or exists(
          select 1 from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
            and r.enabled and r.kind = 'tenant'
          join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
          join permissions p on p.id = rp.permission_id and p.enabled
            and p.scope = 'tenant' and p.code = ${code}
          where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
        )
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }

  private async hasAnyOrgPermission(principal: AuthPrincipal, code: string): Promise<boolean> {
    const result = await this.ctx.db.drizzle.execute<{ allowed: boolean }>(sql`
      select exists(
        select 1 from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
        join role_permissions rp on rp.tenant_id = a.tenant_id and rp.role_id = a.role_id
        join permissions p on p.id = rp.permission_id and p.enabled
          and p.scope = 'org' and p.code = ${code}
        where a.tenant_id = ${principal.tenantId} and a.user_id = ${principal.userId}
      ) as allowed`)
    return result.rows[0]?.allowed ?? false
  }

  // -- assignment eligibility (management api arrives next session) -------

  // validates and creates one role assignment inside a transaction: tenant
  // boundary, enabled/assignable state, tenant roles pinned to root/subtree
  // and org roles constrained by their allowed user and org types
  async createAssignment(input: AssignmentInput): Promise<string> {
    const db = this.ctx.db.drizzle
    return db.transaction(async (tx) => {
      const role = (
        await tx.execute<{ kind: string; enabled: boolean; assignable: boolean }>(
          sql`select kind, enabled, assignable from roles
              where tenant_id = ${input.tenantId} and id = ${input.roleId}`,
        )
      ).rows[0]
      if (!role) throw new Error('assignment rejected: role not found in tenant')
      if (!role.enabled || !role.assignable) {
        throw new Error('assignment rejected: role is not assignable')
      }
      const user = (
        await tx.execute<{ user_type_id: string; enabled: boolean }>(
          sql`select user_type_id, enabled from users
              where tenant_id = ${input.tenantId} and id = ${input.userId}`,
        )
      ).rows[0]
      if (!user) throw new Error('assignment rejected: user not found in tenant')
      if (!user.enabled) throw new Error('assignment rejected: user is disabled')
      const node = (
        await tx.execute<{ org_type_id: string; parent_id: string | null }>(
          sql`select org_type_id, parent_id from org_nodes
              where tenant_id = ${input.tenantId} and id = ${input.orgNodeId}`,
        )
      ).rows[0]
      if (!node) throw new Error('assignment rejected: org node not found in tenant')

      if (role.kind === 'tenant') {
        if (node.parent_id !== null || input.scope !== 'subtree') {
          throw new Error('assignment rejected: tenant roles bind to the root with subtree scope')
        }
      } else {
        const allowedType = (
          await tx.execute(sql`select 1 from role_allowed_user_types
            where tenant_id = ${input.tenantId} and role_id = ${input.roleId}
              and user_type_id = ${user.user_type_id}`)
        ).rows[0]
        if (!allowedType) {
          throw new Error('assignment rejected: user type is not allowed for this role')
        }
        const allowedOrg = (
          await tx.execute(sql`select 1 from role_allowed_org_types
            where tenant_id = ${input.tenantId} and role_id = ${input.roleId}
              and org_type_id = ${node.org_type_id}`)
        ).rows[0]
        if (!allowedOrg) {
          throw new Error('assignment rejected: org node type is not allowed for this role')
        }
      }

      const inserted = await tx.execute<{ id: string }>(sql`
        insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
        values (${input.tenantId}, ${input.userId}, ${input.roleId}, ${input.orgNodeId}, ${input.scope})
        on conflict do nothing
        returning id`)
      const id = inserted.rows[0]?.id
      if (!id) throw new Error('assignment rejected: identical assignment already exists')
      return id
    })
  }

  // removing the last effective tenant-admin assignment would lock the
  // tenant out of its own administration
  async removeAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const db = this.ctx.db.drizzle
    await db.transaction(async (tx) => {
      const target = (
        await tx.execute<{ is_system: boolean; kind: string }>(sql`
          select r.is_system, r.kind
          from user_role_assignments a
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
          where a.tenant_id = ${tenantId} and a.id = ${assignmentId}`)
      ).rows[0]
      if (!target) return
      if (target.is_system && target.kind === 'tenant') {
        const survivors = (
          await tx.execute<{ count: string }>(sql`
            select count(*) from user_role_assignments a
            join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
              and r.is_system and r.kind = 'tenant' and r.enabled
            join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
            where a.tenant_id = ${tenantId} and a.id <> ${assignmentId}`)
        ).rows[0]
        if (Number(survivors?.count ?? 0) === 0) {
          throw new Error('assignment rejected: the last tenant administrator cannot be removed')
        }
      }
      await tx.execute(sql`delete from user_role_assignments
        where tenant_id = ${tenantId} and id = ${assignmentId}`)
    })
  }
}
