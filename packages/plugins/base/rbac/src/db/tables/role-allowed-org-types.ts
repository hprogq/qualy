import { foreignKey, primaryKey, snakeCase, timestamp, uuid } from 'drizzle-orm/pg-core'
import { orgTypes, tenants } from '@qualy/plugin-org/schema'
import { roles } from './roles.ts'

export const roleAllowedOrgTypes = snakeCase.table(
  'role_allowed_org_types',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull(),
    orgTypeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_role_allowed_org_types',
      columns: [table.tenantId, table.roleId, table.orgTypeId],
    }),
    foreignKey({
      name: 'fk_role_allowed_org_types_role',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_role_allowed_org_types_type',
      columns: [table.tenantId, table.orgTypeId],
      foreignColumns: [orgTypes.tenantId, orgTypes.id],
    }).onDelete('restrict'),
  ],
)
