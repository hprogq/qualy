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

const opensCount = defineMessage<{ count: number }>()({
  id: 'assessment/phase/opens-count',
  defaultMessage:
    '{count, plural, =0 {Opens nothing yet} one {Opens # action} other {Opens # actions}}',
})

const addPeopleConfirm = defineMessage<{ count: number }>()({
  id: 'assessment/roster/add-confirm',
  defaultMessage: '{count, plural, =0 {Add} one {Add # person} other {Add # people}}',
})

const toastImported = defineMessage<{ count: number }>()({
  id: 'assessment/toast/imported',
  defaultMessage: '{count, plural, one {# person added} other {# people added}}',
})

const toastAdded = defineMessage<{ count: number }>()({
  id: 'assessment/toast/added',
  defaultMessage: '{count, plural, one {# person added} other {# people added}}',
})

const toastMerged = defineMessage<{ count: number }>()({
  id: 'assessment/toast/merged',
  defaultMessage: '{count, plural, one {# change accepted} other {# changes accepted}}',
})

const importCandidates = defineMessage<{ count: number }>()({
  id: 'assessment/roster/import-candidates',
  defaultMessage:
    '{count, plural, =0 {Nobody new to add} one {# person will be added} other {# people will be added}}',
})

const alsoActiveIn = defineMessage<{ batches: string }>()({
  id: 'assessment/roster/also-active',
  defaultMessage: 'Already taking part in {batches}',
})

const accessSourceCount = defineMessage<{ count: number }>()({
  id: 'assessment/access/source-count',
  defaultMessage: '{count, plural, =0 {Nobody yet} one {# person} other {# people}}',
})

const accessRoleAt = defineMessage<{ role: string }>()({
  id: 'assessment/access/role-at',
  defaultMessage: 'as {role}',
})

const accessSyncSelected = defineMessage<{ count: number }>()({
  id: 'assessment/access/sync-selected',
  defaultMessage: '{count, plural, =0 {Nothing selected} other {# selected}}',
})

const accessDeniedCount = defineMessage<{ count: number }>()({
  id: 'assessment/access/denied-count',
  defaultMessage: '{count, plural, one {# action withheld} other {# actions withheld}}',
})

const discardTitle = defineMessage<{ count: number }>()({
  id: 'assessment/plan/discard-title',
  defaultMessage:
    'Discard {count, plural, one {# unsaved change} other {# unsaved changes}} to the plan?',
})

const describeTitle = defineMessage<{ name: string }>()({
  id: 'assessment/phase/describe-title',
  defaultMessage: 'What \u201c{name}\u201d is for',
})

const scheduleTitle = defineMessage<{ name: string }>()({
  id: 'assessment/schedule/title',
  defaultMessage: 'Schedule \u201c{name}\u201d',
})

const startNowTitle = defineMessage<{ name: string }>()({
  id: 'assessment/schedule/start-now-title',
  defaultMessage: 'Start \u201c{name}\u201d now?',
})

const unscheduleTitle = defineMessage<{ name: string }>()({
  id: 'assessment/schedule/unschedule-title',
  defaultMessage: 'Withdraw the start time of \u201c{name}\u201d?',
})

const pendingShort = defineMessage<{ count: number }>()({
  id: 'assessment/plan/pending-short',
  defaultMessage: '{count} unsaved',
})

// what a batch is, in one line: who it assesses and which materials count
const batchSummary = defineMessage<{ count: number; from: string; until: string }>()({
  id: 'assessment/batch/summary',
  defaultMessage:
    '{count, plural, one {# participant} other {# participants}}, counting materials from {from} to {until}',
})

const batchSummaryDraft = defineMessage<{ units: number; from: string; until: string }>()({
  id: 'assessment/batch/summary-draft',
  defaultMessage:
    'Covers {units, plural, one {# unit} other {# units}}, counting materials from {from} to {until}',
})

const pageOfTotal = defineMessage<{ page: number; pages: number }>()({
  id: 'assessment/batch/page-of-total',
  defaultMessage: 'Page {page} of {pages}',
})

const totalCount = defineMessage<{ count: number }>()({
  id: 'assessment/batch/total-count',
  defaultMessage: '{count, plural, one {# item} other {# items}}',
})

const leftDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-days',
  defaultMessage: '{count, plural, one {# day left} other {# days left}}',
})
const leftHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-hours',
  defaultMessage: '{count, plural, one {# hour left} other {# hours left}}',
})
const leftMinutes = defineMessage<{ minutes: number; seconds: number }>()({
  id: 'assessment/progress/left-minutes',
  defaultMessage: '{minutes}m {seconds}s left',
})
const leftDaysHours = defineMessage<{ days: number; hours: number }>()({
  id: 'assessment/progress/left-days-hours',
  defaultMessage: '{days}d {hours}h left',
})
const leftHoursMinutes = defineMessage<{ hours: number; minutes: number }>()({
  id: 'assessment/progress/left-hours-minutes',
  defaultMessage: '{hours}h {minutes}m left',
})
const leftMinutesOnly = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-minutes-only',
  defaultMessage: '{count}m left',
})
const leftSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-seconds',
  defaultMessage: '{count}s left',
})
// the countdown with no room for a sentence: the ring beside it is what says
// the number is running out
const bareDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-days',
  defaultMessage: '{count, plural, one {# day} other {# days}}',
})
const bareHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-hours',
  defaultMessage: '{count, plural, one {# hour} other {# hours}}',
})
const bareMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-minutes',
  defaultMessage: '{count, plural, one {# minute} other {# minutes}}',
})
const bareSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-seconds',
  defaultMessage: '{count, plural, one {# second} other {# seconds}}',
})
const sinceDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-days',
  defaultMessage: '{count, plural, one {running for # day} other {running for # days}}',
})
const sinceHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-hours',
  defaultMessage: '{count, plural, one {running for # hour} other {running for # hours}}',
})
const sinceMinutes = defineMessage<{ minutes: number; seconds: number }>()({
  id: 'assessment/progress/since-minutes',
  defaultMessage: 'running for {minutes}m {seconds}s',
})
const sinceDaysHours = defineMessage<{ days: number; hours: number }>()({
  id: 'assessment/progress/since-days-hours',
  defaultMessage: 'running for {days}d {hours}h',
})
const sinceHoursMinutes = defineMessage<{ hours: number; minutes: number }>()({
  id: 'assessment/progress/since-hours-minutes',
  defaultMessage: 'running for {hours}h {minutes}m',
})
const sinceMinutesOnly = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-minutes-only',
  defaultMessage: 'running for {count}m',
})
const sinceSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-seconds',
  defaultMessage: 'running for {count}s',
})

/** how far along the plan is, when the stage names have no room */
const stagePosition = defineMessage<{ current: number; total: number }>()({
  id: 'assessment/batch/stage-position',
  defaultMessage: 'Stage {current} of {total}',
})

const stageCount = defineMessage<{ total: number }>()({
  id: 'assessment/batch/stage-count',
  defaultMessage: '{total, plural, one {# stage} other {# stages}}',
})

const materialWindow = defineMessage<{ from: string; until: string }>()({
  id: 'assessment/batch/material-window',
  defaultMessage: 'Materials {from} to {until}',
})

const coversUnits = defineMessage<{ count: number }>()({
  id: 'assessment/batch/covers-units',
  defaultMessage: '{count, plural, one {# unit} other {# units}}',
})

const enrolled = defineMessage<{ count: number }>()({
  id: 'assessment/batch/enrolled',
  defaultMessage: '{count, plural, one {# participant} other {# participants}}',
})

const includedAt = defineMessage<{ time: string }>()({
  id: 'assessment/roster/included-at',
  defaultMessage: 'On the list since {time}',
})

const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {
    // ------------------------------------------------------------------
    // the batch list
    batchesTitle: { id: 'assessment/batch/title', defaultMessage: 'Assessment batches' },
    batchesHint: {
      id: 'assessment/batch/hint',
      defaultMessage: "Manage each assessment round's scope, stage plan and roster.",
    },
    batchesEmpty: {
      id: 'assessment/batch/empty',
      defaultMessage: 'No assessment batches yet.',
    },
    newBatch: { id: 'assessment/batch/new', defaultMessage: 'New batch' },
    batchesEmptyHint: {
      id: 'assessment/batch/empty-hint',
      defaultMessage: 'Create a batch to manage its scope, stages and roster here.',
    },
    searchPlaceholder: {
      id: 'assessment/batch/search',
      defaultMessage: 'Search by name',
    },
    filterStatus: { id: 'assessment/batch/filter-status', defaultMessage: 'Status' },
    filterAll: { id: 'assessment/batch/filter-all', defaultMessage: 'All' },
    noMatchTitle: { id: 'assessment/batch/no-match', defaultMessage: 'No matching batches' },
    noMatchHint: {
      id: 'assessment/batch/no-match-hint',
      defaultMessage: 'Try a different keyword or clear the status filter.',
    },
    clearFilters: { id: 'assessment/batch/clear-filters', defaultMessage: 'Clear filters' },
    previousPage: { id: 'assessment/action/previous-page', defaultMessage: 'Previous' },
    nextPage: { id: 'assessment/action/next-page', defaultMessage: 'Next' },
    pageOfTotal,
    totalCount,
    stagePosition,
    stageCount,
    materialWindow,
    coversUnits,
    enrolled,
    leftDays,
    leftDaysHours,
    leftHours,
    leftHoursMinutes,
    leftMinutes,
    leftMinutesOnly,
    leftSeconds,
    sinceDays,
    sinceDaysHours,
    sinceHoursMinutes,
    sinceMinutesOnly,
    sinceHours,
    sinceMinutes,
    sinceSeconds,
    batchSummary,
    batchSummaryDraft,
    backToList: { id: 'assessment/batch/back', defaultMessage: 'All batches' },
    columnName: { id: 'assessment/batch/column-name', defaultMessage: 'Name' },
    columnStatus: { id: 'assessment/batch/column-status', defaultMessage: 'Status' },
    columnMaterialRange: {
      id: 'assessment/batch/column-material-range',
      defaultMessage: 'Materials accepted',
    },
    columnParticipants: {
      id: 'assessment/batch/column-participants',
      defaultMessage: 'Participants',
    },
    columnCurrentPhase: {
      id: 'assessment/batch/column-current-phase',
      defaultMessage: 'Current stage',
    },
    columnCreatedAt: { id: 'assessment/batch/column-created-at', defaultMessage: 'Created' },

    // the batch form
    nameLabel: { id: 'assessment/batch/name', defaultMessage: 'Name' },
    namePlaceholder: {
      id: 'assessment/batch/name-placeholder',
      defaultMessage: 'e.g. 2026 spring assessment',
    },
    materialRange: {
      id: 'assessment/batch/material-range',
      defaultMessage: 'Material period',
    },
    pickDateRange: { id: 'assessment/action/pick-date-range', defaultMessage: 'Select a period' },
    stepBasics: { id: 'assessment/batch/step-basics', defaultMessage: 'Details' },
    stepScope: { id: 'assessment/batch/step-scope', defaultMessage: 'First participants' },
    back: { id: 'assessment/action/back', defaultMessage: 'Back' },
    next: { id: 'assessment/action/next', defaultMessage: 'Next' },
    scopeLegend: { id: 'assessment/batch/scope', defaultMessage: 'Import from these units' },
    scopeEmpty: {
      id: 'assessment/batch/scope-empty',
      defaultMessage: 'No units available to manage.',
    },
    userTypesLegend: {
      id: 'assessment/batch/user-types',
      defaultMessage: 'Participant types',
    },
    userTypesEmpty: {
      id: 'assessment/batch/user-types-empty',
      defaultMessage: 'No user types available.',
    },
    create: { id: 'assessment/action/create', defaultMessage: 'Create batch' },
    cancel: { id: 'assessment/action/cancel', defaultMessage: 'Cancel' },

    // status and lifecycle
    statusDraft: { id: 'assessment/status/draft', defaultMessage: 'Draft' },
    // a batch whose first stage has a time but has not arrived yet: running
    // is a promise it has made, not a state it is in
    statusPending: { id: 'assessment/status/pending', defaultMessage: 'Starts as scheduled' },
    statusActive: { id: 'assessment/status/active', defaultMessage: 'In progress' },
    statusArchived: { id: 'assessment/status/archived', defaultMessage: 'Archived' },
    deleteBatch: { id: 'assessment/action/delete', defaultMessage: 'Delete batch' },
    deleteConfirmTitle: {
      id: 'assessment/action/delete-confirm-title',
      defaultMessage: 'Delete this batch?',
    },
    deleteConfirmBody: {
      id: 'assessment/action/delete-confirm-body',
      defaultMessage:
        'Nothing has run yet, so nothing is lost but the setup: the stages, their permissions and the coverage go with it.',
    },
    reopen: { id: 'assessment/action/reopen', defaultMessage: 'Reopen batch' },
    reopenTitle: { id: 'assessment/action/reopen-title', defaultMessage: 'Reopen this batch?' },
    reopenBody: {
      id: 'assessment/action/reopen-body',
      defaultMessage:
        'A new stage is added at the end and starts now; earlier stages and their data are unchanged.',
    },
    reopenReason: { id: 'assessment/action/reopen-reason', defaultMessage: 'Why' },
    reopenReasonPlaceholder: {
      id: 'assessment/action/reopen-reason-placeholder',
      defaultMessage: 'e.g. some materials were missed and have to be submitted',
    },
    reopenPhaseName: { id: 'assessment/action/reopen-phase', defaultMessage: 'The stage to open' },
    reopenPhaseHint: {
      id: 'assessment/action/reopen-phase-hint',
      defaultMessage: 'A new stage, not the earlier one running again.',
    },
    reopenPhasePlaceholder: {
      id: 'assessment/action/reopen-phase-placeholder',
      defaultMessage: 'e.g. supplementary submission',
    },
    archive: { id: 'assessment/action/archive', defaultMessage: 'Archive' },
    archiveConfirmTitle: {
      id: 'assessment/action/archive-confirm-title',
      defaultMessage: 'Archive this batch?',
    },
    archiveConfirmBody: {
      id: 'assessment/action/archive-confirm-body',
      defaultMessage:
        'The batch becomes read-only and results stay visible. It can be reopened later, with a reason.',
    },
    draftBanner: {
      id: 'assessment/batch/draft-banner',
      defaultMessage: 'Not started. Schedule the first stage to start it.',
    },

    // ------------------------------------------------------------------
    // the stage plan
    sectionsLabel: { id: 'assessment/batch/sections', defaultMessage: 'Batch sections' },
    switchBatch: { id: 'assessment/batch/switch', defaultMessage: 'Switch batch' },
    notStartedYet: { id: 'assessment/batch/not-started', defaultMessage: 'Not started yet' },
    plannedStart: { id: 'assessment/batch/planned-start', defaultMessage: 'Starts' },
    noStagesYet: { id: 'assessment/batch/no-stages', defaultMessage: 'No stages arranged yet' },
    currentStage: { id: 'assessment/batch/current-stage', defaultMessage: 'Current stage' },
    bareDays,
    bareHours,
    bareMinutes,
    bareSeconds,
    endsUnknown: { id: 'assessment/batch/ends-unknown', defaultMessage: 'No end time set' },
    enterBatch: { id: 'assessment/batch/enter', defaultMessage: 'Open' },
    configureBatch: { id: 'assessment/batch/configure', defaultMessage: 'Keep setting up' },
    draftHint: {
      id: 'assessment/batch/draft-hint',
      defaultMessage: 'Arrange the stages, then schedule the first one to start it.',
    },
    groupRunning: { id: 'assessment/batch/group-running', defaultMessage: 'Under way' },
    groupPending: { id: 'assessment/batch/group-pending', defaultMessage: 'Starting soon' },
    groupDraft: { id: 'assessment/batch/group-draft', defaultMessage: 'Drafts' },
    groupEnded: { id: 'assessment/batch/group-ended', defaultMessage: 'Finished' },
    filterEnded: { id: 'assessment/batch/filter-ended', defaultMessage: 'Finished' },
    endedOn: { id: 'assessment/batch/ended-on', defaultMessage: 'Finished {date}' },
    tabPhases: { id: 'assessment/phase/tab', defaultMessage: 'Stages' },
    tabRoster: { id: 'assessment/roster/tab', defaultMessage: 'Participants' },
    tabOverview: { id: 'assessment/overview/tab', defaultMessage: 'Overview' },
    overviewHint: {
      id: 'assessment/overview/hint',
      defaultMessage: 'Where this batch stands, and what you can do in it right now.',
    },
    overviewPlaceholder: {
      id: 'assessment/overview/placeholder',
      defaultMessage: 'Nothing here yet.',
    },
    tabAccess: { id: 'assessment/access/tab', defaultMessage: 'Staffs' },
    tabSettings: { id: 'assessment/settings/tab', defaultMessage: 'Settings' },
    settingsHint: {
      id: 'assessment/settings/hint',
      defaultMessage: 'Change what this batch is called and what it covers.',
    },
    settingsBasics: { id: 'assessment/settings/basics', defaultMessage: 'The batch itself' },
    settingsBasicsHint: {
      id: 'assessment/settings/basics-hint',
      defaultMessage: 'The material range decides which achievements may be reported here.',
    },
    settingsNote: { id: 'assessment/settings/note', defaultMessage: 'Notes' },
    settingsNoteHint: {
      id: 'assessment/settings/note-hint',
      defaultMessage: 'Seen by whoever works on this batch.',
    },
    enrolledLabel: { id: 'assessment/settings/enrolled', defaultMessage: 'Taking part' },
    settingsUnsaved: { id: 'assessment/settings/unsaved', defaultMessage: 'Not saved yet' },
    settingsLifecycle: { id: 'assessment/settings/lifecycle', defaultMessage: 'This round' },
    settingsLifecycleHint: {
      id: 'assessment/settings/lifecycle-hint',
      defaultMessage: 'Closing it keeps everything and stops the work; each step asks first.',
    },
    phasesHint: {
      id: 'assessment/phase/hint',
      defaultMessage: 'Arrange the stages of this batch and choose what each one opens.',
    },
    phasesEmpty: {
      id: 'assessment/phase/empty',
      defaultMessage: 'No stages yet. Add them from a template, or one at a time.',
    },
    addPhase: { id: 'assessment/phase/add', defaultMessage: 'Add a stage' },
    colStage: { id: 'assessment/plan/col-stage', defaultMessage: 'Stage' },
    colOpens: { id: 'assessment/plan/col-opens', defaultMessage: 'Opens' },
    colPlannedStart: { id: 'assessment/plan/col-start', defaultMessage: 'Starts' },
    colStatus: { id: 'assessment/plan/col-status', defaultMessage: 'Status' },
    colActions: { id: 'assessment/plan/col-actions', defaultMessage: 'Actions' },
    descriptionLabel: { id: 'assessment/phase/description', defaultMessage: 'What it is for' },
    descriptionPlaceholder: {
      id: 'assessment/phase/description-placeholder',
      defaultMessage: 'What happens in this stage',
    },
    notScheduled: { id: 'assessment/plan/not-scheduled', defaultMessage: 'Not scheduled' },
    awaitingEarlier: {
      id: 'assessment/plan/awaiting-earlier',
      defaultMessage: 'Schedule the stage above first',
    },
    lockedBySchedule: { id: 'assessment/plan/locked', defaultMessage: 'Scheduled' },
    upNextBadge: { id: 'assessment/plan/up-next', defaultMessage: 'Ready for a time' },
    enterEditing: {
      id: 'assessment/plan/enter-editing',
      defaultMessage: 'Add or edit stages',
    },
    unscheduledFrom: {
      id: 'assessment/plan/unscheduled-from',
      defaultMessage: 'The stages below have no time yet',
    },
    insertHere: { id: 'assessment/plan/insert-here', defaultMessage: 'Add a stage here' },
    editDetails: { id: 'assessment/phase/edit-details', defaultMessage: 'Details' },
    saveShort: { id: 'assessment/plan/save-short', defaultMessage: 'Save' },
    moveUp: { id: 'assessment/plan/move-up', defaultMessage: 'Move up' },
    moveDown: { id: 'assessment/plan/move-down', defaultMessage: 'Move down' },
    done: { id: 'assessment/action/done', defaultMessage: 'Done' },
    pendingShort,
    schedule: { id: 'assessment/schedule/action', defaultMessage: 'Schedule' },
    goSchedule: { id: 'assessment/schedule/go', defaultMessage: 'Set a time' },
    scheduleTitle,
    describeTitle,
    describeBody: {
      id: 'assessment/phase/describe-body',
      defaultMessage:
        'Shown wherever this stage appears, to administrators and participants alike.',
    },
    startModeLegend: { id: 'assessment/schedule/mode', defaultMessage: 'When it begins' },
    startModeLater: { id: 'assessment/schedule/mode-later', defaultMessage: 'At a set time' },
    startModeLaterHint: {
      id: 'assessment/schedule/mode-later-hint',
      defaultMessage: 'The batch enters this stage on its own, at the time you choose.',
    },
    justNow: { id: 'assessment/plan/just-now', defaultMessage: 'just now' },
    scheduleBody: {
      id: 'assessment/schedule/body',
      defaultMessage: 'The batch enters this stage at the time you choose.',
    },
    scheduleConfirm: { id: 'assessment/schedule/confirm', defaultMessage: 'Schedule it' },
    plannedStartLabel: { id: 'assessment/schedule/planned-at', defaultMessage: 'Starts at' },
    startNow: { id: 'assessment/schedule/start-now', defaultMessage: 'Start now' },
    startNowTitle,
    startNowBody: {
      id: 'assessment/schedule/start-now-body',
      defaultMessage: 'The stage running now ends and this one begins, from this moment.',
    },
    unschedule: { id: 'assessment/schedule/unschedule', defaultMessage: 'Withdraw' },
    unscheduleTitle,
    templateAdd: { id: 'assessment/template/add', defaultMessage: 'Add from a template' },
    templateAddBody: {
      id: 'assessment/template/add-body',
      defaultMessage:
        'The template\u2019s stages are added to the end, with no times of their own.',
    },
    'refusal.schedule-out-of-order': {
      id: 'assessment/refusal/schedule-out-of-order',
      defaultMessage: 'Stages take their times in order: schedule the one above this first.',
    },
    'refusal.unschedule-not-from-tail': {
      id: 'assessment/refusal/unschedule-not-from-tail',
      defaultMessage: 'Withdraw the last scheduled stage first; times are given back from the end.',
    },
    'refusal.scheduled-phase-immutable': {
      id: 'assessment/refusal/scheduled-phase-immutable',
      defaultMessage: 'A stage that already has a time cannot be moved or removed.',
    },
    removePhase: { id: 'assessment/phase/remove', defaultMessage: 'Remove stage' },

    // how a stage starts
    displayNameLabel: { id: 'assessment/phase/display-name', defaultMessage: 'Stage name' },
    unnamedSegment: { id: 'assessment/plan/unnamed', defaultMessage: 'Unnamed stage' },
    newBadge: { id: 'assessment/plan/new-badge', defaultMessage: 'Not saved yet' },
    discardTitle,
    discardEdits: { id: 'assessment/plan/discard', defaultMessage: 'Discard changes' },
    pickDate: { id: 'assessment/phase/pick-date', defaultMessage: 'Pick a date' },
    pickTime: { id: 'assessment/phase/pick-time', defaultMessage: 'Pick a time' },
    clearTime: { id: 'assessment/phase/clear-time', defaultMessage: 'Clear' },
    currentBadge: { id: 'assessment/phase/current', defaultMessage: 'Now' },
    endedBadge: { id: 'assessment/phase/ended', defaultMessage: 'Ended' },
    opensCount,

    // starting a stage by hand
    planRefusedIntro: {
      id: 'assessment/phase/plan-refused',
      defaultMessage: 'Could not save the stage settings:',
    },

    // templates - two different things, both optional
    timelineTemplateLabel: {
      id: 'assessment/template/timeline-label',
      defaultMessage: 'Timeline',
    },
    timelineTemplateEmpty: {
      id: 'assessment/template/timeline-empty',
      defaultMessage: 'No timeline templates yet; stages can be added manually.',
    },
    timelineTemplateChoose: {
      id: 'assessment/template/timeline-choose',
      defaultMessage: 'Choose a timeline…',
    },
    phaseTemplateLegend: {
      id: 'assessment/template/phase-legend',
      defaultMessage: 'Fill this stage from a preset',
    },
    phaseTemplateChoose: {
      id: 'assessment/template/phase-choose',
      defaultMessage: 'Choose a preset…',
    },
    phaseTemplateApply: { id: 'assessment/template/phase-apply', defaultMessage: 'Fill in' },

    // what a stage opens
    profileTitle: {
      id: 'assessment/profile/title',
      defaultMessage: 'Actions open during this stage',
    },
    profileHint: {
      id: 'assessment/profile/hint',
      defaultMessage: 'Applies to this stage only; role permissions are unchanged.',
    },

    // ------------------------------------------------------------------
    // participants
    rosterHint: {
      id: 'assessment/roster/hint',
      defaultMessage:
        'Manage who takes part in this batch, and act on what changed in the organization.',
    },
    importFromOrganization: {
      id: 'assessment/roster/import',
      defaultMessage: 'Import from the organization',
    },
    importTitle: { id: 'assessment/roster/import-title', defaultMessage: 'Import participants' },
    importHint: {
      id: 'assessment/roster/import-hint',
      defaultMessage: 'Anybody already on the list is skipped.',
    },
    importChoose: {
      id: 'assessment/roster/import-choose',
      defaultMessage: 'Choose units and participant types.',
    },
    importConfirm: { id: 'assessment/roster/import-confirm', defaultMessage: 'Import' },
    importCandidates,
    toastImported,
    toastAdded,
    toastMerged,
    toastExcluded: { id: 'assessment/toast/excluded', defaultMessage: 'Taken off the list' },
    toastRestored: { id: 'assessment/toast/restored', defaultMessage: 'Back on the list' },
    toastAdjusted: { id: 'assessment/toast/adjusted', defaultMessage: 'Saved' },
    toastBatchCreated: { id: 'assessment/toast/batch-created', defaultMessage: 'Batch created' },
    toastBatchSaved: { id: 'assessment/toast/batch-saved', defaultMessage: 'Saved' },
    toastBatchArchived: { id: 'assessment/toast/batch-archived', defaultMessage: 'Batch archived' },
    toastBatchReopened: { id: 'assessment/toast/batch-reopened', defaultMessage: 'Batch reopened' },
    toastBatchDeleted: { id: 'assessment/toast/batch-deleted', defaultMessage: 'Batch deleted' },
    toastPlanSaved: { id: 'assessment/toast/plan-saved', defaultMessage: 'Phases saved' },
    toastPhaseScheduled: { id: 'assessment/toast/phase-scheduled', defaultMessage: 'Time set' },
    toastPhaseAdvanced: {
      id: 'assessment/toast/phase-advanced',
      defaultMessage: 'Moved to the next phase',
    },
    toastLapsedCleared: {
      id: 'assessment/toast/lapsed-cleared',
      defaultMessage: 'Withdrawn records cleared',
    },
    toastStaffAdded: { id: 'assessment/toast/staff-added', defaultMessage: 'Brought in' },
    toastStaffRemoved: {
      id: 'assessment/toast/staff-removed',
      defaultMessage: 'Removed from this batch',
    },
    addPeople: { id: 'assessment/roster/add', defaultMessage: 'Add people' },
    addPeopleTitle: { id: 'assessment/roster/add-title', defaultMessage: 'Add participants' },
    addPeopleHint: {
      id: 'assessment/roster/add-hint',
      defaultMessage: 'Search by name or ID, or browse the organization.',
    },
    addPeopleConfirm,
    pickerUnavailable: {
      id: 'assessment/roster/picker-unavailable',
      defaultMessage: 'You cannot browse people in this deployment.',
    },
    rosterUnits: { id: 'assessment/roster/units', defaultMessage: 'Units' },
    rosterEmpty: {
      id: 'assessment/roster/empty',
      defaultMessage: 'No participants yet.',
    },
    columnParticipant: { id: 'assessment/roster/column-name', defaultMessage: 'Name' },
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
      defaultMessage: 'The roster matches the organization; nothing to review.',
    },
    diffArrivals: { id: 'assessment/roster/arrivals', defaultMessage: 'New in these units' },
    diffArrivalsHint: {
      id: 'assessment/roster/arrivals-hint',
      defaultMessage:
        'People who joined the selected units after the roster was generated; add them to include them in this batch.',
    },
    diffDeparted: { id: 'assessment/roster/departed', defaultMessage: 'No longer in these units' },
    diffDepartedHint: {
      id: 'assessment/roster/departed-hint',
      defaultMessage:
        'People who left the selected units but remain on the roster; removing them keeps everything they submitted.',
    },
    diffAnchor: { id: 'assessment/roster/anchor-changed', defaultMessage: 'Moved to another unit' },
    diffAnchorHint: {
      id: 'assessment/roster/anchor-changed-hint',
      defaultMessage:
        'People who moved to another unit within scope; applying the move hands review to the new unit.',
    },
    diffUserType: { id: 'assessment/roster/type-changed', defaultMessage: 'Changed user type' },
    diffScope: { id: 'assessment/roster/scope-integrity', defaultMessage: 'Units that are gone' },
    diffScopeHint: {
      id: 'assessment/roster/scope-integrity-hint',
      defaultMessage:
        'Units that were removed from the organization; they enroll nobody until the scope is adjusted.',
    },
    include: { id: 'assessment/roster/include', defaultMessage: 'Add to this batch' },
    exclude: { id: 'assessment/roster/exclude', defaultMessage: 'Remove' },
    excludeTitle: {
      id: 'assessment/roster/exclude-title',
      defaultMessage: 'Take {name} off the list?',
    },
    excludeBody: {
      id: 'assessment/roster/exclude-body',
      defaultMessage:
        'They stop taking part from now on. Everything they have submitted stays, and they can be added again later.',
    },
    restore: { id: 'assessment/roster/restore', defaultMessage: 'Bring back' },
    applyAnchor: { id: 'assessment/roster/apply-anchor', defaultMessage: 'Apply the move' },
    typeNotEnrolled: {
      id: 'assessment/roster/type-not-enrolled',
      defaultMessage: 'Their new user type is not part of this batch.',
    },
    participantCount,
    alsoActiveIn,
    noBusinessNoShort: {
      id: 'assessment/roster/no-business-no',
      defaultMessage: 'No student or staff ID',
    },
    includedAt,

    // ------------------------------------------------------------------
    // who may work on the round, and what this round accepted of it
    accessHint: {
      id: 'assessment/access/hint',
      defaultMessage:
        'Manage what each person may do in this batch, or sync with the organization.',
    },
    accessEmpty: {
      id: 'assessment/access/empty',
      defaultMessage: 'Nobody works on this batch yet.',
    },
    accessEmptyHint: {
      id: 'assessment/access/empty-hint',
      defaultMessage: 'People who hold a role in the organization appear here once you sync.',
    },
    accessColumnPerson: { id: 'assessment/access/column-person', defaultMessage: 'Person' },
    accessColumnSources: { id: 'assessment/access/column-sources', defaultMessage: 'Granted by' },
    accessColumnPermissions: {
      id: 'assessment/access/column-permissions',
      defaultMessage: 'In this batch',
    },
    accessOriginInherited: {
      id: 'assessment/access/origin-inherited',
      defaultMessage: 'From the organization',
    },
    accessOriginExplicit: {
      id: 'assessment/access/origin-explicit',
      defaultMessage: 'Added for this batch',
    },
    accessSourceLapsed: {
      id: 'assessment/access/source-lapsed',
      defaultMessage: 'Withdrawn elsewhere',
    },
    accessNothing: {
      id: 'assessment/access/nothing',
      defaultMessage: 'Nothing, for now',
    },
    accessAdjust: { id: 'assessment/access/adjust', defaultMessage: 'Adjust' },
    accessAdjustTitle: {
      id: 'assessment/access/adjust-title',
      defaultMessage: 'Adjust what {name} may do in this batch',
    },
    accessAdjustHint: {
      id: 'assessment/access/adjust-hint',
      defaultMessage:
        'Turning something off applies to this batch only and leaves their role in the organization unchanged.',
    },
    accessWithheld: { id: 'assessment/access/withheld', defaultMessage: 'Withheld' },
    accessRemove: { id: 'assessment/access/remove', defaultMessage: 'Remove from this batch' },
    accessRemoveTitle: {
      id: 'assessment/access/remove-title',
      defaultMessage: 'Remove {name} from this batch?',
    },
    accessRemoveBody: {
      id: 'assessment/access/remove-body',
      defaultMessage:
        'They will no longer be able to work on this batch. What they have already done is kept.',
    },
    accessSyncTitle: {
      id: 'assessment/access/sync-title',
      defaultMessage: 'Permissions changed in the organization',
    },
    // the bar: what happened, and the one thing to do about it
    accessSyncPrompt: {
      id: 'assessment/access/sync-prompt',
      defaultMessage: 'Permissions changed in the organization. Review the changes to merge them.',
    },
    accessSyncLapsedPrompt: {
      id: 'assessment/access/sync-lapsed-prompt',
      defaultMessage:
        'Some permissions were withdrawn in the organization and no longer apply here.',
    },
    accessSyncOpen: { id: 'assessment/access/sync-open', defaultMessage: 'Review changes' },
    accessSyncSelectPage: {
      id: 'assessment/access/sync-select-page',
      defaultMessage: 'Select all on this page',
    },
    accessSyncHint: {
      id: 'assessment/access/sync-hint',
      defaultMessage: 'Confirm whether to merge the following changes into this batch.',
    },
    accessSyncNew: { id: 'assessment/access/sync-new', defaultMessage: 'Newly authorized' },
    accessSyncWidened: { id: 'assessment/access/sync-widened', defaultMessage: 'More permissions' },
    accessSyncLapsed: {
      id: 'assessment/access/sync-lapsed',
      defaultMessage: 'No longer authorized',
    },
    accessSyncLapsedHint: {
      id: 'assessment/access/sync-lapsed-hint',
      defaultMessage: 'Withdrawn in the organization and already in effect here.',
    },
    accessSyncApply: { id: 'assessment/access/sync-apply', defaultMessage: 'Accept changes' },
    accessSyncClear: {
      id: 'assessment/access/sync-clear',
      defaultMessage: 'Clear withdrawn records',
    },
    accessSyncQuiet: {
      id: 'assessment/access/sync-quiet',
      defaultMessage: 'Nothing to merge from the organization.',
    },
    accessSourceCount,
    accessRoleAt,
    accessDeniedCount,
    accessSyncSelected,
    addStaff: { id: 'assessment/access/add-staff', defaultMessage: 'Assign a new staff' },
    addStaffTitle: {
      id: 'assessment/access/add-staff-title',
      defaultMessage: 'Assign a new staff for this batch',
    },
    addStaffHint: {
      id: 'assessment/access/add-staff-hint',
      defaultMessage: 'What they may do applies to this batch only.',
    },
    addStaffStepWho: { id: 'assessment/access/add-staff-step-who', defaultMessage: 'Person' },
    addStaffStepWhere: { id: 'assessment/access/add-staff-step-where', defaultMessage: 'Unit' },
    addStaffStepAs: { id: 'assessment/access/add-staff-step-as', defaultMessage: 'Role' },
    addStaffWhereHint: {
      id: 'assessment/access/add-staff-where-hint',
      defaultMessage: 'Which part of this batch they will work on.',
    },
    addStaffAsHint: {
      id: 'assessment/access/add-staff-as-hint',
      defaultMessage: 'What they may do here comes from the role.',
    },
    roleRefusedUserType: {
      id: 'assessment/access/role-refused-user-type',
      defaultMessage: 'Not for this kind of user',
    },
    roleRefusedAuthority: {
      id: 'assessment/access/role-refused-authority',
      defaultMessage: 'Not yours to give',
    },
    roleRefusedUnavailable: {
      id: 'assessment/access/role-refused-unavailable',
      defaultMessage: 'No longer available',
    },
    roleRefusedBeyondBatch: {
      id: 'assessment/access/role-refused-beyond-batch',
      defaultMessage: 'Reaches beyond this batch',
    },
    addStaffNoRoles: {
      id: 'assessment/access/add-staff-no-roles',
      defaultMessage: 'No role you can give here',
    },
    addStaffConfirm: { id: 'assessment/access/add-staff-confirm', defaultMessage: 'Bring in' },

    // ------------------------------------------------------------------
    // the three families the gate itself distinguishes
    permissionGroupEntry: {
      id: 'assessment/permission-group/entry',
      defaultMessage: 'Filling in',
    },
    permissionGroupReview: {
      id: 'assessment/permission-group/review',
      defaultMessage: 'Reviewing',
    },
    permissionGroupResult: {
      id: 'assessment/permission-group/result',
      defaultMessage: 'Results',
    },

    // one sentence per gated code: what opening it lets a participant do
    'permission-hint.assessment.entry.create': {
      id: 'assessment/permission-hint/entry-create',
      defaultMessage: 'Start new entries against the items open in this batch.',
    },
    'permission-hint.assessment.entry.edit': {
      id: 'assessment/permission-hint/entry-edit',
      defaultMessage: 'Change entries that have not been submitted yet.',
    },
    'permission-hint.assessment.entry.submit': {
      id: 'assessment/permission-hint/entry-submit',
      defaultMessage: 'Hand a draft entry over for review.',
    },
    'permission-hint.assessment.entry.withdraw': {
      id: 'assessment/permission-hint/entry-withdraw',
      defaultMessage: 'Take a submitted entry back while it is still unreviewed.',
    },
    'permission-hint.assessment.entry.proxy': {
      id: 'assessment/permission-hint/entry-proxy',
      defaultMessage: 'Submit on a student behalf; the entry stays theirs.',
    },
    'permission-hint.assessment.entry.record': {
      id: 'assessment/permission-hint/entry-record',
      defaultMessage: 'Record findings the institution establishes itself.',
    },
    'permission-hint.assessment.entry.resubmit': {
      id: 'assessment/permission-hint/entry-resubmit',
      defaultMessage: 'Contest an entry that has already been settled.',
    },
    'permission-hint.assessment.review.process': {
      id: 'assessment/permission-hint/review-process',
      defaultMessage: 'Approve, reject or return submitted entries.',
    },
    'permission-hint.assessment.review.reopen': {
      id: 'assessment/permission-hint/review-reopen',
      defaultMessage: 'Reopen a review that was already concluded.',
    },
    'permission-hint.assessment.result.view-peers': {
      id: 'assessment/permission-hint/result-view-peers',
      defaultMessage: 'See the results of other participants.',
    },
    'permission-hint.assessment.ranking.view': {
      id: 'assessment/permission-hint/ranking-view',
      defaultMessage: 'See the ranking of the batch.',
    },
    'permission-hint.assessment.publication.manage': {
      id: 'assessment/permission-hint/publication-manage',
      defaultMessage: 'Announce, publish and withdraw the results of this batch.',
    },

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
    // not gated by a phase, so the phase editor never lists it; the access
    // page does, because a role can carry it into a round
    'permission.assessment.publication.manage': {
      id: 'assessment/permission/publication-manage',
      defaultMessage: 'Announce and publish results',
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
    'refusal.planned-not-in-future': {
      id: 'assessment/refusal/planned-not-in-future',
      defaultMessage: 'The start time has to be in the future.',
    },
    'refusal.planned-out-of-order': {
      id: 'assessment/refusal/planned-out-of-order',
      defaultMessage: 'Stage times have to follow the order of the stages.',
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
      defaultMessage: 'Could not update the participant list.',
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
    ASSESSMENT_BATCH_STATUS_INVALID: {
      id: 'assessment/error/batch-status-invalid',
      defaultMessage: 'The batch cannot be moved to that state from where it is now.',
    },
    ASSESSMENT_BATCH_NO_PARTICIPANTS: {
      id: 'assessment/error/batch-no-participants',
      defaultMessage: 'Choose who is assessed - at least one user type - before activating.',
    },
    ASSESSMENT_BATCH_REFERENCE_INVALID: {
      id: 'assessment/error/batch-reference-invalid',
      defaultMessage: 'One of the selected units or user types does not exist any more.',
    },
    ASSESSMENT_PLAN_INVALID: {
      id: 'assessment/error/plan-invalid',
      defaultMessage: 'Could not save the stage settings. Fix the problems listed and try again.',
    },
    ASSESSMENT_ADVANCE_INVALID: {
      id: 'assessment/error/advance-invalid',
      defaultMessage: 'That stage cannot be started this way.',
    },
    ASSESSMENT_ACCESS_INVALID: {
      id: 'assessment/error/access-invalid',
      defaultMessage: 'That change to who may work on this batch was refused.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
