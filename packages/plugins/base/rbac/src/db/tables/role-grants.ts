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

// Who holds which duty, and over what.
//
// A tenant role carries no node: it applies across the tenant, and pinning
// it to the root with subtree coverage was a fiction the last-administrator
// query and the eligibility rules both had to keep up. An org role is
// anchored: self covers exactly the node, subtree covers its ltree
// descendance.
export const roleGrants = snakeCase.table(
  'role_grants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    roleId: uuid().notNull(),
    orgNodeId: uuid(),
    coverage: varchar({ length: 16 }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_role_grants_coverage', sql`${table.coverage} IN ('self', 'subtree')`),
    // anchored or tenant-wide, never half of each
    check(
      'chk_role_grants_anchor',
      sql`(${table.orgNodeId} IS NULL) = (${table.coverage} IS NULL)`,
    ),
    // one grant per (user, role, anchor); the partial index covers the
    // tenant-wide case, where a null node would defeat a plain unique index
    uniqueIndex('uq_role_grants_anchored')
      .on(table.tenantId, table.userId, table.roleId, table.orgNodeId, table.coverage)
      .where(sql`${table.orgNodeId} IS NOT NULL`),
    uniqueIndex('uq_role_grants_tenant_wide')
      .on(table.tenantId, table.userId, table.roleId)
      .where(sql`${table.orgNodeId} IS NULL`),
    foreignKey({
      name: 'fk_role_grants_user',
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_role_grants_role',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_role_grants_node',
      columns: [table.tenantId, table.orgNodeId],
      foreignColumns: [orgNodes.tenantId, orgNodes.id],
    }).onDelete('restrict'),
    index('idx_role_grants_tenant_user').on(table.tenantId, table.userId),
    index('idx_role_grants_tenant_node').on(table.tenantId, table.orgNodeId),
    index('idx_role_grants_tenant_role').on(table.tenantId, table.roleId),
  ],
)
