import { sql, type SQL } from 'drizzle-orm'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'

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

/**
 * A role that carries every active capability.
 *
 * The administrator branch, and the reason it is a fragment rather than a
 * boolean: diagnostics have to explain a decision with the same predicate that
 * made it, not a second one that agrees today.
 */
export const REACHES_EVERY_NODE = sql`r.permission_mode = 'all-active'`

/**
 * The roles a principal holds, with where each one reaches.
 *
 * The user type gates this, because a disabled type means a person who cannot
 * act, but it contributes no roles of its own.
 */
export const heldRoles = (principal: Principal): SQL => sql`
  select g.role_id, g.org_node_id, g.coverage
  from role_grants g
  join users u on u.tenant_id = g.tenant_id and u.id = g.user_id and u.enabled
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id and t.enabled
  where g.tenant_id = ${principal.tenantId} and g.user_id = ${principal.userId}`

/**
 * Whether an active role carries this exact permission.
 *
 * Pinned to what the registry verified, so a permission row edited out of band
 * stops authorizing rather than starting to.
 */
export const carries = (def: ActivePermission): SQL => sql`(
  r.permission_mode = 'all-active'
  or exists (
    select 1 from role_permissions rp
    join permissions p on p.id = rp.permission_id
      and p.code = ${def.code} and p.plugin = ${def.plugin}
      and p.target_kind = ${def.target}
    where rp.tenant_id = r.tenant_id and rp.role_id = r.id
  )
)`

/** a tenant capability comes only from a tenant role: an org role is anchored somewhere */
export const hasTenantPermissionQuery = (principal: Principal, def: ActivePermission): SQL => sql`
  select exists (
    select 1 from (${heldRoles(principal)}) held
    join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
      and r.status = 'active' and r.kind = 'tenant'
    where ${carries(def)}
  ) as allowed`

export const canAtQuery = (
  principal: Principal,
  def: ActivePermission,
  targetOrgNodeId: string,
): SQL => sql`
  select exists (
    select 1 from (${heldRoles(principal)}) held
    join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
      and r.status = 'active'
    -- inner, not left: a node that does not exist is never authorized, and the
    -- administrator branch would otherwise answer yes for one
    join org_nodes target on target.tenant_id = ${principal.tenantId}
      and target.id = ${targetOrgNodeId}
    left join org_nodes anchor on anchor.tenant_id = ${principal.tenantId}
      and anchor.id = held.org_node_id
    where ${carries(def)}
      and (
        ${REACHES_EVERY_NODE}
        or (held.coverage = 'self' and held.org_node_id = ${targetOrgNodeId})
        or (held.coverage = 'subtree' and target.path <@ anchor.path)
      )
  ) as allowed`

/** how far one org-node permission reaches for this principal */
export const authorizedScopeQuery = (principal: Principal, def: ActivePermission): SQL => sql`
  select distinct (${REACHES_EVERY_NODE}) as every_node,
    held.org_node_id, held.coverage
  from (${heldRoles(principal)}) held
  join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
    and r.status = 'active'
  where ${carries(def)}`

export interface ScopeRow extends Record<string, unknown> {
  every_node: boolean
  org_node_id: string | null
  coverage: 'self' | 'subtree' | null
}

/** the shape both runtimes fold scope rows into, so neither invents its own */
export const foldScope = (rows: readonly ScopeRow[]) => ({
  tenantWide: rows.some((row) => row.every_node),
  anchors: rows
    .filter((row) => row.org_node_id !== null && row.coverage !== null)
    .map((row) => ({ orgNodeId: row.org_node_id!, coverage: row.coverage! })),
})

/** role codes of org-kind grants at the node whose role forbids the given org type */
export const grantsBlockingOrgTypeQuery = (
  tenantId: string,
  orgNodeId: string,
  orgTypeId: string,
): SQL => sql`
  select distinct r.code
  from role_grants g
  join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id and r.kind = 'org'
  where g.tenant_id = ${tenantId} and g.org_node_id = ${orgNodeId}
    and not exists (
      select 1 from role_allowed_org_types t
      where t.tenant_id = g.tenant_id and t.role_id = g.role_id
        and t.org_type_id = ${orgTypeId}
    )
  order by r.code`

// An administrator who could actually sign in today. The sign-in channel flags
// are part of it because a type that opens neither is what every driver
// refuses. Bound identities deliberately are not: whether a user needs one
// before their first sign-in is driver knowledge, so requiring one here would
// state something the core cannot know.
const LOGIN_CAPABLE = sql`
  u.enabled
  and t.enabled
  and (t.allow_local_login or t.allow_sso_login)`

/**
 * The canonical administrator role, locked.
 *
 * Locking the row first serializes every admin-reducing mutation of a tenant,
 * so two concurrent ones cannot each observe the other's administrator as the
 * survivor. Pinned to the whole system-role shape rather than the key alone: a
 * row whose mode, kind or status was edited out of band is not the
 * administrator role any more, and counting its holders would let the last
 * real administrator be removed.
 */
export const lockAdministratorRoleQuery = (tenantId: string, systemKey: string): SQL => sql`
  select id from roles
  where tenant_id = ${tenantId} and system_key = ${systemKey}
    and permission_mode = 'all-active' and kind = 'tenant' and status = 'active'
  for update`

/** holders of that role who could still sign in */
export const administratorSurvivorsQuery = (tenantId: string, roleId: string): SQL => sql`
  select count(distinct g.user_id) as count
  from role_grants g
  join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id and r.status = 'active'
  join users u on u.tenant_id = g.tenant_id and u.id = g.user_id
  join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
  where g.tenant_id = ${tenantId} and g.role_id = ${roleId} and ${LOGIN_CAPABLE}`

/**
 * Every permission a principal effectively holds, for one of three questions.
 *
 * They are deliberately distinct. With a node: what they hold AT it. Without
 * one: what they hold tenant-wide, which is what an escalation guard must
 * compare against. Anywhere: what they hold at all, which is what surface
 * discovery asks, since a capability held at one college is discoverable even
 * though it applies nowhere else.
 */
export const effectiveRowsQuery = (
  principal: Principal,
  target: { orgNodeId: string } | 'anywhere' | undefined,
): SQL => {
  const at = typeof target === 'object' ? target : undefined
  const reach = at
    ? sql`(
        ${REACHES_EVERY_NODE}
        or (held.coverage = 'self' and held.org_node_id = ${at.orgNodeId})
        or (held.coverage = 'subtree' and node.path <@ anchor.path)
      )`
    : target === 'anywhere'
      ? sql`true`
      : sql`r.kind = 'tenant'`
  return sql`
    select distinct p.code, p.plugin, p.target_kind, r.kind
    from (${heldRoles(principal)}) held
    join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
      and r.status = 'active'
    left join org_nodes anchor on anchor.tenant_id = ${principal.tenantId}
      and anchor.id = held.org_node_id
    left join org_nodes node on node.tenant_id = ${principal.tenantId}
      and node.id = ${at?.orgNodeId ?? null}
    join permissions p on r.permission_mode = 'all-active'
      or exists (
        select 1 from role_permissions rp
        where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_id = p.id
      )
    where ${reach}`
}

/**
 * The strongest reach the principal has for each permission at one node.
 *
 * A bind guard needs more than "do they hold it here": granting subtree
 * coverage from a self anchor would hand out more than the actor has.
 */
export const reachAtQuery = (principal: Principal, orgNodeId: string): SQL => sql`
  select distinct p.code, p.plugin, p.target_kind, r.kind,
    (${REACHES_EVERY_NODE}) as every_node, held.coverage
  from (${heldRoles(principal)}) held
  join roles r on r.tenant_id = ${principal.tenantId} and r.id = held.role_id
    and r.status = 'active'
  join org_nodes node on node.tenant_id = ${principal.tenantId}
    and node.id = ${orgNodeId}
  left join org_nodes anchor on anchor.tenant_id = ${principal.tenantId}
    and anchor.id = held.org_node_id
  join permissions p on r.permission_mode = 'all-active'
    or exists (
      select 1 from role_permissions rp
      where rp.tenant_id = r.tenant_id and rp.role_id = r.id and rp.permission_id = p.id
    )
  where ${REACHES_EVERY_NODE}
    or (held.coverage = 'self' and held.org_node_id = ${orgNodeId})
    or (held.coverage = 'subtree' and node.path <@ anchor.path)`

/** how far a grant reaches, ordered so a wider one can be compared to a narrower */
export const REACH_RANK = { self: 0, subtree: 1, tenant: 2 } as const
export type Reach = keyof typeof REACH_RANK

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
