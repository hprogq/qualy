import { defineEntity, UnderscoreNamingStrategy } from '@mikro-orm/core'
import { codePattern } from './code-pattern.ts'

// org's four tables.
//
// Every constraint, index and default the deployed lineage has is written out,
// because the assembly builds its schema from this file: anything missing here
// is a difference the parity gate reports, and would otherwise be an object
// that quietly stops existing.
//
// Constraint names are given explicitly throughout. They are not cosmetic -
// postgres errors are translated to domain errors by constraint name, and a
// repository gate checks every translated name against the schema, so a
// generated name retires both.

const p = defineEntity.properties

export const Tenant = defineEntity({
  name: 'Tenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    slug: p.string().length(63).unique('tenants_slug_key'),
    name: p.string().length(255),
    logoUrl: p.string().length(2048).nullable(),
    // enabled=false or a past expiresAt blocks new logins and invalidates
    // existing sessions; expiresAt null means no expiry
    enabled: p.boolean().default(true),
    expiresAt: p.datetime().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_tenants_slug_format', expression: `slug ~ ${codePattern}` },
    { name: 'chk_tenants_name_not_blank', expression: `btrim(name) <> ''` },
  ],
})

export const OrgType = defineEntity({
  name: 'OrgType',
  tableName: 'org_types',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenant: () =>
      p
        .manyToOne(Tenant)
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('org_types_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    // stable identifier for seeds, rules and cross-references; never renamed
    code: p.string().length(63),
    name: p.string().length(100),
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_org_types_code_format', expression: `code ~ ${codePattern}` },
    { name: 'chk_org_types_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_org_types_sort_order_non_negative', expression: 'sort_order >= 0' },
  ],
  indexes: [
    {
      name: 'uq_org_types_tenant_code',
      expression: 'create unique index uq_org_types_tenant_code on org_types (tenant_id, code)',
    },
    {
      name: 'uq_org_types_tenant_name',
      expression: 'create unique index uq_org_types_tenant_name on org_types (tenant_id, name)',
    },
    // (tenant_id, id) backs the tenant-scoped composite foreign keys other
    // tables use: the database itself rejects cross-tenant references
    {
      name: 'uq_org_types_tenant_id_id',
      expression: 'create unique index uq_org_types_tenant_id_id on org_types (tenant_id, id)',
    },
  ],
})

export const OrgTypeRule = defineEntity({
  name: 'OrgTypeRule',
  tableName: 'org_type_rules',
  properties: {
    tenant: () =>
      p
        .manyToOne(Tenant)
        .primary()
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('org_type_rules_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    parentTypeId: p.uuid().primary(),
    childTypeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_org_type_rules_no_self_loop', expression: 'parent_type_id <> child_type_id' },
  ],
  indexes: [
    {
      name: 'idx_org_type_rules_tenant_child',
      expression:
        'create index idx_org_type_rules_tenant_child on org_type_rules (tenant_id, child_type_id)',
    },
  ],
})

export const OrgNode = defineEntity({
  name: 'OrgNode',
  tableName: 'org_nodes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenant: () =>
      p
        .manyToOne(Tenant)
        .joinColumns('tenant_id')
        .referencedColumnNames('id')
        .foreignKeyName('org_nodes_tenant_id_tenants_id_fkey')
        .deleteRule('cascade'),
    parentId: p.uuid().nullable(),
    orgTypeId: p.uuid(),
    // optional stable identifier; seeds and fixtures look nodes up by code
    code: p.string().length(63).nullable(),
    name: p.string().length(255),
    // postgres ltree paths as plain strings; labels are node uuids with
    // hyphens stripped, joined by dots
    path: p.string().type('ltree'),
    depth: p.smallint().default(0),
    sortOrder: p.smallint().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_org_nodes_code_format', expression: `code IS NULL OR code ~ ${codePattern}` },
    { name: 'chk_org_nodes_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_org_nodes_depth_non_negative', expression: 'depth >= 0' },
    { name: 'chk_org_nodes_sort_order_non_negative', expression: 'sort_order >= 0' },
    { name: 'chk_org_nodes_parent_not_self', expression: 'parent_id IS NULL OR parent_id <> id' },
  ],
  indexes: [
    {
      name: 'uq_org_nodes_tenant_id_id',
      expression: 'create unique index uq_org_nodes_tenant_id_id on org_nodes (tenant_id, id)',
    },
    // path is a derived projection of the parent chain maintained by the org
    // service; uniqueness turns any maintenance bug into a loud constraint
    // error instead of silent tree corruption
    {
      name: 'uq_org_nodes_tenant_path',
      expression: 'create unique index uq_org_nodes_tenant_path on org_nodes (tenant_id, path)',
    },
    {
      name: 'uq_org_nodes_tenant_code',
      expression:
        'create unique index uq_org_nodes_tenant_code on org_nodes (tenant_id, code) where code is not null',
    },
    // sibling names are unique per parent; roots (parent IS NULL) get their
    // own partial index because postgres unique treats NULLs as distinct
    {
      name: 'uq_org_nodes_tenant_parent_name',
      expression:
        'create unique index uq_org_nodes_tenant_parent_name on org_nodes (tenant_id, parent_id, name) where parent_id is not null',
    },
    {
      name: 'uq_org_nodes_tenant_root_name',
      expression:
        'create unique index uq_org_nodes_tenant_root_name on org_nodes (tenant_id, name) where parent_id is null',
    },
    // the database guarantees at most one root per tenant; the org service
    // owns "at least one root" and root protection
    {
      name: 'uq_org_nodes_tenant_single_root',
      expression:
        'create unique index uq_org_nodes_tenant_single_root on org_nodes (tenant_id) where parent_id is null',
    },
    {
      name: 'idx_org_nodes_path_gist',
      expression: 'create index idx_org_nodes_path_gist on org_nodes using gist (path)',
    },
    // backs type-scoped node queries and the referencing side of the type
    // foreign key (postgres never indexes that side automatically)
    {
      name: 'idx_org_nodes_tenant_type',
      expression: 'create index idx_org_nodes_tenant_type on org_nodes (tenant_id, org_type_id)',
    },
    {
      name: 'idx_org_nodes_parent_sort',
      expression:
        'create index idx_org_nodes_parent_sort on org_nodes (tenant_id, parent_id, sort_order, name)',
    },
  ],
})

/**
 * The tenant-scoped composite foreign keys, including the self-reference.
 *
 * Declared apart from the entities because they point at a composite unique
 * key rather than at a primary one - the shape that carries tenant isolation
 * into the database, and one the schema generator has no declaration for.
 */
export const orgCompositeForeignKeys = [
  `alter table org_nodes add constraint fk_org_nodes_org_type
     foreign key (tenant_id, org_type_id) references org_types (tenant_id, id) on delete restrict`,
  `alter table org_nodes add constraint fk_org_nodes_parent
     foreign key (tenant_id, parent_id) references org_nodes (tenant_id, id) on delete restrict`,
  `alter table org_type_rules add constraint fk_org_type_rules_parent
     foreign key (tenant_id, parent_type_id) references org_types (tenant_id, id) on delete cascade`,
  `alter table org_type_rules add constraint fk_org_type_rules_child
     foreign key (tenant_id, child_type_id) references org_types (tenant_id, id) on delete cascade`,
]

/**
 * The names the lineage already gave these constraints.
 *
 * MikroORM derives a primary key's name as `<table>_pkey`, which matches every
 * table here except the one whose key is composite: the lineage calls that one
 * `pk_org_type_rules`. Renaming it instead would be a migration that changes
 * nothing a query can see, and would break error translation for as long as
 * the two halves disagreed - so the strategy is taught the existing name
 * rather than the schema taught a new one.
 */
export class QualyNamingStrategy extends UnderscoreNamingStrategy {
  private static readonly EXISTING: Record<string, string> = {
    org_type_rules: 'pk_org_type_rules',
  }

  override indexName(
    tableName: string,
    columns: string[],
    type: 'primary' | 'foreign' | 'unique' | 'index' | 'sequence' | 'check' | 'default' | 'trigger',
  ): string {
    if (type === 'primary') {
      const existing = QualyNamingStrategy.EXISTING[tableName]
      if (existing) return existing
    }
    return super.indexName(tableName, columns, type)
  }
}

export const entities = [Tenant, OrgType, OrgTypeRule, OrgNode] as const
