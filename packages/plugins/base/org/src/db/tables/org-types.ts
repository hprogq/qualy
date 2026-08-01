import { sql } from 'drizzle-orm'
import {
  check,
  smallint,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { codePattern } from '../code-pattern.ts'
import { tenants } from './tenants.ts'

export const orgTypes = snakeCase.table(
  'org_types',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // stable identifier for seeds, rules and cross-references; never renamed
    code: varchar({ length: 63 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    sortOrder: smallint().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_org_types_code_format', sql`${table.code} ~ ${sql.raw(codePattern)}`),
    check('chk_org_types_name_not_blank', sql`btrim(${table.name}) <> ''`),
    check('chk_org_types_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
    // (tenant_id, id) backs the tenant-scoped composite foreign keys used by
    // other tables: the database itself rejects cross-tenant references
    uniqueIndex('uq_org_types_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_org_types_tenant_code').on(table.tenantId, table.code),
    uniqueIndex('uq_org_types_tenant_name').on(table.tenantId, table.name),
  ],
)
