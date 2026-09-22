import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// auth's tables: the identity categories, the people, where they may stand,
// the doors into a tenant, and what binds a person to a door.
//
// Cross-plugin references are declared against org's own entities, the same
// way auth's queries reach org's tables. That is what makes the
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
    // Tenant business number (student/staff id); once bound, ordinary
    // updates must not clear it. Unique among the living only: deletion is
    // final, so a number a deleted person held is free for whoever is
    // given it next, and history keeps pointing at the old row by id.
    businessNo: p.string().length(64).nullable(),
    // The person's one email address: what notifications are sent to, and
    // the name a password sign-in goes by. Stored normalized (trimmed,
    // lower case) and, like the business number, unique among the living.
    email: p.string().length(254).nullable(),
    // When the person proved they read this address; cleared whenever the
    // address changes. An address nobody proved may still receive notices,
    // it just cannot be trusted to recover an account.
    emailVerifiedAt: p.datetime().nullable(),
    displayName: p.string().length(100),
    // Nullable for DELETED rows only (the check below): a soft-deleted user
    // must not pin a user type or an org unit forever, so those deletions
    // detach the reference instead of failing on it. A live user always has
    // both.
    userTypeId: p.uuid().nullable(),
    primaryOrgNodeId: p.uuid().nullable(),
    enabled: p.boolean().default(true),
    // A tombstone, not a recycle bin: deleting a person is final and nothing
    // brings the row back. It stays because grants, records and audit events
    // name it by id; every other read treats it as absent. deleted implies
    // disabled, which is what lets every "can they act" predicate keep asking
    // only `enabled`.
    deletedAt: p.datetime().nullable(),
    // the whole row is versioned: every lifecycle write bumps it, so an
    // edit based on a stale read is refused rather than silently applied
    version: p.integer().default(1),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_users_display_name_not_blank', expression: `btrim(display_name) <> ''` },
    { name: 'chk_users_deleted_is_disabled', expression: `deleted_at is null or enabled = false` },
    {
      name: 'chk_users_live_user_is_placed',
      expression: `deleted_at is not null or (user_type_id is not null and primary_org_node_id is not null)`,
    },
    { name: 'chk_users_email_normalized', expression: `email = lower(btrim(email))` },
  ],
  indexes: [
    {
      name: 'uq_users_tenant_id_id',
      expression: 'create unique index uq_users_tenant_id_id on users (tenant_id, id)',
    },
    {
      name: 'uq_users_tenant_business_no',
      expression:
        'create unique index uq_users_tenant_business_no on users (tenant_id, business_no) where deleted_at is null and business_no is not null',
    },
    {
      name: 'uq_users_tenant_email_live',
      expression:
        'create unique index uq_users_tenant_email_live on users (tenant_id, email) where deleted_at is null and email is not null',
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
    // the driver that implements this door; the type never changes
    type: p.string().length(32),
    name: p.string().length(100),
    config: p.json<Record<string, unknown>>().defaultRaw(`'{}'`),
    // Provisioned by the platform, one per tenant and driver type (the
    // password door): administered, never created or deleted from a screen.
    isSystem: p.boolean().default(false),
    enabled: p.boolean().default(true),
    // A door taken out of service for good. Sign-in events and bindings name
    // it by id, so the row stays; its address is free for a new door, and
    // anything that still points at the old id finds a deleted one.
    deletedAt: p.datetime().nullable(),
    // Who may sign in through this door: everyone, or exactly the user types
    // listed in auth_provider_user_types. On the provider rather than on the
    // type, because "may use the school CAS" and "may use a password" are
    // facts about the doors, and two booleans on the type could not say
    // which of three doors a kind of person is welcome at.
    audienceMode: p.string().length(16).defaultRaw(`'unrestricted'`),
    // the whole row is versioned: the audience is a set replacement, and a
    // replacement based on a stale read must be refused, not merged
    version: p.integer().default(1),
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
    {
      name: 'chk_auth_providers_audience_mode',
      expression: `audience_mode = 'unrestricted' or audience_mode = 'allow-list'`,
    },
    // deleted implies disabled, so every "can this door be used" predicate
    // keeps asking only `enabled`
    {
      name: 'chk_auth_providers_deleted_is_disabled',
      expression: `deleted_at is null or enabled = false`,
    },
  ],
  indexes: [
    {
      name: 'uq_auth_providers_tenant_id_id',
      expression:
        'create unique index uq_auth_providers_tenant_id_id on auth_providers (tenant_id, id)',
    },
    // live doors only: a deleted door's address can be given to a new one
    {
      name: 'uq_auth_providers_tenant_code',
      expression:
        'create unique index uq_auth_providers_tenant_code on auth_providers (tenant_id, code) where deleted_at is null',
    },
    // one provisioned door per driver type and tenant
    {
      name: 'uq_auth_providers_tenant_system_type',
      expression:
        'create unique index uq_auth_providers_tenant_system_type on auth_providers (tenant_id, type) where is_system and deleted_at is null',
    },
  ],
})

export const AuthProviderUserType = defineEntity({
  name: 'AuthProviderUserType',
  tableName: 'auth_provider_user_types',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('auth_provider_user_types_tenant_id_tenants_id_fkey'),
    authProviderId: p.uuid(),
    userTypeId: p.uuid(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_auth_provider_user_types_row',
      expression:
        'create unique index uq_auth_provider_user_types_row on auth_provider_user_types (tenant_id, auth_provider_id, user_type_id)',
    },
    {
      name: 'idx_auth_provider_user_types_tenant_type',
      expression:
        'create index idx_auth_provider_user_types_tenant_type on auth_provider_user_types (tenant_id, user_type_id)',
    },
  ],
})

/**
 * What binds one person to one door, when the door keeps anything at all.
 *
 * A door that finds people by a fact they already have (their email, their
 * business number) keeps no subject: a password door stores only the
 * credential here, and a door that goes by the business number stores
 * nothing. A door whose accounts live elsewhere (an OAuth provider) stores
 * the external account's durable id as the subject, and the account's
 * current name only as a label to show.
 */
export const UserAuthBinding = defineEntity({
  name: 'UserAuthBinding',
  tableName: 'user_auth_bindings',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('user_auth_bindings_tenant_id_tenants_id_fkey'),
    userId: p.uuid(),
    authProviderId: p.uuid(),
    // the external account's durable id; null for a door that finds the
    // person by a field of their own
    subject: p.string().length(255).nullable(),
    // how the external account is called right now, for a reader; never
    // decides who anybody is
    displayLabel: p.string().length(255).nullable(),
    // the driver's digest of a secret the person proves at the door
    credentialHash: p.text().nullable(),
    boundAt: p.datetime().defaultRaw('now()'),
    lastUsedAt: p.datetime().nullable(),
    // A binding is withdrawn, never erased: who could sign in as whom, and
    // until when, is history. Sign-in reads live rows only.
    revokedAt: p.datetime().nullable(),
    revokedBy: p.uuid().nullable(),
  },
  indexes: [
    {
      name: 'uq_user_auth_bindings_tenant_id_id',
      expression:
        'create unique index uq_user_auth_bindings_tenant_id_id on user_auth_bindings (tenant_id, id)',
    },
    // live rows only: a revoked binding keeps its history without holding
    // the external account hostage, so it can be deliberately bound again
    {
      name: 'uq_user_auth_bindings_subject',
      expression:
        'create unique index uq_user_auth_bindings_subject on user_auth_bindings (tenant_id, auth_provider_id, subject) where revoked_at is null and subject is not null',
    },
    {
      name: 'uq_user_auth_bindings_user_provider',
      expression:
        'create unique index uq_user_auth_bindings_user_provider on user_auth_bindings (tenant_id, user_id, auth_provider_id) where revoked_at is null',
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
    // the door this session came in through, and the binding when the door
    // keeps one: what a door's deletion ends, and what a device list shows
    authProviderId: p.uuid(),
    authBindingId: p.uuid().nullable(),
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
    // ending every session a door opened, and the referencing side of its fk
    {
      name: 'idx_sessions_tenant_provider',
      expression:
        'create index idx_sessions_tenant_provider on sessions (tenant_id, auth_provider_id)',
    },
  ],
})

/**
 * One sign-in attempt, success or failure, as the auth domain's own record.
 *
 * Not an audit event: signing in is this domain's high-frequency security
 * fact, and the trail of administrative operations must not drown in it.
 * Actor references are ids without foreign keys - the row is history and
 * outlives whatever it names - and there is deliberately NO identifier
 * column: what an attacker typed is not worth storing, a resolved attempt
 * records the ids instead, and analysis leans on address, provider and time.
 * The credential itself never comes near this table.
 *
 * `reason_code` is the internal, precise cause; the wire answer stays the
 * uniform refusal the driver gives, so this precision never leaks to an
 * anonymous caller.
 */
export const SignInEvent = defineEntity({
  name: 'SignInEvent',
  tableName: 'sign_in_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('sign_in_events_tenant_id_tenants_id_fkey'),
    occurredAt: p.datetime().defaultRaw('now()'),

    // the door: id plus a snapshot of how it was addressed at the time
    providerId: p.uuid(),
    providerType: p.string().length(32),
    providerCode: p.string().length(63),

    userId: p.uuid().nullable(),
    bindingId: p.uuid().nullable(),

    outcome: p.string().length(16),
    reasonCode: p.string().length(63).nullable(),

    sessionId: p.uuid().nullable(),

    requestId: p.uuid().nullable(),
    traceId: p.string().length(32).nullable(),
    clientIp: p.string().type('inet').nullable(),
    userAgent: p.text().nullable(),
  },
  checks: [
    {
      name: 'chk_sign_in_events_outcome',
      expression: `outcome IN ('success', 'failure')`,
    },
  ],
  indexes: [
    {
      name: 'idx_sign_in_events_tenant_time',
      expression:
        'create index idx_sign_in_events_tenant_time on sign_in_events (tenant_id, occurred_at)',
    },
    {
      name: 'idx_sign_in_events_tenant_user_time',
      expression:
        'create index idx_sign_in_events_tenant_user_time on sign_in_events (tenant_id, user_id, occurred_at)',
    },
    // credential spraying reads as one address knocking on many doors
    {
      name: 'idx_sign_in_events_tenant_ip_time',
      expression:
        'create index idx_sign_in_events_tenant_ip_time on sign_in_events (tenant_id, client_ip, occurred_at)',
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
export const compositeForeignKeys = [
  // Set-null on exactly the referencing column (postgres names the subset so
  // tenant_id survives): deleting a type or unit detaches DELETED users from
  // it, while a live user still blocks the deletion - not through the fk,
  // but through chk_users_live_user_is_placed refusing the null.
  `alter table users add constraint fk_users_user_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete set null (user_type_id)`,
  `alter table users add constraint fk_users_primary_org_node
     foreign key (tenant_id, primary_org_node_id) references org_nodes (tenant_id, id) on delete set null (primary_org_node_id)`,
  `alter table user_type_allowed_org_types add constraint fk_user_type_allowed_org_types_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete cascade`,
  `alter table user_type_allowed_org_types add constraint fk_user_type_allowed_org_types_org_type
     foreign key (tenant_id, org_type_id) references org_types (tenant_id, id) on delete restrict`,
  `alter table auth_provider_user_types add constraint fk_auth_provider_user_types_provider
     foreign key (tenant_id, auth_provider_id) references auth_providers (tenant_id, id) on delete cascade`,
  `alter table auth_provider_user_types add constraint fk_auth_provider_user_types_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete cascade`,
  // restrict like role_grants: a binding is history (revoked, never
  // erased), and users and doors are only soft-deleted anyway
  `alter table user_auth_bindings add constraint fk_user_auth_bindings_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete restrict`,
  `alter table user_auth_bindings add constraint fk_user_auth_bindings_provider
     foreign key (tenant_id, auth_provider_id) references auth_providers (tenant_id, id) on delete restrict`,
  `alter table sessions add constraint fk_sessions_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade`,
  `alter table sessions add constraint fk_sessions_provider
     foreign key (tenant_id, auth_provider_id) references auth_providers (tenant_id, id) on delete restrict`,
  // the column alone: a withdrawn binding is never erased, so this only
  // fires if one ever is, and then the session outlives what named it
  `alter table sessions add constraint fk_sessions_binding
     foreign key (tenant_id, auth_binding_id) references user_auth_bindings (tenant_id, id) on delete set null (auth_binding_id)`,
]

export const entities = [
  UserType,
  UserTypeAllowedOrgType,
  User,
  AuthProvider,
  AuthProviderUserType,
  UserAuthBinding,
  Session,
  SignInEvent,
] as const
