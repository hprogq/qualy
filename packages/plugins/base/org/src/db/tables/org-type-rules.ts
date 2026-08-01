import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  primaryKey,
  snakeCase,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { orgTypes } from './org-types.ts'
import { tenants } from './tenants.ts'

export const orgTypeRules = snakeCase.table(
  'org_type_rules',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentTypeId: uuid().notNull(),
    childTypeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_org_type_rules',
      columns: [table.tenantId, table.parentTypeId, table.childTypeId],
    }),
    check('chk_org_type_rules_no_self_loop', sql`${table.parentTypeId} <> ${table.childTypeId}`),
    foreignKey({
      name: 'fk_org_type_rules_parent',
      columns: [table.tenantId, table.parentTypeId],
      foreignColumns: [orgTypes.tenantId, orgTypes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_org_type_rules_child',
      columns: [table.tenantId, table.childTypeId],
      foreignColumns: [orgTypes.tenantId, orgTypes.id],
    }).onDelete('cascade'),
    index('idx_org_type_rules_tenant_child').on(table.tenantId, table.childTypeId),
  ],
)
