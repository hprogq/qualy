import { sql, type SQL } from 'drizzle-orm'
import {
  scopeCoverage,
  type ActivePermission,
  type AuthorizationScope,
  type Principal,
} from '@qualy/rbac-contract'

// The authorization SQL, owned in one place because two runtimes execute it.
//
// The cordis service awaits promises and the Effect layer yields effects, so
// they cannot share an executor. What they must share is the decision itself.
// Two copies of these statements would be two authorization systems that agree
// until the day one is edited, and the divergence would not look like a bug:
// it would look like an answer.
//
// Everything here is a pure `SQL` value. Reading rows, mapping them and
// deciding what to throw belongs to whoever ran the statement.

/** the catalog's row, inserted if absent; the stored row stays the single truth */
export const upsertPermissionQuery = (permission: ActivePermission): SQL => sql`
  insert into permissions (code, plugin, name, description, group_key, target_kind)
  values (${permission.code}, ${permission.plugin}, ${permission.name},
    ${permission.description ?? null}, ${permission.groupKey ?? null}, ${permission.target})
  on conflict (code) do nothing`

export const permissionRowQuery = (code: string): SQL =>
  sql`select plugin, target_kind from permissions where code = ${code}`

/** display text follows the declaration freely, because it decides nothing */
export const refreshPermissionTextQuery = (permission: ActivePermission): SQL => sql`
  update permissions set name = ${permission.name}, description = ${permission.description ?? null},
    group_key = ${permission.groupKey ?? null}, updated_at = now()
  where code = ${permission.code}`

// --- grants ---

export const roleForGrantQuery = (tenantId: string, roleId: string): SQL => sql`
  select id, code, kind, system_key, permission_mode, status, assignable from roles
  where tenant_id = ${tenantId} and id = ${roleId}`

export const roleSystemKeyQuery = (tenantId: string, roleId: string): SQL =>
  sql`select system_key from roles where tenant_id = ${tenantId} and id = ${roleId}`

export const userForGrantQuery = (tenantId: string, userId: string): SQL => sql`
  select user_type_id, enabled from users
  where tenant_id = ${tenantId} and id = ${userId}`

export const roleAllowsUserTypeQuery = (
  tenantId: string,
  roleId: string,
  userTypeId: string,
): SQL => sql`
  select 1 from role_allowed_user_types
  where tenant_id = ${tenantId} and role_id = ${roleId} and user_type_id = ${userTypeId}`

export const orgNodeTypeQuery = (tenantId: string, orgNodeId: string): SQL =>
  sql`select org_type_id from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`

export const roleAllowsOrgTypeQuery = (
  tenantId: string,
  roleId: string,
  orgTypeId: string,
): SQL => sql`
  select 1 from role_allowed_org_types
  where tenant_id = ${tenantId} and role_id = ${roleId} and org_type_id = ${orgTypeId}`

/** whether the actor themselves holds the canonical administrator role */
export const holdsCanonicalAdminQuery = (
  tenantId: string,
  userId: string,
  canonicalKey: string,
): SQL => sql`
  select 1 from role_grants g
  join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id
    and r.system_key = ${canonicalKey} and r.status = 'active'
  join users u on u.tenant_id = g.tenant_id and u.id = g.user_id and u.enabled
  where g.tenant_id = ${tenantId} and g.user_id = ${userId}`

export const grantQuery = (tenantId: string, grantId: string): SQL => sql`
  select role_id, org_node_id, coverage from role_grants
  where tenant_id = ${tenantId} and id = ${grantId}`

export const insertGrantQuery = (input: {
  tenantId: string
  userId: string
  roleId: string
  orgNodeId: string | null
  coverage: 'self' | 'subtree' | null
}): SQL => sql`
  insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
  values (${input.tenantId}, ${input.userId}, ${input.roleId}, ${input.orgNodeId},
    ${input.coverage})
  returning id`

export const deleteGrantQuery = (tenantId: string, grantId: string): SQL =>
  sql`delete from role_grants where tenant_id = ${tenantId} and id = ${grantId}`

export const rolePermissionModeQuery = (tenantId: string, roleId: string): SQL =>
  sql`select permission_mode from roles where tenant_id = ${tenantId} and id = ${roleId}`

export const rolePermissionCodesQuery = (tenantId: string, roleId: string): SQL => sql`
  select p.code from role_permissions rp
  join permissions p on p.id = rp.permission_id
  where rp.tenant_id = ${tenantId} and rp.role_id = ${roleId}`

/** the same row org and auth lock, so the three cannot interleave */
export const lockTenantQuery = (tenantId: string): SQL =>
  sql`select 1 from tenants where id = ${tenantId} for update`

// --- roles ---

export const insertRoleQuery = (input: {
  tenantId: string
  code: string
  name: string
  description: string | null
  kind: 'tenant' | 'org'
}): SQL => sql`
  insert into roles (tenant_id, code, name, description, kind, status, permission_mode)
  values (${input.tenantId}, ${input.code}, ${input.name}, ${input.description},
    ${input.kind}, 'draft', 'explicit')
  returning id`

export const updateRoleQuery = (
  tenantId: string,
  roleId: string,
  fields: { name?: string; description?: string | null; assignable?: boolean },
): SQL => sql`
  update roles set
    name = coalesce(${fields.name ?? null}, name),
    description = ${fields.description === undefined ? sql`description` : fields.description},
    assignable = coalesce(${fields.assignable ?? null}, assignable),
    version = version + 1,
    updated_at = now()
  where tenant_id = ${tenantId} and id = ${roleId}`

export const setRoleStatusQuery = (tenantId: string, roleId: string, status: string): SQL => sql`
  update roles set status = ${status}, version = version + 1, updated_at = now()
  where tenant_id = ${tenantId} and id = ${roleId}`

export const deleteRoleQuery = (tenantId: string, roleId: string): SQL =>
  sql`delete from roles where tenant_id = ${tenantId} and id = ${roleId}`

export const countGrantsOfRoleQuery = (tenantId: string, roleId: string): SQL => sql`
  select count(*)::int as count from role_grants
  where tenant_id = ${tenantId} and role_id = ${roleId}`

/** what a completeness check counts: who may hold it, and what it may anchor to */
export const roleSetSizesQuery = (tenantId: string, roleId: string): SQL => sql`
  select
    (select count(*)::int from role_allowed_user_types
     where tenant_id = ${tenantId} and role_id = ${roleId}) as user_types,
    (select count(*)::int from role_allowed_org_types
     where tenant_id = ${tenantId} and role_id = ${roleId}) as org_types`

export const lockRoleQuery = (tenantId: string, roleId: string): SQL => sql`
  select id, code, kind, status, permission_mode, system_key, assignable, version
  from roles where tenant_id = ${tenantId} and id = ${roleId} for update`

/**
 * Replace a role's permissions, but only within what is currently on offer.
 *
 * A row whose plugin is unloaded was never offered, so the caller did not
 * decline it by omitting it, and deleting it would quietly discard authority
 * that unloading a plugin is meant to suspend rather than destroy. Removing
 * one is a separate decision needing its own operation.
 */
export const prunePermissionsQuery = (
  tenantId: string,
  roleId: string,
  offered: readonly string[],
  wanted: readonly string[],
): SQL => sql`
  delete from role_permissions
  where tenant_id = ${tenantId} and role_id = ${roleId}
    and permission_id in (
      select id from permissions
      where code = any(string_to_array(${offered.join(',')}, ',')))
    and permission_id not in (
      select id from permissions
      where code = any(string_to_array(${wanted.join(',')}, ',')))`

export const addPermissionsQuery = (
  tenantId: string,
  roleId: string,
  wanted: readonly string[],
): SQL => sql`
  insert into role_permissions (tenant_id, role_id, permission_id)
  select ${tenantId}, ${roleId}, p.id from permissions p
  where p.code = any(string_to_array(${wanted.join(',')}, ','))
  on conflict do nothing`

export const bumpRoleQuery = (tenantId: string, roleId: string): SQL => sql`
  update roles set version = version + 1, updated_at = now()
  where tenant_id = ${tenantId} and id = ${roleId}`

export const roleQuery = (tenantId: string, roleId: string): SQL => sql`
  select id, code, name, description, kind, status, permission_mode, system_key,
    assignable, version
  from roles where tenant_id = ${tenantId} and id = ${roleId}`

// --- eligibility ---

/**
 * A uuid list as a postgres array literal.
 *
 * The ids reach postgres as an array literal rather than a joined string, so
 * an empty set stays an empty array instead of a one-element list containing
 * the empty string. Every id is re-validated because sql.raw does not
 * parameterize; a malformed one yields undefined rather than an exception, so
 * each runtime can raise the failure its own callers understand.
 */
export const uuidArrayLiteral = (ids: readonly string[]): string | undefined => {
  const unique = [...new Set(ids)]
  const shaped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (unique.some((id) => !shaped.test(id))) return undefined
  return unique.length === 0 ? `'{}'::uuid[]` : `array['${unique.join("','")}']::uuid[]`
}

export const countIdsQuery = (
  tenantId: string,
  table: 'user_types' | 'org_types',
  list: string,
): SQL =>
  table === 'user_types'
    ? sql`select count(*)::int as count from user_types
          where tenant_id = ${tenantId} and id = any(${sql.raw(list)})`
    : sql`select count(*)::int as count from org_types
          where tenant_id = ${tenantId} and id = any(${sql.raw(list)})`

export const pruneEligibilityQuery = (
  tenantId: string,
  roleId: string,
  table: 'role_allowed_user_types' | 'role_allowed_org_types',
  column: 'user_type_id' | 'org_type_id',
  list: string,
): SQL => sql`
  delete from ${sql.raw(table)}
  where tenant_id = ${tenantId} and role_id = ${roleId}
    and ${sql.raw(column)} <> all(${sql.raw(list)})`

export const addEligibilityQuery = (
  tenantId: string,
  roleId: string,
  table: 'role_allowed_user_types' | 'role_allowed_org_types',
  column: 'user_type_id' | 'org_type_id',
  list: string,
): SQL => sql`
  insert into ${sql.raw(table)} (tenant_id, role_id, ${sql.raw(column)})
  select ${tenantId}, ${roleId}, id from unnest(${sql.raw(list)}) as id
  on conflict do nothing`

/**
 * Grants that the eligibility sets, as written, would orphan.
 *
 * The node is joined outward because a tenant grant has none: an inner join
 * dropped every one of them, so narrowing a tenant role's user types would
 * have stranded its holders silently.
 */
export const grantsStrandedByEligibilityQuery = (tenantId: string, roleId: string): SQL => sql`
  select count(*)::int as count
  from role_grants g
  join users u on u.tenant_id = g.tenant_id and u.id = g.user_id
  left join org_nodes n on n.tenant_id = g.tenant_id and n.id = g.org_node_id
  where g.tenant_id = ${tenantId} and g.role_id = ${roleId}
    and (not exists (
          select 1 from role_allowed_user_types t
          where t.tenant_id = g.tenant_id and t.role_id = g.role_id
            and t.user_type_id = u.user_type_id)
      or (n.id is not null and not exists (
          select 1 from role_allowed_org_types t
          where t.tenant_id = g.tenant_id and t.role_id = g.role_id
            and t.org_type_id = n.org_type_id)))`

export const roleEligibilityQuery = (tenantId: string, roleId: string): SQL => sql`
  select
    coalesce((select array_agg(user_type_id::text) from role_allowed_user_types
              where tenant_id = ${tenantId} and role_id = ${roleId}), '{}') as user_type_ids,
    coalesce((select array_agg(org_type_id::text) from role_allowed_org_types
              where tenant_id = ${tenantId} and role_id = ${roleId}), '{}') as org_type_ids`

// --- projections both runtimes read ---

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

/** one role or all of a tenant's, with the sets a role screen needs */
export const roleProjectionQuery = (tenantId: string, roleId?: string): SQL => sql`
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
  where r.tenant_id = ${tenantId}
    and (${roleId ?? null}::uuid is null or r.id = ${roleId ?? null})
  order by r.kind, r.code`

export const userExistsQuery = (tenantId: string, userId: string): SQL =>
  sql`select 1 from users where tenant_id = ${tenantId} and id = ${userId}`

export const orgNodeExistsQuery = (tenantId: string, orgNodeId: string): SQL =>
  sql`select 1 from org_nodes where tenant_id = ${tenantId} and id = ${orgNodeId}`

/** the user types and node types a role's eligibility may name */
export const eligibilityOptionsQuery = (
  tenantId: string,
  table: 'user_types' | 'org_types',
): SQL =>
  table === 'user_types'
    ? sql`select id, code, name from user_types where tenant_id = ${tenantId}
          order by sort_order, code`
    : sql`select id, code, name from org_types where tenant_id = ${tenantId}
          order by sort_order, code`

export interface GrantScope {
  read: AuthorizationScope
  manage: AuthorizationScope
  /** a tenant-wide grant has no node, so node coverage cannot decide it */
  tenantGrants: { read: boolean; manage: boolean }
}
