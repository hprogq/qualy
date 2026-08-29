import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// The formula library's tables: a function is a business identity with one
// mutable draft; a published version is an immutable execution contract —
// sources, artifact, schemas, toolchain identity and its own test report.
// Versions are never updated or deleted; archiving a function only hides it
// from new configuration.

const p = defineEntity.properties

const tenantOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

export const FormulaFunction = defineEntity({
  name: 'FormulaFunction',
  tableName: 'assessment_formula_functions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_formula_functions_tenant_id_tenants_id_fkey'),
    // deliberately no foreign key: a function outlives its owning node as a
    // readable historical fact, it just cannot anchor NEW configuration once
    // the node is gone - the service refuses that, not the schema
    ownerNodeId: p.uuid(),
    name: p.string().length(255),
    description: p.text().nullable(),
    draftSourceTs: p.text(),
    draftTests: p.json<readonly Record<string, unknown>[]>(),
    draftRevision: p.integer().default(1),
    createdBy: p.uuid(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedBy: p.uuid(),
    updatedAt: p.datetime().defaultRaw('now()'),
    archivedAt: p.datetime().nullable(),
  },
  checks: [
    {
      name: 'chk_assessment_formula_functions_name_not_blank',
      expression: `btrim(name) <> ''`,
    },
  ],
  indexes: [
    {
      name: 'uq_assessment_formula_functions_tenant_id_id',
      expression:
        'create unique index uq_assessment_formula_functions_tenant_id_id on assessment_formula_functions (tenant_id, id)',
    },
    {
      name: 'idx_assessment_formula_functions_tenant_owner',
      expression:
        'create index idx_assessment_formula_functions_tenant_owner on assessment_formula_functions (tenant_id, owner_node_id)',
    },
  ],
})

export const FormulaVersion = defineEntity({
  name: 'FormulaVersion',
  tableName: 'assessment_formula_versions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_formula_versions_tenant_id_tenants_id_fkey'),
    functionId: p.uuid(),
    versionNo: p.integer(),
    sourceTs: p.text(),
    runtimeJs: p.text(),
    inputSchema: p.json<Record<string, unknown>>(),
    outputSchema: p.json<Record<string, unknown>>(),
    sourceSha256: p.string().length(64),
    runtimeSha256: p.string().length(64),
    contractSha256: p.string().length(64),
    // the compiler's real identity, effect-tsgo patch suffix included
    typescriptVersion: p.string().length(63),
    esbuildVersion: p.string().length(63),
    // the artifact protocol number the SDK exports, not a package version
    formulaAbiVersion: p.integer(),
    // content hash of the SDK runtime bundled into the artifact
    formulaRuntimeSha256: p.string().length(64),
    quickjsEngineVersion: p.string().length(63),
    tests: p.json<readonly Record<string, unknown>[]>(),
    testReport: p.json<Record<string, unknown>>(),
    publishedBy: p.uuid(),
    publishedAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_assessment_formula_versions_tenant_function_no',
      expression:
        'create unique index uq_assessment_formula_versions_tenant_function_no on assessment_formula_versions (tenant_id, function_id, version_no)',
    },
    {
      name: 'uq_assessment_formula_versions_tenant_id_id',
      expression:
        'create unique index uq_assessment_formula_versions_tenant_id_id on assessment_formula_versions (tenant_id, id)',
    },
  ],
})

export const entities = [FormulaFunction, FormulaVersion] as const

export const compositeForeignKeys = [
  `alter table assessment_formula_versions add constraint fk_assessment_formula_versions_function
     foreign key (tenant_id, function_id) references assessment_formula_functions (tenant_id, id) on delete cascade`,
]
