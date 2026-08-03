import { sql, type SQL } from 'drizzle-orm'
import type { Context } from 'cordis'
import { AccessDeniedError, decodeQueryCursor } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import {
  canonicalTenantAdmin,
  scopeCoverage,
  type AuthorizationScope,
  type Principal,
} from '@qualy/rbac-contract'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
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
  version: number
  placement_mode: PlacementMode
  user_count: number
  allowed_org_types: string[]
}

// Two readings of the same list used to be one: "no org types declared"
// meant "anywhere", so clearing the list widened the rule. The mode says
// which is meant, and an allow-list with nothing on it is simply refused at
// the contract rather than quietly becoming permissive.
export type PlacementMode = 'unrestricted' | 'allow-list'
export type PlacementPolicy =
  | { mode: 'unrestricted' }
  | { mode: 'allow-list'; orgTypeIds: string[] }

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
  identity_count: number
  manageable: boolean
}

export interface UserTypeInput {
  code: string
  name: string
  description?: string
  allowLocalLogin?: boolean
  allowSsoLogin?: boolean
  sortOrder?: number
  placementPolicy: PlacementPolicy
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
        t.enabled, t.is_system, t.sort_order, t.version, t.placement_mode,
        (select count(*)::int from users u where u.tenant_id = t.tenant_id and u.user_type_id = t.id)
          as user_count,
        -- where this kind of person may stand. A type confers no authority,
        -- so this is the whole of what it decides.
        coalesce(
          (select array_agg(a.org_type_id::text)
           from user_type_allowed_org_types a
           where a.tenant_id = t.tenant_id and a.user_type_id = t.id),
          '{}') as allowed_org_types
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

  // Created with its placement policy, because a type that exists without
  // one is a type that constrains nothing: the window between "created" and
  // "configured" is exactly when someone gets placed where they should not
  // be, and it is indistinguishable from a type deliberately left open.
  createUserType(tenantId: string, input: UserTypeInput) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const policy = input.placementPolicy
      const created = await tx.execute<{ id: string }>(sql`
        insert into user_types (tenant_id, code, name, description, allow_local_login,
          allow_sso_login, sort_order, placement_mode)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null},
          ${input.allowLocalLogin ?? false}, ${input.allowSsoLogin ?? false},
          ${input.sortOrder ?? 0}, ${policy.mode})
        returning id`)
      const id = created.rows[0]!.id
      if (policy.mode === 'allow-list') {
        const wanted = [...new Set(policy.orgTypeIds)]
        const list = sql.raw(uuidArray(wanted))
        const found = (
          await tx.execute<{ count: number }>(sql`
            select count(*)::int as count from org_types
            where tenant_id = ${tenantId} and id = any(${list})`)
        ).rows[0]!.count
        if (found !== wanted.length) throw iamErrors.create('USER_TYPE_ORG_TYPE_NOT_FOUND')
        await tx.execute(sql`
          insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
          select ${tenantId}, ${id}, id from unnest(${list}) as id`)
      }
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
    expectedVersion: number,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId, expectedVersion)
      // The system account keeps password sign-in. It is what a tenant
      // recovers itself with, and the generic survivor invariant cannot
      // protect it: that check is satisfied by any open channel, so closing
      // local login while sso is nominally allowed would pass even with no
      // sso provider configured anywhere.
      if (fields.allowLocalLogin === false && type.code === SYSTEM_ACCOUNT_USER_TYPE) {
        throw iamErrors.create('RECOVERY_CHANNEL_REQUIRED')
      }
      // a system type's code and system flag are immutable; its display
      // fields and sign-in policy stay editable
      await tx.execute(sql`
        update user_types set
          name = coalesce(${fields.name ?? null}, name),
          description = ${fields.description === undefined ? sql`description` : fields.description},
          allow_local_login = coalesce(${fields.allowLocalLogin ?? null}, allow_local_login),
          allow_sso_login = coalesce(${fields.allowSsoLogin ?? null}, allow_sso_login),
          sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
          version = version + 1,
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
      // closing a sign-in channel can lock a tenant out just as surely as
      // disabling the people who use it
      if (fields.allowLocalLogin === false || fields.allowSsoLogin === false) {
        await this.ctx.rbac.assertTenantKeepsAdministrator(tenantId, tx)
      }
      return type.version + 1
    })
  }

  // Disabling a type people still hold is refused outright. It used to be
  // allowed and did two wrong things at once: it revoked sign-in for every
  // holder without ending a single session, so re-enabling the type handed
  // those sessions straight back. A mass suspension is a different operation
  // with a different shape (an expected count, a reason, session
  // termination) and should be built as one when it is actually needed.
  setUserTypeEnabled(
    tenantId: string,
    userTypeId: string,
    enabled: boolean,
    expectedVersion: number,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId, expectedVersion)
      // asking for the state it is already in is not an edit, so it neither
      // spends a version nor invalidates whatever else is being edited here
      if (type.enabled === enabled) return type.version
      if (!enabled) {
        const inUse = await this.countUsersOfType(tx, tenantId, type.id)
        if (inUse > 0) throw iamErrors.create('USER_TYPE_IN_USE', { userCount: inUse })
      }
      await tx.execute(sql`
        update user_types set enabled = ${enabled}, version = version + 1, updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
      return type.version + 1
    })
  }

  deleteUserType(tenantId: string, userTypeId: string, expectedVersion: number) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = await this.requireUserType(tx, tenantId, userTypeId, expectedVersion)
      if (type.is_system || type.code === SYSTEM_ACCOUNT_USER_TYPE) {
        throw iamErrors.create('USER_TYPE_IS_SYSTEM')
      }
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
      fingerprint: string
      limit: number
    },
  ): Promise<UserRow[]> {
    const [readScope, manageScope] = await this.scopes(principal)
    if (!readScope.tenantWide && readScope.anchors.length === 0) return []
    const after = decodeQueryCursor(input.cursor, input.fingerprint, 2)
    const requested =
      input.scope === 'subtree' ? sql`n.path <@ requested.path` : sql`n.id = requested.id`
    const result = await this.db.execute<UserRow>(sql`
      select u.id, u.business_no, u.display_name, u.enabled,
        u.user_type_id, t.code as user_type_code, t.name as user_type_name,
        u.primary_org_node_id, n.name as primary_org_node_name,
        (select count(*)::int from user_identities i
         where i.tenant_id = u.tenant_id and i.user_id = u.id) as identity_count,
        ${scopeCoverage(manageScope, 'n')} as manageable
      from users u
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
      join org_nodes requested on requested.tenant_id = u.tenant_id
        and requested.id = ${input.orgNodeId}
      where u.tenant_id = ${principal.tenantId}
        and ${requested}
        and ${scopeCoverage(readScope, 'n')}
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
    const [readScope, manageScope] = await this.scopes(principal)
    const row = (
      await this.db.execute<UserRow>(sql`
        select u.id, u.business_no, u.display_name, u.enabled,
          u.user_type_id, t.code as user_type_code, t.name as user_type_name,
          u.primary_org_node_id, n.name as primary_org_node_name,
          (select count(*)::int from user_identities i
           where i.tenant_id = u.tenant_id and i.user_id = u.id) as identity_count,
          ${scopeCoverage(manageScope, 'n')} as manageable
        from users u
        join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        where u.tenant_id = ${principal.tenantId} and u.id = ${userId}
          and ${scopeCoverage(readScope, 'n')}`)
    ).rows[0]
    // not-found and not-readable are indistinguishable on purpose
    if (!row) throw iamErrors.create('USER_NOT_FOUND')
    return row
  }

  private scopes(principal: Principal): Promise<[AuthorizationScope, AuthorizationScope]> {
    return Promise.all([
      this.ctx.rbac.listAuthorizedScope(principal, 'auth.user.read'),
      this.ctx.rbac.listAuthorizedScope(principal, 'auth.user.manage'),
    ])
  }

  // Where the caller may administer users, and which types they may hand
  // out. The users screen holds only auth.user.read, so making it also carry
  // org.tree.read and auth.user-type.read would sit a legitimate org
  // administrator in front of an empty picker.
  //
  // The nodes are the ones actually inside the caller's coverage, not the
  // anchors those grants happen to sit on: a subtree grant at a college
  // means every department under it is a place a user may stand, and
  // returning only the anchor made those unreachable.
  async userOptions(
    principal: Principal,
    search: string | undefined,
    limit: number,
  ): Promise<{
    nodes: {
      orgNodeId: string
      name: string
      depth: number
      orgTypeId: string
      manageable: boolean
    }[]
    // a picker that quietly showed the first five hundred of a large tree
    // looked complete; saying so lets the screen ask for a search instead
    truncated: boolean
    userTypes: { id: string; code: string; name: string; placementPolicy: PlacementPolicy }[]
  }> {
    const [readScope, manageScope] = await this.scopes(principal)
    if (!readScope.tenantWide && readScope.anchors.length === 0) {
      return { nodes: [], truncated: false, userTypes: [] }
    }
    const nodes = (
      await this.db.execute<{
        id: string
        name: string
        depth: number
        org_type_id: string
        manageable: boolean
      }>(sql`
        select n.id, n.name, n.depth, n.org_type_id,
          ${scopeCoverage(manageScope, 'n')} as manageable
        from org_nodes n
        where n.tenant_id = ${principal.tenantId}
          and ${scopeCoverage(readScope, 'n')}
          and (${search ?? null}::text is null or n.name ilike '%' || ${search ?? ''} || '%')
        order by n.path
        limit ${limit + 1}`)
    ).rows
    // Assignable types, with the org types each may stand at, so the screen
    // can pair a type with a node without a second round trip. A system type
    // is provisioned rather than assigned and never appears.
    const userTypes = (
      await this.db.execute<{
        id: string
        code: string
        name: string
        placement_mode: PlacementMode
        allowed_org_type_ids: string[]
      }>(sql`
        select t.id, t.code, t.name, t.placement_mode,
          coalesce((select array_agg(a.org_type_id::text)
            from user_type_allowed_org_types a
            where a.tenant_id = t.tenant_id and a.user_type_id = t.id), '{}')
            as allowed_org_type_ids
        from user_types t
        where t.tenant_id = ${principal.tenantId} and t.enabled and not t.is_system
        order by t.sort_order, t.code`)
    ).rows
    return {
      nodes: nodes.slice(0, limit).map((row) => ({
        orgNodeId: row.id,
        name: row.name,
        depth: row.depth,
        orgTypeId: row.org_type_id,
        manageable: row.manageable,
      })),
      truncated: nodes.length > limit,
      userTypes: userTypes.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        placementPolicy:
          row.placement_mode === 'allow-list'
            ? ({ mode: 'allow-list', orgTypeIds: row.allowed_org_type_ids } as const)
            : ({ mode: 'unrestricted' } as const),
      })),
    }
  }

  // the org types a user type screen picks from. Its own endpoint rather
  // than the role screen's, so stating where a kind of person may stand
  // needs no permission over roles.
  async listOrgTypeOptions(tenantId: string) {
    return (
      await this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from org_types
        where tenant_id = ${tenantId} order by name`)
    ).rows
  }

  // A user type confers no authority, so handing one out is not a grant and
  // needs no escalation check — that was only ever true while types carried
  // roles. What it does decide is where the person may stand, and the
  // platform's own account type is not something an ordinary administrator
  // hands to anyone.
  private async assertMayAssignType(
    tx: Tx,
    actor: Principal | undefined,
    type: { id: string; code: string; is_system: boolean },
  ) {
    if (!actor) return
    if (type.is_system) {
      throw new AccessDeniedError('a system user type is provisioned, not assigned')
    }
  }

  // Where a kind of person may stand, as one predicate. Both plugins can
  // break this invariant (auth by placing or retyping a person, org by
  // retyping the node they stand at) and both diagnose it, so there is one
  // definition of legal rather than four that drift.
  //
  // The type states its policy instead of it being inferred from an empty
  // list. Reading "no rows" as "anywhere" meant unchecking the last box
  // widened the rule rather than narrowing it, silently and with no
  // stranded-user check, which is how a school could end up with students
  // standing under colleges.
  private static placementLegal(type: string, orgTypeId: SQL, atRoot: SQL): SQL {
    const t = sql.raw(type)
    return sql`
      case
        -- a system identity is the tenant's way back in, so it stands at the
        -- root and nowhere else: authority over a person is authority over
        -- the node they stand at, and every node below the root has managers
        -- who are not the tenant's own administrators
        when ${t}.is_system then ${atRoot}
        when ${t}.placement_mode = 'unrestricted' then true
        else exists (
          select 1 from user_type_allowed_org_types a
          where a.tenant_id = ${t}.tenant_id and a.user_type_id = ${t}.id
            and a.org_type_id = ${orgTypeId})
      end`
  }

  private async assertPlacementAllowed(
    tx: Tx,
    tenantId: string,
    userTypeId: string,
    orgNodeId: string,
  ) {
    const legal = IamService.placementLegal('t', sql`n.org_type_id`, sql`n.parent_id is null`)
    const row = (
      await tx.execute<{ legal: boolean }>(sql`
        select ${legal} as legal
        from user_types t
        join org_nodes n on n.tenant_id = t.tenant_id and n.id = ${orgNodeId}
        where t.tenant_id = ${tenantId} and t.id = ${userTypeId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_TYPE_NOT_FOUND')
    if (row.legal) return
    throw iamErrors.create('USER_TYPE_PLACEMENT_NOT_ALLOWED')
  }

  // How many people this scope leaves standing where their type forbids.
  // A count, not a list: which people they are is not the caller's business,
  // only that the change would strand them.
  private async strandedBy(tx: Tx, scope: SQL, orgTypeId: SQL): Promise<number> {
    const legal = IamService.placementLegal('t', orgTypeId, sql`n.parent_id is null`)
    return (
      await tx.execute<{ count: number }>(sql`
        select count(*)::int as count
        from users u
        join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        where ${scope} and not ${legal}`)
    ).rows[0]!.count
  }

  // org asks before it retypes a node: the people standing there do not move,
  // so the node changing under them can strand them just as surely as a
  // transfer would. A lock-holding caller passes its own handle, because a
  // second pool connection under a held lock can deadlock the pool.
  async usersBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: Tx,
  ): Promise<number> {
    const run = (tx: Tx) =>
      this.strandedBy(
        tx,
        sql`u.tenant_id = ${tenantId} and u.primary_org_node_id = ${orgNodeId}`,
        sql`${orgTypeId}::uuid`,
      )
    return handle ? run(handle) : this.write(run)
  }

  // the whole-tenant scan, for migrations and invariant tests: the same
  // predicate every write is decided by, asked of every row at once
  placementViolations(tenantId: string): Promise<number> {
    return this.write((tx) =>
      this.strandedBy(tx, sql`u.tenant_id = ${tenantId}`, sql`n.org_type_id`),
    )
  }

  // Where this kind of person may stand, replaced whole. Widening from an
  // allow-list to "anywhere" is a decision the caller states, not something
  // that falls out of submitting an empty list.
  syncPlacementPolicy(
    tenantId: string,
    userTypeId: string,
    policy: PlacementPolicy,
    expectedVersion: number,
  ): Promise<number> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const type = (
        await tx.execute<{
          id: string
          version: number
          is_system: boolean
          placement_mode: string
        }>(sql`
          select id, version, is_system, placement_mode from user_types
          where tenant_id = ${tenantId} and id = ${userTypeId} for update`)
      ).rows[0]
      if (!type) throw iamErrors.create('USER_TYPE_NOT_FOUND')
      // every other part of a system type is frozen; this one was the way in
      if (type.is_system) throw iamErrors.create('USER_TYPE_IS_SYSTEM')
      if (type.version !== expectedVersion) {
        throw iamErrors.create('USER_TYPE_VERSION_CONFLICT', { currentVersion: type.version })
      }
      const wanted = policy.mode === 'allow-list' ? [...new Set(policy.orgTypeIds)] : []
      const list = sql.raw(uuidArray(wanted))
      if (wanted.length > 0) {
        const found = (
          await tx.execute<{ count: number }>(sql`
            select count(*)::int as count from org_types
            where tenant_id = ${tenantId} and id = any(${list})`)
        ).rows[0]!.count
        if (found !== wanted.length) throw iamErrors.create('USER_TYPE_ORG_TYPE_NOT_FOUND')
      }
      const current = (
        await tx.execute<{ org_type_id: string }>(sql`
          select org_type_id from user_type_allowed_org_types
          where tenant_id = ${tenantId} and user_type_id = ${type.id}`)
      ).rows.map((row) => row.org_type_id)
      // an unchanged policy is not an edit, so it does not spend a version
      // and invalidate whatever else is being edited against this row
      const unchanged =
        type.placement_mode === policy.mode &&
        current.length === wanted.length &&
        wanted.every((id) => current.includes(id))
      if (unchanged) return type.version

      await tx.execute(sql`
        delete from user_type_allowed_org_types
        where tenant_id = ${tenantId} and user_type_id = ${type.id}
          and org_type_id <> all(${list})`)
      if (wanted.length > 0) {
        await tx.execute(sql`
          insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
          select ${tenantId}, ${type.id}, id from unnest(${list}) as id
          on conflict do nothing`)
      }
      await tx.execute(sql`
        update user_types set placement_mode = ${policy.mode},
          version = version + 1, updated_at = now()
        where tenant_id = ${tenantId} and id = ${type.id}`)
      // Checked after the write, against the state that would result, and
      // unconditionally: the old code only looked when the new list was
      // non-empty, so clearing it entirely skipped the check outright.
      const stranded = await this.strandedBy(
        tx,
        sql`u.tenant_id = ${tenantId} and u.user_type_id = ${type.id}`,
        sql`n.org_type_id`,
      )
      if (stranded > 0) {
        throw iamErrors.create('USER_TYPE_PLACEMENT_IN_USE', { userCount: stranded })
      }
      return type.version + 1
    })
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
      await this.assertMayAssignType(tx, actor, type)
      await this.requireOrgNode(tx, tenantId, input.primaryOrgNodeId)
      await this.assertPlacementAllowed(tx, tenantId, type.id, input.primaryOrgNodeId)
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
        this.assertNotSystemIdentity(user)
        const type = await this.requireUserType(tx, tenantId, fields.userTypeId!)
        if (!type.enabled) throw iamErrors.create('USER_TYPE_DISABLED')
        await this.assertMayAssignType(tx, actor, type)
        // the new type must also permit where this person already stands
        await this.assertPlacementAllowed(tx, tenantId, type.id, user.primary_org_node_id)
        // Grants the new type is not eligible for. Asked of every kind of
        // role now that a tenant role declares who may hold it too; the join
        // on roles only narrowed this to org roles, which would have let a
        // retype strand a tenant grant instead of refusing.
        const blocking = (
          await tx.execute<{ count: number }>(sql`
            select count(*)::int as count
            from role_grants g
            where g.tenant_id = ${tenantId} and g.user_id = ${user.id}
              and not exists (
                select 1 from role_allowed_user_types t
                where t.tenant_id = g.tenant_id and t.role_id = g.role_id
                  and t.user_type_id = ${type.id})
              and exists (
                select 1 from roles r
                where r.tenant_id = g.tenant_id and r.id = g.role_id
                  and not ${canonicalTenantAdmin('r')})`)
        ).rows[0]!.count
        if (blocking > 0) {
          throw iamErrors.create('GRANT_INCOMPATIBLE', { grantCount: blocking })
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
      this.assertNotSystemIdentity(user)
      await this.assertManagesNode(tx, actor, user.primary_org_node_id)
      await this.assertManagesNode(tx, actor, primaryOrgNodeId)
      await this.requireOrgNode(tx, tenantId, primaryOrgNodeId)
      // a transfer may not put someone where their kind of person may not be
      await this.assertPlacementAllowed(tx, tenantId, user.user_type_id, primaryOrgNodeId)
      await tx.execute(sql`
        update users set primary_org_node_id = ${primaryOrgNodeId}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${user.id}`)
    })
  }

  setUserEnabled(tenantId: string, userId: string, enabled: boolean, actor?: Principal) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const user = await this.requireUser(tx, tenantId, userId)
      if (!enabled) this.assertNotSystemIdentity(user)
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

  private async requireUserType(
    tx: Tx,
    tenantId: string,
    userTypeId: string,
    expectedVersion?: number,
  ) {
    const row = (
      await tx.execute<{
        id: string
        code: string
        enabled: boolean
        is_system: boolean
        version: number
      }>(sql`
        select id, code, enabled, is_system, version from user_types
        where tenant_id = ${tenantId} and id = ${userTypeId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_TYPE_NOT_FOUND')
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw iamErrors.create('USER_TYPE_VERSION_CONFLICT', { currentVersion: row.version })
    }
    return row
  }

  private async requireUser(tx: Tx, tenantId: string, userId: string) {
    const row = (
      await tx.execute<{
        id: string
        user_type_id: string
        primary_org_node_id: string
        is_system: boolean
      }>(sql`
        select u.id, u.user_type_id, u.primary_org_node_id, t.is_system
        from users u
        join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
        where u.tenant_id = ${tenantId} and u.id = ${userId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_NOT_FOUND')
    return row
  }

  // The recovery account is frozen against the ordinary identity api. Only
  // the type it holds was protected before, which stopped an ordinary person
  // being promoted into it but not the reverse: retyping the recovery
  // account to something ordinary kept its administrator grant, because that
  // role is exempt from eligibility, while dropping the root-only placement
  // rule and the guarantee that password sign-in stays open. Disabling it was
  // likewise allowed as long as some other administrator survived, which is
  // not the same thing as the tenant still being able to recover itself.
  private assertNotSystemIdentity(user: { is_system: boolean }) {
    if (user.is_system) throw iamErrors.create('SYSTEM_ACCOUNT_PROTECTED')
  }

  private async requireOrgNode(tx: Tx, tenantId: string, orgNodeId: string) {
    const row = (
      await tx.execute(sql`
        select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`)
    ).rows[0]
    if (!row) throw iamErrors.create('USER_PLACEMENT_NOT_FOUND')
  }
}

// uuid lists reach postgres as an array literal rather than a joined string,
// so an empty set stays an empty array. Every id is re-validated: these come
// from request input, and sql.raw does not parameterize.
function uuidArray(ids: readonly string[]): string {
  const unique = [...new Set(ids)]
  for (const id of unique) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw iamErrors.create('USER_TYPE_ORG_TYPE_NOT_FOUND', `malformed identifier ${id}`)
    }
  }
  return unique.length === 0 ? `'{}'::uuid[]` : `array['${unique.join("','")}']::uuid[]`
}

export { AccessDeniedError }
