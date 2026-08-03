import { sql, type SQL } from 'drizzle-orm'
import type { Context } from 'cordis'
import { AccessDeniedError, decodeCursor } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import { anchorCoverage, type Principal } from '@qualy/rbac-contract'
import { iamErrors } from './errors.ts'

// Identity administration: user types and users.
//
// Every mutation runs in one transaction whose first statement locks the
// tenant row — the same lock org structural writes and rbac grant writes
// take. Two things follow, and both matter:
//
//   authorization is decided INSIDE that transaction rather than in the
//   router, because a node can be moved out of the caller's authority
//   between a pre-check and the write it was supposed to guard; and
//
//   the lockout invariant is checked AFTER the write, so it reads the state
//   the transaction actually leaves rather than a prediction of it, and a
//   failure simply rolls everything back.

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
  manageable: boolean
}

export interface UserTypeInput {
  code: string
  name: string
  description?: string
  allowLocalLogin?: boolean
  allowSsoLogin?: boolean
  sortOrder?: number
  // a type is created complete: one that opens no sign-in channel and holds
  // no permissions exists, is enabled, and cannot be used for anything
  permissionCodes?: readonly string[]
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

  // serializes identity writes against each other, against org structural
  // writes and against rbac grant writes, which all take the same lock
  private async lockTenant(tx: Tx, tenantId: string) {
    const row = (await tx.execute(sql`select 1 from tenants where id = ${tenantId} for update`))
      .rows[0]
    if (!row) throw new Error(`tenant ${tenantId} does not exist`)
  }

  // authority over a user is authority over where they stand, re-decided on
  // the locked connection. A system-level caller (seed, cross-plugin service
  // use) passes no actor and is trusted.
  private async assertManagesNode(tx: Tx, actor: Principal | undefined, orgNodeId: string) {
    if (!actor) return
    const allowed = await this.ctx.rbac.canAt(actor, 'auth.user.manage', orgNodeId, tx)
    if (!allowed) throw new AccessDeniedError('not allowed to administer users at this node')
  }

  // --- user types ---

  private userTypeProjection(where: SQL) {
    return sql`
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
      where ${where}
      order by t.sort_order, t.code`
  }

  async listUserTypes(tenantId: string): Promise<UserTypeRow[]> {
    return (
      await this.db.execute<UserTypeRow>(this.userTypeProjection(sql`t.tenant_id = ${tenantId}`))
    ).rows
  }

  async getUserType(tenantId: string, userTypeId: string): Promise<UserTypeRow> {
    const row = (
      await this.db.execute<UserTypeRow>(
        this.userTypeProjection(sql`t.tenant_id = ${tenantId} and t.id = ${userTypeId}`),
      )
    ).rows[0]
    if (!row) throw iamErrors.create('USER_TYPE_NOT_FOUND')
    return row
  }

  createUserType(tenantId: string, input: UserTypeInput) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into user_types (tenant_id, code, name, description, allow_local_login,
          allow_sso_login, sort_order)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null},
          ${input.allowLocalLogin ?? false}, ${input.allowSsoLogin ?? false},
          ${input.sortOrder ?? 0})
        returning id`)
      const id = created.rows[0]!.id
      await this.replaceTypePermissions(tx, tenantId, id, input.permissionCodes ?? [])
      return id
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
      // fields and sign-in policy stay editable
      await tx.execute(sql`
        update user_types set
          name = coalesce(${fields.name ?? null}, name),
          description = ${fields.description === undefined ? sql`description` : fields.description},
          allow_local_login = coalesce(${fields.allowLocalLogin ?? null}, allow_local_login),
          allow_sso_login = coalesce(${fields.allowSsoLogin ?? null}, allow_sso_login),
          sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
      // closing a sign-in channel can lock a tenant out just as surely as
      // disabling the people who use it
      if (fields.allowLocalLogin === false || fields.allowSsoLogin === false) {
        await this.ctx.rbac.assertTenantKeepsAdministrator(tenantId, tx)
      }
    })
  }

  // Disabling a type people still hold is refused outright. It used to be
  // allowed and did two wrong things at once: it revoked sign-in for every
  // holder without ending a single session, so re-enabling the type handed
  // those sessions straight back. A mass suspension is a different operation
  // with a different shape (an expected count, a reason, session
  // termination) and should be built as one when it is actually needed.
  setUserTypeEnabled(tenantId: string, userTypeId: string, enabled: boolean) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      if (!enabled) {
        const inUse = await this.countUsersOfType(tx, tenantId, type.id)
        if (inUse > 0) throw iamErrors.create('USER_TYPE_IN_USE', { userCount: inUse })
      }
      await tx.execute(sql`
        update user_types set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
    })
  }

  syncUserTypePermissions(tenantId: string, userTypeId: string, codes: readonly string[]) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      await this.replaceTypePermissions(tx, tenantId, type.id, codes)
    })
  }

  // replaces the whole grant set: only tenant-scope permissions that declare
  // the user-type channel may be granted, and the database trigger is the
  // final backstop
  private async replaceTypePermissions(
    tx: Tx,
    tenantId: string,
    userTypeId: string,
    codes: readonly string[],
  ) {
    const wanted = [...new Set(codes)]
    if (wanted.length > 0) {
      const grantable = (
        await tx.execute<{ code: string }>(sql`
          select code from permissions
          where code = any(string_to_array(${wanted.join(',')}, ','))
            and enabled and grant_to_user_type and scope = 'tenant'`)
      ).rows.map((row) => row.code)
      const rejected = wanted.filter((code) => !grantable.includes(code))
      if (rejected.length > 0) throw iamErrors.create('PERMISSION_NOT_GRANTABLE', { rejected })
    }
    await tx.execute(sql`
      delete from user_type_permissions
      where tenant_id = ${tenantId} and user_type_id = ${userTypeId}
        and permission_id not in (
          select id from permissions
          where code = any(string_to_array(${wanted.join(',')}, ','))
        )`)
    if (wanted.length > 0) {
      await tx.execute(sql`
        insert into user_type_permissions (tenant_id, user_type_id, permission_id)
        select ${tenantId}, ${userTypeId}, p.id from permissions p
        where p.code = any(string_to_array(${wanted.join(',')}, ','))
        on conflict do nothing`)
    }
  }

  deleteUserType(tenantId: string, userTypeId: string) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId)
      if (type.is_system) throw iamErrors.create('USER_TYPE_IS_SYSTEM')
      const inUse = await this.countUsersOfType(tx, tenantId, type.id)
      if (inUse > 0) throw iamErrors.create('USER_TYPE_IN_USE', { userCount: inUse })
      // eligibility rows cascade with the type, which would silently empty a
      // role's allowed set and leave that role assignable to nobody; the
      // count says how many roles must be fixed first
      const stranded = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from roles r
          where r.tenant_id = ${tenantId} and r.kind = 'org'
            and exists (select 1 from role_allowed_user_types t
                        where t.tenant_id = r.tenant_id and t.role_id = r.id
                          and t.user_type_id = ${type.id})
            and not exists (select 1 from role_allowed_user_types t
                            where t.tenant_id = r.tenant_id and t.role_id = r.id
                              and t.user_type_id <> ${type.id})`)
      ).rows[0]!.count
      if (stranded > 0) throw iamErrors.create('USER_TYPE_LAST_FOR_ROLE', { roleCount: stranded })
      await tx.execute(sql`
        delete from user_types where tenant_id = ${tenantId} and id = ${type.id}`)
    })
  }

  // --- users ---

  // Users of one org node or of its subtree, intersected with what the
  // caller's own grants actually reach. The requested scope alone decided
  // this once, which meant a bare self grant at a node returned every user
  // below it. A partial subtree is the correct answer here, not an error.
  async listUsers(
    principal: Principal,
    input: {
      orgNodeId: string
      scope: 'self' | 'subtree'
      search?: string
      cursor?: string
      limit: number
    },
  ): Promise<UserRow[]> {
    const [readAnchors, manageAnchors] = await Promise.all([
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.read'),
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.manage'),
    ])
    if (readAnchors.length === 0) return []
    const after = decodeCursor(input.cursor, 2)
    const requested =
      input.scope === 'subtree' ? sql`n.path <@ requested.path` : sql`n.id = requested.id`
    const result = await this.db.execute<UserRow>(sql`
      select u.id, u.business_no, u.display_name, u.enabled,
        u.user_type_id, t.code as user_type_code, t.name as user_type_name,
        u.primary_org_node_id, n.name as primary_org_node_name,
        (select i.identifier from user_identities i
         where i.tenant_id = u.tenant_id and i.user_id = u.id
         order by i.bound_at limit 1) as identifier,
        ${anchorCoverage(manageAnchors, 'n')} as manageable
      from users u
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
      join org_nodes requested on requested.tenant_id = u.tenant_id
        and requested.id = ${input.orgNodeId}
      where u.tenant_id = ${principal.tenantId}
        and ${requested}
        and ${anchorCoverage(readAnchors, 'n')}
        and (${input.search ?? null}::text is null
             or u.display_name ilike '%' || ${input.search ?? ''} || '%'
             or coalesce(u.business_no, '') ilike '%' || ${input.search ?? ''} || '%')
        and (${after?.[0] ?? null}::text is null
             or (u.display_name, u.id::text) > (${after?.[0] ?? ''}, ${after?.[1] ?? ''}))
      order by u.display_name, u.id
      limit ${input.limit}`)
    return result.rows
  }

  async getUser(principal: Principal, userId: string): Promise<UserRow> {
    const [readAnchors, manageAnchors] = await Promise.all([
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.read'),
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.manage'),
    ])
    const row = (
      await this.db.execute<UserRow>(sql`
        select u.id, u.business_no, u.display_name, u.enabled,
          u.user_type_id, t.code as user_type_code, t.name as user_type_name,
          u.primary_org_node_id, n.name as primary_org_node_name,
          (select i.identifier from user_identities i
           where i.tenant_id = u.tenant_id and i.user_id = u.id
           order by i.bound_at limit 1) as identifier,
          ${anchorCoverage(manageAnchors, 'n')} as manageable
        from users u
        join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        where u.tenant_id = ${principal.tenantId} and u.id = ${userId}
          and ${anchorCoverage(readAnchors, 'n')}`)
    ).rows[0]
    // not-found and not-readable are indistinguishable on purpose
    if (!row) throw iamErrors.create('USER_NOT_FOUND')
    return row
  }

  // where the caller may administer users at all, and which types they may
  // give someone. The users screen needs both and holds only auth.user.read,
  // so making it also carry org.tree.read and auth.user-type.read would sit a
  // legitimate org administrator in front of an empty picker.
  async userOptions(principal: Principal): Promise<{
    anchors: { orgNodeId: string; name: string; scope: 'self' | 'subtree'; manageable: boolean }[]
    userTypes: { id: string; code: string; name: string }[]
  }> {
    const [readAnchors, manageAnchors] = await Promise.all([
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.read'),
      this.ctx.rbac.listAuthorizedAnchors(principal, 'auth.user.manage'),
    ])
    if (readAnchors.length === 0) return { anchors: [], userTypes: [] }
    const manageable = new Set(manageAnchors.map((anchor) => anchor.orgNodeId))
    const ids = [...new Set(readAnchors.map((anchor) => anchor.orgNodeId))]
    const names = new Map(
      (
        await this.db.execute<{ id: string; name: string }>(sql`
          select id, name from org_nodes
          where tenant_id = ${principal.tenantId}
            and id = any(string_to_array(${ids.join(',')}, ',')::uuid[])`)
      ).rows.map((row) => [row.id, row.name]),
    )
    // an anchor pointing at a vanished node simply drops out (fail closed)
    const anchors = readAnchors.flatMap((anchor) => {
      const name = names.get(anchor.orgNodeId)
      return name === undefined
        ? []
        : [
            {
              orgNodeId: anchor.orgNodeId,
              name,
              scope: anchor.scope,
              manageable: manageable.has(anchor.orgNodeId),
            },
          ]
    })
    const userTypes = (
      await this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from user_types
        where tenant_id = ${principal.tenantId} and enabled
        order by sort_order, code`)
    ).rows
    return { anchors, userTypes }
  }

  createUser(
    tenantId: string,
    input: {
      displayName: string
      userTypeId: string
      primaryOrgNodeId: string
      businessNo?: string
    },
    actor?: Principal,
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      // authority follows the node the user will stand on
      await this.assertManagesNode(tx, actor, input.primaryOrgNodeId)
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

  // changing someone's type is the cross-domain case: it must stay
  // compatible with the grants they already hold, and it must not take away
  // the tenant's last way in
  updateUser(
    tenantId: string,
    userId: string,
    fields: { displayName?: string; userTypeId?: string; businessNo?: string },
    actor?: Principal,
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      await this.assertManagesNode(tx, actor, user.primary_org_node_id)
      const changingType =
        fields.userTypeId !== undefined && fields.userTypeId !== user.user_type_id
      if (changingType) {
        const type = await this.requireUserType(tx, tenantId, fields.userTypeId!)
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
      // a type change can move the last administrator onto a type that
      // cannot sign in at all
      if (changingType) await this.ctx.rbac.assertTenantKeepsAdministrator(tenantId, tx)
    })
  }

  // moving someone is not an ordinary field edit: it changes who administers
  // them, so both ends must be inside the caller's own authority
  setUserPlacement(tenantId: string, userId: string, primaryOrgNodeId: string, actor?: Principal) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      await this.assertManagesNode(tx, actor, user.primary_org_node_id)
      await this.assertManagesNode(tx, actor, primaryOrgNodeId)
      await this.requireOrgNode(tx, tenantId, primaryOrgNodeId)
      await tx.execute(sql`
        update users set primary_org_node_id = ${primaryOrgNodeId}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${user.id}`)
    })
  }

  setUserEnabled(tenantId: string, userId: string, enabled: boolean, actor?: Principal) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      await this.assertManagesNode(tx, actor, user.primary_org_node_id)
      await tx.execute(sql`
        update users set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${user.id}`)
      if (!enabled) {
        // a disabled user must lose access now, not when their session
        // happens to expire
        await tx.execute(sql`
          delete from sessions where tenant_id = ${tenantId} and user_id = ${user.id}`)
        await this.ctx.rbac.assertTenantKeepsAdministrator(tenantId, tx)
      }
    })
  }

  // --- shared guards ---

  private async countUsersOfType(tx: Tx, tenantId: string, userTypeId: string): Promise<number> {
    return (
      await tx.execute<{ count: number }>(sql`
        select count(*)::int as count from users
        where tenant_id = ${tenantId} and user_type_id = ${userTypeId}`)
    ).rows[0]!.count
  }

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
}

export { AccessDeniedError }
