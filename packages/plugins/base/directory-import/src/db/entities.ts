import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// What a directory import did, kept as history.
//
// Four tables and no foreign key beyond the tenant: an import outlives the
// people and the units it made - a unit may be deleted, a person is only
// ever marked deleted - and history must neither vanish with them nor pin
// them in place. The rows say which spreadsheet line became which person;
// the nodes say which units were made or reused on the way; the events say
// what was done to the import afterwards. What a person or a unit IS now
// lives on their own rows, joined when a screen asks.

const p = defineEntity.properties

const tenantOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

export const DirectoryImport = defineEntity({
  name: 'DirectoryImport',
  tableName: 'directory_imports',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('directory_imports_tenant_id_tenants_id_fkey'),
    // the spreadsheet as it was sent, bound in the same transaction that
    // writes this row; its own name and size as they were, so the record
    // still reads once the attachment is retired
    sourceAttachmentId: p.uuid(),
    filenameSnapshot: p.string().length(255),
    sizeBytes: p.bigint(),
    contentHashAlgorithm: p.string().length(32).nullable(),
    contentHash: p.string().length(128).nullable(),
    actorId: p.uuid().nullable(),
    sheetName: p.string().length(255),
    headerRow: p.integer(),
    userTypeId: p.uuid(),
    // the deepest unit every row stood under: where the reader's authority
    // is judged when history is read back
    anchorNodeId: p.uuid(),
    // history, not configuration: what the mapping and the chain were
    mappingSnapshot: p.json<Record<string, unknown>>(),
    chainSnapshot: p.json<readonly unknown[]>(),
    sourceRowCount: p.integer(),
    createdUserCount: p.integer(),
    existingUserCount: p.integer(),
    createdNodeCount: p.integer(),
    reusedNodeCount: p.integer(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      // one upload, one import: a lost response and a second press must not
      // provision the same people twice
      name: 'uq_directory_imports_source',
      expression:
        'create unique index uq_directory_imports_source on directory_imports (tenant_id, source_attachment_id)',
    },
    {
      name: 'idx_directory_imports_tenant_time',
      expression:
        'create index idx_directory_imports_tenant_time on directory_imports (tenant_id, created_at desc, id)',
    },
  ],
})

export const DirectoryImportRow = defineEntity({
  name: 'DirectoryImportRow',
  tableName: 'directory_import_rows',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('directory_import_rows_tenant_id_tenants_id_fkey'),
    importId: p.uuid(),
    sourceRowNo: p.integer(),
    userId: p.uuid().nullable(),
    businessNoSnapshot: p.string().length(64),
    displayNameSnapshot: p.string().length(255),
    primaryOrgNodeIdSnapshot: p.uuid().nullable(),
    primaryOrgPathSnapshot: p.text(),
    disposition: p.string().length(16),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_directory_import_rows_disposition',
      expression: `disposition IN ('created', 'existing')`,
    },
  ],
  indexes: [
    {
      name: 'idx_directory_import_rows_import',
      expression:
        'create index idx_directory_import_rows_import on directory_import_rows (tenant_id, import_id, source_row_no)',
    },
    {
      name: 'idx_directory_import_rows_user',
      expression:
        'create index idx_directory_import_rows_user on directory_import_rows (tenant_id, user_id)',
    },
  ],
})

export const DirectoryImportNode = defineEntity({
  name: 'DirectoryImportNode',
  tableName: 'directory_import_nodes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('directory_import_nodes_tenant_id_tenants_id_fkey'),
    importId: p.uuid(),
    // the unit, while it exists; nothing pins it here once it is gone
    orgNodeId: p.uuid().nullable(),
    parentNodeIdSnapshot: p.uuid().nullable(),
    orgTypeIdSnapshot: p.uuid(),
    nameSnapshot: p.string().length(255),
    pathSnapshot: p.text(),
    depthInImport: p.integer(),
    disposition: p.string().length(16),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_directory_import_nodes_disposition',
      expression: `disposition IN ('created', 'reused')`,
    },
  ],
  indexes: [
    {
      name: 'idx_directory_import_nodes_import',
      expression:
        'create index idx_directory_import_nodes_import on directory_import_nodes (tenant_id, import_id, depth_in_import)',
    },
  ],
})

export const DirectoryImportEvent = defineEntity({
  name: 'DirectoryImportEvent',
  tableName: 'directory_import_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('directory_import_events_tenant_id_tenants_id_fkey'),
    importId: p.uuid(),
    kind: p.string().length(32),
    actorId: p.uuid().nullable(),
    reason: p.string().length(500).nullable(),
    affectedUserCount: p.integer().default(0),
    deletedNodeCount: p.integer().default(0),
    retainedNodeCount: p.integer().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_directory_import_events_kind',
      expression: `kind IN ('reversed', 'nodes-cleaned')`,
    },
  ],
  indexes: [
    {
      name: 'idx_directory_import_events_import',
      expression:
        'create index idx_directory_import_events_import on directory_import_events (tenant_id, import_id, created_at desc)',
    },
  ],
})

export const entities = [
  DirectoryImport,
  DirectoryImportRow,
  DirectoryImportNode,
  DirectoryImportEvent,
] as const
