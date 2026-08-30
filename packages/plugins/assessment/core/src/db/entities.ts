import { defineEntity } from '@mikro-orm/core'
import { Tenant } from '@qualy/plugin-org/db'

// The assessment domain's tables: batches, phases and rosters; items,
// entries and review. Score run and publication tables arrive with the
// features that need them - nothing here anticipates them.
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
    // the score tree is written as a whole set, so a save states the version
    // it was composed against and every accepted one moves it on: without it
    // the later of two concurrent full-tree payloads deletes what the earlier
    // added, because omission is how the set says "removed"
    scoreGroupsVersion: p.integer().default(1),
    // the low-risk sugar switch (§9): a participant who has not submitted
    // anything yet may have an anchor change synced without the diff panel.
    // A config slot only until entries exist to define "first submission".
    // projection of the phase queue, never authoritative
    currentPhaseId: p.uuid().nullable(),
    // the labels a reviewer picks a reason from, one list per act:
    // {reject: string[], escalate: string[]}. Configuration, not history -
    // the chosen label is copied onto the review event, so editing these
    // lists never rewrites what anybody already said
    reviewReasons: p.json<Record<string, unknown>>().defaultRaw(`'{}'`),
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
/**
 * Where a round is administered from, frozen when it is created.
 *
 * The roster answers who takes part; it cannot also answer who may run the
 * round, because a round with nobody in it would then be nobody's - and
 * "nobody's" resolved to "anybody holding the permission somewhere", which
 * let an administrator of one college pick up an empty draft belonging to
 * another and fill it with their own people. These are the units the round
 * was drawn from, and they stay whatever happens to the roster.
 */
export const BatchManagementAnchor = defineEntity({
  name: 'BatchManagementAnchor',
  tableName: 'batch_management_anchors',
  properties: {
    tenantId: tenantKeyOf('batch_management_anchors_tenant_id_tenants_id_fkey'),
    batchId: p.uuid().primary(),
    orgNodeId: p.uuid().primary(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
})

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
/**
 * What happened to somebody's place in a round, in the order it happened.
 *
 * The participant row is the truth about who is in the round now; this is
 * the truth about how they came to be. Without it, taking somebody off the
 * list and putting them back left no trace of either: the row's own columns
 * are the current state, and restoring one clears the withdrawal it replaced.
 * Append-only, and nothing reads it to make a decision.
 */
export const BatchParticipantEvent = defineEntity({
  name: 'BatchParticipantEvent',
  tableName: 'batch_participant_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('batch_participant_events_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    participantId: p.uuid(),
    /** included, excluded, readmitted */
    kind: p.string().length(31),
    actorId: p.uuid().nullable(),
    reason: p.string().length(500).nullable(),
    occurredAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_batch_participant_events_kind',
      expression: `kind IN ('included', 'excluded', 'readmitted')`,
    },
  ],
  indexes: [
    {
      name: 'idx_batch_participant_events_participant',
      expression:
        'create index idx_batch_participant_events_participant on batch_participant_events (tenant_id, participant_id, occurred_at desc)',
    },
  ],
})

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
// item_id carries a real key to assessment_items (cascade: only a draft
// item with no business facts can be hard-deleted, and a phase allowance
// naming it should go with it). Since empty reads as unrestricted, the
// cascade may narrow an allowance but never empty one: deleting the last
// item a phase names is refused in the item service before it gets here.
// Same-batch membership is the service's check, like the participant
// allowance.
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
    // the target of the entries same-batch reference: an entry names its
    // participant together with its batch, and this is what makes that pair
    // checkable
    {
      name: 'uq_batch_participants_tenant_batch_id',
      expression:
        'create unique index uq_batch_participants_tenant_batch_id on batch_participants (tenant_id, batch_id, id)',
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

// --- items, entries and review ---
//
// From here down is what a batch is *about*: the questions it asks (items,
// versioned), the answers people give (entries, versioned), and the judgment
// passed on each answer (review instances and their events). Three shared
// rules govern all of it:
//
//   - History is append-only. Item configuration and entry content are both
//     revision tables; nothing updates a payload in place, and everything
//     that judges or scores an answer anchors the exact revision it judged.
//   - The batch is a boundary the database itself holds. Every reference
//     between two batch-scoped rows carries (tenant_id, batch_id) so that an
//     entry cannot cite an item from another round, whatever a service bug
//     asks for.
//   - Resolution snapshots are values, not references. Who reviews an entry
//     was decided from frozen lineage at submit time; the columns recording
//     that decision (node id, role ids, path) deliberately have no foreign
//     keys, because history must not pin the living org tree.

/**
 * A node of the score tree - only one level of it for now, but the shape is
 * final so nesting is an API change, not a migration.
 *
 * cap and floor are the whole reason the tree exists (ADR-5): combination
 * limits live here and only here, never inside a calculator.
 */
export const ScoreGroup = defineEntity({
  name: 'ScoreGroup',
  tableName: 'score_groups',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('score_groups_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    // the API refuses a parent while grouping is flat; the schema does not,
    // because freezing "flat" into the database would make nesting a
    // destructive change
    parentGroupId: p.uuid().nullable(),
    name: p.string().length(255),
    cap: p.decimal().precision(12).scale(4).nullable(),
    floor: p.decimal().precision(12).scale(4).nullable(),
    sortOrder: p.integer().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_score_groups_name_not_blank', expression: `btrim(name) <> ''` },
    // floor above cap would leave the aggregator two defensible answers;
    // negative values stay legal, deduction groups are real
    {
      name: 'chk_score_groups_floor_le_cap',
      expression: 'floor IS NULL OR cap IS NULL OR floor <= cap',
    },
  ],
  indexes: [
    {
      name: 'uq_score_groups_tenant_id_id',
      expression:
        'create unique index uq_score_groups_tenant_id_id on score_groups (tenant_id, id)',
    },
    // the target of every same-batch reference to a group
    {
      name: 'uq_score_groups_tenant_batch_id',
      expression:
        'create unique index uq_score_groups_tenant_batch_id on score_groups (tenant_id, batch_id, id)',
    },
    {
      name: 'idx_score_groups_tenant_batch_sort',
      expression:
        'create index idx_score_groups_tenant_batch_sort on score_groups (tenant_id, batch_id, sort_order)',
    },
  ],
})

/**
 * One question a batch asks - a light identity whose actual configuration
 * lives in immutable revisions.
 *
 * current_revision_id is what a *new* entry decodes against; an existing
 * entry decodes against the revision it recorded, whatever the item says
 * today. Nullable only for the instant between inserting the item and its
 * first revision; the service keeps it set from then on.
 */
export const AssessmentItem = defineEntity({
  name: 'AssessmentItem',
  tableName: 'assessment_items',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_items_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    // which driver interprets this item's config and payloads
    itemType: p.string().length(63),
    title: p.string().length(255),
    currentRevisionId: p.uuid().nullable(),
    scoreGroupId: p.uuid(),
    // how many entries one participant may hold; null is unlimited
    maxEntries: p.integer().nullable(),
    sortOrder: p.integer().default(0),
    status: p.string().length(16).defaultRaw(`'draft'`),
    voidedAt: p.datetime().nullable(),
    voidedBy: p.uuid().nullable(),
    voidReason: p.string().length(500).nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_assessment_items_item_type_format',
      expression: `item_type ~ '^[a-z0-9]+(?:[.-][a-z0-9]+)*$'`,
    },
    { name: 'chk_assessment_items_title_not_blank', expression: `btrim(title) <> ''` },
    {
      name: 'chk_assessment_items_status',
      expression: `status IN ('draft', 'active', 'voided')`,
    },
    {
      name: 'chk_assessment_items_max_entries_positive',
      expression: 'max_entries IS NULL OR max_entries >= 1',
    },
    // voiding is an act with an actor, a time and a non-blank reason; an
    // active row carries none of them. Spelled as two full arms because the
    // equality form has a hole: with the right side false, an active row
    // with a stray voided_at also makes the left side false, and false =
    // false passes
    {
      name: 'chk_assessment_items_void_state_shape',
      expression: `(status <> 'voided' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(void_reason) <> '')`,
    },
  ],
  indexes: [
    {
      name: 'uq_assessment_items_tenant_id_id',
      expression:
        'create unique index uq_assessment_items_tenant_id_id on assessment_items (tenant_id, id)',
    },
    {
      name: 'uq_assessment_items_tenant_batch_id',
      expression:
        'create unique index uq_assessment_items_tenant_batch_id on assessment_items (tenant_id, batch_id, id)',
    },
    {
      name: 'idx_assessment_items_tenant_batch_group',
      expression:
        'create index idx_assessment_items_tenant_batch_group on assessment_items (tenant_id, batch_id, score_group_id, sort_order)',
    },
  ],
})

/**
 * One saved configuration of an item, immutable from the moment it exists.
 *
 * Entry revisions and score runs cite these by id, which is what lets an
 * administrator change a question without changing what already-submitted
 * answers mean. There is deliberately no update path: fixing a config is
 * appending the next revision.
 */
export const AssessmentItemRevision = defineEntity({
  name: 'AssessmentItemRevision',
  tableName: 'assessment_item_revisions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('assessment_item_revisions_tenant_id_tenants_id_fkey'),
    itemId: p.uuid(),
    revisionNo: p.integer(),
    // who may create entries on this configuration: the students themselves,
    // or only staff recording an administrative fact
    entrySource: p.string().length(31),
    formConfig: p.json<Record<string, unknown>>(),
    scoringConfig: p.json<Record<string, unknown>>(),
    // The compiled execution plan for this revision's arithmetic: server
    // generated, never submitted, and never rewritten once written - what an
    // entry was scored by has to be a fact, not a re-derivation. Nullable
    // only for revisions that predate it, which the assembly's boot backfill
    // compiles through the one compiler; the column tightens when every
    // deployment has run it.
    scoringPlan: p.json<Record<string, unknown>>().nullable(),
    reviewPolicy: p.json<Record<string, unknown>>(),
    displayConfig: p.json<Record<string, unknown>>(),
    createdBy: p.uuid(),
    reason: p.string().length(500).nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_assessment_item_revisions_no_positive',
      expression: 'revision_no >= 1',
    },
    {
      name: 'chk_assessment_item_revisions_entry_source',
      expression: `entry_source IN ('student', 'administrative')`,
    },
  ],
  indexes: [
    {
      name: 'uq_assessment_item_revisions_tenant_id_id',
      expression:
        'create unique index uq_assessment_item_revisions_tenant_id_id on assessment_item_revisions (tenant_id, id)',
    },
    {
      name: 'uq_assessment_item_revisions_tenant_item_no',
      expression:
        'create unique index uq_assessment_item_revisions_tenant_item_no on assessment_item_revisions (tenant_id, item_id, revision_no)',
    },
    // the target of "this revision must belong to this item" references
    {
      name: 'uq_assessment_item_revisions_tenant_item_id',
      expression:
        'create unique index uq_assessment_item_revisions_tenant_item_id on assessment_item_revisions (tenant_id, item_id, id)',
    },
  ],
})

/**
 * One person's one claim on one item - the business identity, kept light.
 *
 * Content lives in revisions and judgment lives in review instances; what
 * this row holds is whose claim it is and where the claim stands. The status
 * is a projection of the review history, updated in the same transaction as
 * the event that moves it.
 */
export const Entry = defineEntity({
  name: 'Entry',
  tableName: 'entries',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('entries_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    itemId: p.uuid(),
    participantId: p.uuid(),
    currentRevisionId: p.uuid().nullable(),
    // the latest round, while one is open; history stays on the instances
    currentReviewInstanceId: p.uuid().nullable(),
    // what the institution currently recognises this claim as. An approved
    // entry has one; a reopened or overturned one keeps the last, because
    // "what was decided" does not stop being true while it is reconsidered
    currentRecognitionId: p.uuid().nullable(),
    status: p.string().length(16).defaultRaw(`'draft'`),
    // how the claim came to exist - self-filed, proxied, recorded by staff -
    // always derived by the server, never accepted from a client
    source: p.string().length(16),
    /**
     * The unread-dot pair (§32.72): a monotonic bumped in the same
     * transaction as any external change its owner should hear about, and
     * the mark of how far the owner has seen. `attention > seen` is the dot.
     * Revisions rather than timestamps: two writers racing on a clock give
     * wrong answers a counter cannot.
     */
    participantAttentionRevision: p.integer().default(0),
    participantSeenRevision: p.integer().default(0),
    createdAt: p.datetime().defaultRaw('now()'),
    updatedAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_entries_attention',
      expression: `participant_seen_revision >= 0 AND participant_attention_revision >= participant_seen_revision`,
    },
    // an approved claim has been recognised as something, even if that
    // something is the empty recognition a fixed question needs. The reverse
    // is deliberately NOT stated: a reopened or rejected entry keeps its
    // last determination as history, and the scorer ignores it by status
    {
      name: 'chk_entries_approved_has_recognition',
      expression: `status <> 'approved' OR current_recognition_id IS NOT NULL`,
    },
    {
      name: 'chk_entries_status',
      // needs_revision is not a rejection: it is what an administrator's
      // intervention or a configuration change leaves behind, and counting
      // it as one would put every such change into the rejection rate
      // (§32.62)
      expression: `status IN ('draft', 'in_review', 'needs_revision', 'approved', 'rejected', 'voided')`,
    },
    {
      name: 'chk_entries_source',
      expression: `source IN ('self', 'proxy', 'record', 'import', 'system')`,
    },
  ],
  indexes: [
    {
      name: 'uq_entries_tenant_id_id',
      expression: 'create unique index uq_entries_tenant_id_id on entries (tenant_id, id)',
    },
    // the target of the revision item-binding key: a revision names its entry
    // together with that entry's item, and this is what makes the pair
    // checkable
    // the target of "this row belongs to that round's entry" references
    {
      name: 'uq_entries_tenant_batch_id',
      expression:
        'create unique index uq_entries_tenant_batch_id on entries (tenant_id, batch_id, id)',
    },
    {
      name: 'uq_entries_tenant_id_item',
      expression:
        'create unique index uq_entries_tenant_id_item on entries (tenant_id, id, item_id)',
    },
    // one participant's entries on one item: the max_entries count and the
    // filing screen both read down this path
    {
      name: 'idx_entries_tenant_batch_participant_item',
      expression:
        'create index idx_entries_tenant_batch_participant_item on entries (tenant_id, batch_id, participant_id, item_id)',
    },
    {
      name: 'idx_entries_tenant_batch_item_status',
      expression:
        'create index idx_entries_tenant_batch_item_status on entries (tenant_id, batch_id, item_id, status)',
    },
  ],
})

/**
 * What happened to a claim that no review round can explain.
 *
 * A claim's story is otherwise told by its rounds: submitted, judged, ended.
 * But an approved claim sent back because the question changed under it has
 * no open round to record that in, and writing it into the rejections would
 * mean an administrator's edit shows up in the rejection rate. So the entry
 * itself gets a log, append-only like every other one here.
 */
export const EntryEvent = defineEntity({
  name: 'EntryEvent',
  tableName: 'entry_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('entry_events_tenant_id_tenants_id_fkey'),
    entryId: p.uuid(),
    kind: p.string().length(31),
    /** null when nobody in particular did it - a sweep, a scheduled step */
    actorId: p.uuid().nullable(),
    reason: p.string().length(500).nullable(),
    /**
     * The item revision that caused this, when a configuration change did.
     * Null for an intervention somebody performed by hand.
     */
    causeRevisionId: p.uuid().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [{ name: 'chk_entry_events_kind_format', expression: `kind ~ ${CODE}` }],
  indexes: [
    {
      name: 'idx_entry_events_tenant_entry_created',
      expression:
        'create index idx_entry_events_tenant_entry_created on entry_events (tenant_id, entry_id, created_at)',
    },
  ],
})

/**
 * What was actually said, each time it was said.
 *
 * The payload decodes against item_revision_id - the configuration that was
 * current when this revision was written - and never against the item's
 * latest. actor and subject are distinct on purpose: a proxy filing records
 * who typed and who it is about, and neither is ever client-supplied.
 */
export const EntryRevision = defineEntity({
  name: 'EntryRevision',
  tableName: 'entry_revisions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('entry_revisions_tenant_id_tenants_id_fkey'),
    entryId: p.uuid(),
    // the entry's own item, repeated here so the pair of keys below can hold
    // "item_revision_id is a revision of that item" without a service if
    itemId: p.uuid(),
    itemRevisionId: p.uuid(),
    revisionNo: p.integer(),
    payload: p.json<Record<string, unknown>>(),
    actorId: p.uuid(),
    subjectId: p.uuid(),
    source: p.string().length(16),
    note: p.string().length(500).nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    { name: 'chk_entry_revisions_no_positive', expression: 'revision_no >= 1' },
    {
      name: 'chk_entry_revisions_source',
      expression: `source IN ('self', 'proxy', 'record', 'import', 'system')`,
    },
  ],
  indexes: [
    {
      name: 'uq_entry_revisions_tenant_id_id',
      expression:
        'create unique index uq_entry_revisions_tenant_id_id on entry_revisions (tenant_id, id)',
    },
    {
      name: 'uq_entry_revisions_tenant_entry_no',
      expression:
        'create unique index uq_entry_revisions_tenant_entry_no on entry_revisions (tenant_id, entry_id, revision_no)',
    },
    // the target of "this revision must belong to this entry" references
    {
      name: 'uq_entry_revisions_tenant_entry_id',
      expression:
        'create unique index uq_entry_revisions_tenant_entry_id on entry_revisions (tenant_id, entry_id, id)',
    },
  ],
})

/**
 * What the institution decided, each time it decided it.
 *
 * Not a corrected filing: the student's evidence stays exactly as they wrote
 * it, forever, and this is the separate fact of what review made of it. The
 * two are different questions - "what was claimed" and "what was
 * recognised" - and a system that answers both with one row can never
 * explain a downgrade.
 *
 * Append-only, like every other decision here. A second determination
 * supersedes the first by pointing at it; nothing ever updates a row of this
 * table, which is what lets an appeal be explained as "provincial, then
 * national" rather than as a value that changed.
 *
 * `values` is keyed by recognition id, never by a calculator's parameter
 * name: parameter names belong to one version of one function, and these
 * facts outlive both.
 */
export const EntryRecognition = defineEntity({
  name: 'EntryRecognition',
  tableName: 'entry_recognitions',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('entry_recognitions_tenant_id_tenants_id_fkey'),
    batchId: p.uuid(),
    entryId: p.uuid(),
    /** the filing this determination was made against */
    entryRevisionId: p.uuid(),
    itemId: p.uuid(),
    /** the configuration whose recognition contract this was determined under */
    itemRevisionId: p.uuid(),
    values: p.json<Record<string, unknown>>(),
    /** where the determination came from; scoring never asks */
    source: p.string().length(16),
    reviewInstanceId: p.uuid().nullable(),
    reviewEventId: p.uuid().nullable(),
    /** the determination this one replaces, if it replaced one */
    supersedesId: p.uuid().nullable(),
    createdBy: p.uuid().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_entry_recognitions_source',
      expression: `source IN ('review', 'record', 'import', 'system')`,
    },
    {
      // an object of recognised facts, never a list or a bare number that
      // would later read as one
      name: 'chk_entry_recognitions_values_object',
      expression: `jsonb_typeof(values) = 'object'`,
    },
    // a determination made by review names the round and the word that made
    // it; one made any other way names neither, rather than half a story
    {
      name: 'chk_entry_recognitions_review_shape',
      expression: `(source <> 'review' AND review_instance_id IS NULL AND review_event_id IS NULL)
        OR (source = 'review' AND review_instance_id IS NOT NULL AND review_event_id IS NOT NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_entry_recognitions_tenant_id_id',
      expression:
        'create unique index uq_entry_recognitions_tenant_id_id on entry_recognitions (tenant_id, id)',
    },
    // the target of "this determination belongs to that entry" references,
    // which is what stops an entry pointing at another entry's recognition
    {
      name: 'uq_entry_recognitions_tenant_entry_id',
      expression:
        'create unique index uq_entry_recognitions_tenant_entry_id on entry_recognitions (tenant_id, entry_id, id)',
    },
    {
      // one word, one determination: the same approval cannot be the origin
      // of two formal recognitions
      name: 'uq_entry_recognitions_review_event',
      expression:
        'create unique index uq_entry_recognitions_review_event on entry_recognitions (tenant_id, review_event_id) where review_event_id is not null',
    },
    {
      // and the trail is a line, not a tree: one determination has at most
      // one successor
      name: 'uq_entry_recognitions_supersedes',
      expression:
        'create unique index uq_entry_recognitions_supersedes on entry_recognitions (tenant_id, supersedes_id) where supersedes_id is not null',
    },
    {
      name: 'idx_entry_recognitions_tenant_entry_created',
      expression:
        'create index idx_entry_recognitions_tenant_entry_created on entry_recognitions (tenant_id, entry_id, created_at)',
    },
  ],
})

/**
 * Which attachments a revision cites, as rows rather than an array column.
 *
 * The payload still names attachment ids field by field; this table is what
 * makes those names enforceable - a real foreign key into storage, a reverse
 * path for authorization, and a stable order.
 */
export const EntryRevisionAttachment = defineEntity({
  name: 'EntryRevisionAttachment',
  tableName: 'entry_revision_attachments',
  properties: {
    tenantId: tenantKeyOf('entry_revision_attachments_tenant_id_tenants_id_fkey'),
    revisionId: p.uuid().primary(),
    attachmentId: p.uuid().primary(),
    position: p.integer(),
  },
  checks: [
    {
      name: 'chk_entry_revision_attachments_position_non_negative',
      expression: 'position >= 0',
    },
  ],
  indexes: [
    {
      name: 'uq_entry_revision_attachments_tenant_revision_position',
      expression:
        'create unique index uq_entry_revision_attachments_tenant_revision_position on entry_revision_attachments (tenant_id, revision_id, position)',
    },
    // the reverse question: which revisions cite this attachment
    {
      name: 'idx_entry_revision_attachments_tenant_attachment',
      expression:
        'create index idx_entry_revision_attachments_tenant_attachment on entry_revision_attachments (tenant_id, attachment_id)',
    },
  ],
})

/**
 * One formal round of judgment over one revision of one entry.
 *
 * A row per submission, never reused: withdrawing and resubmitting opens a
 * new round with its own history. The chain the round walks was resolved
 * from frozen lineage at submit time and snapshotted into effective_chain;
 * the current_* columns are the projection the inbox joins against, and
 * they carry no foreign keys because completed rounds are history and
 * history must not pin the org tree.
 */
export const ReviewInstance = defineEntity({
  name: 'ReviewInstance',
  tableName: 'review_instances',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_instances_tenant_id_tenants_id_fkey'),
    entryId: p.uuid(),
    // the exact revision under judgment, frozen for the whole round
    revisionId: p.uuid(),
    roundNo: p.integer(),
    origin: p.string().length(16),
    initiator: p.string().length(16),
    /**
     * Which version of the question's review policy this round is walking.
     *
     * Not the version the judged filing was written under. Those are two
     * different facts about one round: what is being judged, and by what
     * procedure. A round opened today follows the procedure in force today,
     * which is what lets an administrator fix a level nobody holds by
     * editing the question rather than by asking every waiting student to
     * refile (§32.62).
     */
    policyRevisionId: p.uuid(),
    // and which version of the recognition contract it determines under.
    // The same revision as the policy today, and a separate fact anyway:
    // what a round asks a reviewer to determine and what procedure it walks
    // are two things that will not always move together
    recognitionRevisionId: p.uuid(),
    /** the round this one replaced, when a policy change opened it */
    supersedesInstanceId: p.uuid().nullable(),
    /** the decision being contested, when this round is an appeal against one */
    appealedInstanceId: p.uuid().nullable(),
    /**
     * The determination being contested, when no round produced it.
     *
     * An administrative record is approved as it is written, so there is no
     * round to name - and a student who disagrees with a penalty has to be
     * able to say so against the determination itself.
     */
    appealedRecognitionId: p.uuid().nullable(),
    // both routes, resolved once against this participant's frozen lineage
    // and frozen with the round. The column keeps its old name: what it
    // holds grew a second route, and renaming it would cost a rewrite of
    // every round ever opened to buy nothing.
    effectiveChain: p.json<Record<string, unknown>>(),
    currentRoute: p.string().length(16).defaultRaw(`'normal'`),
    /** the step by its permanent name, never by its position (§32.62) */
    currentStageId: p.string().length(63),
    state: p.string().length(31).defaultRaw(`'active'`),
    /**
     * Why nobody can act, whenever nobody can. One of `no-assignee` (the
     * stage's roles have no accepted holder), `no-independent-reviewer`
     * (holders exist, but every one of them already judged an earlier step
     * of this round), `panel-seat-unfilled` (a seat of the sitting panel
     * has nobody eligible left to take it). For the administrator's alert
     * panel: a blocked round that cannot say why reads as a staffing gap
     * even when it is a conflict rule doing exactly its job.
     */
    blockedReason: p.string().length(31).nullable(),
    outcome: p.string().length(31).nullable(),
    currentRoleIds: p.array().columnType('uuid[]'),
    currentNodeId: p.uuid(),
    currentNodePath: p.string().type('ltree'),
    createdAt: p.datetime().defaultRaw('now()'),
    completedAt: p.datetime().nullable(),
  },
  checks: [
    { name: 'chk_review_instances_round_positive', expression: 'round_no >= 1' },
    {
      name: 'chk_review_instances_appealed_one',
      // a round is contested by naming the round; a determination made
      // without one is contested by naming the determination
      expression: 'appealed_instance_id IS NULL OR appealed_recognition_id IS NULL',
    },
    {
      name: 'chk_review_instances_origin',
      // reroute: the same filing, walked again under a newer policy because
      // an administrator said so. A new round rather than an edit to the old
      // one, so "why did it go there" survives (§32.62)
      expression: `origin IN ('initial', 'appeal', 'reopen', 'reroute')`,
    },
    {
      name: 'chk_review_instances_initiator',
      expression: `initiator IN ('participant', 'staff')`,
    },
    {
      name: 'chk_review_instances_route',
      expression: `current_route IN ('normal', 'escalation')`,
    },
    {
      name: 'chk_review_instances_state',
      // awaiting_supplement is an open state: the round paused itself to ask
      // the person who filed for more backing, and it holds the entry's one
      // open-round slot while it waits (§32.65 ⑤)
      expression: `state IN ('active', 'blocked', 'awaiting_supplement', 'completed')`,
    },
    // a completed round says when and how it ended; an open one says neither.
    // The open arm is spelled <> 'completed' rather than IN ('active',
    // 'blocked') - the state check above already bounds the values, and the
    // generator mangles IN-lists when adding a check to an existing table
    // (the array cast comes back as a bare [], which is not sql)
    {
      name: 'chk_review_instances_lifecycle_shape',
      expression: `(state <> 'completed' AND completed_at IS NULL AND outcome IS NULL) OR (state = 'completed' AND completed_at IS NOT NULL AND outcome IS NOT NULL)`,
    },
    // a blocked round always says why, and only a blocked round says
    // anything. Spelled as two arms rather than an IN-list for the same
    // generator reason as the lifecycle shape; the value set is the
    // writers' discipline
    {
      name: 'chk_review_instances_blocked_reason_shape',
      expression: `(state <> 'blocked' AND blocked_reason IS NULL) OR (state = 'blocked' AND blocked_reason IS NOT NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_review_instances_tenant_id_id',
      expression:
        'create unique index uq_review_instances_tenant_id_id on review_instances (tenant_id, id)',
    },
    {
      name: 'uq_review_instances_tenant_entry_round',
      expression:
        'create unique index uq_review_instances_tenant_entry_round on review_instances (tenant_id, entry_id, round_no)',
    },
    // the target of "this round must belong to this entry" references
    {
      name: 'uq_review_instances_tenant_entry_id',
      expression:
        'create unique index uq_review_instances_tenant_entry_id on review_instances (tenant_id, entry_id, id)',
    },
    // one open round per entry, held by the database rather than by a guard
    // in whatever code path happens to submit: a double-click and a race both
    // land here
    {
      name: 'uq_review_instances_open_entry',
      // spelled the way pg_get_indexdef reports it back: the comparator pairs
      // expression indexes textually, and any prettier spelling of this
      // predicate diffs against its own introspection forever
      expression: `create unique index uq_review_instances_open_entry on review_instances (entry_id) where ((state)::text = ANY ((ARRAY['active'::character varying, 'blocked'::character varying, 'awaiting_supplement'::character varying])::text[]))`,
    },
    // the inbox join: open rounds standing at my node
    {
      name: 'idx_review_instances_inbox',
      expression:
        'create index idx_review_instances_inbox on review_instances (tenant_id, state, current_node_id)',
    },
  ],
})

/**
 * What happened in a round, in order, forever.
 *
 * Events are the audit trail and the appeal record; the instance columns are
 * a projection of them, updated in the same transaction. A rejection's
 * suggested payload rides here too - advice shown read-only to the student,
 * never a revision of the entry itself.
 */
export const ReviewEvent = defineEntity({
  name: 'ReviewEvent',
  tableName: 'review_events',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_events_tenant_id_tenants_id_fkey'),
    reviewInstanceId: p.uuid(),
    kind: p.string().length(31),
    /**
     * Where the round was standing when this was said. Null on events that
     * belong to the round rather than to a step, and on everything recorded
     * before rounds had two routes. Without it, "which level approved this"
     * stops being answerable the moment a round is re-routed onto a new
     * policy, because position no longer identifies anything.
     */
    route: p.string().length(16).nullable(),
    stageId: p.string().length(63).nullable(),
    actorId: p.uuid().nullable(),
    // the label picked from the batch's configured reason list, copied here
    // verbatim: the event must keep saying what was said even after the
    // list is edited
    reason: p.string().length(100).nullable(),
    comment: p.text().nullable(),
    suggestedPayload: p.json<Record<string, unknown>>().nullable(),
    // what this word determined, when it determined anything: an approval
    // carries the complete recognition, a refusal or a referral carries
    // none, and the reason is required only when the determination changed
    recognitionPayload: p.json<Record<string, unknown>>().nullable(),
    recognitionReason: p.text().nullable(),
    recognitionHash: p.string().length(64).nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [{ name: 'chk_review_events_kind_format', expression: `kind ~ ${CODE}` }],
  indexes: [
    {
      name: 'idx_review_events_tenant_instance_created',
      expression:
        'create index idx_review_events_tenant_instance_created on review_events (tenant_id, review_instance_id, created_at)',
    },
    // the target of "this word was spoken in that round" references
    {
      name: 'uq_review_events_tenant_instance_id',
      expression:
        'create unique index uq_review_events_tenant_instance_id on review_events (tenant_id, review_instance_id, id)',
    },
  ],
})

/**
 * One sitting of several reviewers judging one step together (§32.66).
 *
 * Opened when a round enters an escalation stage whose quorum is `all`,
 * constituted from whoever is eligible at that moment: the seat count is
 * the panel's frozen denominator, and organizational change afterwards can
 * refill a seat but never grow or shrink the sitting. `superseded` is a
 * panel dissolved without a resolution - the round left it (withdrawn,
 * rerouted) or its evidence changed under it (a supplement answered), and
 * its votes stay readable as history that counted for nothing.
 */
export const ReviewPanel = defineEntity({
  name: 'ReviewPanel',
  tableName: 'review_panels',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_panels_tenant_id_tenants_id_fkey'),
    reviewInstanceId: p.uuid(),
    route: p.string().length(16),
    stageId: p.string().length(63),
    /** how many independent judgments this sitting takes; frozen at creation */
    seatCount: p.integer(),
    state: p.string().length(16).defaultRaw(`'open'`),
    /** what the completed sitting amounted to; null until it resolves */
    resolution: p.string().length(16).nullable(),
    // the one determination this sitting is voting on. Frozen by the first
    // ballot: three reviewers approving three different recognitions is not
    // a decision anybody could act on, so the panel votes on one text
    recognitionPayload: p.json<Record<string, unknown>>().nullable(),
    recognitionHash: p.string().length(64).nullable(),
    // why the frozen proposal differs from what the sitting inherited. Kept
    // beside the proposal rather than on a ballot: the sitting votes on one
    // text and one explanation, and the word that ends the round carries
    // both. Without it a panel's correction reaches the record as a changed
    // determination nobody explained.
    recognitionReason: p.text().nullable(),
    recognitionLockedAt: p.datetime().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
    closedAt: p.datetime().nullable(),
  },
  checks: [
    { name: 'chk_review_panels_seat_count_positive', expression: 'seat_count >= 1' },
    {
      name: 'chk_review_panels_state',
      expression: `state IN ('open', 'resolved', 'superseded')`,
    },
    // Resolved says what and when; superseded says only when; open says
    // neither. The resolution's value set ('approved' | 'escalated') is the
    // writers' discipline rather than an arm here: an IN-list inside a
    // compound check comes back from the generator as broken array sql
    {
      name: 'chk_review_panels_lifecycle_shape',
      expression: `(state = 'open' AND resolution IS NULL AND closed_at IS NULL) OR (state = 'resolved' AND resolution IS NOT NULL AND closed_at IS NOT NULL) OR (state = 'superseded' AND resolution IS NULL AND closed_at IS NOT NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_review_panels_tenant_id_id',
      expression:
        'create unique index uq_review_panels_tenant_id_id on review_panels (tenant_id, id)',
    },
    // one sitting at a time: the round stands at one stage, and its stage
    // holds one open panel - held by the database, not by the writer's care
    {
      name: 'uq_review_panels_open_instance',
      expression: `create unique index uq_review_panels_open_instance on review_panels (review_instance_id) where ((state)::text = 'open'::text)`,
    },
    {
      name: 'idx_review_panels_tenant_instance',
      expression:
        'create index idx_review_panels_tenant_instance on review_panels (tenant_id, review_instance_id)',
    },
  ],
})

/**
 * Who holds one seat of a panel, for as long as they hold it.
 *
 * Append-only per occupancy: a member who loses eligibility before voting
 * has the row ended (`ended_reason`), and a replacement is a new row on the
 * same seat - the seat's story stays readable. A seat whose occupant voted
 * never ends: the vote made it history.
 */
export const ReviewPanelAssignment = defineEntity({
  name: 'ReviewPanelAssignment',
  tableName: 'review_panel_assignments',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_panel_assignments_tenant_id_tenants_id_fkey'),
    panelId: p.uuid(),
    seatNo: p.integer(),
    /** who sits there; a historical fact, deliberately without a foreign key */
    userId: p.uuid(),
    assignedAt: p.datetime().defaultRaw('now()'),
    endedAt: p.datetime().nullable(),
    endedReason: p.string().length(31).nullable(),
  },
  checks: [
    { name: 'chk_review_panel_assignments_seat_positive', expression: 'seat_no >= 1' },
    {
      name: 'chk_review_panel_assignments_ended_shape',
      expression: `(ended_at IS NULL AND ended_reason IS NULL) OR (ended_at IS NOT NULL AND ended_reason IS NOT NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_review_panel_assignments_tenant_id_id',
      expression:
        'create unique index uq_review_panel_assignments_tenant_id_id on review_panel_assignments (tenant_id, id)',
    },
    // one current occupant per seat, one seat per person - the two races a
    // concurrent claim can run, both lost at the index
    {
      name: 'uq_review_panel_assignments_live_seat',
      expression:
        'create unique index uq_review_panel_assignments_live_seat on review_panel_assignments (panel_id, seat_no) where (ended_at IS NULL)',
    },
    {
      name: 'uq_review_panel_assignments_live_user',
      expression:
        'create unique index uq_review_panel_assignments_live_user on review_panel_assignments (panel_id, user_id) where (ended_at IS NULL)',
    },
    {
      name: 'idx_review_panel_assignments_tenant_panel',
      expression:
        'create index idx_review_panel_assignments_tenant_panel on review_panel_assignments (tenant_id, panel_id)',
    },
  ],
})

/**
 * One member's judgment, cast once and never edited (§32.66).
 *
 * The authority on panel opinions: events narrate, votes count. Losing a
 * role after voting does not reach back here - permission answers whether a
 * new act may happen, never whether a past lawful one still counts.
 */
export const ReviewVote = defineEntity({
  name: 'ReviewVote',
  tableName: 'review_votes',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_votes_tenant_id_tenants_id_fkey'),
    panelId: p.uuid(),
    assignmentId: p.uuid(),
    voterUserId: p.uuid(),
    decision: p.string().length(16),
    /** which determination this ballot was cast on; null on votes cast before there were any */
    recognitionHash: p.string().length(64).nullable(),
    /** the configured label the voter picked, copied verbatim */
    reason: p.string().length(100).nullable(),
    comment: p.text().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_review_votes_decision',
      expression: `decision IN ('approve', 'reject')`,
    },
  ],
  indexes: [
    // a seat occupancy speaks at most once
    {
      name: 'uq_review_votes_assignment',
      expression: 'create unique index uq_review_votes_assignment on review_votes (assignment_id)',
    },
    {
      name: 'idx_review_votes_tenant_panel',
      expression:
        'create index idx_review_votes_tenant_panel on review_votes (tenant_id, panel_id)',
    },
  ],
})

/**
 * A reviewer asking for more backing without moving the round (§32.65 ⑤).
 *
 * The boundary it sits on: changing WHAT was claimed goes through rejection
 * and a new revision; adding to WHY it should be believed goes through here,
 * and the judged revision is never touched. The asked-for pieces live in
 * `requirements` - a deliberately small builder of text and file asks, so a
 * supplement can never grow into a second form the filing was not written
 * under. The open request itself is the participant's whole capability to
 * answer: no phase gate, because a round that paused itself to ask must not
 * have the answer locked out by whatever the calendar did since.
 */
export const ReviewSupplementRequest = defineEntity({
  name: 'ReviewSupplementRequest',
  tableName: 'review_supplement_requests',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_supplement_requests_tenant_id_tenants_id_fkey'),
    reviewInstanceId: p.uuid(),
    requestNo: p.integer(),
    /** who asked; a historical fact, deliberately without a foreign key */
    requestedBy: p.uuid(),
    /** what is wanted and why, said to the person who filed */
    instructions: p.text(),
    /** [{key, label, kind: 'text'|'file', required}] - text and file only */
    requirements: p.json<readonly Record<string, unknown>[]>(),
    status: p.string().length(16).defaultRaw(`'open'`),
    answeredAt: p.datetime().nullable(),
    cancelledAt: p.datetime().nullable(),
    cancelledBy: p.uuid().nullable(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  checks: [
    {
      name: 'chk_review_supplement_requests_status',
      expression: `status IN ('open', 'answered', 'cancelled')`,
    },
    { name: 'chk_review_supplement_requests_no_positive', expression: 'request_no >= 1' },
    {
      name: 'chk_review_supplement_requests_instructions_not_blank',
      expression: `btrim(instructions) <> ''`,
    },
    // each conclusion carries its own facts and none of the other's; spelled
    // as full arms for the same reason the item void shape is
    {
      name: 'chk_review_supplement_requests_lifecycle_shape',
      expression: `(status = 'open' AND answered_at IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR (status = 'answered' AND answered_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND answered_at IS NULL)`,
    },
  ],
  indexes: [
    {
      name: 'uq_review_supplement_requests_tenant_id_id',
      expression:
        'create unique index uq_review_supplement_requests_tenant_id_id on review_supplement_requests (tenant_id, id)',
    },
    {
      name: 'uq_review_supplement_requests_tenant_instance_no',
      expression:
        'create unique index uq_review_supplement_requests_tenant_instance_no on review_supplement_requests (tenant_id, review_instance_id, request_no)',
    },
    // one open ask per round, held by the database: the round's own state
    // says whether it is waiting, and two waiting requests would leave
    // "answered which one" undefined. Spelled the way pg_get_indexdef
    // reports it back, like the open-entry index above
    {
      name: 'uq_review_supplement_requests_open',
      expression: `create unique index uq_review_supplement_requests_open on review_supplement_requests (review_instance_id) where ((status)::text = 'open'::text)`,
    },
  ],
})

/** the answer, whole: one response closes one request, exactly once */
export const ReviewSupplementResponse = defineEntity({
  name: 'ReviewSupplementResponse',
  tableName: 'review_supplement_responses',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: tenantOf('review_supplement_responses_tenant_id_tenants_id_fkey'),
    requestId: p.uuid(),
    /** answers keyed by requirement key; file answers cite attachment ids */
    payload: p.json<Record<string, unknown>>(),
    /** the entry's own subject; the server derives it, never the client */
    respondedBy: p.uuid(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_review_supplement_responses_tenant_id_id',
      expression:
        'create unique index uq_review_supplement_responses_tenant_id_id on review_supplement_responses (tenant_id, id)',
    },
    {
      name: 'uq_review_supplement_responses_tenant_request',
      expression:
        'create unique index uq_review_supplement_responses_tenant_request on review_supplement_responses (tenant_id, request_id)',
    },
  ],
})

/**
 * Which attachments a supplement answer cites, as rows - the same reason
 * entry_revision_attachments exists: a real key into storage, a reverse path
 * for authorization, and a stable order.
 */
export const ReviewSupplementAttachment = defineEntity({
  name: 'ReviewSupplementAttachment',
  tableName: 'review_supplement_attachments',
  properties: {
    tenantId: tenantKeyOf('review_supplement_attachments_tenant_id_tenants_id_fkey'),
    responseId: p.uuid().primary(),
    attachmentId: p.uuid().primary(),
    position: p.integer(),
  },
  checks: [
    {
      name: 'chk_review_supplement_attachments_position_non_negative',
      expression: 'position >= 0',
    },
  ],
  indexes: [
    {
      name: 'uq_review_supplement_attachments_tenant_response_position',
      expression:
        'create unique index uq_review_supplement_attachments_tenant_response_position on review_supplement_attachments (tenant_id, response_id, position)',
    },
    // the reverse question: which supplement answers cite this attachment
    {
      name: 'idx_review_supplement_attachments_tenant_attachment',
      expression:
        'create index idx_review_supplement_attachments_tenant_attachment on review_supplement_attachments (tenant_id, attachment_id)',
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
  `alter table batch_management_anchors add constraint fk_batch_management_anchors_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_management_anchors add constraint fk_batch_management_anchors_node
     foreign key (tenant_id, org_node_id) references org_nodes (tenant_id, id) on delete restrict`,
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
  `alter table batch_participant_events add constraint fk_batch_participant_events_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table batch_participant_events add constraint fk_batch_participant_events_participant
     foreign key (tenant_id, participant_id) references batch_participants (tenant_id, id) on delete cascade`,
  `alter table phase_events add constraint fk_phase_events_phase
     foreign key (tenant_id, phase_id) references batch_phases (tenant_id, id) on delete cascade`,
  `alter table phase_item_scopes add constraint fk_phase_item_scopes_phase
     foreign key (tenant_id, phase_id) references batch_phases (tenant_id, id) on delete cascade`,
  `alter table phase_item_scopes add constraint fk_phase_item_scopes_item
     foreign key (tenant_id, item_id) references assessment_items (tenant_id, id) on delete cascade`,
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
  // --- items, entries, review ---
  //
  // The same-batch keys are the point of this block: wherever two batch-scoped
  // rows reference each other, the reference carries batch_id, so citing a row
  // from another round is a 23503 rather than a service-layer promise. The
  // "belongs to the same parent" keys (an entry's current revision, a round's
  // revision) work the same way one level down, carrying the parent id.
  `alter table score_groups add constraint fk_score_groups_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table score_groups add constraint fk_score_groups_parent
     foreign key (tenant_id, batch_id, parent_group_id) references score_groups (tenant_id, batch_id, id) on delete restrict`,
  `alter table assessment_items add constraint fk_assessment_items_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table assessment_items add constraint fk_assessment_items_score_group
     foreign key (tenant_id, batch_id, score_group_id) references score_groups (tenant_id, batch_id, id) on delete restrict`,
  `alter table assessment_items add constraint fk_assessment_items_current_revision
     foreign key (tenant_id, id, current_revision_id) references assessment_item_revisions (tenant_id, item_id, id) on delete set null (current_revision_id)`,
  `alter table assessment_item_revisions add constraint fk_assessment_item_revisions_item
     foreign key (tenant_id, item_id) references assessment_items (tenant_id, id) on delete cascade`,
  `alter table entries add constraint fk_entries_batch
     foreign key (tenant_id, batch_id) references assessment_batches (tenant_id, id) on delete cascade`,
  `alter table entries add constraint fk_entries_item
     foreign key (tenant_id, batch_id, item_id) references assessment_items (tenant_id, batch_id, id) on delete restrict`,
  `alter table entries add constraint fk_entries_participant
     foreign key (tenant_id, batch_id, participant_id) references batch_participants (tenant_id, batch_id, id) on delete restrict`,
  `alter table entries add constraint fk_entries_current_revision
     foreign key (tenant_id, id, current_revision_id) references entry_revisions (tenant_id, entry_id, id) on delete set null (current_revision_id)`,
  // A determination belongs to one entry, in one round, about one question -
  // and every one of those is held by a composite key rather than a bare
  // uuid, so no row can cite another entry's filing or another round's word.
  `alter table entry_recognitions add constraint fk_entry_recognitions_entry
    foreign key (tenant_id, batch_id, entry_id) references entries (tenant_id, batch_id, id) on delete cascade`,
  `alter table entry_recognitions add constraint fk_entry_recognitions_entry_revision
    foreign key (tenant_id, entry_id, entry_revision_id) references entry_revisions (tenant_id, entry_id, id) on delete cascade`,
  `alter table entry_recognitions add constraint fk_entry_recognitions_entry_item
    foreign key (tenant_id, entry_id, item_id) references entries (tenant_id, id, item_id) on delete cascade`,
  `alter table entry_recognitions add constraint fk_entry_recognitions_item_revision
    foreign key (tenant_id, item_id, item_revision_id) references assessment_item_revisions (tenant_id, item_id, id) on delete restrict`,
  // superseding is nulled rather than blocked: losing the link back is not
  // a reason to refuse deleting an older determination
  `alter table entry_recognitions add constraint fk_entry_recognitions_supersedes
    foreign key (tenant_id, entry_id, supersedes_id) references entry_recognitions (tenant_id, entry_id, id) on delete set null (supersedes_id)`,
  // The round and the word are pinned, not nulled. The shape check already
  // says a review determination names both, so nulling them would make the
  // delete fail on the check instead - two constraints asking for opposite
  // things. Provenance is what this row is for; a whole batch or tenant
  // going away still takes the chain with it through their own cascades.
  `alter table entry_recognitions add constraint fk_entry_recognitions_review_instance
    foreign key (tenant_id, entry_id, review_instance_id) references review_instances (tenant_id, entry_id, id) on delete restrict`,
  `alter table entry_recognitions add constraint fk_entry_recognitions_review_event
    foreign key (tenant_id, review_instance_id, review_event_id) references review_events (tenant_id, review_instance_id, id) on delete restrict`,
  // the pointer, held to this entry's own determinations
  `alter table entries add constraint fk_entries_current_recognition
    foreign key (tenant_id, id, current_recognition_id) references entry_recognitions (tenant_id, entry_id, id) on delete set null (current_recognition_id)`,
  `alter table review_instances add constraint fk_review_instances_appealed_recognition
    foreign key (tenant_id, entry_id, appealed_recognition_id) references entry_recognitions (tenant_id, entry_id, id) on delete restrict`,
  `alter table review_instances add constraint fk_review_instances_recognition_revision
    foreign key (tenant_id, recognition_revision_id) references assessment_item_revisions (tenant_id, id) on delete restrict`,
  `alter table entries add constraint fk_entries_current_review_instance
     foreign key (tenant_id, id, current_review_instance_id) references review_instances (tenant_id, entry_id, id) on delete set null (current_review_instance_id)`,
  `alter table entry_revisions add constraint fk_entry_revisions_entry
     foreign key (tenant_id, entry_id) references entries (tenant_id, id) on delete cascade`,
  // the item-binding pair: the first key holds "item_id is this entry's own
  // item", the second holds "item_revision_id is a revision of that item".
  // Together they refuse a revision decoding by another item's - or another
  // batch's - configuration, which neither plain key could say alone
  `alter table entry_revisions add constraint fk_entry_revisions_entry_item
     foreign key (tenant_id, entry_id, item_id) references entries (tenant_id, id, item_id) on delete cascade`,
  `alter table entry_revisions add constraint fk_entry_revisions_item_revision
     foreign key (tenant_id, item_id, item_revision_id) references assessment_item_revisions (tenant_id, item_id, id) on delete restrict`,
  `alter table entry_revision_attachments add constraint fk_entry_revision_attachments_revision
     foreign key (tenant_id, revision_id) references entry_revisions (tenant_id, id) on delete cascade`,
  // into storage: a revision that cites an attachment is what "bound" means,
  // and the row it cites cannot be deleted out from under it
  `alter table entry_revision_attachments add constraint fk_entry_revision_attachments_attachment
     foreign key (tenant_id, attachment_id) references storage_attachments (tenant_id, id) on delete restrict`,
  `alter table review_instances add constraint fk_review_instances_entry
     foreign key (tenant_id, entry_id) references entries (tenant_id, id) on delete cascade`,
  `alter table review_instances add constraint fk_review_instances_revision
     foreign key (tenant_id, entry_id, revision_id) references entry_revisions (tenant_id, entry_id, id) on delete cascade`,
  `alter table review_instances add constraint fk_review_instances_policy_revision
     foreign key (tenant_id, policy_revision_id) references assessment_item_revisions (tenant_id, id) on delete restrict`,
  `alter table review_instances add constraint fk_review_instances_supersedes
     foreign key (tenant_id, supersedes_instance_id) references review_instances (tenant_id, id) on delete set null (supersedes_instance_id)`,
  `alter table review_instances add constraint fk_review_instances_appealed
     foreign key (tenant_id, appealed_instance_id) references review_instances (tenant_id, id) on delete set null (appealed_instance_id)`,
  `alter table review_events add constraint fk_review_events_instance
     foreign key (tenant_id, review_instance_id) references review_instances (tenant_id, id) on delete cascade`,
  `alter table review_panels add constraint fk_review_panels_instance
     foreign key (tenant_id, review_instance_id) references review_instances (tenant_id, id) on delete cascade`,
  `alter table review_panel_assignments add constraint fk_review_panel_assignments_panel
     foreign key (tenant_id, panel_id) references review_panels (tenant_id, id) on delete cascade`,
  `alter table review_votes add constraint fk_review_votes_panel
     foreign key (tenant_id, panel_id) references review_panels (tenant_id, id) on delete cascade`,
  `alter table review_votes add constraint fk_review_votes_assignment
     foreign key (tenant_id, assignment_id) references review_panel_assignments (tenant_id, id) on delete cascade`,
  `alter table review_supplement_requests add constraint fk_review_supplement_requests_instance
     foreign key (tenant_id, review_instance_id) references review_instances (tenant_id, id) on delete cascade`,
  `alter table review_supplement_responses add constraint fk_review_supplement_responses_request
     foreign key (tenant_id, request_id) references review_supplement_requests (tenant_id, id) on delete cascade`,
  `alter table review_supplement_attachments add constraint fk_review_supplement_attachments_response
     foreign key (tenant_id, response_id) references review_supplement_responses (tenant_id, id) on delete cascade`,
  // into storage, like the entry citation rows: a cited file cannot be
  // deleted out from under the answer that cites it
  `alter table review_supplement_attachments add constraint fk_review_supplement_attachments_attachment
     foreign key (tenant_id, attachment_id) references storage_attachments (tenant_id, id) on delete restrict`,
  `alter table entry_events add constraint fk_entry_events_entry
     foreign key (tenant_id, entry_id) references entries (tenant_id, id) on delete cascade`,
  `alter table entry_events add constraint fk_entry_events_cause_revision
     foreign key (tenant_id, cause_revision_id) references assessment_item_revisions (tenant_id, id) on delete set null (cause_revision_id)`,
]

export const entities = [
  AssessmentBatch,
  BatchManagementAnchor,
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
  BatchParticipantEvent,
  BatchConfigRevision,
  ScoreGroup,
  AssessmentItem,
  AssessmentItemRevision,
  Entry,
  EntryEvent,
  EntryRecognition,
  EntryRevision,
  EntryRevisionAttachment,
  ReviewInstance,
  ReviewEvent,
  ReviewPanel,
  ReviewPanelAssignment,
  ReviewVote,
  ReviewSupplementRequest,
  ReviewSupplementResponse,
  ReviewSupplementAttachment,
] as const
