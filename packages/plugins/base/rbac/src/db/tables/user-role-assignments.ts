import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from '@qualy/plugin-auth/schema'
import { orgNodes, tenants } from '@qualy/plugin-org/schema'
import { roles } from './roles.ts'

// who holds which duty over which org scope: self covers exactly the node,
// subtree covers the node and its ltree descendants
export const userRoleAssignments = snakeCase.table(
  'user_role_assignments',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    roleId: uuid().notNull(),
    orgNodeId: uuid().notNull(),
    scope: varchar({ length: 16 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_user_role_assignments_scope', sql`${table.scope} IN ('self', 'subtree')`),
    uniqueIndex('uq_user_role_assignments').on(
      table.tenantId,
      table.userId,
      table.roleId,
      table.orgNodeId,
      table.scope,
    ),
    foreignKey({
      name: 'fk_user_role_assignments_user',
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_user_role_assignments_role',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_user_role_assignments_node',
      columns: [table.tenantId, table.orgNodeId],
      foreignColumns: [orgNodes.tenantId, orgNodes.id],
    }).onDelete('restrict'),
    index('idx_user_role_assignments_tenant_user').on(table.tenantId, table.userId),
    index('idx_user_role_assignments_tenant_node').on(table.tenantId, table.orgNodeId),
    index('idx_user_role_assignments_tenant_role').on(table.tenantId, table.roleId),
  ],
)
