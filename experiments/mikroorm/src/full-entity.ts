import { defineEntity } from '@mikro-orm/core'

// org_nodes, declared in full.
//
// The entities next door are the minimum the queries needed. This one is the
// whole table, because the question the migration side has to answer is not
// "can MikroORM address these columns" but "can it emit this DDL": a uuidv7()
// default that the database owns, an ltree column, five check constraints, two
// tenant-scoped composite foreign keys, and a partial unique index.
//
// If any of those cannot be expressed, a from-scratch deployment built from
// entities is not the schema the product has, and the whole route stops here.

const p = defineEntity.properties

export const FullTenant = defineEntity({
  name: 'FullTenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    slug: p.string().length(63),
    name: p.string().length(255),
    enabled: p.boolean().default(true),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  uniques: [{ name: 'uq_tenants_slug', properties: ['slug'] }],
})

export const FullOrgType = defineEntity({
  name: 'FullOrgType',
  tableName: 'org_types',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    code: p.string().length(63),
    name: p.string().length(255),
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  uniques: [
    { name: 'uq_org_types_tenant_code', properties: ['tenantId', 'code'] },
    // the composite key the tenant-scoped foreign keys point at
    { name: 'uq_org_types_tenant_id_id', properties: ['tenantId', 'id'] },
  ],
})

export const FullOrgNode = defineEntity({
  name: 'FullOrgNode',
  tableName: 'org_nodes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    parentId: p.uuid().nullable(),
    orgTypeId: p.uuid(),
    code: p.string().length(63).nullable(),
    name: p.string().length(255),
    path: p.string().type('ltree'),
    depth: p.smallint().default(0),
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_org_nodes_code_format',
      expression: `code IS NULL OR code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    },
    { name: 'chk_org_nodes_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_org_nodes_depth_non_negative', expression: 'depth >= 0' },
    { name: 'chk_org_nodes_sort_order_non_negative', expression: 'sort_order >= 0' },
    {
      name: 'chk_org_nodes_parent_not_self',
      expression: 'parent_id IS NULL OR parent_id <> id',
    },
  ],
  uniques: [{ name: 'uq_org_nodes_tenant_id_id', properties: ['tenantId', 'id'] }],
  indexes: [
    { name: 'idx_org_nodes_tenant_parent', properties: ['tenantId', 'parentId'] },
    // ltree lookups are the read path, and a btree over an ltree column does
    // not serve `<@`
    { name: 'idx_org_nodes_path', expression: 'create index idx_org_nodes_path on org_nodes using gist (path)' },
    // partial: only a coded node participates, and the drizzle version says so
    // with a where clause
    {
      name: 'uq_org_nodes_tenant_code',
      expression:
        'create unique index uq_org_nodes_tenant_code on org_nodes (tenant_id, code) where code is not null',
    },
  ],
})

export const fullEntities = [FullTenant, FullOrgType, FullOrgNode] as const
