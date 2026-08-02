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
import { tenants } from '@qualy/plugin-org/schema'

// duty templates: tenant roles are system-provided (tenant-admin) and bind
// to the root node only; org roles carry org-scope permissions and node
// assignments constrained by their allowed user/org types
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
    isSystem: boolean().default(false).notNull(),
    assignable: boolean().default(true).notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_roles_code_format', sql`${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('chk_roles_name_not_blank', sql`btrim(${table.name}) <> ''`),
    check('chk_roles_kind', sql`${table.kind} IN ('tenant', 'org')`),
    uniqueIndex('uq_roles_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_roles_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('uq_roles_tenant_name').on(table.tenantId, table.name),
  ],
)
