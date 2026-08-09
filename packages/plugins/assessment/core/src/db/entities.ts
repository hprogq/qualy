import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// The assessment domain's batch, phase and roster tables. Entry, review,
// scoring and publication tables arrive with their own milestones; nothing
// here anticipates them beyond the two bare uuid columns called out below.
//
// Constraint names are explicit throughout: postgres errors are translated to
// domain errors by constraint name, and the parity gates compare the schema
// these declarations build against the committed lineage object by object.

const p = defineEntity.properties

const CODE = `'^[a-z0-9]+(?:-[a-z0-9]+)*$'`

/** the tenant a row belongs to, cascading when the tenant goes */
const tenantOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

/** the same, as part of a composite primary key */
const tenantKeyOf = (foreignKeyName: string) => () =>
  p
    .manyToOne(Tenant)
    .primary()
    .joinColumns('tenant_id')
    .referencedColumnNames('id')
    .foreignKeyName(foreignKeyName)
    .deleteRule('cascade')

// One batch = one rule set over one org subtree. The scope node is referenced
// and its path snapshotted; participants freeze their own anchors, so the
// batch-level snapshot only serves scope display and jurisdiction checks.
export const AssessmentBatch = defineEntity({
  name: 'AssessmentBatch',
  tableName: 'assessment_batches',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_batches_tenant_id_tenants_id_fkey'),
    name: p.string().length(255),
    // administrator-authored markdown; business data, not a message catalog key
    descriptionMd: p.text().nullable(),
    scopeNodeId: p.uuid(),
    scopePath: p.string().type('ltree'),
    // material dates are half-open [start, end): certificates carry dates, not
    // instants, so a date range avoids 23:59:59.999 and timezone noise
    materialRange: p.string().type('daterange'),
    // process times are timestamptz displayed in this zone
    timezone: p.string().length(63).defaultRaw(`'Asia/Shanghai'`),
    status: p.string().length(16).defaultRaw(`'draft'`),
    // monotonic counter behind the append-only config event log; a ScoreRun
    // freezes the value it read, which is what makes stale runs detectable
    configRevision: p.integer().default(0),
    // projection of the phase queue, never authoritative
    currentPhaseId: p.uuid().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_assessment_batches_name_not_blank', expression: `btrim(name) <> ''` },
    {
      name: 'chk_assessment_batches_status',
      expression: `status IN ('draft', 'active', 'archived')`,
    },
    { name: 'chk_assessment_batches_timezone_not_blank', expression: `btrim(timezone) <> ''` },
    {
      name: 'chk_assessment_batches_config_revision_non_negative',
      expression: 'config_revision >= 0',
    },
  ],
  indexes: [
    // (tenant_id, id) backs the tenant-scoped composite foreign keys, here and
    // in every table below: the database itself rejects cross-tenant references
    {
      name: 'uq_assessment_batches_tenant_id_id',
      expression:
        'create unique index uq_assessment_batches_tenant_id_id on assessment_batches (tenant_id, id)',
    },
    {
      name: 'idx_assessment_batches_tenant_status',
      expression:
        'create index idx_assessment_batches_tenant_status on assessment_batches (tenant_id, status)',
    },
    // referencing side of the scope-node foreign key; postgres never indexes it
    {
      name: 'idx_assessment_batches_tenant_scope_node',
      expression:
        'create index idx_assessment_batches_tenant_scope_node on assessment_batches (tenant_id, scope_node_id)',
    },
  ],
})

// which user types a batch enrolls; batch-level configuration, not a tenant
// global (§32.5)
export const BatchUserType = defineEntity({
  name: 'BatchUserType',
  tableName: 'batch_user_types',
  properties: {
    tenantId: tenantKeyOf('batch_user_types_tenant_id_tenants_id_fkey'),
    batchId: p.uuid().primary(),
    userTypeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_batch_user_types_tenant_user_type',
      expression:
        'create index idx_batch_user_types_tenant_user_type on batch_user_types (tenant_id, user_type_id)',
    },
  ],
})

// One named business phase in a batch's timeline queue. No start/end columns:
// an interval is [this phase's actual_entry_at, the next one's), derived and
// therefore unable to express gaps or overlaps.
export const BatchPhase = defineEntity({
  name: 'BatchPhase',
  tableName: 'batch_phases',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_phases_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    ordinal: p.integer(),
    phaseKey: p.string().length(63),
    displayName: p.string().length(100),
    entryTrigger: p.string().length(16),
    plannedEntryAt: p.datetime().nullable(),
    // the semantic instant the phase began: a scheduled boundary records its
    // planned value however late the scheduler ran (the machine's execution
    // instant goes to phase_events.processed_at); immutable once set
    actualEntryAt: p.datetime().nullable(),
    // duration spec copied from a template, materialized into planned_entry_at
    // once its anchoring event's instant is known
    entryOffset: p.json<Record<string, unknown>>().nullable(),
    // display-only estimate ("around Sep 10"); never arms anything
    estimatedEntryAt: p.datetime().nullable(),
    // Bound at schedulePreliminary, not at creation: NULL is the legitimate
    // unarmed state of a publication-triggered phase (§32.26). Bare uuid until
    // the publications table exists; the foreign key is a later ALTER.
    opensPublicationId: p.uuid().nullable(),
    // permission codes this phase opens, checked against PHASE_GATED
    permissionProfile: p.json<readonly string[]>().defaultRaw(`'[]'`),
    // provenance of a template application; survives template deletion
    sourceTemplateId: p.uuid().nullable(),
    sourceTemplateVersion: p.integer().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_batch_phases_ordinal_non_negative', expression: 'ordinal >= 0' },
    { name: 'chk_batch_phases_phase_key_format', expression: `phase_key ~ ${CODE}` },
    { name: 'chk_batch_phases_display_name_not_blank', expression: `btrim(display_name) <> ''` },
    {
      name: 'chk_batch_phases_entry_trigger',
      expression: `entry_trigger IN ('scheduled', 'manual', 'publication')`,
    },
    {
      name: 'chk_batch_phases_publication_binding',
      expression: `entry_trigger = 'publication' OR opens_publication_id IS NULL`,
    },
  ],
  indexes: [
    {
      name: 'uq_batch_phases_tenant_id_id',
      expression:
        'create unique index uq_batch_phases_tenant_id_id on batch_phases (tenant_id, id)',
    },
    {
      name: 'uq_batch_phases_tenant_batch_ordinal',
      expression:
        'create unique index uq_batch_phases_tenant_batch_ordinal on batch_phases (tenant_id, batch_id, ordinal)',
    },
    // one publication opens at most one phase
    {
      name: 'uq_batch_phases_opens_publication',
      expression:
        'create unique index uq_batch_phases_opens_publication on batch_phases (opens_publication_id) where opens_publication_id is not null',
    },
  ],
})

// append-only audit of plan edits and actual transitions; actor is recorded
// as a historical fact, deliberately without a foreign key, so the audit
// outlives any account
export const PhaseEvent = defineEntity({
  name: 'PhaseEvent',
  tableName: 'phase_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('phase_events_tenant_id_tenants_id_fkey'),
    phaseId: p.uuid(),
    kind: p.string().length(31),
    plannedAt: p.datetime().nullable(),
    // the semantic instant a transition took effect
    actualAt: p.datetime().nullable(),
    // when the machine executed it, for scheduled boundaries processed late
    processedAt: p.datetime().nullable(),
    actorId: p.uuid().nullable(),
    reason: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [{ name: 'chk_phase_events_kind_format', expression: `kind ~ ${CODE}` }],
  indexes: [
    {
      name: 'idx_phase_events_tenant_phase_created',
      expression:
        'create index idx_phase_events_tenant_phase_created on phase_events (tenant_id, phase_id, created_at)',
    },
  ],
})

// tenant-level phase sequence presets; application copies, never inherits
export const PhaseTemplate = defineEntity({
  name: 'PhaseTemplate',
  tableName: 'phase_templates',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('phase_templates_tenant_id_tenants_id_fkey'),
    name: p.string().length(100),
    version: p.integer().default(1),
    phases: p.json<readonly Record<string, unknown>[]>().defaultRaw(`'[]'`),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_phase_templates_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_phase_templates_version_positive', expression: 'version >= 1' },
  ],
  indexes: [
    {
      name: 'uq_phase_templates_tenant_name',
      expression:
        'create unique index uq_phase_templates_tenant_name on phase_templates (tenant_id, name)',
    },
  ],
})

// a scoped supplementary phase's item allowance; empty means unrestricted.
// item_id stays a bare uuid until the items table exists; the foreign key is
// a later ALTER.
export const PhaseItemScope = defineEntity({
  name: 'PhaseItemScope',
  tableName: 'phase_item_scopes',
  properties: {
    tenantId: tenantKeyOf('phase_item_scopes_tenant_id_tenants_id_fkey'),
    phaseId: p.uuid().primary(),
    itemId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
})

// a scoped supplementary phase's participant allowance; empty means unrestricted
export const PhaseParticipantScope = defineEntity({
  name: 'PhaseParticipantScope',
  tableName: 'phase_participant_scopes',
  properties: {
    tenantId: tenantKeyOf('phase_participant_scopes_tenant_id_tenants_id_fkey'),
    phaseId: p.uuid().primary(),
    participantId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_phase_participant_scopes_tenant_participant',
      expression:
        'create index idx_phase_participant_scopes_tenant_participant on phase_participant_scopes (tenant_id, participant_id)',
    },
  ],
})

// The frozen roster. anchor_path freezes the id chain, anchor_lineage freezes
// each level's node type alongside it - RoleAt resolves against the frozen
// node, then reads current holders, so org restructures and type changes
// never rewrite who reviews whom (ADR 0006). Never auto-added or auto-removed;
// excluded keeps every row.
export const BatchParticipant = defineEntity({
  name: 'BatchParticipant',
  tableName: 'batch_participants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_participants_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    userId: p.uuid(),
    assessmentAnchorNodeId: p.uuid(),
    anchorPath: p.string().type('ltree'),
    // [{nodeId, nodeTypeId}] from the anchor up to the root, frozen at
    // inclusion; jsonb on purpose - a snapshot chained back to live rows by
    // foreign keys would stop being one
    anchorLineage: p.json<readonly Record<string, unknown>[]>(),
    userTypeId: p.uuid(),
    status: p.string().length(16).defaultRaw(`'active'`),
    includedAt: p.datetime().defaultRaw('now()'),
    excludedAt: p.datetime().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_batch_participants_status',
      expression: `status IN ('active', 'excluded')`,
    },
  ],
  indexes: [
    {
      name: 'uq_batch_participants_tenant_id_id',
      expression:
        'create unique index uq_batch_participants_tenant_id_id on batch_participants (tenant_id, id)',
    },
    {
      name: 'uq_batch_participants_tenant_batch_user',
      expression:
        'create unique index uq_batch_participants_tenant_batch_user on batch_participants (tenant_id, batch_id, user_id)',
    },
    // referencing sides of the user, anchor and type foreign keys
    {
      name: 'idx_batch_participants_tenant_user',
      expression:
        'create index idx_batch_participants_tenant_user on batch_participants (tenant_id, user_id)',
    },
    {
      name: 'idx_batch_participants_tenant_anchor',
      expression:
        'create index idx_batch_participants_tenant_anchor on batch_participants (tenant_id, assessment_anchor_node_id)',
    },
    {
      name: 'idx_batch_participants_tenant_user_type',
      expression:
        'create index idx_batch_participants_tenant_user_type on batch_participants (tenant_id, user_type_id)',
    },
    // subtree jurisdiction and roster-diff queries over the frozen path
    {
      name: 'idx_batch_participants_anchor_path_gist',
      expression:
        'create index idx_batch_participants_anchor_path_gist on batch_participants using gist (anchor_path)',
    },
  ],
})

// append-only config event log behind assessment_batches.config_revision;
// actor recorded without a foreign key for the same reason as phase_events
export const BatchConfigRevision = defineEntity({
  name: 'BatchConfigRevision',
  tableName: 'batch_config_revisions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_config_revisions_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    revision: p.integer(),
    actorId: p.uuid().nullable(),
    diff: p.json<Record<string, unknown>>(),
    reason: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [{ name: 'chk_batch_config_revisions_revision_positive', expression: 'revision >= 1' }],
  indexes: [
    {
      name: 'uq_batch_config_revisions_tenant_batch_revision',
      expression:
        'create unique index uq_batch_config_revisions_tenant_batch_revision on batch_config_revisions (tenant_id, batch_id, revision)',
    },
  ],
})

/**
 * The tenant-scoped composite foreign keys, including the two that reach into
 * org and auth - which is why the descriptor declares database dependencies
 * on both.
 *
 * Delete rules are the data-retention policy: batch-owned rows go with their
 * batch, but rows recording that a person took part refuse to lose their
 * subject - a user, node or type referenced by assessment history cannot be
 * deleted out from under it.
 *
 * current_phase_id sets null column-wise (postgres 15+ syntax) because a
 * plain SET NULL would null tenant_id too, and because the projection must
 * not block deleting a draft batch's phases.
 */
export const compositeForeignKeys = [
  `alter table assessment_batches add constraint fk_assessment_batches_scope_node
     foreign key (tenant_id, scope_node_id) references org_nodes (tenant_id, id) on delete restrict`,
  `alter table assessment_batches add constraint fk_assessment_batches_current_phase
     foreign key (tenant_id, current_phase_id) references batch_phases (tenant_id, id) on delete set null (current_phase_id)`,
  `alter table batch_user_types add constraint fk_batch_user_types_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_user_types add constraint fk_batch_user_types_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete restrict`,
  `alter table batch_phases add constraint fk_batch_phases_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table phase_events add constraint fk_phase_events_phase
     foreign key (tenant_id, phase_id) references batch_phases (tenant_id, id) on delete cascade`,
  `alter table phase_item_scopes add constraint fk_phase_item_scopes_phase
     foreign key (tenant_id, phase_id) references batch_phases (tenant_id, id) on delete cascade`,
  `alter table phase_participant_scopes add constraint fk_phase_participant_scopes_phase
     foreign key (tenant_id, phase_id) references batch_phases (tenant_id, id) on delete cascade`,
  `alter table phase_participant_scopes add constraint fk_phase_participant_scopes_participant
     foreign key (tenant_id, participant_id) references batch_participants (tenant_id, id) on delete cascade`,
  `alter table batch_participants add constraint fk_batch_participants_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_participants add constraint fk_batch_participants_user
     foreign key (tenant_id, user_id) references users (tenant_id, id) on delete restrict`,
  `alter table batch_participants add constraint fk_batch_participants_anchor_node
     foreign key (tenant_id, assessment_anchor_node_id) references org_nodes (tenant_id, id) on delete restrict`,
  `alter table batch_participants add constraint fk_batch_participants_user_type
     foreign key (tenant_id, user_type_id) references user_types (tenant_id, id) on delete restrict`,
  `alter table batch_config_revisions add constraint fk_batch_config_revisions_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
]

export const entities = [
  AssessmentBatch,
  BatchUserType,
  BatchPhase,
  PhaseEvent,
  PhaseTemplate,
  PhaseItemScope,
  PhaseParticipantScope,
  BatchParticipant,
  BatchConfigRevision,
] as const
