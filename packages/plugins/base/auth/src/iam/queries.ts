import { sql, type SQL } from 'drizzle-orm'
import { scopeCoverage, type AuthorizationScope } from '@qualy/rbac-contract'

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

// --- users ---

/** the user with the system flag their type carries, which several guards read */
export const userGuardQuery = (tenantId: string, userId: string): SQL => sql`
  select u.id, u.user_type_id, u.primary_org_node_id, t.is_system
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  where u.tenant_id = ${tenantId} and u.id = ${userId}`

export const orgNodeExistsQuery = (tenantId: string, orgNodeId: string): SQL =>
  sql`select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`

/** whether this kind of person may stand at this node, by the one predicate */
export const placementAllowedQuery = (
  tenantId: string,
  userTypeId: string,
  orgNodeId: string,
): SQL => sql`
  select ${placementLegal('t', sql`n.org_type_id`, sql`n.parent_id is null`)} as legal
  from user_types t
  join org_nodes n on n.tenant_id = t.tenant_id and n.id = ${orgNodeId}
  where t.tenant_id = ${tenantId} and t.id = ${userTypeId}`

export const insertUserQuery = (input: {
  tenantId: string
  displayName: string
  userTypeId: string
  primaryOrgNodeId: string
  businessNo: string | null
}): SQL => sql`
  insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
  values (${input.tenantId}, ${input.displayName}, ${input.userTypeId},
    ${input.primaryOrgNodeId}, ${input.businessNo})
  returning id`

export const updateUserQuery = (
  tenantId: string,
  userId: string,
  fields: { displayName?: string; userTypeId?: string; businessNo?: string },
): SQL => sql`
  update users set
    display_name = coalesce(${fields.displayName ?? null}, display_name),
    user_type_id = coalesce(${fields.userTypeId ?? null}, user_type_id),
    business_no = coalesce(${fields.businessNo ?? null}, business_no),
    updated_at = now()
  where tenant_id = ${tenantId} and id = ${userId}`

export const setUserPlacementQuery = (
  tenantId: string,
  userId: string,
  primaryOrgNodeId: string,
): SQL => sql`
  update users set primary_org_node_id = ${primaryOrgNodeId}, updated_at = now()
  where tenant_id = ${tenantId} and id = ${userId}`

export const setUserEnabledQuery = (tenantId: string, userId: string, enabled: boolean): SQL =>
  sql`update users set enabled = ${enabled}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${userId}`

/** a disabled user loses access now, not when their session happens to expire */
export const deleteUserSessionsQuery = (tenantId: string, userId: string): SQL =>
  sql`delete from sessions where tenant_id = ${tenantId} and user_id = ${userId}`

/**
 * Grants the new type would not be eligible for.
 *
 * Asked of every kind of role, because a tenant role declares who may hold it
 * too: narrowing this to org roles would let a retype strand a tenant grant
 * instead of refusing. The canonical administrator is exempt, since its
 * authority does not come from eligibility.
 */
export const grantsBlockingUserTypeQuery = (
  tenantId: string,
  userId: string,
  userTypeId: string,
  canonicalAdmin: SQL,
): SQL => sql`
  select count(*)::int as count
  from role_grants g
  where g.tenant_id = ${tenantId} and g.user_id = ${userId}
    and not exists (
      select 1 from role_allowed_user_types t
      where t.tenant_id = g.tenant_id and t.role_id = g.role_id
        and t.user_type_id = ${userTypeId})
    and exists (
      select 1 from roles r
      where r.tenant_id = g.tenant_id and r.id = g.role_id
        and not ${canonicalAdmin})`

// --- reads both runtimes serve ---

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

/** what a user row carries, and whether this caller may change it */
const USER_COLUMNS = (manageScope: AuthorizationScope): SQL => sql`
  u.id, u.business_no, u.display_name, u.enabled,
  u.user_type_id, t.code as user_type_code, t.name as user_type_name,
  u.primary_org_node_id, n.name as primary_org_node_name,
  (select count(*)::int from user_identities i
   where i.tenant_id = u.tenant_id and i.user_id = u.id) as identity_count,
  ${scopeCoverage(manageScope, 'n')} as manageable`

/**
 * Users of one node or of its subtree, intersected with what the caller reaches.
 *
 * The requested scope alone decided this once, which meant a bare self grant at
 * a node returned every user below it. A partial subtree is the correct answer
 * here, not an error.
 */
export const listUsersQuery = (
  tenantId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
  input: {
    orgNodeId: string
    scope: 'self' | 'subtree'
    search?: string
    after?: readonly string[]
    limit: number
  },
): SQL => {
  const requested =
    input.scope === 'subtree' ? sql`n.path <@ requested.path` : sql`n.id = requested.id`
  return sql`
    select ${USER_COLUMNS(scopes.manage)}
    from users u
    join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
    join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
    join org_nodes requested on requested.tenant_id = u.tenant_id
      and requested.id = ${input.orgNodeId}
    where u.tenant_id = ${tenantId}
      and ${requested}
      and ${scopeCoverage(scopes.read, 'n')}
      and (${input.search ?? null}::text is null
           or u.display_name ilike '%' || ${input.search ?? ''} || '%'
           or coalesce(u.business_no, '') ilike '%' || ${input.search ?? ''} || '%')
      and (${input.after?.[0] ?? null}::text is null
           or (u.display_name, u.id::text) > (${input.after?.[0] ?? ''}, ${input.after?.[1] ?? ''}))
    order by u.display_name, u.id
    limit ${input.limit}`
}

/** one user, visible only through the caller's read scope */
export const userQuery = (
  tenantId: string,
  userId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
): SQL => sql`
  select ${USER_COLUMNS(scopes.manage)}
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
  where u.tenant_id = ${tenantId} and u.id = ${userId}
    and ${scopeCoverage(scopes.read, 'n')}`

/**
 * The nodes a caller may place people at.
 *
 * These are the nodes actually inside the caller's coverage, not the anchors
 * their grants happen to sit on: a subtree grant at a college means every
 * department under it is a place a user may stand, and returning only the
 * anchor made those unreachable.
 */
export const placeableNodesQuery = (
  tenantId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
  search: string | undefined,
  limit: number,
): SQL => sql`
  select n.id, n.name, n.depth, n.org_type_id,
    ${scopeCoverage(scopes.manage, 'n')} as manageable
  from org_nodes n
  where n.tenant_id = ${tenantId}
    and ${scopeCoverage(scopes.read, 'n')}
    and (${search ?? null}::text is null or n.name ilike '%' || ${search ?? ''} || '%')
  order by n.path
  limit ${limit + 1}`

/**
 * Assignable types with the org types each may stand at.
 *
 * One statement so the screen can pair a person with a place without a second
 * round trip. A system type is provisioned rather than assigned, so it never
 * appears.
 */
export const assignableUserTypesQuery = (tenantId: string): SQL => sql`
  select t.id, t.code, t.name, t.placement_mode,
    coalesce((select array_agg(a.org_type_id::text)
      from user_type_allowed_org_types a
      where a.tenant_id = t.tenant_id and a.user_type_id = t.id), '{}')
      as allowed_org_type_ids
  from user_types t
  where t.tenant_id = ${tenantId} and t.enabled and not t.is_system
  order by t.sort_order, t.code`

/**
 * The org types a user type screen picks from.
 *
 * Its own endpoint rather than the role screen's, so stating where a kind of
 * person may stand needs no permission over roles.
 */
export const orgTypeOptionsQuery = (tenantId: string): SQL => sql`
  select id, code, name from org_types
  where tenant_id = ${tenantId} order by name`

export const insertUserTypeQuery = (input: {
  tenantId: string
  code: string
  name: string
  description: string | null
  allowLocalLogin: boolean
  allowSsoLogin: boolean
  sortOrder: number
  placementMode: 'unrestricted' | 'allow-list'
}): SQL => sql`
  insert into user_types (tenant_id, code, name, description, allow_local_login,
    allow_sso_login, sort_order, placement_mode)
  values (${input.tenantId}, ${input.code}, ${input.name}, ${input.description},
    ${input.allowLocalLogin}, ${input.allowSsoLogin},
    ${input.sortOrder}, ${input.placementMode})
  returning id`

export const seedAllowedOrgTypesQuery = (
  tenantId: string,
  userTypeId: string,
  list: string,
): SQL => sql`
  insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
  select ${tenantId}, ${userTypeId}, id from unnest(${sql.raw(list)}) as id`

// --- signing in ---

/**
 * The anonymous tenant a sign-in screen belongs to.
 *
 * A lapsed tenant is not a tenant one may sign in to, so the liveness test
 * travels with the lookup rather than being a second thing to remember.
 */
export const activeTenantBySlugQuery = (slug: string): SQL => sql`
  select id, slug, name from tenants
  where slug = ${slug} and enabled and (expires_at is null or expires_at > now())`

/** the enabled providers of one tenant, in the order a screen shows them */
export const loginProvidersQuery = (tenantId: string): SQL => sql`
  select code, type, name from auth_providers
  where tenant_id = ${tenantId} and enabled
  order by sort_order, code`

/**
 * One public provider code, of the type the route belongs to.
 *
 * The type is part of the predicate so a row belonging to one driver cannot be
 * driven through another driver's route.
 */
export const providerByCodeQuery = (
  tenantId: string,
  providerCode: string,
  expectedType: string,
): SQL => sql`
  select id from auth_providers
  where tenant_id = ${tenantId} and code = ${providerCode}
    and type = ${expectedType} and enabled`

/** an identity with what the core needs to decide whether it may be used */
export const identityByIdentifierQuery = (
  tenantId: string,
  providerId: string,
  identifier: string,
): SQL => sql`
  select i.id, i.user_id, i.credential_hash, t.allow_local_login
  from user_identities i
  join users u on u.tenant_id = i.tenant_id and u.id = i.user_id
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  where i.tenant_id = ${tenantId} and i.auth_provider_id = ${providerId}
    and i.identifier = ${identifier}`

export const touchIdentityQuery = (identityId: string): SQL =>
  sql`update user_identities set last_used_at = now() where id = ${identityId}`

/**
 * The person behind a session, with everything a shell renders.
 *
 * The liveness of the user, their type and their tenant is part of the
 * predicate: a row that survives disabling would let a session outlive the
 * account it belongs to.
 */
export const signedInUserQuery = (tenantId: string, userId: string): SQL => sql`
  select u.id, u.display_name, u.business_no,
    t.id as user_type_id, t.code as user_type_code, t.name as user_type_name,
    n.id as org_node_id, n.code as org_node_code, n.name as org_node_name,
    e.id as tenant_id, e.slug as tenant_slug, e.name as tenant_name
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
  join tenants e on e.id = u.tenant_id
  where u.tenant_id = ${tenantId} and u.id = ${userId}
    and u.enabled and t.enabled and e.enabled
    and (e.expires_at is null or e.expires_at > now())`

export const insertSessionQuery = (input: {
  tenantId: string
  userId: string
  tokenHash: string
  ttlSeconds: number
  loginIp?: string
  userAgent?: string
}): SQL => sql`
  insert into sessions (tenant_id, user_id, token_hash, expires_at, login_ip, user_agent)
  values (${input.tenantId}, ${input.userId}, ${input.tokenHash},
    now() + make_interval(secs => ${input.ttlSeconds}),
    ${input.loginIp ?? null}, ${input.userAgent ?? null})
  returning expires_at`

/**
 * Signing out, by the token the caller presented.
 *
 * The token is the scope: it identifies exactly one session, so there is
 * nothing wider to accidentally delete. Signing out is the one thing a caller
 * can do without a resolved principal, which is why it cannot go through the
 * principal to find its row.
 */
export const revokeSessionByTokenQuery = (tokenHash: string): SQL =>
  sql`delete from sessions where token_hash = ${tokenHash}`
