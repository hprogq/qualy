import { sql, type SQL } from 'drizzle-orm'

// The placement rule, owned in one place because four callers decide by it and
// two runtimes execute it.
//
// Both plugins can break the invariant: auth by placing or retyping a person,
// org by retyping the node they already stand at. Both diagnose it. A second
// copy of this predicate would not fail loudly, it would answer differently,
// and a placement rule that answers differently in two places is not a rule.

/**
 * Where a kind of person may stand.
 *
 * The type states its policy rather than having it inferred from an empty
 * list. Reading "no rows" as "anywhere" meant unchecking the last box widened
 * the rule instead of narrowing it, silently and with no stranded-user check.
 */
export const placementLegal = (type: string, orgTypeId: SQL, atRoot: SQL): SQL => {
  const t = sql.raw(type)
  return sql`
    case
      -- a system identity is the tenant's way back in, so it stands at the
      -- root and nowhere else: authority over a person is authority over the
      -- node they stand at, and every node below the root has managers who are
      -- not the tenant's own administrators
      when ${t}.is_system then ${atRoot}
      when ${t}.placement_mode = 'unrestricted' then true
      else exists (
        select 1 from user_type_allowed_org_types a
        where a.tenant_id = ${t}.tenant_id and a.user_type_id = ${t}.id
          and a.org_type_id = ${orgTypeId})
    end`
}

/**
 * How many people a scope leaves standing where their type forbids.
 *
 * A count rather than a list: which people they are is not the caller's
 * business, only that the change would strand them.
 */
export const strandedByQuery = (scope: SQL, orgTypeId: SQL): SQL => sql`
  select count(*)::int as count
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
  where ${scope} and not ${placementLegal('t', orgTypeId, sql`n.parent_id is null`)}`

/** the people a node retype would strand, which is what org asks before it retypes */
export const usersBlockingOrgTypeQuery = (
  tenantId: string,
  orgNodeId: string,
  orgTypeId: string,
): SQL =>
  strandedByQuery(
    sql`u.tenant_id = ${tenantId} and u.primary_org_node_id = ${orgNodeId}`,
    sql`${orgTypeId}::uuid`,
  )

/**
 * A session, with everything that decides whether it is still usable.
 *
 * Written as one statement so both runtimes ask the same question. The
 * relational query builder the cordis service uses is promise-shaped, and
 * duplicating the joins for the Effect side would mean two definitions of
 * "this session is still good".
 *
 * The conditions are deliberately returned rather than filtered on: an expired
 * session has to be distinguishable from an unknown one, because the first
 * clears the cookie and can say so and the second must not confirm that a
 * token ever existed.
 */
export const sessionByTokenQuery = (tokenHash: string): SQL => sql`
  select
    s.id, s.tenant_id, s.user_id, s.expires_at, s.last_used_at,
    (s.expires_at <= now()) as expired,
    -- the aliases are worth reading slowly: t is the USER TYPE and n is the
    -- TENANT. Checking t.enabled and forgetting n.enabled leaves a disabled
    -- tenant's sessions working, which is what this expression got wrong once
    (
      u.enabled
      and t.enabled
      and n.enabled
      and (n.expires_at is null or n.expires_at > now())
    ) as usable
  from sessions s
  join users u on u.tenant_id = s.tenant_id and u.id = s.user_id
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join tenants n on n.id = s.tenant_id
  where s.token_hash = ${tokenHash}`

export const deleteSessionQuery = (sessionId: string): SQL =>
  sql`delete from sessions where id = ${sessionId}`

/** last_used_at is only written when it has gone stale, to keep reads from writing */
export const touchSessionQuery = (sessionId: string): SQL =>
  sql`update sessions set last_used_at = now() where id = ${sessionId}`

// --- user types ---

/**
 * A user type as an administrator sees it.
 *
 * The allowed org types come along because they are the whole of what a type
 * decides: a type confers no authority, only where its holders may stand.
 */
export const userTypeProjection = (where: SQL): SQL => sql`
  select t.id, t.code, t.name, t.description, t.allow_local_login, t.allow_sso_login,
    t.enabled, t.is_system, t.sort_order, t.version, t.placement_mode,
    (select count(*)::int from users u where u.tenant_id = t.tenant_id and u.user_type_id = t.id)
      as user_count,
    coalesce(
      (select array_agg(a.org_type_id::text)
       from user_type_allowed_org_types a
       where a.tenant_id = t.tenant_id and a.user_type_id = t.id),
      '{}') as allowed_org_types
  from user_types t
  where ${where}
  order by t.sort_order, t.code`

export const userTypesOfTenant = (tenantId: string): SQL =>
  userTypeProjection(sql`t.tenant_id = ${tenantId}`)

export const oneUserType = (tenantId: string, userTypeId: string): SQL =>
  userTypeProjection(sql`t.tenant_id = ${tenantId} and t.id = ${userTypeId}`)

/** the columns a guard needs, without the projection's aggregates */
export const userTypeGuardQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select id, code, enabled, is_system, version from user_types
  where tenant_id = ${tenantId} and id = ${userTypeId}`

export const countUsersOfTypeQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select count(*)::int as count from users
  where tenant_id = ${tenantId} and user_type_id = ${userTypeId}`

export const setUserTypeEnabledQuery = (
  tenantId: string,
  userTypeId: string,
  enabled: boolean,
): SQL => sql`
  update user_types set enabled = ${enabled}, version = version + 1, updated_at = now()
  where tenant_id = ${tenantId} and id = ${userTypeId}`

export const updateUserTypeQuery = (
  tenantId: string,
  userTypeId: string,
  fields: {
    name?: string
    description?: string | null
    allowLocalLogin?: boolean
    allowSsoLogin?: boolean
    sortOrder?: number
  },
): SQL => sql`
  update user_types set
    name = coalesce(${fields.name ?? null}, name),
    description = ${fields.description === undefined ? sql`description` : fields.description},
    allow_local_login = coalesce(${fields.allowLocalLogin ?? null}, allow_local_login),
    allow_sso_login = coalesce(${fields.allowSsoLogin ?? null}, allow_sso_login),
    sort_order = coalesce(${fields.sortOrder ?? null}, sort_order),
    version = version + 1,
    updated_at = now()
  where tenant_id = ${tenantId} and id = ${userTypeId}`

export const lockTenantQuery = (tenantId: string): SQL =>
  sql`select 1 from tenants where id = ${tenantId} for update`

/**
 * Roles that would be left assignable to nobody if this type went away.
 *
 * Eligibility rows cascade with the type, which would silently empty a role's
 * allowed set. The count says how many roles must be fixed first. Asked of
 * every kind of role, because a tenant role declares who may hold it too:
 * looking only at org roles once left a live tenant role behind with nobody
 * eligible for it, which is the inert state the lifecycle exists to prevent.
 */
export const rolesStrandedByUserTypeQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select count(*)::int as count from roles r
  where r.tenant_id = ${tenantId}
    and exists (select 1 from role_allowed_user_types t
                where t.tenant_id = r.tenant_id and t.role_id = r.id
                  and t.user_type_id = ${userTypeId})
    and not exists (select 1 from role_allowed_user_types t
                    where t.tenant_id = r.tenant_id and t.role_id = r.id
                      and t.user_type_id <> ${userTypeId})`

export const deleteUserTypeQuery = (tenantId: string, userTypeId: string): SQL =>
  sql`delete from user_types where tenant_id = ${tenantId} and id = ${userTypeId}`

// --- placement policy ---

/**
 * A validated literal uuid array.
 *
 * The ids are interpolated rather than parameterised because `= any(...)` and
 * `unnest(...)` need an array literal, so each one is checked against the uuid
 * shape first. A malformed id is refused as a missing org type rather than
 * reaching the database.
 */
export const uuidArrayLiteral = (
  ids: readonly string[],
): { sql: string; ids: string[] } | undefined => {
  const unique = [...new Set(ids)]
  const shaped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (unique.some((id) => !shaped.test(id))) return undefined
  return {
    sql: unique.length === 0 ? `'{}'::uuid[]` : `array['${unique.join("','")}']::uuid[]`,
    ids: unique,
  }
}

/** the type's own row, locked, with what a policy edit needs to decide */
export const lockUserTypeQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select id, version, is_system, placement_mode from user_types
  where tenant_id = ${tenantId} and id = ${userTypeId} for update`

export const countOrgTypesQuery = (tenantId: string, list: string): SQL => sql`
  select count(*)::int as count from org_types
  where tenant_id = ${tenantId} and id = any(${sql.raw(list)})`

export const currentAllowedOrgTypesQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select org_type_id from user_type_allowed_org_types
  where tenant_id = ${tenantId} and user_type_id = ${userTypeId}`

export const pruneAllowedOrgTypesQuery = (
  tenantId: string,
  userTypeId: string,
  list: string,
): SQL => sql`
  delete from user_type_allowed_org_types
  where tenant_id = ${tenantId} and user_type_id = ${userTypeId}
    and org_type_id <> all(${sql.raw(list)})`

export const addAllowedOrgTypesQuery = (
  tenantId: string,
  userTypeId: string,
  list: string,
): SQL => sql`
  insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
  select ${tenantId}, ${userTypeId}, id from unnest(${sql.raw(list)}) as id
  on conflict do nothing`

export const setPlacementModeQuery = (
  tenantId: string,
  userTypeId: string,
  mode: string,
): SQL => sql`
  update user_types set placement_mode = ${mode}, version = version + 1, updated_at = now()
  where tenant_id = ${tenantId} and id = ${userTypeId}`

/** the people this type would leave standing illegally, under the policy as written */
export const strandedByPolicyQuery = (tenantId: string, userTypeId: string): SQL =>
  strandedByQuery(
    sql`u.tenant_id = ${tenantId} and u.user_type_id = ${userTypeId}`,
    sql`n.org_type_id`,
  )
