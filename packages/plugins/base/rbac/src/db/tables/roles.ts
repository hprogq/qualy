import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'

// Duty templates, and the only container permissions live in. A tenant role
// applies across the tenant; an org role is anchored on a node by each grant
// and constrained by the user and node types it declares eligible.
export const roles = snakeCase.table(
  'roles',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar({ length: 63 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 500 }),
    kind: varchar({ length: 16 }).notNull(),
    // draft is what makes complete creation possible without demanding every
    // decision up front: a role is configured while it can grant nothing,
    // and activation is where completeness is checked. An "active but empty"
    // role is indistinguishable from a misconfigured one, so it cannot exist.
    status: varchar({ length: 16 }).default('draft').notNull(),
    // 'explicit' takes its permissions from role_permissions. 'all-active'
    // means every currently active definition, which is how the tenant
    // administrator stays complete when a plugin adds a capability — the
    // alternative was a flag on every permission that each author had to
    // remember, where forgetting silently under-privileged the administrator.
    permissionMode: varchar({ length: 16 }).default('explicit').notNull(),
    // set for roles the platform provisions and protects; null for the
    // tenant's own roles
    systemKey: varchar({ length: 63 }),
    assignable: boolean().default(true).notNull(),
    // optimistic concurrency for set replacements: a stale editor must not
    // silently undo a change made after it read
    version: integer().default(1).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_roles_code_format', sql`${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('chk_roles_name_not_blank', sql`btrim(${table.name}) <> ''`),
    check('chk_roles_kind', sql`${table.kind} IN ('tenant', 'org')`),
    check('chk_roles_status', sql`${table.status} IN ('draft', 'active', 'disabled')`),
    check(
      'chk_roles_permission_mode',
      sql`${table.permissionMode} IN ('explicit', 'all-active')`,
    ),
    // Holding every capability is reserved for the administrator role the
    // platform provisions; a tenant cannot mint a second one.
    //
    // IS NOT DISTINCT FROM rather than =, because a check that evaluates to
    // null is satisfied: with a null system_key the equality was null, so
    // `false or null` accepted exactly the row this forbids. Nothing in the
    // api can write it, which is the point of stating it here at all, since
    // what this guards against is a seed, a migration or a hand-run insert.
    check(
      'chk_roles_all_active_is_system',
      sql`${table.permissionMode} <> 'all-active'
        OR ${table.systemKey} IS NOT DISTINCT FROM 'tenant-admin'`,
    ),
    // and the converse, which is the half that actually protects a tenant:
    // without it the administrator row could be re-kinded, disabled or made
    // unassignable and still answer to its own name
    check(
      'chk_roles_tenant_admin_shape',
      sql`${table.systemKey} <> 'tenant-admin' OR (
        ${table.permissionMode} = 'all-active' AND ${table.kind} = 'tenant'
        AND ${table.status} = 'active' AND ${table.assignable})`,
    ),
    uniqueIndex('uq_roles_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_roles_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('uq_roles_tenant_name').on(table.tenantId, table.name),
    uniqueIndex('uq_roles_tenant_system_key')
      .on(table.tenantId, table.systemKey)
      .where(sql`${table.systemKey} IS NOT NULL`),
  ],
)
