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

// One batch = one round of assessment. Who takes part in it is the roster and
// nothing else: the organizational units somebody once imported from are a
// record of that act (roster_imports), not a standing definition the roster
// has to be kept in step with.
export const AssessmentBatch = defineEntity({
  name: 'AssessmentBatch',
  tableName: 'assessment_batches',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_batches_tenant_id_tenants_id_fkey'),
    name: p.string().length(255),
    // administrator-authored markdown; business data, not a message catalog key
    descriptionMd: p.text().nullable(),
    // material dates are half-open [start, end): certificates carry dates, not
    // instants, so a date range avoids 23:59:59.999 and timezone noise
    materialRange: p.string().type('daterange'),
    // process times are timestamptz displayed in this zone
    timezone: p.string().length(63).defaultRaw(`'Asia/Shanghai'`),
    status: p.string().length(16).defaultRaw(`'draft'`),
    // monotonic counter behind the append-only config event log; a ScoreRun
    // freezes the value it read, which is what makes stale runs detectable
    configRevision: p.integer().default(0),
    // the low-risk sugar switch (§9): a participant who has not submitted
    // anything yet may have an anchor change synced without the diff panel.
    // A config slot only until entries exist to define "first submission".
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
  ],
})

// The units a batch faces - its population's definition, as a set. Rows
// reference living org units by id and nothing else: the unit's current
// position resolves at read time, so a class moved elsewhere in the tree
// stays in scope. Deliberately no foreign key to org_nodes - a deleted unit
// must surface as a scope-integrity warning on the diff panel rather than
// vanish with its row or block the deletion; the service validates tenant
// and existence at write.
// What somebody once imported, and on what grounds.
//
// A record of an act, not a definition: "on 12 August these units and these
// user types were used to add 128 people". It is history, and nothing reads
// it to decide anything - who takes part in a batch is the roster and only
// the roster. A batch that kept a live "participant scope" would be two
// answers to one question, and every organizational change would ask which
// of them wins.
export const RosterImport = defineEntity({
  name: 'RosterImport',
  tableName: 'roster_imports',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('roster_imports_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    // the query that was run, as it was written: ids rather than references,
    // because a unit deleted afterwards must not erase the record of it
    orgNodeIds: p.json<readonly string[]>(),
    userTypeIds: p.json<readonly string[]>(),
    importedCount: p.integer(),
    actorId: p.uuid().nullable(),
    occurredAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'idx_roster_imports_batch',
      expression:
        'create index idx_roster_imports_batch on roster_imports (tenant_id, batch_id, occurred_at desc)',
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
    // prose about the phase, shown wherever the phase is: what it is for, or
    // why it has no time yet. Drives nothing (32.41)
    description: p.string().length(500).default(''),
    // the instant it is due to begin, or null while it is unscheduled. There
    // is no second way to enter a phase: a time or an administrator
    plannedEntryAt: p.datetime().nullable(),
    // what the round is waiting for before this phase can be given a time
    // ("waiting on the college's approval"). Read only while there is no
    // time: once one is set, the sentence is about a decision already made
    entryNote: p.string().length(200).default(''),
    // the semantic instant the phase began: a scheduled boundary records its
    // planned value however late the scheduler ran (the machine's execution
    // instant goes to phase_events.processed_at); immutable once set
    actualEntryAt: p.datetime().nullable(),
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

// What this batch has accepted of the tenant's authority.
//
// Not roles, and not a copy of them either. A role assignment is the tenant
// saying "this person does this job here"; these rows are the batch saying
// "and I accepted that much of it, on this date". Authority is then read as
//
//   what the assignment still carries  ∩  what this batch accepted
//
// which is the whole point of the acceptance boundary: withdrawing a role, an
// assignment or a capability narrows every batch at once, while granting one
// reaches only the batches whose administrator has since said yes. Without the
// ceiling, an assessment nobody has looked at in a year silently gains
// whatever the tenant added to a role last week.
export const BatchAccessSource = defineEntity({
  name: 'BatchAccessSource',
  tableName: 'batch_access_sources',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_access_sources_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    /**
     * The role assignment this came from. Deliberately no foreign key: a
     * revoked assignment must leave this row behind - it is the record of what
     * was accepted and when - rather than take it away.
     */
    roleAssignmentId: p.uuid(),
    /** who the assignment is for; stored so a person can be read without rbac */
    subjectId: p.uuid(),
    /**
     * inherited: the tenant already gave them this job, and the batch took it
     * on at creation or at a synchronisation.
     * explicit: this batch asked for the assignment itself, for somebody
     * brought in for this round.
     */
    origin: p.string().length(16),
    acceptedAt: p.datetime().defaultRaw('now()'),
    acceptedBy: p.uuid().nullable(),
  },
  checks: [
    {
      name: 'chk_batch_access_sources_origin',
      expression: `origin IN ('inherited', 'explicit')`,
    },
  ],
  indexes: [
    {
      name: 'uq_batch_access_sources_tenant_id_id',
      expression:
        'create unique index uq_batch_access_sources_tenant_id_id on batch_access_sources (tenant_id, id)',
    },
    {
      name: 'uq_batch_access_sources_assignment',
      expression:
        'create unique index uq_batch_access_sources_assignment on batch_access_sources (tenant_id, batch_id, role_assignment_id)',
    },
    {
      name: 'idx_batch_access_sources_subject',
      expression:
        'create index idx_batch_access_sources_subject on batch_access_sources (tenant_id, batch_id, subject_id)',
    },
  ],
})

/** the ceiling itself: one row per capability this batch said yes to */
export const BatchAccessSourcePermission = defineEntity({
  name: 'BatchAccessSourcePermission',
  tableName: 'batch_access_source_permissions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_access_source_permissions_tenant_id_tenants_id_fkey'),
    sourceId: p.uuid(),
    permissionCode: p.string().length(127),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_batch_access_source_permissions',
      expression:
        'create unique index uq_batch_access_source_permissions on batch_access_source_permissions (tenant_id, source_id, permission_code)',
    },
  ],
})

/**
 * What this batch takes back, whoever gave it.
 *
 * Held against the person rather than against one source, because that is what
 * an administrator means: somebody who is both a tutor and a year head has two
 * ways to reach the same capability, and turning it off once has to turn it
 * off. A deny against one of the two would read as done and leave the other
 * standing.
 */
export const BatchAccessDeny = defineEntity({
  name: 'BatchAccessDeny',
  tableName: 'batch_access_denies',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_access_denies_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    subjectId: p.uuid(),
    permissionCode: p.string().length(127),
    reason: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    createdBy: p.uuid().nullable(),
  },
  indexes: [
    {
      name: 'uq_batch_access_denies',
      expression:
        'create unique index uq_batch_access_denies on batch_access_denies (tenant_id, batch_id, subject_id, permission_code)',
    },
  ],
})

// What happened to the batch as a whole, as facts rather than as a column
// that can be nulled out.
//
// Archiving and reopening are not a flag flipping back and forth: a batch was
// closed on the 20th and opened again on the 3rd, and the fortnight in
// between is a real interval that the last phase did not run through. Kept
// append-only for the same reason phase_events is, and without a foreign key
// to the actor, so the record outlives the account.
export const BatchLifecycleEvent = defineEntity({
  name: 'BatchLifecycleEvent',
  tableName: 'batch_lifecycle_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_lifecycle_events_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    kind: p.string().length(31),
    occurredAt: p.datetime().defaultRaw('now()'),
    actorId: p.uuid().nullable(),
    reason: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_batch_lifecycle_events_kind',
      expression: `kind IN ('archived', 'reopened')`,
    },
    // reopening a finished batch is the one act nobody may perform silently
    {
      name: 'chk_batch_lifecycle_events_reopen_reason',
      expression: `kind <> 'reopened' OR btrim(coalesce(reason, '')) <> ''`,
    },
  ],
  indexes: [
    {
      name: 'idx_batch_lifecycle_events_tenant_batch_occurred',
      expression:
        'create index idx_batch_lifecycle_events_tenant_batch_occurred on batch_lifecycle_events (tenant_id, batch_id, occurred_at)',
    },
  ],
})

// Tenant-level presets, in two kinds that share a table but not a meaning:
// a 'timeline' is a whole phase sequence a draft batch can start from, while
// a 'phase' describes one phase's options (name and what it opens) and is
// applied to a single row of a plan. Application copies, never inherits.
export const PhaseTemplate = defineEntity({
  name: 'PhaseTemplate',
  tableName: 'phase_templates',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('phase_templates_tenant_id_tenants_id_fkey'),
    name: p.string().length(100),
    kind: p.string().length(16).default('timeline'),
    version: p.integer().default(1),
    phases: p.json<readonly Record<string, unknown>[]>().defaultRaw(`'[]'`),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_phase_templates_name_not_blank', expression: `btrim(name) <> ''` },
    { name: 'chk_phase_templates_kind', expression: `kind IN ('timeline', 'phase')` },
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
    includedBy: p.uuid().nullable(),
    excludedAt: p.datetime().nullable(),
    excludedBy: p.uuid().nullable(),
    // why somebody was taken out, for the round where they had already
    // submitted something: membership is withdrawn, never deleted
    exclusionReason: p.string().length(500).nullable(),
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
  `alter table assessment_batches add constraint fk_assessment_batches_current_phase
     foreign key (tenant_id, current_phase_id) references batch_phases (tenant_id, id) on delete set null (current_phase_id)`,
  `alter table roster_imports add constraint fk_roster_imports_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_phases add constraint fk_batch_phases_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_access_sources add constraint fk_batch_access_sources_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_access_sources add constraint fk_batch_access_sources_subject
     foreign key (tenant_id, subject_id) references users (tenant_id, id) on delete cascade`,
  `alter table batch_access_source_permissions add constraint fk_batch_access_source_permissions_source
     foreign key (tenant_id, source_id) references batch_access_sources (tenant_id, id) on delete cascade`,
  `alter table batch_access_denies add constraint fk_batch_access_denies_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_access_denies add constraint fk_batch_access_denies_subject
     foreign key (tenant_id, subject_id) references users (tenant_id, id) on delete cascade`,
  `alter table batch_lifecycle_events add constraint fk_batch_lifecycle_events_batch
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
  RosterImport,
  BatchPhase,
  PhaseEvent,
  BatchLifecycleEvent,
  BatchAccessSource,
  BatchAccessSourcePermission,
  BatchAccessDeny,
  PhaseTemplate,
  PhaseItemScope,
  PhaseParticipantScope,
  BatchParticipant,
  BatchConfigRevision,
] as const
