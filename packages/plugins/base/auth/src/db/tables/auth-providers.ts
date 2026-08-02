import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  jsonb,
  smallint,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'

export const authProviders = snakeCase.table(
  'auth_providers',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: varchar({ length: 63 }).notNull(),
    // provider family; only 'local' ships in this phase, cas may follow
    type: varchar({ length: 32 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    config: jsonb().default({}).notNull(),
    isSystem: boolean().default(false).notNull(),
    enabled: boolean().default(true).notNull(),
    // display order for the tenant's login method list
    sortOrder: smallint().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // code and type appear in public login urls (/auth/<type>/<code>/...)
    check('chk_auth_providers_code_format', sql`${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('chk_auth_providers_type_format', sql`${table.type} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check('chk_auth_providers_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
    uniqueIndex('uq_auth_providers_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_auth_providers_tenant_code').on(table.tenantId, table.code),
  ],
)
