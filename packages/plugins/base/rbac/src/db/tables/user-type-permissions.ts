import { sql } from 'drizzle-orm'
import { foreignKey, index, primaryKey, snakeCase, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userTypes } from '@qualy/plugin-auth/schema'
import { tenants } from '@qualy/plugin-org/schema'
import { permissions } from './permissions.ts'

// tenant-scope base capabilities attached to a whole user type
export const userTypePermissions = snakeCase.table(
  'user_type_permissions',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userTypeId: uuid().notNull(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_user_type_permissions',
      columns: [table.tenantId, table.userTypeId, table.permissionId],
    }),
    foreignKey({
      name: 'fk_user_type_permissions_type',
      columns: [table.tenantId, table.userTypeId],
      foreignColumns: [userTypes.tenantId, userTypes.id],
    }).onDelete('cascade'),
    index('idx_user_type_permissions_tenant_type').on(table.tenantId, table.userTypeId),
  ],
)
