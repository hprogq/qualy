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
    name: p.string().length(255),
    description: p.text().nullable(),
    draftSourceTs: p.text(),
    draftTests: p.json<readonly Record<string, unknown>[]>(),
    draftRevision: p.integer().default(1),
    // The author, and deliberately no foreign key: authorship is a fact
    // about who wrote this, not a live reference. It never moves - there is
    // no transfer and no administrative takeover - so when an author's
    // account goes away the mutable function simply has nobody who may edit
    // it, while every published version it minted stays replayable forever.
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
      // Exactly the library list's keyset: one author's formulas, newest
      // touched first, with the id breaking ties. Declared ascending and
      // read backwards, which a btree does natively and which gives the
      // `updated_at desc, id desc` the list asks for - spelling the
      // directions out instead would only make the schema generator and
      // the ORM's own create-schema disagree about the trailing column.
      name: 'idx_assessment_formula_functions_tenant_author_updated',
      expression:
        'create index idx_assessment_formula_functions_tenant_author_updated on assessment_formula_functions (tenant_id, created_by, updated_at, id)',
    },
  ],
})

// testReport rows are the structured report array, not a record
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
    // the value-schema language, the regex dialect and the sandbox calling
    // convention this version was proven under; execution must check them
    // before replaying history in a newer world
    valueSchemaProfileVersion: p.integer().default(1),
    regexProfileVersion: p.integer().default(1),
    sandboxAbiVersion: p.integer().default(1),
    // where this version actually came from - the source-language policy it
    // passed, the parser that decided it, and WHICH compiler/runtime builds
    // served the publication. Provenance for audits, never a compat gate:
    // rows minted before process isolation carry 'unrecorded'.
    sourcePolicyVersion: p.integer().default(1),
    sourcePolicyParserVersion: p.string().length(63).default('unrecorded'),
    authoringBuildId: p.string().length(64).default('unrecorded'),
    sandboxRuntimeBuildId: p.string().length(64).default('unrecorded'),
    // what publication is idempotent over: the same source, examples and
    // toolchain republished answer with the version that already exists.
    // Nullable because rows published before the fingerprint existed cannot
    // be given one retroactively.
    publishFingerprint: p.string().length(64).nullable(),
    tests: p.json<readonly Record<string, unknown>[]>(),
    testReport: p.json<readonly Record<string, unknown>[]>(),
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
    {
      name: 'uq_assessment_formula_versions_fingerprint',
      expression:
        'create unique index uq_assessment_formula_versions_fingerprint on assessment_formula_versions (tenant_id, function_id, publish_fingerprint)',
    },
  ],
})

export const entities = [FormulaFunction, FormulaVersion] as const

export const compositeForeignKeys = [
  // RESTRICT, not CASCADE: a published version is a permanent execution
  // fact - dropping the function must be refused (23001) while any version
  // stands. Tenant lifecycle still cascades whole: restrict evaluates the
  // STATEMENT's final state, so one `delete from tenants` removes versions
  // through their own tenant edge before the function edge is judged
  // (probed and CI-held by the isomorphic diamond in org's schema.test).
  `alter table assessment_formula_versions add constraint fk_assessment_formula_versions_function
     foreign key (tenant_id, function_id) references assessment_formula_functions (tenant_id, id) on delete restrict`,
]
