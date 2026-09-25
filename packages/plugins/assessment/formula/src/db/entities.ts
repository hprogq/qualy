import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// The formula library's tables. A function is a business identity with one
// mutable draft; every save of that draft's source or examples leaves an
// immutable draft revision behind it; a published version is an immutable
// execution contract - sources, artifact, schemas, toolchain identity, its
// own test report and the name its author published it under. Versions are
// never deleted, and nothing of them but their label ever changes.
// Revisions are never updated; the oldest of one function's history go once
// it holds more than it keeps, never its current draft's nor the ones its
// versions were published from. Archiving a function only hides it from new
// configuration.

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
    // What the NAME and the description are at, kept apart from the draft's
    // own revision. A rename is deliberately not a draft revision - nothing
    // that could be published moved - but it still needs a token of its own,
    // or two windows editing the description and the name would each save
    // against the draft revision they read, both be accepted, and the later
    // one silently drop the other's words. The same shape a published
    // version's label already carries.
    detailsRevision: p.integer().default(1),
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
    // Where this draft was forked from, if it was - the exact published
    // version somebody copied to start it. Deliberately no foreign key, for
    // the same reason `createdBy` has none: it records a fact about how this
    // function came to exist, not a live reference. A copy is a snapshot, so
    // nothing here is consulted to run anything; the source may be renamed,
    // archived, unshared or republished without this function noticing.
    copiedFromVersionId: p.uuid().nullable(),
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
    // What its author called this publication, and why they made it. These
    // two are the only columns of this table that may ever change: they are
    // a label on the record, not part of it. What a round was scored under
    // is the source, the examples and the artifact above - a better title
    // for the same rule rewrites nothing, while forcing a republication to
    // fix a typo would mint a version that says the rule changed when it did
    // not. Null only on rows published before publications were named.
    releaseName: p.string().length(100).nullable(),
    releaseNotes: p.text().nullable(),
    // the concurrency token for those two, kept apart from anything about
    // the publication itself: two windows editing the same version's title
    // must not overwrite each other, and the draft's own revision has
    // nothing to say about a version that was published long ago
    metadataRevision: p.integer().default(1),
    // who last rewrote the label, and when; null while it still reads as
    // its author first wrote it
    metadataUpdatedAt: p.datetime().nullable(),
    metadataUpdatedBy: p.uuid().nullable(),
  },
  checks: [
    {
      name: 'chk_assessment_formula_versions_release_name_not_blank',
      expression: `release_name is null or btrim(release_name) <> ''`,
    },
  ],
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
    {
      // one name, one publication: a name worn twice leaves the reader to
      // tell them apart by the number the name was meant to replace
      name: 'uq_assessment_formula_versions_release_name',
      expression:
        'create unique index uq_assessment_formula_versions_release_name on assessment_formula_versions (tenant_id, function_id, release_name) where release_name is not null',
    },
    {
      // the template library's keyset: newest published first, the id
      // breaking ties. Declared ascending and read backwards, which a btree
      // does natively - the same handling as the library list's own index.
      name: 'idx_assessment_formula_versions_tenant_published',
      expression:
        'create index idx_assessment_formula_versions_tenant_published on assessment_formula_versions (tenant_id, published_at, id)',
    },
  ],
})

/**
 * One saved state of a function's draft: its source and examples, whole.
 *
 * A row per save that changed either of them, and never a diff - a formula
 * is kilobytes, and a snapshot reads, restores and audits without replaying
 * anything. Renaming the function is not a revision: nothing that could be
 * published moved. Restoring an older state appends a new revision naming
 * where it came from rather than rewinding. What a function keeps of its
 * history is bounded: the library lets the oldest revisions go once there
 * are more than it keeps, sparing the current draft's and those a version
 * was published from.
 *
 * `origin` says how the revision came to be. `sourceVersionId` and
 * `sourceDraftRevisionNo` name what it was restored or copied from, and like
 * the function's own provenance carry no foreign key: they are facts about
 * how this state arose, not live references.
 */
export const FormulaDraftRevision = defineEntity({
  name: 'FormulaDraftRevision',
  tableName: 'assessment_formula_draft_revisions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_formula_draft_revisions_tenant_id_tenants_id_fkey'),
    functionId: p.uuid(),
    revisionNo: p.integer(),
    sourceTs: p.text(),
    tests: p.json<readonly Record<string, unknown>[]>(),
    sourceSha256: p.string().length(64),
    savedBy: p.uuid(),
    savedAt: p.datetime().defaultRaw('now()'),
    origin: p.string().length(32),
    sourceVersionId: p.uuid().nullable(),
    sourceDraftRevisionNo: p.integer().nullable(),
  },
  checks: [
    {
      name: 'chk_assessment_formula_draft_revisions_origin',
      expression: `origin in ('created', 'saved', 'restored-from-version', 'restored-from-draft', 'copied-from-template', 'migration')`,
    },
  ],
  indexes: [
    {
      // the revision list's own keyset as well: one function, newest first
      name: 'uq_assessment_formula_draft_revisions_no',
      expression:
        'create unique index uq_assessment_formula_draft_revisions_no on assessment_formula_draft_revisions (tenant_id, function_id, revision_no)',
    },
  ],
})

/**
 * Who a published version has been offered to.
 *
 * A row is one audience: everybody standing at this org node or under it may
 * DISCOVER this version and copy it. Discovery and copying, and nothing
 * else - a shared version never becomes bindable to somebody else's
 * question, which stays the author's own right.
 *
 * Scoped to the VERSION rather than the function on purpose. A version is an
 * immutable published fact; offering v1 must not silently offer whatever its
 * author publishes tomorrow.
 */
export const FormulaShareScope = defineEntity({
  name: 'FormulaShareScope',
  tableName: 'assessment_formula_share_scopes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_formula_share_scopes_tenant_id_tenants_id_fkey'),
    versionId: p.uuid(),
    orgNodeId: p.uuid(),
    // who offered it; a fact about the act, not a live reference - same
    // reasoning as `createdBy` above
    sharedBy: p.uuid(),
    sharedAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_assessment_formula_share_scopes',
      expression:
        'create unique index uq_assessment_formula_share_scopes on assessment_formula_share_scopes (tenant_id, version_id, org_node_id)',
    },
    {
      // the audience read: from a viewer's node outward to what it may see
      name: 'idx_assessment_formula_share_scopes_node',
      expression:
        'create index idx_assessment_formula_share_scopes_node on assessment_formula_share_scopes (tenant_id, org_node_id, version_id)',
    },
  ],
})

export const entities = [
  FormulaFunction,
  FormulaVersion,
  FormulaDraftRevision,
  FormulaShareScope,
] as const

export const compositeForeignKeys = [
  // RESTRICT, not CASCADE: a published version is a permanent execution
  // fact - dropping the function must be refused (23001) while any version
  // stands. Tenant lifecycle still cascades whole: restrict evaluates the
  // STATEMENT's final state, so one `delete from tenants` removes versions
  // through their own tenant edge before the function edge is judged
  // (probed and CI-held by the isomorphic diamond in org's schema.test).
  `alter table assessment_formula_versions add constraint fk_assessment_formula_versions_function
     foreign key (tenant_id, function_id) references assessment_formula_functions (tenant_id, id) on delete restrict`,
  // CASCADE on both edges, and the difference from the RESTRICT above is
  // lifetime rather than importance. A published version is a permanent
  // execution fact, so nothing may quietly remove one; an audience is the
  // CURRENT distribution policy, and a policy naming a version or a unit
  // that no longer exists is not a fact worth keeping - it is a row that
  // can only ever mislead a reader.
  `alter table assessment_formula_share_scopes add constraint fk_assessment_formula_share_scopes_version
     foreign key (tenant_id, version_id) references assessment_formula_versions (tenant_id, id) on delete cascade`,
  // CASCADE: a draft's history belongs to the function it drafted, and goes
  // with it - which a published version, above, never allows while it stands
  `alter table assessment_formula_draft_revisions add constraint fk_assessment_formula_draft_revisions_function
     foreign key (tenant_id, function_id) references assessment_formula_functions (tenant_id, id) on delete cascade`,
  `alter table assessment_formula_share_scopes add constraint fk_assessment_formula_share_scopes_node
     foreign key (tenant_id, org_node_id) references org_nodes (tenant_id, id) on delete cascade`,
]
