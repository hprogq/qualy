import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// platform-level permission catalog: rows are reference data owned by the
// permission registry (plugins upsert their definitions), never deleted at
// runtime. Codes are dotted stable apis: "org.tree.manage".
export const permissions = snakeCase.table(
  'permissions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    code: varchar({ length: 127 }).notNull(),
    plugin: varchar({ length: 127 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 500 }),
    groupKey: varchar({ length: 63 }),
    // tenant permissions ignore org nodes, org permissions require a target
    scope: varchar({ length: 16 }).notNull(),
    grantToUserType: boolean().notNull(),
    grantToRole: boolean().notNull(),
    defaultTenantAdmin: boolean().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_permissions_code').on(table.code),
    check('chk_permissions_code_format', sql`${table.code} ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$'`),
    check('chk_permissions_scope', sql`${table.scope} IN ('tenant', 'org')`),
    // org-scope permissions can never flow through user types
    check(
      'chk_permissions_user_type_scope',
      sql`NOT ${table.grantToUserType} OR ${table.scope} = 'tenant'`,
    ),
  ],
)
