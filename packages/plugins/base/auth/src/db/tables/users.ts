import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { orgNodes, tenants } from '@qualy/plugin-org/schema'
import { userTypes } from './user-types.ts'

export const users = snakeCase.table(
  'users',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // tenant business number (student/staff id); once bound, ordinary
    // updates must not clear it
    businessNo: varchar({ length: 64 }),
    displayName: varchar({ length: 100 }).notNull(),
    userTypeId: uuid().notNull(),
    // every user belongs somewhere; the bootstrap admin gets the root node
    // (tenant provisioning creates the root before the admin)
    primaryOrgNodeId: uuid().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_users_display_name_not_blank', sql`btrim(${table.displayName}) <> ''`),
    uniqueIndex('uq_users_tenant_id_id').on(table.tenantId, table.id),
    uniqueIndex('uq_users_tenant_business_no')
      .on(table.tenantId, table.businessNo)
      .where(sql`${table.businessNo} IS NOT NULL`),
    foreignKey({
      name: 'fk_users_user_type',
      columns: [table.tenantId, table.userTypeId],
      foreignColumns: [userTypes.tenantId, userTypes.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_users_primary_org_node',
      columns: [table.tenantId, table.primaryOrgNodeId],
      foreignColumns: [orgNodes.tenantId, orgNodes.id],
    }).onDelete('restrict'),
    index('idx_users_tenant_user_type').on(table.tenantId, table.userTypeId),
    // backs org-membership listings and the referencing side of the node fk
    index('idx_users_tenant_org_node_name').on(
      table.tenantId,
      table.primaryOrgNodeId,
      table.displayName,
    ),
  ],
)
