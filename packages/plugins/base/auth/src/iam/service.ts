import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import { AccessDeniedError } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import { iamErrors } from './errors.ts'

// Identity administration: user types and users. Like the org tree, every
// mutation runs in one transaction whose first statement locks the tenant
// row, so a check and the write it guards never race — and rbac's
// assignment writes take the same lock, which is what lets the
// cross-domain checks below (a user's type against its existing role
// assignments) be trusted.

type Drizzle = Context['db']['drizzle']
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0]

const translateDbError: (error: unknown) => never = createConstraintTranslator({
  uq_user_types_tenant_code: () => iamErrors.create('USER_TYPE_CONFLICT'),
  uq_users_tenant_business_no: () => iamErrors.create('USER_CONFLICT'),
  uq_user_identities_login: () => iamErrors.create('IDENTITY_CONFLICT'),
  uq_user_types_tenant_name: () =>
    iamErrors.create('USER_TYPE_CONFLICT', 'a user type with that name already exists'),
  fk_users_user_type: () => iamErrors.create('USER_TYPE_NOT_FOUND'),
  fk_users_primary_org_node: () => iamErrors.create('USER_PLACEMENT_NOT_FOUND'),
})

export type UserTypeRow = {
  id: string
  code: string
  name: string
  description: string | null
  allow_local_login: boolean
  allow_sso_login: boolean
  enabled: boolean
  is_system: boolean
  sort_order: number
  user_count: number
  permissions: string[]
}

export type UserRow = {
  id: string
  business_no: string | null
  display_name: string
  enabled: boolean
  user_type_id: string
  user_type_code: string
  user_type_name: string
  primary_org_node_id: string
  primary_org_node_name: string
  identifier: string | null
}

export class IamService {
  constructor(private ctx: Context) {}

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

  // serializes structural identity writes against each other and against
  // rbac's assignment writes, which take the same lock
  private async lockTenant(tx: Tx, tenantId: string) {
    const row = (await tx.execute(sql`select 1 from tenants where id = ${tenantId} for update`))
      .rows[0]
    if (!row) throw new Error(`tenant ${tenantId} does not exist`)
  }

  // --- user types ---

  async listUserTypes(tenantId: string): Promise<UserTypeRow[]> {
    const result = await this.db.execute<UserTypeRow>(sql`
      select t.id, t.code, t.name, t.description, t.allow_local_login, t.allow_sso_login,
        t.enabled, t.is_system, t.sort_order,
        (select count(*)::int from users u where u.tenant_id = t.tenant_id and u.user_type_id = t.id)
          as user_count,
        coalesce(
          (select array_agg(p.code order by p.code)
           from user_type_permissions utp
           join permissions p on p.id = utp.permission_id
           where utp.tenant_id = t.tenant_id and utp.user_type_id = t.id),
          '{}') as permissions
      from user_types t
      where t.tenant_id = ${tenantId}
      order by t.sort_order, t.code`)
    return result.rows
  }

  createUserType(
    tenantId: string,
    input: {
      code: string
      name: string
      description?: string
      allowLocalLogin?: boolean
      allowSsoLogin?: boolean
      sortOrder?: number
    },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into user_types (tenant_id, code, name, description, allow_local_login,
          allow_sso_login, sort_order)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null},
          ${input.allowLocalLogin ?? false}, ${input.allowSsoLogin ?? false},
          ${input.sortOrder ?? 0})
        returning id`)
      return created.rows[0]!.id
    })
  }

  updateUserType(
    tenantId: string,
    userTypeId: string,
    fields: {
      name?: string
      description?: string | null
      allowLocalLogin?: boolean
      allowSsoLogin?: boolean
      sortOrder?: number
    },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      // a system type's code and system flag are immutable; its display
      // fields and login policy stay editable
      await tx.execute(sql`
        update user_types set
          name = coalesce(${fields.name ?? null}, name),
          description = ${fields.description === undefined ? sql`description` : fields.description},
          allow_local_login = coalesce(${fields.allowLocalLogin ?? null}, allow_local_login),
          allow_sso_login = coalesce(${fields.allowSsoLogin ?? null}, allow_sso_login),
          sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
    })
  }

  setUserTypeEnabled(tenantId: string, userTypeId: string, enabled: boolean) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      if (!enabled) {
        // disabling a type disables every sign-in that depends on it, so the
        // tenant must keep an enabled administrator afterwards
        await this.assertAdministratorSurvives(tx, tenantId, { disablingUserTypeId: type.id })
      }
      await tx.execute(sql`
        update user_types set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
      // sessions are re-validated against the type on every request, so a
      // disabled type takes effect immediately without touching the table
    })
  }

  // replaces the whole grant set in one transaction: only tenant-scope
  // permissions that declare the user-type channel may be granted, and the
  // database trigger is the final backstop
  syncUserTypePermissions(tenantId: string, userTypeId: string, codes: readonly string[]) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      const wanted = [...new Set(codes)]
      if (wanted.length > 0) {
        const grantable = (
          await tx.execute<{ code: string }>(sql`
            select code from permissions
            where code = any(string_to_array(${wanted.join(',')}, ','))
              and enabled and grant_to_user_type and scope = 'tenant'`)
        ).rows.map((row) => row.code)
        const rejected = wanted.filter((code) => !grantable.includes(code))
        if (rejected.length > 0) {
          throw iamErrors.create('PERMISSION_NOT_GRANTABLE', { rejected })
        }
      }
      await tx.execute(sql`
        delete from user_type_permissions
        where tenant_id = ${tenantId} and user_type_id = ${type.id}
          and permission_id not in (
            select id from permissions
            where code = any(string_to_array(${wanted.join(',')}, ','))
          )`)
      if (wanted.length > 0) {
        await tx.execute(sql`
          insert into user_type_permissions (tenant_id, user_type_id, permission_id)
          select ${tenantId}, ${type.id}, p.id from permissions p
          where p.code = any(string_to_array(${wanted.join(',')}, ','))
          on conflict do nothing`)
      }
    })
  }

  deleteUserType(tenantId: string, userTypeId: string) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      if (type.is_system) throw iamErrors.create('USER_TYPE_IS_SYSTEM')
      const inUse = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from users
          where tenant_id = ${tenantId} and user_type_id = ${type.id}`)
      ).rows[0]!.count
      if (inUse > 0) throw iamErrors.create('USER_TYPE_IN_USE', { userCount: inUse })
      await tx.execute(sql`
        delete from user_types where tenant_id = ${tenantId} and id = ${type.id}`)
    })
  }

  // --- users ---

  // users of one org node, or of its whole subtree; the caller has already
  // been authorized at the requested node
  async listUsers(
    tenantId: string,
    input: { orgNodeId: string; subtree: boolean; search?: string },
  ): Promise<UserRow[]> {
    const result = await this.db.execute<UserRow>(sql`
      select u.id, u.business_no, u.display_name, u.enabled,
        u.user_type_id, t.code as user_type_code, t.name as user_type_name,
        u.primary_org_node_id, n.name as primary_org_node_name,
        (select i.identifier from user_identities i
         where i.tenant_id = u.tenant_id and i.user_id = u.id
         order by i.bound_at limit 1) as identifier
      from users u
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
      join org_nodes anchor on anchor.tenant_id = u.tenant_id and anchor.id = ${input.orgNodeId}
      where u.tenant_id = ${tenantId}
        and (${input.subtree} and n.path <@ anchor.path or n.id = anchor.id)
        and (${input.search ?? null}::text is null
             or u.display_name ilike '%' || ${input.search ?? ''} || '%'
             or coalesce(u.business_no, '') ilike '%' || ${input.search ?? ''} || '%')
      order by u.display_name, u.id
      limit 200`)
    return result.rows
  }

  createUser(
    tenantId: string,
    input: {
      displayName: string
      userTypeId: string
      primaryOrgNodeId: string
      businessNo?: string
    },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, input.userTypeId)
      if (!type.enabled) throw iamErrors.create('USER_TYPE_DISABLED')
      await this.requireOrgNode(tx, tenantId, input.primaryOrgNodeId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
        values (${tenantId}, ${input.displayName}, ${type.id}, ${input.primaryOrgNodeId},
          ${input.businessNo ?? null})
        returning id`)
      return created.rows[0]!.id
    })
  }

  // changing the type or the placement of a user is the cross-domain case:
  // both must stay compatible with the role assignments the user already
  // holds, checked under the same tenant lock those assignments take
  updateUser(
    tenantId: string,
    userId: string,
    fields: { displayName?: string; userTypeId?: string; businessNo?: string },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      if (fields.userTypeId && fields.userTypeId !== user.user_type_id) {
        const type = await this.requireUserType(tx, tenantId, fields.userTypeId)
        if (!type.enabled) throw iamErrors.create('USER_TYPE_DISABLED')
        const blocking = (
          await tx.execute<{ count: number }>(sql`
            select count(*)::int as count
            from user_role_assignments a
            join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.kind = 'org'
            where a.tenant_id = ${tenantId} and a.user_id = ${user.id}
              and not exists (
                select 1 from role_allowed_user_types t
                where t.tenant_id = a.tenant_id and t.role_id = a.role_id
                  and t.user_type_id = ${type.id})`)
        ).rows[0]!.count
        if (blocking > 0) {
          throw iamErrors.create('ASSIGNMENT_INCOMPATIBLE', { assignmentCount: blocking })
        }
      }
      await tx.execute(sql`
        update users set
          display_name = coalesce(${fields.displayName ?? null}, display_name),
          user_type_id = coalesce(${fields.userTypeId ?? null}, user_type_id),
          business_no = coalesce(${fields.businessNo ?? null}, business_no),
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${user.id}`)
    })
  }

  setUserEnabled(tenantId: string, userId: string, enabled: boolean) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      if (!enabled) {
        await this.assertAdministratorSurvives(tx, tenantId, { disablingUserId: user.id })
      }
      await tx.execute(sql`
        update users set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${user.id}`)
      if (!enabled) {
        // a disabled user must lose access now, not when their session
        // happens to expire
        await tx.execute(sql`
          delete from sessions where tenant_id = ${tenantId} and user_id = ${user.id}`)
      }
    })
  }

  // where a user stands, which is where authority over them is decided
  async userOrgNode(tenantId: string, userId: string): Promise<string> {
    const row = (
      await this.db.execute<{ primary_org_node_id: string }>(sql`
        select primary_org_node_id from users
        where tenant_id = ${tenantId} and id = ${userId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_NOT_FOUND')
    return row.primary_org_node_id
  }

  // --- shared guards ---

  private async requireUserType(tx: Tx, tenantId: string, userTypeId: string) {
    const row = (
      await tx.execute<{ id: string; enabled: boolean; is_system: boolean }>(sql`
        select id, enabled, is_system from user_types
        where tenant_id = ${tenantId} and id = ${userTypeId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_TYPE_NOT_FOUND')
    return row
  }

  private async requireUser(tx: Tx, tenantId: string, userId: string) {
    const row = (
      await tx.execute<{ id: string; user_type_id: string; primary_org_node_id: string }>(sql`
        select id, user_type_id, primary_org_node_id from users
        where tenant_id = ${tenantId} and id = ${userId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_NOT_FOUND')
    return row
  }

  private async requireOrgNode(tx: Tx, tenantId: string, orgNodeId: string) {
    const row = (
      await tx.execute(sql`
        select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_PLACEMENT_NOT_FOUND')
  }

  // the tenant must always keep one enabled user who can actually sign in
  // and holds the canonical tenant-admin role. Locking that role row is what
  // serializes concurrent lockout attempts.
  private async assertAdministratorSurvives(
    tx: Tx,
    tenantId: string,
    exclude: { disablingUserId?: string; disablingUserTypeId?: string },
  ) {
    const role = (
      await tx.execute<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${tenantId} and code = 'tenant-admin' and is_system and kind = 'tenant'
        for update`)
    ).rows[0]
    if (!role) return
    const survivors = (
      await tx.execute<{ count: string }>(sql`
        select count(distinct a.user_id) as count
        from user_role_assignments a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id and t.enabled
        where a.tenant_id = ${tenantId} and a.role_id = ${role.id}
          and (${exclude.disablingUserId ?? null}::uuid is null
               or u.id <> ${exclude.disablingUserId ?? null})
          and (${exclude.disablingUserTypeId ?? null}::uuid is null
               or u.user_type_id <> ${exclude.disablingUserTypeId ?? null})`)
    ).rows[0]
    if (Number(survivors?.count ?? 0) === 0) throw iamErrors.create('LAST_ADMINISTRATOR')
  }
}

export { AccessDeniedError }
