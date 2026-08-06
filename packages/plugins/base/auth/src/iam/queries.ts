import { sql, type SQL } from 'drizzle-orm'
import { scopeCoverage, type AuthorizationScope } from '@qualy/rbac-contract'

// --- user types ---

/** the columns a guard needs, without the projection's aggregates */
export const userTypeGuardQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select id, code, enabled, is_system, version from user_types
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

// --- placement policy ---

// --- users ---

/** the user with the system flag their type carries, which several guards read */
export const userGuardQuery = (tenantId: string, userId: string): SQL => sql`
  select u.id, u.user_type_id, u.primary_org_node_id, t.is_system
  from users u
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  where u.tenant_id = ${tenantId} and u.id = ${userId}`

export const orgNodeExistsQuery = (tenantId: string, orgNodeId: string): SQL =>
  sql`select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`

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
