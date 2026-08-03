import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  smallint,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'

// stable identity category (administrator/student/faculty/...): login-channel
// switches and tenant-scope base capabilities live here; org-scoped duties
// are role assignments, never user types
export const userTypes = snakeCase.table(
  'user_types',
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
    allowLocalLogin: boolean().default(false).notNull(),
    allowSsoLogin: boolean().default(false).notNull(),
    enabled: boolean().default(true).notNull(),
    isSystem: boolean().default(false).notNull(),
    // Whether this kind of person may stand anywhere, or only under the org
    // types listed in user_type_allowed_org_types. It is a column rather
    // than "an empty list means anywhere" because that reading made
    // unchecking the last box widen the rule instead of narrowing it, with
    // no warning and no stranded-user check.
    placementMode: varchar({ length: 16 }).default('unrestricted').notNull(),
    // the whole row is versioned, not one part of it: every mutation bumps
    // it, so a set replacement based on a stale read is refused
    version: integer().default(1).notNull(),
    sortOrder: smallint().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_user_types_code_format', sql`${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('chk_user_types_name_not_blank', sql`btrim(${table.name}) <> ''`),
    check('chk_user_types_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
    check(
      'chk_user_types_placement_mode',
      sql`${table.placementMode} in ('unrestricted', 'allow-list')`,
    ),
    uniqueIndex('uq_user_types_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_user_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('uq_user_types_tenant_name').on(table.tenantId, table.name),
  ],
)
