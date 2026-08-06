import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// auth's six tables: the identity categories, the people, where they may
// stand, and what they log in with.
//
// Cross-plugin references are declared against org's own entities, the same
// way the drizzle schema imported org's tables. That is what makes the
// dependency real rather than a comment: an assembly without org fails during
// resolution, by name, instead of failing halfway through a migration with
// postgres complaining about a relation nobody connects to a missing plugin.

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

// stable identity category (administrator/student/faculty/...): login-channel
// switches and tenant-scope base capabilities live here; org-scoped duties
// are role assignments, never user types
export const UserType = defineEntity({
  name: 'UserType',
  tableName: 'user_types',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('user_types_tenant_id_tenants_id_fkey'),
    code: p.string().length(63),
    name: p.string().length(100),
    description: p.string().length(500).nullable(),
    allowLocalLogin: p.boolean().default(false),
    allowSsoLogin: p.boolean().default(false),
    enabled: p.boolean().default(true),
    isSystem: p.boolean().default(false),
    // Whether this kind of person may stand anywhere, or only under the org
    // types listed in user_type_allowed_org_types. A column rather than "an
    // empty list means anywhere", because that reading made unchecking the
    // last box widen the rule instead of narrowing it, with no warning and
    // no stranded-user check.
    placementMode: p.string().length(16),
    // the whole row is versioned, not one part of it: every mutation bumps
    // it, so a set replacement based on a stale read is refused
    version: p.integer().default(1),
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_user_types_code_format', expression: `code ~ ${CODE}` },
    { name: 'chk_user_types_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_user_types_sort_order_non_negative', expression: 'sort_order >= 0' },
    {
      name: 'chk_user_types_placement_mode',
      expression: `placement_mode in ('unrestricted', 'allow-list')`,
    },
  ],
  indexes: [
    {
      name: 'uq_user_types_tenant_id_id',
      expression: 'create unique index uq_user_types_tenant_id_id on user_types (tenant_id, id)',
    },
    {
      name: 'uq_user_types_tenant_code',
      expression: 'create unique index uq_user_types_tenant_code on user_types (tenant_id, code)',
    },
    {
      name: 'uq_user_types_tenant_name',
      expression: 'create unique index uq_user_types_tenant_name on user_types (tenant_id, name)',
    },
  ],
})

// Where a kind of person may stand. A student belongs to a class, a teacher
// to a grade or a teaching-research office, a system account to the root -
// that is a fact about the identity, not about any duty they take on.
export const UserTypeAllowedOrgType = defineEntity({
  name: 'UserTypeAllowedOrgType',
  tableName: 'user_type_allowed_org_types',
  properties: {
    tenantId: () =>
      p
        .manyToOne(Tenant)
        .primary()
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('user_type_allowed_org_types_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    userTypeId: p.uuid().primary(),
    orgTypeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_user_type_allowed_org_types_tenant_type',
      expression:
        'create index idx_user_type_allowed_org_types_tenant_type on user_type_allowed_org_types (tenant_id, user_type_id)',
    },
  ],
})

export const User = defineEntity({
  name: 'User',
  tableName: 'users',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('users_tenant_id_tenants_id_fkey'),
    // tenant business number (student/staff id); once bound, ordinary
    // updates must not clear it
    businessNo: p.string().length(64).nullable(),
    displayName: p.string().length(100),
    userTypeId: p.uuid(),
    // every user belongs somewhere; the bootstrap admin gets the root node
    // (tenant provisioning creates the root before the admin)
    primaryOrgNodeId: p.uuid(),
    enabled: p.boolean().default(true),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [{ name: 'chk_users_display_name_not_blank', expression: `btrim(display_name) <> ''` }],
  indexes: [
    {
      name: 'uq_users_tenant_id_id',
      expression: 'create unique index uq_users_tenant_id_id on users (tenant_id, id)',
    },
    {
      name: 'uq_users_tenant_business_no',
      expression:
        'create unique index uq_users_tenant_business_no on users (tenant_id, business_no) where business_no is not null',
    },
    {
      name: 'idx_users_tenant_user_type',
      expression: 'create index idx_users_tenant_user_type on users (tenant_id, user_type_id)',
    },
    // backs org-membership listings and the referencing side of the node fk
    {
      name: 'idx_users_tenant_org_node_name',
      expression:
        'create index idx_users_tenant_org_node_name on users (tenant_id, primary_org_node_id, display_name)',
    },
  ],
})

export const AuthProvider = defineEntity({
  name: 'AuthProvider',
  tableName: 'auth_providers',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('auth_providers_tenant_id_tenants_id_fkey'),
    code: p.string().length(63),
    // provider family; only 'local' ships in this phase, cas may follow
    type: p.string().length(32),
    name: p.string().length(100),
    config: p.json<Record<string, unknown>>().defaultRaw(`'{}'`),
    isSystem: p.boolean().default(false),
    enabled: p.boolean().default(true),
    // display order for the tenant's login method list
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    // code and type appear in public login urls (/auth/<type>/<code>/...)
    { name: 'chk_auth_providers_code_format', expression: `code ~ ${CODE}` },
    { name: 'chk_auth_providers_type_format', expression: `type ~ ${CODE}` },
    { name: 'chk_auth_providers_sort_order_non_negative', expression: 'sort_order >= 0' },
  ],
  indexes: [
    {
      name: 'uq_auth_providers_tenant_id_id',
      expression:
        'create unique index uq_auth_providers_tenant_id_id on auth_providers (tenant_id, id)',
    },
    {
      name: 'uq_auth_providers_tenant_code',
      expression:
        'create unique index uq_auth_providers_tenant_code on auth_providers (tenant_id, code)',
    },
  ],
})

export const UserIdentity = defineEntity({
  name: 'UserIdentity',
  tableName: 'user_identities',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('user_identities_tenant_id_tenants_id_fkey'),
    userId: p.uuid(),
    authProviderId: p.uuid(),
    identifier: p.string().length(255),
    // argon2id digest for local identities; null for future sso bindings
    credentialHash: p.text().nullable(),
    boundAt: p.datetime().defaultRaw('now()'),
    lastUsedAt: p.datetime().nullable(),
  },
  indexes: [
    {
      name: 'uq_user_identities_tenant_id_id',
      expression:
        'create unique index uq_user_identities_tenant_id_id on user_identities (tenant_id, id)',
    },
    {
      name: 'uq_user_identities_login',
      expression:
        'create unique index uq_user_identities_login on user_identities (tenant_id, auth_provider_id, identifier)',
    },
    {
      name: 'uq_user_identities_user_provider',
      expression:
        'create unique index uq_user_identities_user_provider on user_identities (tenant_id, user_id, auth_provider_id)',
    },
  ],
})

export const Session = defineEntity({
  name: 'Session',
  tableName: 'sessions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('sessions_tenant_id_tenants_id_fkey'),
    userId: p.uuid(),
    // sha256 of the raw cookie token; the raw value is never stored
    tokenHash: p.character().length(64).unique('sessions_token_hash_key'),
    expiresAt: p.datetime(),
    lastUsedAt: p.datetime().nullable(),
    loginIp: p.string().type('inet').nullable(),
    userAgent: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    // revoke-all-for-user, expiry sweeps and the referencing side of the fk
    {
      name: 'idx_sessions_tenant_user_expires',
      expression:
        'create index idx_sessions_tenant_user_expires on sessions (tenant_id, user_id, expires_at)',
    },
  ],
})

/**
 * The tenant-scoped composite foreign keys.
 *
 * Each points at a composite unique key rather than a primary one, which is
 * what stops a row referencing another tenant's row, and is the shape the
 * schema generator has no declaration for. Two of them reach into org, which
 * is why this plugin declares a database dependency on it.
 */
export const authCompositeForeignKeys = [
  `alter table users add constraint fk_users_user_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete restrict`,
  `alter table users add constraint fk_users_primary_org_node
     foreign key (tenant_id, primary_org_node_id) references org_nodes (tenant_id, id) on delete restrict`,
  `alter table user_type_allowed_org_types add constraint fk_user_type_allowed_org_types_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete cascade`,
  `alter table user_type_allowed_org_types add constraint fk_user_type_allowed_org_types_org_type
     foreign key (tenant_id, org_type_id) references org_types (tenant_id, id) on delete restrict`,
  `alter table user_identities add constraint fk_user_identities_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade`,
  `alter table user_identities add constraint fk_user_identities_provider
     foreign key (tenant_id, auth_provider_id) references auth_providers (tenant_id, id) on delete restrict`,
  `alter table sessions add constraint fk_sessions_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade`,
]

export const entities = [
  UserType,
  UserTypeAllowedOrgType,
  User,
  AuthProvider,
  UserIdentity,
  Session,
] as const
