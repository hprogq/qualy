import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  smallint,
  snakeCase,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { codePattern } from '../code-pattern.ts'
import { ltree } from '../ltree.ts'
import { orgTypes } from './org-types.ts'
import { tenants } from './tenants.ts'

export const orgNodes = snakeCase.table(
  'org_nodes',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid(),
    orgTypeId: uuid().notNull(),
    // optional stable identifier; seeds and fixtures look nodes up by code
    code: varchar({ length: 63 }),
    name: varchar({ length: 255 }).notNull(),
    path: ltree().notNull(),
    depth: smallint().default(0).notNull(),
    sortOrder: smallint().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'chk_org_nodes_code_format',
      sql`${table.code} IS NULL OR ${table.code} ~ ${sql.raw(codePattern)}`,
    ),
    check('chk_org_nodes_name_not_blank', sql`btrim(${table.name}) <> ''`),
    check('chk_org_nodes_depth_non_negative', sql`${table.depth} >= 0`),
    check('chk_org_nodes_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
    check(
      'chk_org_nodes_parent_not_self',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    uniqueIndex('uq_org_nodes_tenant_id_id').on(table.tenantId, table.id),
    // tenant-scoped composite foreign keys: a node can only reference a parent
    // and a type of its own tenant, enforced by the database itself
    foreignKey({
      name: 'fk_org_nodes_parent',
      columns: [table.tenantId, table.parentId],
      foreignColumns: [table.tenantId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_org_nodes_org_type',
      columns: [table.tenantId, table.orgTypeId],
      foreignColumns: [orgTypes.tenantId, orgTypes.id],
    }).onDelete('restrict'),
    uniqueIndex('uq_org_nodes_tenant_code')
      .on(table.tenantId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
    // sibling names are unique per parent; roots (parent IS NULL) get their
    // own partial index because postgres unique treats NULLs as distinct
    uniqueIndex('uq_org_nodes_tenant_parent_name')
      .on(table.tenantId, table.parentId, table.name)
      .where(sql`${table.parentId} IS NOT NULL`),
    uniqueIndex('uq_org_nodes_tenant_root_name')
      .on(table.tenantId, table.name)
      .where(sql`${table.parentId} IS NULL`),
    // the database guarantees at most one root per tenant; the org service
    // owns "at least one root" and root protection
    uniqueIndex('uq_org_nodes_tenant_single_root')
      .on(table.tenantId)
      .where(sql`${table.parentId} IS NULL`),
    index('idx_org_nodes_parent_sort').on(
      table.tenantId,
      table.parentId,
      table.sortOrder,
      table.name,
    ),
    // backs type-scoped node queries and the referencing side of the type
    // foreign key (postgres never indexes that side automatically)
    index('idx_org_nodes_tenant_type').on(table.tenantId, table.orgTypeId),
    index('idx_org_nodes_path_gist').using('gist', table.path),
  ],
)
