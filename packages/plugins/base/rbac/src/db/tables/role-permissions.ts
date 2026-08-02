import { foreignKey, index, primaryKey, snakeCase, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'
import { permissions } from './permissions.ts'
import { roles } from './roles.ts'

export const rolePermissions = snakeCase.table(
  'role_permissions',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_role_permissions',
      columns: [table.tenantId, table.roleId, table.permissionId],
    }),
    foreignKey({
      name: 'fk_role_permissions_role',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    index('idx_role_permissions_tenant_role').on(table.tenantId, table.roleId),
  ],
)
