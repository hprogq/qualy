import { sql } from 'drizzle-orm'
import {
  check,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// Platform-level capability catalog: rows are reference data owned by the
// permission registry (plugins upsert their definitions), never deleted at
// runtime. Codes are dotted stable apis: "org.tree.manage".
//
// What a row does NOT carry is as deliberate as what it does. There is no
// grant-channel flag, because a permission reaches a person through a role
// and through nothing else. There is no default-administrator flag, because
// "the tenant administrator holds everything" is one fact about one role,
// not a boolean every plugin author has to remember. And there is no enabled
// switch, because whether a capability exists is decided by whether its
// plugin is loaded — an administrator who could switch one off could lock
// every caller, including themselves, out of the api that requires it.
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
    // what the capability protects, and therefore how it is checked: a
    // tenant target needs no node, an org-node target requires one
    targetKind: varchar({ length: 16 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_permissions_code').on(table.code),
    check('chk_permissions_code_format', sql`${table.code} ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$'`),
    check('chk_permissions_target_kind', sql`${table.targetKind} IN ('tenant', 'org-node')`),
  ],
)
