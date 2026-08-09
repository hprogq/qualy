import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import { defineMessage } from '@qualy/i18n-contract'
import type * as assessmentErrors from '../server/errors.ts'

// Everything the assessment plugin says to a human: the batch administration
// screen's copy, one label per gated permission, one sentence per refusal the
// engine can return, and a translation for every error code the contract can
// raise.
//
// Written for someone seeing the product for the first time: no word of it
// assumes the reader knows how the machinery underneath is named. The refusal
// and permission maps are keyed by the enums themselves, so a new engine
// refusal or a new gated code stops compiling here rather than reaching a
// screen as a raw identifier.

const participantCount = defineMessage<{ count: number }>()({
  id: 'assessment/roster/count',
  defaultMessage: '{count, plural, =0 {Nobody enrolled yet} one {# person} other {# people}}',
})

const holdersCount = defineMessage<{ count: number }>()({
  id: 'assessment/roster/holders',
  defaultMessage:
    '{count, plural, =0 {nobody can review here} one {# person can review here} other {# people can review here}}',
})

const offsetDaysAfter = defineMessage<{ days: number }>()({
  id: 'assessment/phase/starts-days-after',
  defaultMessage:
    'Starts automatically {days, plural, one {# day} other {# days}} after the previous stage begins',
})

const startsAt = defineMessage<{ time: string }>()({
  id: 'assessment/phase/starts-at',
  defaultMessage: 'Starts automatically on {time}',
})

const startedAt = defineMessage<{ time: string }>()({
  id: 'assessment/phase/started-at',
  defaultMessage: 'Started on {time}',
})

const targetAt = defineMessage<{ time: string }>()({
  id: 'assessment/phase/target-at',
  defaultMessage: 'Started by hand; aim for {time}',
})

const estimatedAt = defineMessage<{ time: string }>()({
  id: 'assessment/phase/estimated-at',
  defaultMessage: 'Expected around {time}',
})

const opensCount = defineMessage<{ count: number }>()({
  id: 'assessment/phase/opens-count',
  defaultMessage:
    '{count, plural, =0 {Opens nothing yet} one {Opens # action} other {Opens # actions}}',
})

const unitsCount = defineMessage<{ count: number }>()({
  id: 'assessment/batch/units-count',
  defaultMessage: '{count, plural, one {# unit} other {# units}}',
})

const alsoActiveIn = defineMessage<{ batches: string }>()({
  id: 'assessment/roster/also-active',
  defaultMessage: 'Already taking part in {batches}',
})

const confirmRemovePhase = defineMessage<{ name: string }>()({
  id: 'assessment/phase/remove-confirm',
  defaultMessage: 'Remove the stage “{name}” from the plan?',
})

const confirmStartPhase = defineMessage<{ name: string }>()({
  id: 'assessment/phase/start-confirm',
  defaultMessage: 'Start “{name}” now?',
})

const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {
    // ------------------------------------------------------------------
    // the batch list
    batchesTitle: { id: 'assessment/batch/title', defaultMessage: 'Assessment batches' },
    batchesHint: {
      id: 'assessment/batch/hint',
      defaultMessage:
        'A batch is one round of assessment: who takes part, which stages it goes through, and when.',
    },
    batchesEmpty: {
      id: 'assessment/batch/empty',
      defaultMessage: 'No batches yet. Create the first one to get started.',
    },
    newBatch: { id: 'assessment/batch/new', defaultMessage: 'New batch' },
    newBatchHint: {
      id: 'assessment/batch/new-hint',
      defaultMessage:
        'The batch starts as a draft you can shape freely. Nothing is visible to students until you activate it.',
    },
    backToList: { id: 'assessment/batch/back', defaultMessage: 'All batches' },
    columnName: { id: 'assessment/batch/column-name', defaultMessage: 'Name' },
    columnStatus: { id: 'assessment/batch/column-status', defaultMessage: 'Status' },
    columnMaterialRange: {
      id: 'assessment/batch/column-material-range',
      defaultMessage: 'Materials accepted',
    },
    columnUnits: { id: 'assessment/batch/column-units', defaultMessage: 'Who it covers' },

    // the batch form
    nameLabel: { id: 'assessment/batch/name', defaultMessage: 'Name' },
    namePlaceholder: {
      id: 'assessment/batch/name-placeholder',
      defaultMessage: 'e.g. 2026 spring assessment',
    },
    materialFrom: { id: 'assessment/batch/material-from', defaultMessage: 'Count materials from' },
    materialTo: { id: 'assessment/batch/material-to', defaultMessage: 'until' },
    materialHint: {
      id: 'assessment/batch/material-hint',
      defaultMessage:
        'Only things that happened between these dates count. The end date itself is not included.',
    },
    scopeLegend: { id: 'assessment/batch/scope', defaultMessage: 'Which units take part' },
    scopeHint: {
      id: 'assessment/batch/scope-hint',
      defaultMessage:
        'Everyone in the selected units is assessed together under the same rules. Pick each unit directly; do not also pick a unit that contains one you already picked.',
    },
    scopeEmpty: {
      id: 'assessment/batch/scope-empty',
      defaultMessage: 'There are no units you can manage, so a batch cannot be created from here.',
    },
    userTypesLegend: {
      id: 'assessment/batch/user-types',
      defaultMessage: 'Who in those units is assessed',
    },
    userTypesEmpty: {
      id: 'assessment/batch/user-types-empty',
      defaultMessage: 'No user types are available yet.',
    },
    create: { id: 'assessment/action/create', defaultMessage: 'Create batch' },
    save: { id: 'assessment/action/save', defaultMessage: 'Save' },
    cancel: { id: 'assessment/action/cancel', defaultMessage: 'Cancel' },
    close: { id: 'assessment/action/close', defaultMessage: 'Close' },

    // status and lifecycle
    statusDraft: { id: 'assessment/status/draft', defaultMessage: 'Draft' },
    statusActive: { id: 'assessment/status/active', defaultMessage: 'In progress' },
    statusArchived: { id: 'assessment/status/archived', defaultMessage: 'Archived' },
    activate: { id: 'assessment/action/activate', defaultMessage: 'Activate' },
    activateConfirmTitle: {
      id: 'assessment/action/activate-confirm-title',
      defaultMessage: 'Activate this batch?',
    },
    activateConfirmBody: {
      id: 'assessment/action/activate-confirm-body',
      defaultMessage:
        'The list of participants is drawn up from the selected units, and the units can no longer be changed. Stages then start according to the plan.',
    },
    archive: { id: 'assessment/action/archive', defaultMessage: 'Archive' },
    archiveConfirmTitle: {
      id: 'assessment/action/archive-confirm-title',
      defaultMessage: 'Archive this batch?',
    },
    archiveConfirmBody: {
      id: 'assessment/action/archive-confirm-body',
      defaultMessage:
        'An archived batch is closed for good: results stay visible, but nothing can be changed any more.',
    },
    draftBanner: {
      id: 'assessment/batch/draft-banner',
      defaultMessage:
        'This batch is still a draft. Set up its stages below, then activate it when everything is ready.',
    },

    // ------------------------------------------------------------------
    // the stage plan
    tabPhases: { id: 'assessment/phase/tab', defaultMessage: 'Stages' },
    tabRoster: { id: 'assessment/roster/tab', defaultMessage: 'Participants' },
    phasesHint: {
      id: 'assessment/phase/hint',
      defaultMessage:
        'The batch moves through these stages in order. Each stage decides what participants can do while it lasts.',
    },
    phasesEmpty: {
      id: 'assessment/phase/empty',
      defaultMessage:
        'No stages yet. Start from a ready-made timeline, or add stages one by one - both work.',
    },
    addPhase: { id: 'assessment/phase/add', defaultMessage: 'Add a stage' },
    editPhase: { id: 'assessment/phase/edit', defaultMessage: 'Edit' },
    viewPhase: { id: 'assessment/phase/view', defaultMessage: 'View' },
    newPhaseName: { id: 'assessment/phase/new-name', defaultMessage: 'New stage' },
    phasePanelTitle: { id: 'assessment/phase/panel-title', defaultMessage: 'Stage details' },
    phasePanelHint: {
      id: 'assessment/phase/panel-hint',
      defaultMessage: 'Changes are saved to the whole plan when you press Save.',
    },
    removePhase: { id: 'assessment/phase/remove', defaultMessage: 'Remove stage' },
    confirmRemovePhase,

    // how a stage starts
    displayNameLabel: { id: 'assessment/phase/display-name', defaultMessage: 'Stage name' },
    triggerLegend: { id: 'assessment/phase/trigger', defaultMessage: 'How does it start?' },
    triggerScheduled: {
      id: 'assessment/phase/trigger-scheduled',
      defaultMessage: 'At a set time',
    },
    triggerScheduledHint: {
      id: 'assessment/phase/trigger-scheduled-hint',
      defaultMessage: 'Starts by itself, even if nobody is at a computer.',
    },
    triggerManual: { id: 'assessment/phase/trigger-manual', defaultMessage: 'By hand' },
    triggerManualHint: {
      id: 'assessment/phase/trigger-manual-hint',
      defaultMessage: 'Waits until someone presses Start.',
    },
    triggerPublication: {
      id: 'assessment/phase/trigger-publication',
      defaultMessage: 'When results are published',
    },
    triggerPublicationHint: {
      id: 'assessment/phase/trigger-publication-hint',
      defaultMessage: 'Follows the publication of results; it has no time of its own.',
    },
    triggerFrozen: {
      id: 'assessment/phase/trigger-frozen',
      defaultMessage: 'How a stage starts is fixed once the batch is in progress.',
    },
    plannedLabel: { id: 'assessment/phase/planned', defaultMessage: 'Starts on' },
    timeModeLegend: { id: 'assessment/phase/time-mode', defaultMessage: 'When?' },
    timeModeDate: { id: 'assessment/phase/time-mode-date', defaultMessage: 'On a set date' },
    timeModeOffset: {
      id: 'assessment/phase/time-mode-offset',
      defaultMessage: 'A number of days after the previous stage',
    },
    plannedSlaLabel: {
      id: 'assessment/phase/planned-sla',
      defaultMessage: 'Aim to start by (optional)',
    },
    plannedSlaHint: {
      id: 'assessment/phase/planned-sla-hint',
      defaultMessage:
        'A reminder for yourselves. The stage still waits for someone to press Start.',
    },
    offsetLabel: {
      id: 'assessment/phase/offset',
      defaultMessage: 'Days after the previous stage begins',
    },
    offsetHint: {
      id: 'assessment/phase/offset-hint',
      defaultMessage:
        'Use this when the exact date depends on when the previous stage happens - for example, objections open one day after results are out.',
    },
    offsetFrozen: {
      id: 'assessment/phase/offset-frozen',
      defaultMessage:
        'The previous stage is now on the calendar, so this interval has become the start time above and can no longer be edited.',
    },
    estimatedLabel: {
      id: 'assessment/phase/estimated',
      defaultMessage: 'Shown to participants as (optional)',
    },
    estimatedHint: {
      id: 'assessment/phase/estimated-hint',
      defaultMessage:
        'A rough date participants see, such as “around September 10”. It changes nothing by itself.',
    },
    timeUndecided: { id: 'assessment/phase/time-undecided', defaultMessage: 'Time not set yet' },
    waitingLabel: { id: 'assessment/phase/waiting', defaultMessage: 'Waiting to start' },
    manualStart: { id: 'assessment/phase/manual-start', defaultMessage: 'Started by hand' },
    publicationStart: {
      id: 'assessment/phase/publication-start',
      defaultMessage: 'Starts when results are published',
    },
    currentBadge: { id: 'assessment/phase/current', defaultMessage: 'Now' },
    endedBadge: { id: 'assessment/phase/ended', defaultMessage: 'Ended' },
    upNextBadge: { id: 'assessment/phase/up-next', defaultMessage: 'Up next' },
    startsAt,
    startedAt,
    targetAt,
    estimatedAt,
    offsetDaysAfter,
    opensCount,
    unitsCount,

    // starting a stage by hand
    advance: { id: 'assessment/phase/advance', defaultMessage: 'Start this stage' },
    confirmStartPhase,
    advanceForce: { id: 'assessment/phase/advance-force', defaultMessage: 'Start early' },
    advanceForceTitle: {
      id: 'assessment/phase/advance-force-title',
      defaultMessage: 'Start this stage ahead of time?',
    },
    advanceForceBody: {
      id: 'assessment/phase/advance-force-body',
      defaultMessage:
        'This stage has a set start time that has not arrived yet. Starting it early is recorded together with your reason.',
    },
    advanceReason: { id: 'assessment/phase/advance-reason', defaultMessage: 'Reason' },
    planRefusedIntro: {
      id: 'assessment/phase/plan-refused',
      defaultMessage: 'The plan could not be saved:',
    },

    // templates - two different things, both optional
    timelineTemplateApply: {
      id: 'assessment/template/timeline-apply',
      defaultMessage: 'Start from a timeline',
    },
    timelineTemplateTitle: {
      id: 'assessment/template/timeline-title',
      defaultMessage: 'Start from a ready-made timeline',
    },
    timelineTemplateBody: {
      id: 'assessment/template/timeline-body',
      defaultMessage:
        'A timeline is a prepared sequence of stages. Applying one replaces the stages this batch has now - you can still edit everything afterwards.',
    },
    timelineTemplateLabel: {
      id: 'assessment/template/timeline-label',
      defaultMessage: 'Timeline',
    },
    timelineTemplateEmpty: {
      id: 'assessment/template/timeline-empty',
      defaultMessage: 'No ready-made timelines yet. You can build the stages by hand instead.',
    },
    timelineTemplateChoose: {
      id: 'assessment/template/timeline-choose',
      defaultMessage: 'Choose a timeline…',
    },
    phaseTemplateLegend: {
      id: 'assessment/template/phase-legend',
      defaultMessage: 'Fill this stage from a preset',
    },
    phaseTemplateHint: {
      id: 'assessment/template/phase-hint',
      defaultMessage:
        'A preset fills in the name and the actions below. Your own adjustments stay yours - applying it is just a starting point.',
    },
    phaseTemplateChoose: {
      id: 'assessment/template/phase-choose',
      defaultMessage: 'Choose a preset…',
    },
    phaseTemplateApply: { id: 'assessment/template/phase-apply', defaultMessage: 'Fill in' },

    // what a stage opens
    profileTitle: {
      id: 'assessment/profile/title',
      defaultMessage: 'While this stage lasts, participants can…',
    },
    profileHint: {
      id: 'assessment/profile/hint',
      defaultMessage:
        'Ticking a box opens that action during this stage for people whose role already allows it. Everything else about their roles is unaffected.',
    },

    // ------------------------------------------------------------------
    // participants
    rosterHint: {
      id: 'assessment/roster/hint',
      defaultMessage:
        'The list was drawn up when the batch was activated. If the organization changes afterwards, the changes appear below as suggestions and you decide each one.',
    },
    rosterEmpty: {
      id: 'assessment/roster/empty',
      defaultMessage: 'Nobody is on the list yet.',
    },
    rosterDraft: {
      id: 'assessment/roster/draft',
      defaultMessage:
        'The list of participants is drawn up when the batch is activated - based on the units and user types chosen for it.',
    },
    columnParticipant: { id: 'assessment/roster/column-name', defaultMessage: 'Name' },
    columnBusinessNo: { id: 'assessment/roster/column-no', defaultMessage: 'ID number' },
    columnParticipantStatus: {
      id: 'assessment/roster/column-status',
      defaultMessage: 'Status',
    },
    participantActive: { id: 'assessment/roster/active', defaultMessage: 'Taking part' },
    excludedBadge: { id: 'assessment/roster/excluded', defaultMessage: 'Removed' },
    diffTitle: {
      id: 'assessment/roster/diff-title',
      defaultMessage: 'Changes in the organization',
    },
    diffEmpty: {
      id: 'assessment/roster/diff-empty',
      defaultMessage: 'The list matches the organization. Nothing needs your attention.',
    },
    diffArrivals: { id: 'assessment/roster/arrivals', defaultMessage: 'New in these units' },
    diffArrivalsHint: {
      id: 'assessment/roster/arrivals-hint',
      defaultMessage:
        'These people joined the units after the list was drawn up. Add the ones who should take part here.',
    },
    diffDeparted: { id: 'assessment/roster/departed', defaultMessage: 'No longer in these units' },
    diffDepartedHint: {
      id: 'assessment/roster/departed-hint',
      defaultMessage:
        'These people have left the units but are still on the list. Remove the ones who should finish elsewhere - nothing they submitted is lost.',
    },
    diffAnchor: { id: 'assessment/roster/anchor-changed', defaultMessage: 'Moved to another unit' },
    diffAnchorHint: {
      id: 'assessment/roster/anchor-changed-hint',
      defaultMessage:
        'These people are still taking part but now sit somewhere else. Applying the move means their submissions are reviewed by the new unit.',
    },
    diffUserType: { id: 'assessment/roster/type-changed', defaultMessage: 'Changed user type' },
    diffScope: { id: 'assessment/roster/scope-integrity', defaultMessage: 'Units that are gone' },
    diffScopeHint: {
      id: 'assessment/roster/scope-integrity-hint',
      defaultMessage:
        'These units were selected for the batch but no longer exist in the organization. Nobody joins through them until the batch is pointed elsewhere.',
    },
    include: { id: 'assessment/roster/include', defaultMessage: 'Add to this batch' },
    exclude: { id: 'assessment/roster/exclude', defaultMessage: 'Remove' },
    restore: { id: 'assessment/roster/restore', defaultMessage: 'Bring back' },
    applyAnchor: { id: 'assessment/roster/apply-anchor', defaultMessage: 'Apply the move' },
    typeNotEnrolled: {
      id: 'assessment/roster/type-not-enrolled',
      defaultMessage: 'Their new user type is not part of this batch.',
    },
    participantCount,
    holdersCount,
    alsoActiveIn,

    // ------------------------------------------------------------------
    // one label per gated code; the matrix is built from PHASE_GATED_CODES,
    // so a code without a label here does not compile
    'permission.assessment.entry.create': {
      id: 'assessment/permission/entry-create',
      defaultMessage: 'Start a new entry',
    },
    'permission.assessment.entry.edit': {
      id: 'assessment/permission/entry-edit',
      defaultMessage: 'Edit their drafts',
    },
    'permission.assessment.entry.submit': {
      id: 'assessment/permission/entry-submit',
      defaultMessage: 'Submit for review',
    },
    'permission.assessment.entry.withdraw': {
      id: 'assessment/permission/entry-withdraw',
      defaultMessage: 'Take a submission back',
    },
    'permission.assessment.entry.proxy': {
      id: 'assessment/permission/entry-proxy',
      defaultMessage: 'Submit on behalf of a student',
    },
    'permission.assessment.entry.record': {
      id: 'assessment/permission/entry-record',
      defaultMessage: 'Record official findings',
    },
    'permission.assessment.entry.resubmit': {
      id: 'assessment/permission/entry-resubmit',
      defaultMessage: 'Contest a settled entry',
    },
    'permission.assessment.review.process': {
      id: 'assessment/permission/review-process',
      defaultMessage: 'Review submissions',
    },
    'permission.assessment.review.reopen': {
      id: 'assessment/permission/review-reopen',
      defaultMessage: 'Reopen a finished review',
    },
    'permission.assessment.result.view-peers': {
      id: 'assessment/permission/result-view-peers',
      defaultMessage: 'See classmates’ results',
    },
    'permission.assessment.ranking.view': {
      id: 'assessment/permission/ranking-view',
      defaultMessage: 'See the ranking',
    },

    // ------------------------------------------------------------------
    // the engine's refusals, in words an administrator can act on
    'refusal.phase-not-found': {
      id: 'assessment/refusal/phase-not-found',
      defaultMessage: 'One of the stages is no longer part of this plan. Reload and try again.',
    },
    'refusal.actual-immutable': {
      id: 'assessment/refusal/actual-immutable',
      defaultMessage: 'A stage that has already started keeps its start time.',
    },
    'refusal.phase-already-entered': {
      id: 'assessment/refusal/phase-already-entered',
      defaultMessage: 'This stage has already started, so its timing can no longer be changed.',
    },
    'refusal.ended-phase-name-only': {
      id: 'assessment/refusal/ended-phase-name-only',
      defaultMessage: 'Only the name of a finished stage can still be changed.',
    },
    'refusal.display-name-blank': {
      id: 'assessment/refusal/display-name-blank',
      defaultMessage: 'Every stage needs a name.',
    },
    'refusal.planned-on-publication-phase': {
      id: 'assessment/refusal/planned-on-publication-phase',
      defaultMessage:
        'This stage begins when results are published, so it cannot have its own start time.',
    },
    'refusal.hard-plan-beyond-event-boundary': {
      id: 'assessment/refusal/hard-plan-beyond-event-boundary',
      defaultMessage:
        'An earlier stage has no fixed date yet, so a stage after it cannot promise one. Use “days after the previous stage” instead.',
    },
    'refusal.planned-not-in-future': {
      id: 'assessment/refusal/planned-not-in-future',
      defaultMessage: 'The start time has to be in the future.',
    },
    'refusal.planned-out-of-order': {
      id: 'assessment/refusal/planned-out-of-order',
      defaultMessage: 'Stage times have to follow the order of the stages.',
    },
    'refusal.offset-not-positive': {
      id: 'assessment/refusal/offset-not-positive',
      defaultMessage: 'The number of days has to be more than zero.',
    },
    'refusal.offset-on-non-scheduled-phase': {
      id: 'assessment/refusal/offset-on-non-scheduled-phase',
      defaultMessage: '“Days after the previous stage” only works for stages that start by time.',
    },
    'refusal.offset-with-planned': {
      id: 'assessment/refusal/offset-with-planned',
      defaultMessage:
        'This interval has already become a start time on the calendar and cannot be changed any more.',
    },
    'refusal.binding-on-non-publication-phase': {
      id: 'assessment/refusal/binding-on-non-publication-phase',
      defaultMessage: 'Only a stage that begins with published results can be tied to them.',
    },
    'refusal.binding-immutable-after-entry': {
      id: 'assessment/refusal/binding-immutable-after-entry',
      defaultMessage: 'This stage has already begun; which publication opened it is now a record.',
    },
    'refusal.profile-code-not-gated': {
      id: 'assessment/refusal/profile-code-not-gated',
      defaultMessage: 'One of the selected actions is not something a stage can open or close.',
    },
    'refusal.insert-not-after-current': {
      id: 'assessment/refusal/insert-not-after-current',
      defaultMessage:
        'While the batch is running, a new stage can only go in after the one happening now.',
    },
    'refusal.insert-after-terminal': {
      id: 'assessment/refusal/insert-after-terminal',
      defaultMessage: 'Nothing can come after the closing stage.',
    },
    'refusal.terminal-must-be-manual': {
      id: 'assessment/refusal/terminal-must-be-manual',
      defaultMessage:
        'The last stage has to be closed by a person, so set it to start and end by hand.',
    },
    'refusal.plan-empty': {
      id: 'assessment/refusal/plan-empty',
      defaultMessage: 'Add at least one stage before activating the batch.',
    },
    'refusal.template-requires-draft': {
      id: 'assessment/refusal/template-requires-draft',
      defaultMessage: 'A ready-made timeline can only be applied while the batch is still a draft.',
    },
    'refusal.phase-removed': {
      id: 'assessment/refusal/phase-removed',
      defaultMessage: 'Stages cannot be removed once the batch is in progress.',
    },
    'refusal.reorder-not-allowed': {
      id: 'assessment/refusal/reorder-not-allowed',
      defaultMessage: 'Stages cannot be reordered once the batch is in progress.',
    },
    'refusal.phase-key-immutable': {
      id: 'assessment/refusal/phase-key-immutable',
      defaultMessage: 'A stage keeps its identity once the batch is in progress.',
    },
    'refusal.trigger-immutable': {
      id: 'assessment/refusal/trigger-immutable',
      defaultMessage: 'How a stage starts cannot change once the batch is in progress.',
    },
    'refusal.scope-in-template': {
      id: 'assessment/refusal/scope-in-template',
      defaultMessage: 'A reusable template cannot point at one batch’s items or people.',
    },
    'refusal.participant-not-in-batch': {
      id: 'assessment/refusal/participant-not-in-batch',
      defaultMessage: 'One of the selected people is not a participant of this batch.',
    },
    'refusal.phase-template-shape': {
      id: 'assessment/refusal/phase-template-shape',
      defaultMessage:
        'A stage preset describes a single stage - its name and actions - without any dates.',
    },
    'refusal.template-not-a-timeline': {
      id: 'assessment/refusal/template-not-a-timeline',
      defaultMessage:
        'That is a preset for a single stage, not a timeline, so it cannot replace the whole plan.',
    },
    'refusal.proxy-without-submit': {
      id: 'assessment/refusal/proxy-without-submit',
      defaultMessage:
        'This stage lets staff submit for a student but not students themselves - check that this is intended.',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof assessmentErrors>>()({
    ASSESSMENT_BATCH_NOT_FOUND: {
      id: 'assessment/error/batch-not-found',
      defaultMessage: 'This batch no longer exists.',
    },
    ASSESSMENT_PHASE_NOT_FOUND: {
      id: 'assessment/error/phase-not-found',
      defaultMessage: 'That stage is not part of this batch any more. Reload and try again.',
    },
    ASSESSMENT_PARTICIPANT_NOT_FOUND: {
      id: 'assessment/error/participant-not-found',
      defaultMessage: 'That person is not on this batch’s list of participants.',
    },
    ASSESSMENT_PARTICIPANT_INVALID: {
      id: 'assessment/error/participant-invalid',
      defaultMessage: 'That change to the participants could not be made.',
    },
    ASSESSMENT_TEMPLATE_NOT_FOUND: {
      id: 'assessment/error/template-not-found',
      defaultMessage: 'That template no longer exists.',
    },
    ASSESSMENT_TEMPLATE_CONFLICT: {
      id: 'assessment/error/template-conflict',
      defaultMessage: 'A template with that name already exists.',
    },
    ASSESSMENT_BATCH_READ_ONLY: {
      id: 'assessment/error/batch-read-only',
      defaultMessage: 'This batch is archived, so nothing about it can be changed.',
    },
    ASSESSMENT_BATCH_SCOPE_LOCKED: {
      id: 'assessment/error/batch-scope-locked',
      defaultMessage:
        'The units taking part were fixed when the batch was activated and cannot change.',
    },
    ASSESSMENT_BATCH_STATUS_INVALID: {
      id: 'assessment/error/batch-status-invalid',
      defaultMessage: 'The batch cannot be moved to that state from where it is now.',
    },
    ASSESSMENT_BATCH_NO_USER_TYPES: {
      id: 'assessment/error/batch-no-user-types',
      defaultMessage: 'Choose who is assessed - at least one user type - before activating.',
    },
    ASSESSMENT_BATCH_REFERENCE_INVALID: {
      id: 'assessment/error/batch-reference-invalid',
      defaultMessage: 'One of the selected units or user types does not exist any more.',
    },
    ASSESSMENT_PLAN_INVALID: {
      id: 'assessment/error/plan-invalid',
      defaultMessage: 'The stage plan could not be saved. Look over the problems listed.',
    },
    ASSESSMENT_ADVANCE_INVALID: {
      id: 'assessment/error/advance-invalid',
      defaultMessage: 'That stage cannot be started this way.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
