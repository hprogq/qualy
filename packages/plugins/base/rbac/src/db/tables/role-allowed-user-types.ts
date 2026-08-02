import { foreignKey, primaryKey, snakeCase, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userTypes } from '@qualy/plugin-auth/schema'
import { tenants } from '@qualy/plugin-org/schema'
import { roles } from './roles.ts'

// applicability, not permission: an org role without allowed user types is
// not "unrestricted" but unassignable
export const roleAllowedUserTypes = snakeCase.table(
  'role_allowed_user_types',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull(),
    userTypeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_role_allowed_user_types',
      columns: [table.tenantId, table.roleId, table.userTypeId],
    }),
    foreignKey({
      name: 'fk_role_allowed_user_types_role',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_role_allowed_user_types_type',
      columns: [table.tenantId, table.userTypeId],
      foreignColumns: [userTypes.tenantId, userTypes.id],
    }).onDelete('cascade'),
  ],
)
