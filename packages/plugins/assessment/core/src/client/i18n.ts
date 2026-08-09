import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import { defineMessage } from '@qualy/i18n-contract'
import type * as assessmentErrors from '../server/errors.ts'
import { PHASE_GATED_CODES, type PhaseGatedCode } from '../permissions.ts'

// Everything the assessment plugin says to a human: the batch administration
// screen's copy, one label per gated permission, one sentence per refusal the
// engine can return, and a translation for every error code the contract can
// raise.
//
// The refusal and permission maps are keyed by the enums themselves, so a new
// engine refusal or a new gated code stops compiling here rather than
// reaching a screen as a raw identifier.

const participantCount = defineMessage<{ count: number }>()({
  id: 'assessment/roster/count',
  defaultMessage: '{count, plural, one {# participant} other {# participants}}',
})

const holdersCount = defineMessage<{ count: number }>()({
  id: 'assessment/roster/holders',
  defaultMessage:
    '{count, plural, =0 {nobody can review here} one {# person can review here} other {# people can review here}}',
})

const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {
    // batch administration shell
    batchesTitle: { id: 'assessment/batch/title', defaultMessage: 'Assessment batches' },
    batchesHint: {
      id: 'assessment/batch/hint',
      defaultMessage: 'Each batch is one rule set over the units it faces.',
    },
    batchesEmpty: { id: 'assessment/batch/empty', defaultMessage: 'No batches yet.' },
    newBatch: { id: 'assessment/batch/new', defaultMessage: 'New batch' },
    newBatchHint: {
      id: 'assessment/batch/new-hint',
      defaultMessage: 'A batch starts as a draft: everything is editable until it is activated.',
    },
    nameLabel: { id: 'assessment/batch/name', defaultMessage: 'Name' },
    materialFrom: { id: 'assessment/batch/material-from', defaultMessage: 'Materials from' },
    materialTo: { id: 'assessment/batch/material-to', defaultMessage: 'Materials until' },
    materialHint: {
      id: 'assessment/batch/material-hint',
      defaultMessage: 'Half-open: the end date itself is not included.',
    },
    scopeLegend: { id: 'assessment/batch/scope', defaultMessage: 'Organizational units' },
    scopeHint: {
      id: 'assessment/batch/scope-hint',
      defaultMessage: 'Pick the units this batch faces. Do not pick a unit inside another.',
    },
    scopeEmpty: {
      id: 'assessment/batch/scope-empty',
      defaultMessage: 'You may not manage any organizational unit.',
    },
    userTypesLegend: { id: 'assessment/batch/user-types', defaultMessage: 'Enrolled user types' },
    userTypesEmpty: {
      id: 'assessment/batch/user-types-empty',
      defaultMessage: 'This tenant has no enabled user types.',
    },
    anchorAutoSync: {
      id: 'assessment/batch/anchor-auto-sync',
      defaultMessage: 'Sync anchor changes automatically before a first submission',
    },
    create: { id: 'assessment/action/create', defaultMessage: 'Create' },
    save: { id: 'assessment/action/save', defaultMessage: 'Save' },
    apply: { id: 'assessment/action/apply', defaultMessage: 'Apply' },
    cancel: { id: 'assessment/action/cancel', defaultMessage: 'Cancel' },
    statusDraft: { id: 'assessment/status/draft', defaultMessage: 'Draft' },
    statusActive: { id: 'assessment/status/active', defaultMessage: 'Active' },
    statusArchived: { id: 'assessment/status/archived', defaultMessage: 'Archived' },
    activate: { id: 'assessment/action/activate', defaultMessage: 'Activate' },
    activateHint: {
      id: 'assessment/action/activate-hint',
      defaultMessage: 'Activation freezes the roster from the units above.',
    },
    archive: { id: 'assessment/action/archive', defaultMessage: 'Archive' },

    // phase plan editor
    phasesTitle: { id: 'assessment/phase/title', defaultMessage: 'Phase timeline' },
    phasesHint: {
      id: 'assessment/phase/hint',
      defaultMessage:
        'A phase begins at its planned second, whether or not anything is running. Times below the first event boundary stay pending until that event happens.',
    },
    phasesEmpty: {
      id: 'assessment/phase/empty',
      defaultMessage: 'No phases yet. Apply a template to start.',
    },
    templateLabel: { id: 'assessment/phase/template', defaultMessage: 'Phase template' },
    templateApply: { id: 'assessment/phase/template-apply', defaultMessage: 'Apply template' },
    templateEmpty: {
      id: 'assessment/phase/template-empty',
      defaultMessage: 'No templates defined for this tenant.',
    },
    templateDraftOnly: {
      id: 'assessment/phase/template-draft-only',
      defaultMessage: 'A template can only be applied to a draft batch.',
    },
    displayNameLabel: { id: 'assessment/phase/display-name', defaultMessage: 'Phase name' },
    triggerScheduled: { id: 'assessment/phase/trigger-scheduled', defaultMessage: 'Scheduled' },
    triggerManual: { id: 'assessment/phase/trigger-manual', defaultMessage: 'Manual' },
    triggerPublication: {
      id: 'assessment/phase/trigger-publication',
      defaultMessage: 'On publication',
    },
    plannedLabel: { id: 'assessment/phase/planned', defaultMessage: 'Planned start' },
    plannedSlaLabel: { id: 'assessment/phase/planned-sla', defaultMessage: 'Target date' },
    plannedSlaHint: {
      id: 'assessment/phase/planned-sla-hint',
      defaultMessage: 'Advisory only: a manual boundary never starts by itself.',
    },
    offsetLabel: { id: 'assessment/phase/offset', defaultMessage: 'Starts after' },
    offsetDays: { id: 'assessment/phase/offset-days', defaultMessage: 'days' },
    offsetHours: { id: 'assessment/phase/offset-hours', defaultMessage: 'hours' },
    offsetFrozen: {
      id: 'assessment/phase/offset-frozen',
      defaultMessage: 'Materialized; the planned time above is what holds now.',
    },
    estimatedLabel: {
      id: 'assessment/phase/estimated',
      defaultMessage: 'Estimated (display only)',
    },
    enteredLabel: { id: 'assessment/phase/entered', defaultMessage: 'Started' },
    pendingLabel: { id: 'assessment/phase/pending', defaultMessage: 'Pending' },
    currentBadge: { id: 'assessment/phase/current', defaultMessage: 'Current' },
    endedBadge: { id: 'assessment/phase/ended', defaultMessage: 'Ended' },
    insertPhase: { id: 'assessment/phase/insert', defaultMessage: 'Insert a phase here' },
    insertKeyLabel: { id: 'assessment/phase/insert-key', defaultMessage: 'Phase key' },
    advance: { id: 'assessment/phase/advance', defaultMessage: 'Start this phase now' },
    advanceForce: { id: 'assessment/phase/advance-force', defaultMessage: 'Start early' },
    advanceReason: { id: 'assessment/phase/advance-reason', defaultMessage: 'Reason' },
    advanceForceHint: {
      id: 'assessment/phase/advance-force-hint',
      defaultMessage: 'Starting a scheduled phase before its time is recorded with your reason.',
    },
    planRefused: {
      id: 'assessment/phase/plan-refused',
      defaultMessage: 'The plan was not saved:',
    },

    // permission profile matrix
    profileTitle: { id: 'assessment/profile/title', defaultMessage: 'What this phase opens' },
    profileHint: {
      id: 'assessment/profile/hint',
      defaultMessage:
        'A phase can only narrow what a role already grants; codes outside this list are never phase-controlled.',
    },

    // roster
    rosterTitle: { id: 'assessment/roster/title', defaultMessage: 'Roster' },
    rosterHint: {
      id: 'assessment/roster/hint',
      defaultMessage:
        'Frozen at activation. Organizational changes never move it on their own - they appear below.',
    },
    rosterEmpty: { id: 'assessment/roster/empty', defaultMessage: 'Nobody on the roster yet.' },
    rosterDraft: {
      id: 'assessment/roster/draft',
      defaultMessage: 'The roster is generated when the batch is activated.',
    },
    diffTitle: { id: 'assessment/roster/diff-title', defaultMessage: 'Organizational changes' },
    diffEmpty: {
      id: 'assessment/roster/diff-empty',
      defaultMessage: 'The roster matches the organization.',
    },
    diffArrivals: { id: 'assessment/roster/arrivals', defaultMessage: 'Newly in scope' },
    diffDeparted: { id: 'assessment/roster/departed', defaultMessage: 'Left the scope' },
    diffAnchor: { id: 'assessment/roster/anchor-changed', defaultMessage: 'Moved within scope' },
    diffUserType: { id: 'assessment/roster/type-changed', defaultMessage: 'User type changed' },
    diffScope: { id: 'assessment/roster/scope-integrity', defaultMessage: 'Missing scope units' },
    diffScopeHint: {
      id: 'assessment/roster/scope-integrity-hint',
      defaultMessage: 'These units were deleted; they enroll nobody until the scope is edited.',
    },
    include: { id: 'assessment/roster/include', defaultMessage: 'Add to roster' },
    exclude: { id: 'assessment/roster/exclude', defaultMessage: 'Remove from roster' },
    restore: { id: 'assessment/roster/restore', defaultMessage: 'Put back on the roster' },
    applyAnchor: { id: 'assessment/roster/apply-anchor', defaultMessage: 'Apply new position' },
    excludedBadge: { id: 'assessment/roster/excluded', defaultMessage: 'Removed' },
    alsoActiveIn: {
      id: 'assessment/roster/also-active',
      defaultMessage: 'Also participating in: {batches}',
    },
    typeNotEnrolled: {
      id: 'assessment/roster/type-not-enrolled',
      defaultMessage: 'The new type is not enrolled in this batch.',
    },
    participantCount,
    holdersCount,

    // one label per gated code; the matrix is built from PHASE_GATED_CODES,
    // so a code without a label here does not compile
    'permission.assessment.entry.create': {
      id: 'assessment/permission/entry-create',
      defaultMessage: 'Draft entries',
    },
    'permission.assessment.entry.edit': {
      id: 'assessment/permission/entry-edit',
      defaultMessage: 'Edit drafts',
    },
    'permission.assessment.entry.submit': {
      id: 'assessment/permission/entry-submit',
      defaultMessage: 'Submit entries',
    },
    'permission.assessment.entry.withdraw': {
      id: 'assessment/permission/entry-withdraw',
      defaultMessage: 'Withdraw submissions',
    },
    'permission.assessment.entry.proxy': {
      id: 'assessment/permission/entry-proxy',
      defaultMessage: 'Submit on a student behalf',
    },
    'permission.assessment.entry.record': {
      id: 'assessment/permission/entry-record',
      defaultMessage: 'Record administrative findings',
    },
    'permission.assessment.entry.resubmit': {
      id: 'assessment/permission/entry-resubmit',
      defaultMessage: 'Reopen a settled entry',
    },
    'permission.assessment.review.process': {
      id: 'assessment/permission/review-process',
      defaultMessage: 'Review submissions',
    },
    'permission.assessment.review.reopen': {
      id: 'assessment/permission/review-reopen',
      defaultMessage: 'Start a staff review',
    },
    'permission.assessment.result.view-peers': {
      id: 'assessment/permission/result-view-peers',
      defaultMessage: 'See other results',
    },
    'permission.assessment.ranking.view': {
      id: 'assessment/permission/ranking-view',
      defaultMessage: 'See rankings',
    },

    // the engine's refusals, in the words an administrator can act on
    'refusal.phase-not-found': {
      id: 'assessment/refusal/phase-not-found',
      defaultMessage: 'That phase is no longer part of this plan.',
    },
    'refusal.actual-immutable': {
      id: 'assessment/refusal/actual-immutable',
      defaultMessage: 'A phase that has started cannot have its start time rewritten.',
    },
    'refusal.phase-already-entered': {
      id: 'assessment/refusal/phase-already-entered',
      defaultMessage: 'This phase has already started; its times are history now.',
    },
    'refusal.ended-phase-name-only': {
      id: 'assessment/refusal/ended-phase-name-only',
      defaultMessage: 'Only the name of a phase that has ended can still be changed.',
    },
    'refusal.display-name-blank': {
      id: 'assessment/refusal/display-name-blank',
      defaultMessage: 'Every phase needs a name.',
    },
    'refusal.planned-on-publication-phase': {
      id: 'assessment/refusal/planned-on-publication',
      defaultMessage: 'This phase starts when its publication does; it has no time of its own.',
    },
    'refusal.hard-plan-beyond-event-boundary': {
      id: 'assessment/refusal/hard-plan-beyond-boundary',
      defaultMessage:
        'A fixed date cannot sit after a phase that waits for an event. Use an offset instead.',
    },
    'refusal.planned-not-in-future': {
      id: 'assessment/refusal/planned-not-in-future',
      defaultMessage: 'A planned time has to be in the future.',
    },
    'refusal.planned-out-of-order': {
      id: 'assessment/refusal/planned-out-of-order',
      defaultMessage: 'Phase times have to run in the order the phases do.',
    },
    'refusal.offset-not-positive': {
      id: 'assessment/refusal/offset-not-positive',
      defaultMessage: 'An offset has to be longer than zero.',
    },
    'refusal.offset-on-non-scheduled-phase': {
      id: 'assessment/refusal/offset-on-non-scheduled',
      defaultMessage: 'Only a scheduled phase can start after an offset.',
    },
    'refusal.offset-with-planned': {
      id: 'assessment/refusal/offset-with-planned',
      defaultMessage: 'This offset has already produced a planned time and cannot be changed.',
    },
    'refusal.binding-on-non-publication-phase': {
      id: 'assessment/refusal/binding-on-non-publication',
      defaultMessage: 'Only a publication phase can be bound to a publication.',
    },
    'refusal.binding-immutable-after-entry': {
      id: 'assessment/refusal/binding-immutable',
      defaultMessage: 'Which publication opened this phase is a matter of record now.',
    },
    'refusal.profile-code-not-gated': {
      id: 'assessment/refusal/profile-code-not-gated',
      defaultMessage: 'That permission is not one a phase can control.',
    },
    'refusal.insert-not-after-current': {
      id: 'assessment/refusal/insert-not-after-current',
      defaultMessage: 'A phase can only be inserted after the one in progress.',
    },
    'refusal.insert-after-terminal': {
      id: 'assessment/refusal/insert-after-terminal',
      defaultMessage: 'Nothing comes after the closing phase.',
    },
    'refusal.terminal-must-be-manual': {
      id: 'assessment/refusal/terminal-must-be-manual',
      defaultMessage: 'The last phase has to be closed by a person.',
    },
    'refusal.plan-empty': {
      id: 'assessment/refusal/plan-empty',
      defaultMessage: 'A batch needs a phase plan before it can be activated.',
    },
    'refusal.template-requires-draft': {
      id: 'assessment/refusal/template-requires-draft',
      defaultMessage: 'A template can only be applied to a draft batch.',
    },
    'refusal.phase-removed': {
      id: 'assessment/refusal/phase-removed',
      defaultMessage: 'A phase cannot be removed from an active batch.',
    },
    'refusal.reorder-not-allowed': {
      id: 'assessment/refusal/reorder-not-allowed',
      defaultMessage: 'Phases cannot be reordered once the batch is active.',
    },
    'refusal.phase-key-immutable': {
      id: 'assessment/refusal/phase-key-immutable',
      defaultMessage: 'A phase keeps its key once the batch is active.',
    },
    'refusal.trigger-immutable': {
      id: 'assessment/refusal/trigger-immutable',
      defaultMessage: 'How a phase starts cannot change once the batch is active.',
    },
    'refusal.scope-in-template': {
      id: 'assessment/refusal/scope-in-template',
      defaultMessage: 'A template cannot name items or people of one batch.',
    },
    'refusal.participant-not-in-batch': {
      id: 'assessment/refusal/participant-not-in-batch',
      defaultMessage: 'That person is not on this roster.',
    },
    'refusal.proxy-without-submit': {
      id: 'assessment/refusal/proxy-without-submit',
      defaultMessage:
        'This phase allows submitting on a student behalf but not submitting; check that is intended.',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof assessmentErrors>>()({
    ASSESSMENT_BATCH_NOT_FOUND: {
      id: 'assessment/error/batch-not-found',
      defaultMessage: 'Assessment batch not found.',
    },
    ASSESSMENT_PHASE_NOT_FOUND: {
      id: 'assessment/error/phase-not-found',
      defaultMessage: 'That phase does not exist in this batch.',
    },
    ASSESSMENT_PARTICIPANT_NOT_FOUND: {
      id: 'assessment/error/participant-not-found',
      defaultMessage: 'That person is not on this batch roster.',
    },
    ASSESSMENT_PARTICIPANT_INVALID: {
      id: 'assessment/error/participant-invalid',
      defaultMessage: 'The roster change was refused; check the reported reason.',
    },
    ASSESSMENT_TEMPLATE_NOT_FOUND: {
      id: 'assessment/error/template-not-found',
      defaultMessage: 'Phase template not found.',
    },
    ASSESSMENT_TEMPLATE_CONFLICT: {
      id: 'assessment/error/template-conflict',
      defaultMessage: 'A phase template with that name already exists.',
    },
    ASSESSMENT_BATCH_READ_ONLY: {
      id: 'assessment/error/batch-read-only',
      defaultMessage: 'This batch is archived and can no longer be changed.',
    },
    ASSESSMENT_BATCH_SCOPE_LOCKED: {
      id: 'assessment/error/batch-scope-locked',
      defaultMessage: 'The batch scope cannot change once the batch is active.',
    },
    ASSESSMENT_BATCH_STATUS_INVALID: {
      id: 'assessment/error/batch-status-invalid',
      defaultMessage: 'The batch cannot move to that status from where it is.',
    },
    ASSESSMENT_BATCH_NO_USER_TYPES: {
      id: 'assessment/error/batch-no-user-types',
      defaultMessage: 'Select at least one user type before activating the batch.',
    },
    ASSESSMENT_BATCH_REFERENCE_INVALID: {
      id: 'assessment/error/batch-reference-invalid',
      defaultMessage: 'The scope node or a selected user type does not exist.',
    },
    ASSESSMENT_PLAN_INVALID: {
      id: 'assessment/error/plan-invalid',
      defaultMessage: 'The phase plan change was refused; review the reported problems.',
    },
    ASSESSMENT_ADVANCE_INVALID: {
      id: 'assessment/error/advance-invalid',
      defaultMessage: 'The phase cannot be advanced that way.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
