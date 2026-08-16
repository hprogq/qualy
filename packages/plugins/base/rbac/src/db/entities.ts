import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// rbac's six tables: the capability catalog, the duty templates, what each
// template carries, who may hold it, and where it applies.

const p = defineEntity.properties

const CODE = `'^[a-z0-9]+(?:-[a-z0-9]+)*$'`

/** the tenant a row belongs to, cascading when the tenant goes */
const tenantOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

/** the same, as part of a composite primary key */
const tenantKeyOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .primary()
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

// Platform-level capability catalog: rows are reference data owned by the
// permission registry (plugins upsert their definitions), never deleted at
// runtime. Codes are dotted stable apis: "org.tree.manage".
//
// Not tenant scoped, and the only table here that is not: what a deployment
// can authorize is decided by which plugins it loads.
export const Permission = defineEntity({
  name: 'Permission',
  tableName: 'permissions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    code: p.string().length(127),
    plugin: p.string().length(127),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    groupKey: p.string().length(63).nullable(),
    // what the capability protects, and therefore how it is checked: a
    // tenant target needs no node, an org-node target requires one
    targetKind: p.string().length(16),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_permissions_code_format',
      expression: `code ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$'`,
    },
    {
      name: 'chk_permissions_target_kind',
      expression: `target_kind IN ('tenant', 'org-node')`,
    },
  ],
  indexes: [
    {
      name: 'uq_permissions_code',
      expression: 'create unique index uq_permissions_code on permissions (code)',
    },
  ],
})

// Duty templates, and the only container permissions live in. A tenant role
// applies across the tenant; an org role is anchored on a node by each grant
// and constrained by the user and node types it declares eligible.
export const Role = defineEntity({
  name: 'Role',
  tableName: 'roles',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('roles_tenant_id_tenants_id_fkey'),
    code: p.string().length(63),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    kind: p.string().length(16),
    // draft is what makes complete creation possible without demanding every
    // decision up front: a role is configured while it can grant nothing,
    // and activation is where completeness is checked. An "active but empty"
    // role is indistinguishable from a misconfigured one, so it cannot exist.
    status: p.string().length(16).defaultRaw(`'draft'`),
    // 'explicit' takes its permissions from role_permissions. 'all-active'
    // means every currently active definition, which is how the tenant
    // administrator stays complete when a plugin adds a capability.
    permissionMode: p.string().length(16).defaultRaw(`'explicit'`),
    // Who may hold the role, and where its duty applies, each stated rather
    // than inferred from an empty list. Reading "no rows" as "anyone" would
    // make unchecking the last box widen the rule instead of narrowing it,
    // and would skip the stranding check on the way - the same mistake user
    // type placement already made once and now states as a mode.
    eligibilityMode: p.string().length(16).defaultRaw(`'allow-list'`),
    // only meaningful for an org role: a tenant role anchors to nothing
    anchorMode: p.string().length(16).defaultRaw(`'allow-list'`),
    // set for roles the platform provisions and protects; null for the
    // tenant's own roles
    systemKey: p.string().length(63).nullable(),
    assignable: p.boolean().default(true),
    // optimistic concurrency for set replacements: a stale editor must not
    // silently undo a change made after it read
    version: p.integer().default(1),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_roles_code_format', expression: `code ~ ${CODE}` },
    { name: 'chk_roles_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_roles_kind', expression: `kind IN ('tenant', 'org')` },
    { name: 'chk_roles_status', expression: `status IN ('draft', 'active', 'disabled')` },
    {
      name: 'chk_roles_permission_mode',
      expression: `permission_mode IN ('explicit', 'all-active')`,
    },
    {
      name: 'chk_roles_eligibility_mode',
      expression: `eligibility_mode IN ('unrestricted', 'allow-list')`,
    },
    { name: 'chk_roles_anchor_mode', expression: `anchor_mode IN ('unrestricted', 'allow-list')` },
    // Holding every capability is reserved for the administrator role the
    // platform provisions; a tenant cannot mint a second one.
    //
    // IS NOT DISTINCT FROM rather than =, because a check that evaluates to
    // null is satisfied: with a null system_key the equality was null, so
    // `false or null` accepted exactly the row this forbids.
    {
      name: 'chk_roles_all_active_is_system',
      expression: `permission_mode <> 'all-active' OR system_key IS NOT DISTINCT FROM 'tenant-admin'`,
    },
    // and the converse, which is the half that actually protects a tenant:
    // without it the administrator row could be re-kinded, disabled or made
    // unassignable and still answer to its own name
    {
      name: 'chk_roles_tenant_admin_shape',
      expression: `system_key <> 'tenant-admin' OR (permission_mode = 'all-active' AND kind = 'tenant' AND status = 'active' AND assignable)`,
    },
  ],
  indexes: [
    {
      name: 'uq_roles_tenant_id_id',
      expression: 'create unique index uq_roles_tenant_id_id on roles (tenant_id, id)',
    },
    {
      name: 'uq_roles_tenant_code',
      expression: 'create unique index uq_roles_tenant_code on roles (tenant_id, code)',
    },
    {
      name: 'uq_roles_tenant_name',
      expression: 'create unique index uq_roles_tenant_name on roles (tenant_id, name)',
    },
    {
      name: 'uq_roles_tenant_system_key',
      expression:
        'create unique index uq_roles_tenant_system_key on roles (tenant_id, system_key) where system_key is not null',
    },
  ],
})

export const RolePermission = defineEntity({
  name: 'RolePermission',
  tableName: 'role_permissions',
  properties: {
    tenantId: tenantKeyOf('role_permissions_tenant_id_tenants_id_fkey'),
    roleId: p.uuid().primary(),
    permissionId: () =>
      p
        .manyToOne(Permission)
        .primary()
        .joinColumns('permission_id')
        .referencedColumnNames('id')
        .foreignKeyName('role_permissions_permission_id_permissions_id_fkey')
        .deleteRule('cascade'),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_role_permissions_tenant_role',
      expression:
        'create index idx_role_permissions_tenant_role on role_permissions (tenant_id, role_id)',
    },
  ],
})

export const RoleAllowedOrgType = defineEntity({
  name: 'RoleAllowedOrgType',
  tableName: 'role_allowed_org_types',
  properties: {
    tenantId: tenantKeyOf('role_allowed_org_types_tenant_id_tenants_id_fkey'),
    roleId: p.uuid().primary(),
    orgTypeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
})

// applicability, not permission: an org role without allowed user types is
// not "unrestricted" but unassignable
export const RoleAllowedUserType = defineEntity({
  name: 'RoleAllowedUserType',
  tableName: 'role_allowed_user_types',
  properties: {
    tenantId: tenantKeyOf('role_allowed_user_types_tenant_id_tenants_id_fkey'),
    roleId: p.uuid().primary(),
    userTypeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
})

/**
 * Which roles a role may hand out (§CLAUDE 访问模型).
 *
 * The escalation guard answers "do you hold that much authority"; this
 * answers a different question - "is this office yours to appoint" - and
 * neither implies the other. A college administrator can hold every
 * permission a college administrator carries and still not be the one who
 * appoints college administrators.
 *
 * A DAG over roles, not a level number: real appointment relationships are
 * not a ladder. No rule row means the role appoints nothing; the canonical
 * tenant administrator bypasses the table rather than owning edges to every
 * role, because it is already the whole of the tenant's authority.
 */
export const RoleGrantRule = defineEntity({
  name: 'RoleGrantRule',
  tableName: 'role_grant_rules',
  properties: {
    tenantId: tenantKeyOf('role_grant_rules_tenant_id_tenants_id_fkey'),
    /** the role whose holders may appoint */
    granterRoleId: p.uuid().primary(),
    /** the role they may appoint people to */
    targetRoleId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_role_grant_rules_tenant_target',
      expression:
        'create index idx_role_grant_rules_tenant_target on role_grant_rules (tenant_id, target_role_id)',
    },
  ],
})

// Who holds which duty, and over what.
//
// A tenant role carries no node: it applies across the tenant, and pinning it
// to the root with subtree coverage was a fiction the last-administrator query
// and the eligibility rules both had to keep up. An org role is anchored: self
// covers exactly the node, subtree covers its ltree descendance.
export const RoleGrant = defineEntity({
  name: 'RoleGrant',
  tableName: 'role_grants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('role_grants_tenant_id_tenants_id_fkey'),
    userId: p.uuid(),
    roleId: p.uuid(),
    orgNodeId: p.uuid().nullable(),
    coverage: p.string().length(16).nullable(),
    /**
     * The thing this authority is confined to, if it is confined to one.
     *
     * Opaque on purpose: three strings that mean nothing here. A consumer that
     * owns some kind of object can ask for authority scoped to one of its
     * own - "assessment / batch / <uuid>" - without this plugin learning what
     * an assessment is, and without a foreign key that would make its table
     * depend on one. A grant that names a resource confers nothing outside it:
     * every general question filters these rows out.
     */
    resourceNamespace: p.string().length(63).nullable(),
    resourceType: p.string().length(63).nullable(),
    resourceId: p.uuid().nullable(),
    validFrom: p.datetime().nullable(),
    validUntil: p.datetime().nullable(),
    /** withdrawn rather than deleted: who could do what, and until when, is history */
    revokedAt: p.datetime().nullable(),
    revokedBy: p.uuid().nullable(),
    createdBy: p.uuid().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_role_grants_coverage', expression: `coverage IN ('self', 'subtree')` },
    // anchored or tenant-wide, never half of each
    {
      name: 'chk_role_grants_anchor',
      expression: '(org_node_id IS NULL) = (coverage IS NULL)',
    },
    // all three parts of a resource, or none of them: half a reference points
    // at nothing and would silently widen the grant
    {
      name: 'chk_role_grants_resource',
      expression: `num_nonnulls(resource_namespace, resource_type, resource_id) IN (0, 3)`,
    },
    {
      name: 'chk_role_grants_validity',
      expression: 'valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until',
    },
  ],
  indexes: [
    // one grant per (user, role, anchor); the partial index covers the
    // tenant-wide case, where a null node would defeat a plain unique index
    // One live grant per (user, role, anchor, resource). Revoked rows are
    // excluded: a withdrawn authority is history, and history must not stop
    // the same authority being given again.
    {
      name: 'uq_role_grants_anchored',
      expression: `create unique index uq_role_grants_anchored on role_grants
        (tenant_id, user_id, role_id, org_node_id, coverage, coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
        where org_node_id is not null and revoked_at is null`,
    },
    {
      name: 'uq_role_grants_tenant_wide',
      expression: `create unique index uq_role_grants_tenant_wide on role_grants
        (tenant_id, user_id, role_id, coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
        where org_node_id is null and revoked_at is null`,
    },
    {
      name: 'idx_role_grants_resource',
      expression: `create index idx_role_grants_resource on role_grants
        (tenant_id, resource_namespace, resource_type, resource_id) where resource_id is not null`,
    },
    {
      name: 'idx_role_grants_tenant_user',
      expression: 'create index idx_role_grants_tenant_user on role_grants (tenant_id, user_id)',
    },
    {
      name: 'idx_role_grants_tenant_node',
      expression:
        'create index idx_role_grants_tenant_node on role_grants (tenant_id, org_node_id)',
    },
    {
      name: 'idx_role_grants_tenant_role',
      expression: 'create index idx_role_grants_tenant_role on role_grants (tenant_id, role_id)',
    },
  ],
})

/**
 * The tenant-scoped composite foreign keys.
 *
 * Each points at a composite unique key rather than a primary one, which is
 * what stops a row referencing another tenant's row, and is the shape the
 * schema generator has no declaration for. Three reach into org and auth,
 * which is why this plugin declares database dependencies on both.
 */
export const compositeForeignKeys = [
  `alter table role_permissions add constraint fk_role_permissions_role
     foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_allowed_org_types add constraint fk_role_allowed_org_types_role
     foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_allowed_org_types add constraint fk_role_allowed_org_types_type
     foreign key (tenant_id, org_type_id) references org_types (tenant_id, id) on delete restrict`,
  `alter table role_allowed_user_types add constraint fk_role_allowed_user_types_role
     foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_allowed_user_types add constraint fk_role_allowed_user_types_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete cascade`,
  `alter table role_grant_rules add constraint fk_role_grant_rules_granter
     foreign key (tenant_id, granter_role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_grant_rules add constraint fk_role_grant_rules_target
     foreign key (tenant_id, target_role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_grants add constraint fk_role_grants_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade`,
  `alter table role_grants add constraint fk_role_grants_role
     foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade`,
  `alter table role_grants add constraint fk_role_grants_node
     foreign key (tenant_id, org_node_id) references org_nodes (tenant_id, id) on delete restrict`,
]

export const entities = [
  Permission,
  Role,
  RolePermission,
  RoleAllowedOrgType,
  RoleAllowedUserType,
  RoleGrantRule,
  RoleGrant,
] as const
