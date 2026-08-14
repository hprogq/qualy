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
// The countdown with no room for a sentence, on a bar narrow enough to have
// dropped the stage's name: it says whose clock it is in one word, because
// without it a bare number on a page about a batch reads as the batch's.
const bareDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-days',
  defaultMessage: '{count, plural, one {# day left in stage} other {# days left in stage}}',
})
const bareHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-hours',
  defaultMessage: '{count, plural, one {# hour left in stage} other {# hours left in stage}}',
})
const bareMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-minutes',
  defaultMessage: '{count, plural, one {# minute left in stage} other {# minutes left in stage}}',
})
const bareSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-seconds',
  defaultMessage: '{count, plural, one {# second left in stage} other {# seconds left in stage}}',
})
const bareSinceDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-days',
  defaultMessage: '{count, plural, one {# day into stage} other {# days into stage}}',
})
const bareSinceHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-hours',
  defaultMessage: '{count, plural, one {# hour into stage} other {# hours into stage}}',
})
const bareSinceMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-minutes',
  defaultMessage: '{count, plural, one {# minute into stage} other {# minutes into stage}}',
})
const bareSinceSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-seconds',
  defaultMessage: '{count, plural, one {# second into stage} other {# seconds into stage}}',
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

// the round as the people in it read it: when a stage began, when it gives
// way to the next, and nothing about who arranges any of it
const flowFrom = defineMessage<{ when: string }>()({
  id: 'assessment/flow/from',
  defaultMessage: 'from {when}',
})
const flowEarlier = defineMessage<{ count: number }>()({
  id: 'assessment/flow/earlier',
  defaultMessage: '{count, plural, one {# earlier stage} other {# earlier stages}}',
})
const flowFromPending = defineMessage<{ when: string }>()({
  id: 'assessment/flow/from-pending',
  defaultMessage: 'from {when}, end to be decided',
})
const flowUntil = defineMessage<{ when: string }>()({
  id: 'assessment/flow/until',
  defaultMessage: 'until {when}',
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

// a group whose own limit moved it says both numbers, so the one that counts
// is never an unexplained figure next to what its questions came to
const groupCapped = defineMessage<{ raw: string; cap: string }>()({
  id: 'assessment/result/group-capped',
  defaultMessage: 'Adds up to {raw}, held to the group limit {cap}',
})

const groupFloored = defineMessage<{ raw: string; floor: string }>()({
  id: 'assessment/result/group-floored',
  defaultMessage: 'Adds up to {raw}, lifted to the group minimum {floor}',
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
    flowTitle: { id: 'assessment/flow/title', defaultMessage: 'How this round runs' },
    flowFrom,
    flowUntil,
    viewFullFlow: { id: 'assessment/flow/view', defaultMessage: 'See the whole flow' },
    flowBackToCurrent: {
      id: 'assessment/flow/back-to-current',
      defaultMessage: 'Back to the stage in hand',
    },
    // a stage with no time still says something about its time: an empty
    // line reads as a screen that failed to load one
    flowPending: { id: 'assessment/flow/pending', defaultMessage: 'Time to be decided' },
    flowEndPending: { id: 'assessment/flow/end-pending', defaultMessage: 'End to be decided' },
    flowEarlier,
    flowFromPending,
    // said on every stage: a rail of dates leaves the reader counting which
    // of them is behind and which is still to come
    flowStatusEnded: { id: 'assessment/flow/status-ended', defaultMessage: 'Over' },
    flowStatusCurrent: { id: 'assessment/flow/status-current', defaultMessage: 'Under way' },
    flowStatusFuture: { id: 'assessment/flow/status-future', defaultMessage: 'To come' },
    bareDays,
    bareHours,
    bareMinutes,
    bareSeconds,
    bareSinceDays,
    bareSinceHours,
    bareSinceMinutes,
    bareSinceSeconds,
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
    // ------------------------------------------------------------------
    // one's own filings
    navGroupPersonal: { id: 'assessment/nav-group/personal', defaultMessage: 'My part' },
    navGroupWork: { id: 'assessment/nav-group/work', defaultMessage: 'Handling' },
    myEntriesTab: { id: 'assessment/entry/tab', defaultMessage: 'My entries' },
    myEntriesHint: {
      id: 'assessment/entry/hint',
      defaultMessage: 'File your claims here, and follow what happens to each one.',
    },
    myEntriesEmpty: {
      id: 'assessment/entry/empty',
      defaultMessage: 'Nothing to file yet. Questions appear here once the round opens them.',
    },
    itemVoided: {
      id: 'assessment/entry/item-voided',
      defaultMessage: 'This question was withdrawn and no longer counts.',
    },
    entryNew: { id: 'assessment/entry/new', defaultMessage: 'File a claim' },
    entryEdit: { id: 'assessment/entry/edit', defaultMessage: 'Edit' },
    entrySubmit: { id: 'assessment/entry/submit', defaultMessage: 'Submit' },
    entryWithdraw: { id: 'assessment/entry/withdraw', defaultMessage: 'Withdraw' },
    entrySave: { id: 'assessment/entry/save', defaultMessage: 'Save' },
    entryHistoryOpen: { id: 'assessment/entry/history-open', defaultMessage: 'History' },
    entryIssueRequired: {
      id: 'assessment/entry/issue-required',
      defaultMessage: 'needs an answer',
    },
    entryIssueOutOfRange: {
      id: 'assessment/entry/issue-out-of-range',
      defaultMessage: 'is outside the dates this round counts',
    },
    entryIssueNotADate: {
      id: 'assessment/entry/issue-not-a-date',
      defaultMessage: 'is not a date',
    },
    entryIssueTooLong: { id: 'assessment/entry/issue-too-long', defaultMessage: 'is too long' },
    entryIssueTooMany: {
      id: 'assessment/entry/issue-too-many',
      defaultMessage: 'has more files than allowed',
    },
    entryIssueFileTooLarge: {
      id: 'assessment/entry/issue-file-too-large',
      defaultMessage: 'has a file over the size limit',
    },
    entryIssueFileType: {
      id: 'assessment/entry/issue-file-type',
      defaultMessage: 'has a file of a kind this question does not take',
    },
    entryIssueFileMissing: {
      id: 'assessment/entry/issue-file-missing',
      defaultMessage: 'names a file that is no longer there',
    },
    entryIssueFileNotYours: {
      id: 'assessment/entry/issue-file-not-yours',
      defaultMessage: 'names a file somebody else uploaded',
    },
    entryIssueFileElsewhere: {
      id: 'assessment/entry/issue-file-elsewhere',
      defaultMessage: 'names a file already used by another entry',
    },
    entryIssueOther: { id: 'assessment/entry/issue-other', defaultMessage: 'cannot be accepted' },
    refuseNotYours: {
      id: 'assessment/entry/refuse-not-yours',
      defaultMessage: 'This entry is not yours to change.',
    },
    refuseNotActive: {
      id: 'assessment/entry/refuse-not-active',
      defaultMessage: 'You are no longer taking part in this round.',
    },
    refuseOutOfReach: {
      id: 'assessment/entry/refuse-out-of-reach',
      defaultMessage: 'This participant is outside the units you look after.',
    },
    refuseNotEditable: {
      id: 'assessment/entry/refuse-not-editable',
      defaultMessage: 'It is being reviewed. Withdraw it first to change it.',
    },
    refuseNotSubmittable: {
      id: 'assessment/entry/refuse-not-submittable',
      defaultMessage: 'Only a draft can be submitted.',
    },
    refuseNotWithdrawable: {
      id: 'assessment/entry/refuse-not-withdrawable',
      defaultMessage: 'It has already been decided and cannot be withdrawn.',
    },
    refuseMaxEntries: {
      id: 'assessment/entry/refuse-max-entries',
      defaultMessage: 'You have already filed as many as this question allows.',
    },
    refuseItemVoided: {
      id: 'assessment/entry/refuse-item-voided',
      defaultMessage: 'This question is no longer open.',
    },
    refuseItemUnconfigured: {
      id: 'assessment/entry/refuse-item-unconfigured',
      defaultMessage: 'This question is not fully set up yet. Tell whoever runs the round.',
    },
    refuseReviewLevelMissing: {
      id: 'assessment/entry/refuse-review-level-missing',
      defaultMessage:
        'This question is reviewed at a level you do not sit under, so it cannot be submitted. Tell whoever runs the round.',
    },
    refuseBasisRequired: {
      id: 'assessment/entry/refuse-basis-required',
      defaultMessage: 'A recorded fact needs its basis.',
    },
    refuseNotParticipant: {
      id: 'assessment/entry/refuse-not-participant',
      defaultMessage: 'You are not taking part in this round.',
    },
    refuseNoPermission: {
      id: 'assessment/entry/refuse-no-permission',
      defaultMessage: 'You are not allowed to do this in this round.',
    },
    refuseNotReviewer: {
      id: 'assessment/entry/refuse-not-reviewer',
      defaultMessage: 'You are not a reviewer for this submission.',
    },
    refusePhaseClosed: {
      id: 'assessment/entry/refuse-phase-closed',
      defaultMessage: 'The round is not open for this right now.',
    },
    refuseOutOfScope: {
      id: 'assessment/entry/refuse-out-of-scope',
      defaultMessage: 'The current stage does not cover this question or this person.',
    },
    refuseOther: {
      id: 'assessment/entry/refuse-other',
      defaultMessage: 'This cannot be done to the entry right now.',
    },
    entryNote: { id: 'assessment/entry/note', defaultMessage: 'Note' },
    entryStatusDraft: { id: 'assessment/entry/status-draft', defaultMessage: 'Draft' },
    entryStatusInReview: { id: 'assessment/entry/status-in-review', defaultMessage: 'In review' },
    entryStatusApproved: { id: 'assessment/entry/status-approved', defaultMessage: 'Approved' },
    entryStatusRejected: { id: 'assessment/entry/status-rejected', defaultMessage: 'Sent back' },
    entryStatusVoided: { id: 'assessment/entry/status-voided', defaultMessage: 'Void' },
    entryFilePick: { id: 'assessment/entry/file-pick', defaultMessage: 'Add a file' },
    entryFileUploading: { id: 'assessment/entry/file-uploading', defaultMessage: 'Uploading…' },
    entryFileRemove: { id: 'assessment/entry/file-remove', defaultMessage: 'Remove' },
    entryFileFailed: {
      id: 'assessment/entry/file-failed',
      defaultMessage: 'The upload did not finish. Try the file again.',
    },
    entryFieldCleared: { id: 'assessment/entry/field-cleared', defaultMessage: 'left empty' },
    entryFileUnnamed: { id: 'assessment/entry/file-unnamed', defaultMessage: 'Attached file' },
    entryHistoryTitle: {
      id: 'assessment/entry/history-title',
      defaultMessage: 'The whole account',
    },
    entryHistoryRound: { id: 'assessment/entry/history-round', defaultMessage: 'Round {round}' },
    entryHistoryRevision: {
      id: 'assessment/entry/history-revision',
      defaultMessage: 'Version {no}',
    },
    entrySuggestionTitle: {
      id: 'assessment/entry/suggestion-title',
      defaultMessage: 'What the reviewer suggested',
    },
    entrySuggestionHint: {
      id: 'assessment/entry/suggestion-hint',
      defaultMessage: 'For reference only. Edit your own entry and submit it again.',
    },
    // ------------------------------------------------------------------
    // the review queue
    reviewNoStanding: {
      id: 'assessment/review/no-standing',
      defaultMessage: 'You have no reviewing role in this round.',
    },
    recordNoStanding: {
      id: 'assessment/record/no-standing',
      defaultMessage: 'You have no recording authority in this round.',
    },
    reviewTab: { id: 'assessment/review/tab', defaultMessage: 'Review work' },
    reviewHint: {
      id: 'assessment/review/hint',
      defaultMessage: 'Submissions waiting for your decision, oldest first.',
    },
    reviewEmpty: { id: 'assessment/review/empty', defaultMessage: 'Nothing waiting for you.' },
    reviewColumnItem: { id: 'assessment/review/column-item', defaultMessage: 'Question' },
    reviewColumnWho: { id: 'assessment/review/column-who', defaultMessage: 'From' },
    reviewColumnWhen: { id: 'assessment/review/column-when', defaultMessage: 'Submitted' },
    reviewApplicant: { id: 'assessment/review/applicant', defaultMessage: 'Applicant' },
    reviewRound: { id: 'assessment/review/round', defaultMessage: 'Round' },
    reviewSubmittedAt: { id: 'assessment/review/submitted-at', defaultMessage: 'Submitted' },
    reviewTrail: { id: 'assessment/review/trail', defaultMessage: 'What has happened' },
    entryCountsFor: {
      id: 'assessment/entry/counts-for',
      defaultMessage: 'Counts {value} when approved',
    },
    entryUpdatedAt: { id: 'assessment/entry/updated-at', defaultMessage: 'Filed {when}' },
    reviewOpen: { id: 'assessment/review/open', defaultMessage: 'Open' },
    reviewDetailTab: { id: 'assessment/review/detail-tab', defaultMessage: 'Review' },
    reviewApprove: { id: 'assessment/review/approve', defaultMessage: 'Approve' },
    reviewReject: { id: 'assessment/review/reject', defaultMessage: 'Send back' },
    reviewRejectTitle: {
      id: 'assessment/review/reject-title',
      defaultMessage: 'Send this back',
    },
    reviewComment: { id: 'assessment/review/comment', defaultMessage: 'A word for the student' },
    reviewCommentHint: {
      id: 'assessment/review/comment-hint',
      defaultMessage: 'Say what to fix. This is required when sending back.',
    },
    reviewSuggestToggle: {
      id: 'assessment/review/suggest-toggle',
      defaultMessage: 'Attach a suggested version',
    },
    eventSubmitted: { id: 'assessment/event/submitted', defaultMessage: '{who} submitted it' },
    eventApproved: { id: 'assessment/event/approved', defaultMessage: '{who} approved this step' },
    eventRejected: { id: 'assessment/event/rejected', defaultMessage: '{who} sent it back' },
    eventEscalated: {
      id: 'assessment/event/escalated',
      defaultMessage: '{who} sent it up as a doubt',
    },
    eventComment: { id: 'assessment/event/comment', defaultMessage: '{who} left a note' },
    eventRecommendApprove: {
      id: 'assessment/event/recommend-approve',
      defaultMessage: '{who} advised approving it',
    },
    eventRecommendReject: {
      id: 'assessment/event/recommend-reject',
      defaultMessage: '{who} advised sending it back',
    },
    eventWithdrawn: { id: 'assessment/event/withdrawn', defaultMessage: '{who} withdrew it' },
    eventNoReviewer: {
      id: 'assessment/event/no-reviewer',
      defaultMessage: 'No reviewer at this step yet; waiting',
    },
    eventReviewerFound: {
      id: 'assessment/event/reviewer-found',
      defaultMessage: 'A reviewer is available again; the review continues',
    },
    eventItemVoided: {
      id: 'assessment/event/item-voided',
      defaultMessage: 'The question was withdrawn, so this review ended',
    },
    eventOther: { id: 'assessment/event/other', defaultMessage: 'Something happened here' },
    eventSomebody: { id: 'assessment/event/somebody', defaultMessage: 'Somebody' },
    outcomeApproved: { id: 'assessment/outcome/approved', defaultMessage: 'Approved' },
    outcomeRejected: { id: 'assessment/outcome/rejected', defaultMessage: 'Sent back' },
    outcomeCancelled: { id: 'assessment/outcome/cancelled', defaultMessage: 'Ended' },
    outcomeOther: { id: 'assessment/outcome/other', defaultMessage: 'Closed' },
    reviewStageReviewers: { id: 'assessment/review/stage-reviewers', defaultMessage: 'Now: {who}' },
    reviewStageNobody: {
      id: 'assessment/review/stage-nobody',
      defaultMessage: 'Nobody can review here yet',
    },
    reviewSaid: { id: 'assessment/review/said', defaultMessage: 'Noted on this review.' },
    reviewStageNoHolder: {
      id: 'assessment/review/stage-no-holder',
      defaultMessage: 'Skipped: nobody above this participant holds that role',
    },
    reviewDecided: { id: 'assessment/review/decided', defaultMessage: 'Decision recorded.' },
    reviewClosedAlready: {
      id: 'assessment/review/closed-already',
      defaultMessage: 'This round was already closed by someone else.',
    },
    reviewSubmittedBy: {
      id: 'assessment/review/submitted-by',
      defaultMessage: '{name} · round {round}',
    },
    reviewPayloadTitle: { id: 'assessment/review/payload-title', defaultMessage: 'What was filed' },
    reviewFiles: { id: 'assessment/review/files', defaultMessage: 'Files' },
    reviewDownload: { id: 'assessment/review/download', defaultMessage: 'Download' },
    // ------------------------------------------------------------------
    // one's own provisional standing
    resultTab: { id: 'assessment/result/tab', defaultMessage: 'My standing' },
    resultHint: {
      id: 'assessment/result/hint',
      defaultMessage: 'Where your approved claims put you right now. Nothing here is final.',
    },
    resultProvisional: {
      id: 'assessment/result/provisional',
      defaultMessage: 'Provisional',
    },
    resultTotal: { id: 'assessment/result/total', defaultMessage: 'Total' },
    resultGroupItems: { id: 'assessment/result/group-items', defaultMessage: 'From questions' },
    resultGroupChildren: {
      id: 'assessment/result/group-children',
      defaultMessage: 'From groups inside',
    },
    resultGroupFinal: { id: 'assessment/result/group-final', defaultMessage: 'Counted' },
    resultGroupCapped: groupCapped,
    resultGroupFloored: groupFloored,
    resultLineExcluded: {
      id: 'assessment/result/line-excluded',
      defaultMessage: 'Sent back · not counted',
    },
    resultLineVoided: {
      id: 'assessment/result/line-voided',
      defaultMessage: 'Question withdrawn · not counted',
    },
    resultLineAdjustment: {
      id: 'assessment/result/line-adjustment',
      defaultMessage: 'Group limit',
    },
    resultEmpty: {
      id: 'assessment/result/empty',
      defaultMessage: 'Nothing counts yet. Approved claims appear here.',
    },
    // ------------------------------------------------------------------
    // recording on someone's behalf
    recordTab: { id: 'assessment/record/tab', defaultMessage: 'Record for someone' },
    recordHint: {
      id: 'assessment/record/hint',
      defaultMessage:
        'File an administrative fact about a participant. It takes effect at once, with its basis.',
    },
    recordEmpty: {
      id: 'assessment/record/empty',
      defaultMessage: 'No administrative questions in this round.',
    },
    recordWho: { id: 'assessment/record/who', defaultMessage: 'About whom' },
    recordWhoPlaceholder: {
      id: 'assessment/record/who-placeholder',
      defaultMessage: 'Search the roster by name',
    },
    recordBasis: { id: 'assessment/record/basis', defaultMessage: 'Basis' },
    recordBasisHint: {
      id: 'assessment/record/basis-hint',
      defaultMessage: 'The document this fact rests on, e.g. a file number. Required.',
    },
    recordSubmit: { id: 'assessment/record/submit', defaultMessage: 'Record it' },
    recordDone: { id: 'assessment/record/done', defaultMessage: 'Recorded.' },
    // ------------------------------------------------------------------
    // configuring the questions
    itemsTab: { id: 'assessment/items/tab', defaultMessage: 'Questions' },
    itemsHint: {
      id: 'assessment/items/hint',
      defaultMessage:
        'Arrange this round\u2019s groups and questions, and set how each question is filed and reviewed.',
    },
    itemsStuckTitle: {
      id: 'assessment/items/stuck-title',
      defaultMessage: 'These steps have no reviewer',
    },
    itemsStuckRow: {
      id: 'assessment/items/stuck-row',
      defaultMessage:
        '{unit} · {roles} · {count, plural, one {# submission waiting} other {# submissions waiting}}',
    },
    itemsStuckHint: {
      id: 'assessment/items/stuck-hint',
      defaultMessage: 'Grant one of these roles at the unit and the submissions continue.',
    },
    itemsOutlineOrphans: {
      id: 'assessment/items/outline-orphans',
      defaultMessage: 'Group deleted',
    },
    itemsOutlineAddItem: {
      id: 'assessment/items/outline-add-item',
      defaultMessage: 'Add question',
    },
    itemsOutlineAddGroup: {
      id: 'assessment/items/outline-add-group',
      defaultMessage: 'Add subgroup',
    },
    itemsCapChip: { id: 'assessment/items/cap-chip', defaultMessage: 'up to {value} pts' },
    itemsSheetEmpty: {
      id: 'assessment/items/sheet-empty',
      defaultMessage: 'No groups yet. Add one, then write questions into it.',
    },
    itemsChipRecorded: { id: 'assessment/items/chip-recorded', defaultMessage: 'recorded' },
    itemsGroupUnnamed: { id: 'assessment/items/group-unnamed', defaultMessage: 'Untitled group' },
    itemsGroupInside: {
      id: 'assessment/items/group-inside',
      defaultMessage: 'Inside \u201c{parent}\u201d',
    },
    itemsGroupEditing: { id: 'assessment/items/group-editing', defaultMessage: 'Group settings' },
    itemsGroupCapHint: {
      id: 'assessment/items/group-cap-hint',
      defaultMessage: 'Leave empty for no ceiling.',
    },
    itemsGroupFloorHint: {
      id: 'assessment/items/group-floor-hint',
      defaultMessage: 'Leave empty for no floor.',
    },
    itemsGroupName: { id: 'assessment/items/group-name', defaultMessage: 'Name' },
    itemsGroupCap: { id: 'assessment/items/group-cap', defaultMessage: 'Cap' },
    itemsGroupFloor: { id: 'assessment/items/group-floor', defaultMessage: 'Floor' },
    itemsGroupRemove: { id: 'assessment/items/group-remove', defaultMessage: 'Remove' },
    itemsGroupsReasonHint: {
      id: 'assessment/items/groups-reason-hint',
      defaultMessage: 'The round is running; changes need a reason.',
    },
    itemsGroupRefusedHasItems: {
      id: 'assessment/items/group-refused-has-items',
      defaultMessage: 'still has questions in it, so it cannot be removed.',
    },
    itemsGroupRefusedHasChildren: {
      id: 'assessment/items/group-refused-has-children',
      defaultMessage: 'still has groups inside it, so it cannot be removed.',
    },
    itemsGroupRefusedFloorAboveCap: {
      id: 'assessment/items/group-refused-floor-above-cap',
      defaultMessage: 'has a floor above its ceiling.',
    },
    itemsGroupRefusedReason: {
      id: 'assessment/items/group-refused-reason',
      defaultMessage: 'A ceiling changed in a running round. Say why below.',
    },
    itemsGroupRefusedParent: {
      id: 'assessment/items/group-refused-parent',
      defaultMessage: 'cannot sit where it was put.',
    },
    itemsGroupRefusedNotFound: {
      id: 'assessment/items/group-refused-not-found',
      defaultMessage: 'is no longer in this round. Refresh to see the current groups.',
    },
    itemsGroupRefusedOther: {
      id: 'assessment/items/group-refused-other',
      defaultMessage: 'could not be saved.',
    },
    itemsGroupAdd: { id: 'assessment/items/group-add', defaultMessage: 'Add a group' },
    itemsGroupsSave: { id: 'assessment/items/groups-save', defaultMessage: 'Save groups' },
    itemsGroupsSaved: { id: 'assessment/items/groups-saved', defaultMessage: 'Groups saved.' },
    itemsListTitle: { id: 'assessment/items/list-title', defaultMessage: 'Questions' },
    itemsEditTitle: { id: 'assessment/items/edit-title', defaultMessage: 'Question' },
    itemsFieldTitle: { id: 'assessment/items/field-title', defaultMessage: 'Title' },
    itemsFieldGroup: { id: 'assessment/items/field-group', defaultMessage: 'Score group' },
    itemsFieldMax: {
      id: 'assessment/items/field-max',
      defaultMessage: 'Entries per person',
    },
    itemsFieldEntrySource: {
      id: 'assessment/items/field-entry-source',
      defaultMessage: 'Who files it',
    },
    itemsEntrySourceStudent: {
      id: 'assessment/items/entry-source-student',
      defaultMessage: 'Participants file it themselves',
    },
    itemsEntrySourceAdministrative: {
      id: 'assessment/items/entry-source-administrative',
      defaultMessage: 'Staff record it, with a basis',
    },
    itemsFieldAdd: { id: 'assessment/items/form-add', defaultMessage: 'Add a field' },
    itemsFieldRemove: { id: 'assessment/items/form-remove', defaultMessage: 'Remove' },
    itemsFieldUp: { id: 'assessment/items/form-up', defaultMessage: 'Move up' },
    itemsFieldDown: { id: 'assessment/items/form-down', defaultMessage: 'Move down' },
    itemsFieldLabel: { id: 'assessment/items/field-label', defaultMessage: 'Label' },
    itemsFieldType: { id: 'assessment/items/field-type', defaultMessage: 'Type' },
    itemsTypeText: { id: 'assessment/items/type-text', defaultMessage: 'Text' },
    itemsTypeDate: { id: 'assessment/items/type-date', defaultMessage: 'Date' },
    itemsTypeAttachment: { id: 'assessment/items/type-attachment', defaultMessage: 'File' },
    itemsFieldRequired: { id: 'assessment/items/field-required', defaultMessage: 'Required' },
    itemsFieldMaxLength: {
      id: 'assessment/items/field-max-length',
      defaultMessage: 'Longest text',
    },
    itemsFieldMinDate: { id: 'assessment/items/field-min-date', defaultMessage: 'Earliest date' },
    itemsDateWindow: {
      id: 'assessment/items/date-window',
      defaultMessage: 'This round only counts material from {from} to {until}.',
    },
    itemsFieldMaxDate: { id: 'assessment/items/field-max-date', defaultMessage: 'Latest date' },
    itemsFieldMaxCount: { id: 'assessment/items/field-max-count', defaultMessage: 'Most files' },
    itemsFieldMaxSize: {
      id: 'assessment/items/field-max-size',
      defaultMessage: 'Largest file (MB)',
    },
    itemsFieldAccept: {
      id: 'assessment/items/field-accept',
      defaultMessage: 'Accepted kinds',
    },
    itemsFieldAcceptHint: {
      id: 'assessment/items/field-accept-hint',
      defaultMessage: 'Comma-separated, like .pdf, image/*. Empty accepts anything.',
    },
    itemsFixedValue: {
      id: 'assessment/items/fixed-value',
      defaultMessage: 'Each approved entry counts',
    },
    itemsFixedValueHint: {
      id: 'assessment/items/fixed-value-hint',
      defaultMessage: 'A signed amount, like 3.00 or -1.00.',
    },
    itemsDoubtTitle: {
      id: 'assessment/items/doubt-title',
      defaultMessage: 'If sent up as a doubt',
    },
    itemsDoubtHint: {
      id: 'assessment/items/doubt-hint',
      defaultMessage: 'Entered when a reviewer raises a doubt; the last step decides.',
    },
    itemsDoubtEmpty: {
      id: 'assessment/items/doubt-empty',
      defaultMessage: 'Without steps, reviewers cannot raise a doubt here.',
    },
    itemsStageAdd: { id: 'assessment/items/stage-add', defaultMessage: 'Add a step' },
    itemsStageRemove: { id: 'assessment/items/stage-remove', defaultMessage: 'Remove step' },
    itemsStageNumber: { id: 'assessment/items/stage-number', defaultMessage: 'Step {n}' },
    itemsStageKind: {
      id: 'assessment/items/stage-kind',
      defaultMessage: 'How the reviewer is found',
    },
    itemsStageRoleAt: {
      id: 'assessment/items/stage-role-at',
      defaultMessage: 'At a chosen level',
    },
    itemsStageNearestRole: {
      id: 'assessment/items/stage-nearest-role',
      defaultMessage: 'Nearest holder, walking up',
    },
    itemsStageNearestHint: {
      id: 'assessment/items/stage-nearest-hint',
      defaultMessage: 'Walks up from the participant\u2019s unit to the nearest holder.',
    },
    itemsStageRole: { id: 'assessment/items/stage-role', defaultMessage: 'Role' },
    itemsTerminalHere: {
      id: 'assessment/items/terminal-here',
      defaultMessage: 'Done on approval',
    },
    itemsStageDoubt: {
      id: 'assessment/items/stage-doubt',
      defaultMessage: 'Only reached by escalation',
    },
    reviewChainTitle: { id: 'assessment/review/chain-title', defaultMessage: 'The chain' },
    reviewStageHere: { id: 'assessment/review/stage-here', defaultMessage: 'Now here' },
    reviewStageSkipped: {
      id: 'assessment/review/stage-skipped',
      defaultMessage: 'Skipped: no such unit above this participant',
    },
    reviewEscalate: { id: 'assessment/review/escalate', defaultMessage: 'Send up as a doubt' },
    reviewCommentAction: {
      id: 'assessment/review/comment-action',
      defaultMessage: 'Leave a note',
    },
    reviewRecommendApprove: {
      id: 'assessment/review/recommend-approve',
      defaultMessage: 'Advise approval',
    },
    reviewRecommendReject: {
      id: 'assessment/review/recommend-reject',
      defaultMessage: 'Advise sending back',
    },
    reviewSayTitle: { id: 'assessment/review/say-title', defaultMessage: 'What to say' },
    reviewEscalatedHere: {
      id: 'assessment/review/escalated-here',
      defaultMessage: 'A doubt is on its way up; the end of the chain decides.',
    },
    itemsReviewTitle: {
      id: 'assessment/items/review-title',
      defaultMessage: 'Ordinary review',
    },
    itemsTabBasics: { id: 'assessment/items/tab-basics', defaultMessage: 'Basics' },
    itemsTabFields: { id: 'assessment/items/tab-fields', defaultMessage: 'Form fields' },
    itemsTabScoring: { id: 'assessment/items/tab-scoring', defaultMessage: 'Scoring' },
    itemsTabReview: { id: 'assessment/items/tab-review', defaultMessage: 'Review chain' },
    itemsFieldDescription: {
      id: 'assessment/items/field-description',
      defaultMessage: 'Filing instructions',
    },
    itemsFieldDescriptionHint: {
      id: 'assessment/items/field-description-hint',
      defaultMessage: 'Shown under the question when filing.',
    },
    itemsFieldMaxUnlimited: {
      id: 'assessment/items/field-max-unlimited',
      defaultMessage: 'Empty for no limit',
    },
    itemsFlowSubmit: { id: 'assessment/items/flow-submit', defaultMessage: 'Submitted' },
    itemsFlowSubmitBy: {
      id: 'assessment/items/flow-submit-by',
      defaultMessage: 'by the participant',
    },
    itemsFlowDone: { id: 'assessment/items/flow-done', defaultMessage: 'Review complete' },
    itemsFlowDoneSub: {
      id: 'assessment/items/flow-done-sub',
      defaultMessage: 'approved entries count',
    },
    itemsStageExpand: { id: 'assessment/items/stage-expand', defaultMessage: 'Edit' },
    itemsStageLevelShort: { id: 'assessment/items/stage-level-short', defaultMessage: 'Level' },
    itemsStageRolesShort: { id: 'assessment/items/stage-roles-short', defaultMessage: 'Roles' },
    itemsStageKindShort: { id: 'assessment/items/stage-kind-short', defaultMessage: 'How' },
    itemsStageWalkUp: { id: 'assessment/items/stage-walk-up', defaultMessage: 'Walks up' },
    itemsPickTarget: {
      id: 'assessment/items/pick-something',
      defaultMessage: 'Pick a group or question on the left to edit.',
    },
    itemsTreeSummary: {
      id: 'assessment/items/tree-summary',
      defaultMessage: '{count, plural, one {# question} other {# questions}}, {sum} pts in all',
    },
    itemsTreeSummaryNoCap: {
      id: 'assessment/items/tree-summary-no-cap',
      defaultMessage: '{count, plural, one {# question} other {# questions}}',
    },
    itemsTreeTitle: { id: 'assessment/items/tree-title', defaultMessage: 'Structure' },
    itemsPreviewTitle: {
      id: 'assessment/items/preview-title',
      defaultMessage: 'Participant view',
    },
    itemsPreviewLive: {
      id: 'assessment/items/preview-live',
      defaultMessage: 'Follows this draft',
    },
    itemsPreviewChain: {
      id: 'assessment/items/preview-chain',
      defaultMessage: 'After submitting, it passes',
    },
    itemsPreviewMax: {
      id: 'assessment/items/preview-max',
      defaultMessage: '{count, plural, one {At most # entry} other {At most # entries}}',
    },
    itemsPreviewNoMax: {
      id: 'assessment/items/preview-no-max',
      defaultMessage: 'No entry limit',
    },
    itemsPreviewValue: {
      id: 'assessment/items/preview-value',
      defaultMessage: '{value} pts on approval',
    },
    itemsPreviewUpload: {
      id: 'assessment/items/preview-upload',
      defaultMessage: '{count, plural, one {Up to # file} other {Up to # files}}',
    },
    itemsUntitled: { id: 'assessment/items/untitled', defaultMessage: 'Untitled question' },
    itemsDefaultFieldLabel: {
      id: 'assessment/items/default-field-label',
      defaultMessage: 'Details',
    },
    itemsReviewCovered: {
      id: 'assessment/items/review-covered',
      defaultMessage:
        '{count, plural, one {The one unit at this level has someone who can review} other {All # units at this level have someone who can review}}',
    },
    itemsReviewUncovered: {
      id: 'assessment/items/review-uncovered',
      defaultMessage:
        'Nobody can review at {names}. Give somebody one of these roles at those units - submissions from their participants wait until you do.',
    },
    itemsReviewNoUnits: {
      id: 'assessment/items/review-no-units',
      defaultMessage:
        'Nobody in this round sits under a unit of this kind, so nothing can be reviewed here.',
    },
    itemsReviewLevel: {
      id: 'assessment/items/review-level',
      defaultMessage: 'Reviewed at which level',
    },
    itemsReviewRoles: { id: 'assessment/items/review-roles', defaultMessage: 'Reviewed by whom' },
    itemsReviewRolesHint: {
      id: 'assessment/items/review-roles-hint',
      defaultMessage: 'People holding one of these roles at that exact unit.',
    },
    itemsFormEmpty: {
      id: 'assessment/items/form-empty',
      defaultMessage: 'No fields yet. A question needs at least one.',
    },
    itemsFieldConfig: { id: 'assessment/items/field-config', defaultMessage: 'Configuration' },
    itemsFieldConfigHint: {
      id: 'assessment/items/field-config-hint',
      defaultMessage: 'The full configuration, as JSON: form, scoring and review chain.',
    },
    itemsFieldReason: { id: 'assessment/items/field-reason', defaultMessage: 'Reason' },
    itemsConfigUnreadable: {
      id: 'assessment/items/config-unreadable',
      defaultMessage: 'That is not readable JSON yet.',
    },
    itemsSaved: { id: 'assessment/items/saved', defaultMessage: 'Question saved.' },
    itemsVoid: { id: 'assessment/items/void', defaultMessage: 'Withdraw' },
    itemsVoidTitle: { id: 'assessment/items/void-title', defaultMessage: 'Withdraw this question' },
    itemsVoidHint: {
      id: 'assessment/items/void-hint',
      defaultMessage:
        'Open entries end here; decided ones keep their outcome. Say why - everyone affected reads it.',
    },
    itemsVoidReason: { id: 'assessment/items/void-reason', defaultMessage: 'Reason' },
    itemsRestore: { id: 'assessment/items/restore', defaultMessage: 'Reopen' },
    itemsDelete: { id: 'assessment/items/delete', defaultMessage: 'Delete' },
    itemsStatusVoided: { id: 'assessment/items/status-voided', defaultMessage: 'Withdrawn' },
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
    entryNoteLabel: { id: 'assessment/phase/entry-note', defaultMessage: 'Waiting on' },
    entryNoteHint: {
      id: 'assessment/phase/entry-note-hint',
      defaultMessage: 'Shown to everybody until this stage has a time.',
    },
    entryNotePlaceholder: {
      id: 'assessment/phase/entry-note-placeholder',
      defaultMessage: 'e.g. the college has to approve the list first',
    },
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
      defaultMessage: 'Start new entries against the questions open in this batch.',
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
    // still spoken of on the phase editor: the gate opens and closes it by
    // name whoever it belongs to, and it belongs to the participant (§32.14)
    'permission-hint.assessment.entry.resubmit': {
      id: 'assessment/permission-hint/entry-resubmit',
      defaultMessage: 'Ask for a settled entry to be looked at again.',
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
      defaultMessage: 'Ask for another look',
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
      defaultMessage: 'A reusable template cannot point at one batch’s questions or people.',
    },
    'refusal.participant-not-in-batch': {
      id: 'assessment/refusal/participant-not-in-batch',
      defaultMessage: 'One of the selected people is not a participant of this batch.',
    },
    'refusal.item-not-in-batch': {
      id: 'assessment/refusal/item-not-in-batch',
      defaultMessage: 'One of the selected questions does not belong to this batch.',
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
    ASSESSMENT_MATERIAL_RANGE_INVALID: {
      id: 'assessment/error/material-range-invalid',
      defaultMessage:
        'The new material window would leave existing entries outside it. Deal with those entries first.',
    },
    ASSESSMENT_ENTRY_NOT_FOUND: {
      id: 'assessment/error/entry-not-found',
      defaultMessage: 'This entry no longer exists.',
    },
    ASSESSMENT_ENTRY_ACTION_REFUSED: {
      id: 'assessment/error/entry-action-refused',
      defaultMessage: 'This cannot be done to the entry right now.',
    },
    ASSESSMENT_ENTRY_PAYLOAD_INVALID: {
      id: 'assessment/error/entry-payload-invalid',
      defaultMessage: 'The filing could not be saved. Fix the fields listed and try again.',
    },
    ASSESSMENT_ITEM_ACTION_REFUSED: {
      id: 'assessment/error/item-action-refused',
      defaultMessage: 'This cannot be done to the question right now.',
    },
    ASSESSMENT_ATTACHMENT_NOT_FOUND: {
      id: 'assessment/error/attachment-not-found',
      defaultMessage: 'This file no longer exists.',
    },
    ASSESSMENT_REVIEW_NOT_FOUND: {
      id: 'assessment/error/review-not-found',
      defaultMessage: 'This review no longer exists.',
    },
    ASSESSMENT_REVIEW_CONFLICT: {
      id: 'assessment/error/review-conflict',
      defaultMessage: 'This round was already closed by someone else. Refresh to see the outcome.',
    },
    ASSESSMENT_ITEM_NOT_FOUND: {
      id: 'assessment/error/item-not-found',
      defaultMessage: 'This question no longer exists.',
    },
    ASSESSMENT_ITEM_CONFIG_INVALID: {
      id: 'assessment/error/item-config-invalid',
      defaultMessage: 'Could not save the question. Fix the problems listed and try again.',
    },
    ASSESSMENT_SCORE_GROUP_INVALID: {
      id: 'assessment/error/score-group-invalid',
      defaultMessage: 'Could not save the score groups. Fix the problems listed and try again.',
    },
    ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT: {
      id: 'assessment/error/score-group-version-conflict',
      defaultMessage:
        'Someone else changed the score groups while you were editing. Refresh and make your change again.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
