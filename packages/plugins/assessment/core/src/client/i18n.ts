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
  defaultMessage: 'Adds up to {raw}, lifted to the group lower limit {floor}',
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
      defaultMessage: 'Where this batch stands, and what is waiting on you.',
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
      defaultMessage: 'Your claims, and where each one has got to.',
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
    entryAppeal: { id: 'assessment/entry/appeal', defaultMessage: 'Appeal' },
    entryAppealTitle: {
      id: 'assessment/entry/appeal-title',
      defaultMessage: 'Appeal this decision',
    },
    entryAppealHint: {
      id: 'assessment/entry/appeal-hint',
      defaultMessage: 'The material stays as it is. To change it, edit and submit again instead.',
    },
    entryAppealReason: {
      id: 'assessment/entry/appeal-reason',
      defaultMessage: 'Why the decision is wrong',
    },
    entryAppealed: { id: 'assessment/entry/appealed', defaultMessage: 'Appeal submitted.' },
    refuseNothingToAppeal: {
      id: 'assessment/entry/refuse-nothing-to-appeal',
      defaultMessage: 'There is no decision here to appeal.',
    },
    refuseReviewOpen: {
      id: 'assessment/entry/refuse-review-open',
      defaultMessage: 'This is being reviewed. Wait for the outcome.',
    },
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
    refuseNeedsRevision: {
      id: 'assessment/entry/refuse-needs-revision',
      defaultMessage: 'The form has changed since this draft. Fill in what it now asks for.',
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
      defaultMessage: 'A record needs its basis.',
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
    entryStatusRevising: {
      id: 'assessment/entry/status-revising',
      defaultMessage: 'To resubmit',
    },
    entryResubmit: { id: 'assessment/entry/resubmit', defaultMessage: 'Resubmit' },
    entryAbandon: { id: 'assessment/entry/abandon', defaultMessage: 'Give up this claim' },
    entryAbandonConfirm: {
      id: 'assessment/entry/abandon-confirm',
      defaultMessage: 'Give up this claim? Its place on the question opens up; the record stays.',
    },
    entryBlockedNow: {
      id: 'assessment/entry/blocked-now',
      defaultMessage: 'Not open right now.',
    },
    refuseNotAbandonable: {
      id: 'assessment/entry/refuse-not-abandonable',
      defaultMessage: 'Withdraw it from review first.',
    },
    entryStatusNeedsRevision: {
      id: 'assessment/entry/status-needs-revision',
      defaultMessage: 'More needed',
    },
    entryStatusApproved: { id: 'assessment/entry/status-approved', defaultMessage: 'Approved' },
    entryStatusRejected: { id: 'assessment/entry/status-rejected', defaultMessage: 'Sent back' },
    entryStatusVoided: { id: 'assessment/entry/status-voided', defaultMessage: 'Void' },
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
    entrySuggestionAdvisory: {
      id: 'assessment/entry/suggestion-advisory',
      defaultMessage: 'Advice',
    },
    // ------------------------------------------------------------------
    // the review queue
    recordNoStanding: {
      id: 'assessment/record/no-standing',
      defaultMessage: 'You have no recording authority in this round.',
    },
    reviewTab: { id: 'assessment/review/tab', defaultMessage: 'Review work' },
    reviewHint: {
      id: 'assessment/review/hint',
      defaultMessage: 'Submissions waiting for your decision, oldest first.',
    },
    reviewColumnItem: { id: 'assessment/review/column-item', defaultMessage: 'Question' },
    reviewColumnWho: { id: 'assessment/review/column-who', defaultMessage: 'From' },
    reviewColumnStatus: { id: 'assessment/review/column-status', defaultMessage: 'Standing' },
    reviewColumnWhen: { id: 'assessment/review/column-when', defaultMessage: 'Submitted' },
    reviewApplicant: { id: 'assessment/review/applicant', defaultMessage: 'Applicant' },
    reviewRound: { id: 'assessment/review/round', defaultMessage: 'Round' },
    reviewSubmittedAt: { id: 'assessment/review/submitted-at', defaultMessage: 'Submitted' },
    reviewTrail: { id: 'assessment/review/trail', defaultMessage: 'What has happened' },
    entryCountsFor: {
      id: 'assessment/entry/counts-for',
      defaultMessage: 'Counts {value} when approved',
    },
    reviewOpen: { id: 'assessment/review/open', defaultMessage: 'Open' },
    reviewDetailTab: { id: 'assessment/review/detail-tab', defaultMessage: 'Review' },
    reviewApprove: { id: 'assessment/review/approve', defaultMessage: 'Approve' },
    reviewReject: { id: 'assessment/review/reject', defaultMessage: 'Send back' },
    reviewComment: {
      id: 'assessment/review/comment',
      defaultMessage: 'A word for whoever filed it',
    },
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
    eventReturnedForRevision: {
      id: 'assessment/event/returned-for-revision',
      defaultMessage: '{who} sent it back for more',
    },
    eventForwarded: {
      id: 'assessment/event/forwarded',
      defaultMessage: '{who} passed it on',
    },
    eventEscalated: {
      id: 'assessment/event/escalated',
      defaultMessage: '{who} escalated it for review',
    },
    eventAppealed: {
      id: 'assessment/event/appealed',
      defaultMessage: '{who} contested the decision',
    },
    eventAbandoned: {
      id: 'assessment/event/abandoned',
      defaultMessage: '{who} gave the claim up',
    },
    eventRerouted: {
      id: 'assessment/event/rerouted',
      defaultMessage: 'The review route was changed by an administrator',
    },
    outcomeSuperseded: {
      id: 'assessment/outcome/superseded',
      defaultMessage: 'Continued in a later round',
    },
    originAppeal: { id: 'assessment/origin/appeal', defaultMessage: 'Appeal' },
    originReroute: {
      id: 'assessment/origin/reroute',
      defaultMessage: 'Continued after a route change',
    },
    originReopen: { id: 'assessment/origin/reopen', defaultMessage: 'Reopened' },
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
    reviewSubmittedBy: {
      id: 'assessment/review/submitted-by',
      defaultMessage: '{name} · round {round}',
    },
    reviewPayloadTitle: { id: 'assessment/review/payload-title', defaultMessage: 'What was filed' },
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
        'Record something about a participant. It needs a basis and takes effect at once.',
    },
    recordEmpty: {
      id: 'assessment/record/empty',
      defaultMessage: 'No administrative questions in this round.',
    },
    recordWho: { id: 'assessment/record/who', defaultMessage: 'About whom' },
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
    itemsOutlineAddItem: {
      id: 'assessment/items/outline-add-item',
      defaultMessage: 'Add question',
    },
    itemsOutlineAddGroup: {
      id: 'assessment/items/outline-add-group',
      defaultMessage: 'Add subgroup',
    },
    itemsCapChip: { id: 'assessment/items/cap-chip', defaultMessage: 'up to {value} pts' },
    itemsGroupUnnamed: { id: 'assessment/items/group-unnamed', defaultMessage: 'Untitled group' },
    itemsGroupNew: { id: 'assessment/items/group-new', defaultMessage: 'New group' },
    itemsGroupEditing: { id: 'assessment/items/group-editing', defaultMessage: 'Group settings' },
    itemsGroupCapHint: {
      id: 'assessment/items/group-cap-hint',
      defaultMessage: 'Leave empty for no upper limit.',
    },
    itemsGroupFloorHint: {
      id: 'assessment/items/group-floor-hint',
      defaultMessage: 'Leave empty for no lower limit.',
    },
    itemsGroupName: { id: 'assessment/items/group-name', defaultMessage: 'Name' },
    itemsGroupParent: { id: 'assessment/items/group-parent', defaultMessage: 'Sits inside' },
    itemsGroupParentHint: {
      id: 'assessment/items/group-parent-hint',
      defaultMessage: 'Move it by choosing another section.',
    },
    itemsGroupCap: { id: 'assessment/items/group-cap', defaultMessage: 'Upper limit' },
    itemsGroupFloor: { id: 'assessment/items/group-floor', defaultMessage: 'Lower limit' },
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
      defaultMessage: 'has a lower limit above its upper limit.',
    },
    itemsGroupRefusedReason: {
      id: 'assessment/items/group-refused-reason',
      defaultMessage: 'An upper limit changed in a running round. Say why below.',
    },
    itemsGroupRefusedParent: {
      id: 'assessment/items/group-refused-parent',
      defaultMessage: 'cannot sit where it was put.',
    },
    itemsGroupRefusedNotFound: {
      id: 'assessment/items/group-refused-not-found',
      defaultMessage: 'is no longer in this round. Refresh to see the current groups.',
    },
    itemsGroupRefusedOnePaper: {
      id: 'assessment/items/group-refused-one-paper',
      defaultMessage: 'must sit inside the round, which already has its outermost group.',
    },
    itemsGroupRefusedOther: {
      id: 'assessment/items/group-refused-other',
      defaultMessage: 'could not be saved.',
    },
    itemsGroupsSaved: { id: 'assessment/items/groups-saved', defaultMessage: 'Groups saved.' },
    itemsListTitle: { id: 'assessment/items/list-title', defaultMessage: 'Questions' },
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
    itemsFieldUnnamed: { id: 'assessment/items/field-unnamed', defaultMessage: 'Untitled field' },
    itemsStageSettings: {
      id: 'assessment/items/stage-settings',
      defaultMessage: 'Step settings',
    },
    itemsTitlePlaceholder: {
      id: 'assessment/items/title-placeholder',
      defaultMessage: 'e.g. Award in a discipline competition',
    },
    itemsMoveReasonTitle: {
      id: 'assessment/items/move-reason-title',
      defaultMessage: 'Why this question moved',
    },
    itemsReasonTitle: { id: 'assessment/items/reason-title', defaultMessage: 'Why this changed' },
    itemsReasonHint: {
      id: 'assessment/items/reason-hint',
      defaultMessage:
        'The round is running and this changes what counts. Everyone affected reads this.',
    },
    itemsNew: { id: 'assessment/items/new', defaultMessage: 'New question' },
    itemsPublishAfterSave: {
      id: 'assessment/items/publish-after-save',
      defaultMessage: 'Save it first, then publish.',
    },
    itemsPublish: { id: 'assessment/items/publish', defaultMessage: 'Publish' },
    itemsStatusComposing: { id: 'assessment/items/status-composing', defaultMessage: 'Draft' },
    itemsStatusDraft: { id: 'assessment/items/status-draft', defaultMessage: 'Unpublished' },
    itemsPublished: { id: 'assessment/items/published', defaultMessage: 'Published.' },
    itemsFieldAdd: { id: 'assessment/items/form-add', defaultMessage: 'Add a field' },
    itemsFieldRemove: { id: 'assessment/items/form-remove', defaultMessage: 'Remove' },
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
    itemsFixedValue: {
      id: 'assessment/items/fixed-value',
      defaultMessage: 'Each approved entry counts',
    },
    itemsEscalationTitle: {
      id: 'assessment/items/escalation-title',
      defaultMessage: 'Escalation route',
    },
    itemsEscalationHint: {
      id: 'assessment/items/escalation-hint',
      defaultMessage: 'Where a reviewer sends what they cannot judge; the last step decides.',
    },
    itemsEscalationEmpty: {
      id: 'assessment/items/escalation-empty',
      defaultMessage: 'With no steps here, a reviewer cannot escalate.',
    },
    itemsStageAdd: { id: 'assessment/items/stage-add', defaultMessage: 'Add a step' },
    itemsStageRemove: { id: 'assessment/items/stage-remove', defaultMessage: 'Remove step' },
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
    entryDeclare: { id: 'assessment/entry/declare', defaultMessage: 'Claim it' },
    entryDeclaredFiled: {
      id: 'assessment/entry/declared-filed',
      defaultMessage: 'Claimed; it goes to review.',
    },
    entryDeclaredCounted: {
      id: 'assessment/entry/declared-counted',
      defaultMessage: 'Claimed and counted.',
    },
    myEntriesGranted: {
      id: 'assessment/entry/granted',
      defaultMessage: 'Granted; nothing to file',
    },
    itemsKind: { id: 'assessment/items/kind', defaultMessage: 'Kind of question' },
    itemsKindEvidence: {
      id: 'assessment/items/kind-evidence',
      defaultMessage: 'Form-based',
    },
    itemsKindEvidenceHint: {
      id: 'assessment/items/kind-evidence-hint',
      defaultMessage: 'Fill in details or upload material, then submit',
    },
    itemsKindDeclaration: {
      id: 'assessment/items/kind-declaration',
      defaultMessage: 'Confirmation',
    },
    itemsKindDeclarationHint: {
      id: 'assessment/items/kind-declaration-hint',
      defaultMessage: 'Nothing to fill in; confirm and submit',
    },
    itemsKindConstant: {
      id: 'assessment/items/kind-constant',
      defaultMessage: 'Automatic',
    },
    itemsKindConstantHint: {
      id: 'assessment/items/kind-constant-hint',
      defaultMessage: 'No action needed; the system scores it',
    },
    itemsDeclaredHint: {
      id: 'assessment/items/declared-hint',
      defaultMessage: 'One press claims it; nothing is written',
    },
    itemsDeclaredBody: {
      id: 'assessment/items/declared-body',
      defaultMessage:
        'Participants claim this question with one press. Say what they are claiming in the description above.',
    },
    itemsGrantedTitle: { id: 'assessment/items/granted-title', defaultMessage: 'Who gets it' },
    itemsGrantedHint: {
      id: 'assessment/items/granted-hint',
      defaultMessage: 'Nobody files anything and nobody reviews it',
    },
    itemsGrantedBody: {
      id: 'assessment/items/granted-body',
      defaultMessage: 'Everybody on the roster is granted the amount below.',
    },
    itemsReviewWorkflow: {
      id: 'assessment/items/review-workflow',
      defaultMessage: 'Reviewed step by step',
    },
    itemsReviewNone: { id: 'assessment/items/review-none', defaultMessage: 'No review' },
    itemsReviewNoneHint: {
      id: 'assessment/items/review-none-hint',
      defaultMessage: 'Submitting counts it at once.',
    },
    resultDerived: {
      id: 'assessment/result/derived',
      defaultMessage: 'Granted by the round',
    },
    itemsFolding: { id: 'assessment/items/folding', defaultMessage: 'How approvals count' },
    itemsFoldingHint: {
      id: 'assessment/items/folding-hint',
      defaultMessage: 'How several approved filings become this question\u2019s score',
    },
    itemsFoldingSum: { id: 'assessment/items/folding-sum', defaultMessage: 'Add them up' },
    itemsFoldingMax: {
      id: 'assessment/items/folding-max',
      defaultMessage: 'Only the highest counts',
    },
    itemsFoldingTopN: {
      id: 'assessment/items/folding-top-n',
      defaultMessage: 'The highest few count',
    },
    itemsFoldingN: { id: 'assessment/items/folding-n', defaultMessage: 'How many' },
    itemsFoldingSumHint: {
      id: 'assessment/items/folding-sum-hint',
      defaultMessage: 'Every approved filing counts',
    },
    itemsFoldingMaxHint: {
      id: 'assessment/items/folding-max-hint',
      defaultMessage: 'One filing counts: the highest',
    },
    itemsFoldingTopNHint: {
      id: 'assessment/items/folding-top-n-hint',
      defaultMessage: 'The N highest count, added up',
    },
    resultNotCounted: {
      id: 'assessment/result/not-counted',
      defaultMessage: 'Approved; the question counts other filings instead',
    },
    reviewChainTitle: { id: 'assessment/review/chain-title', defaultMessage: 'Review route' },
    reviewStageHere: { id: 'assessment/review/stage-here', defaultMessage: 'Now here' },
    reviewStageSkipped: {
      id: 'assessment/review/stage-skipped',
      defaultMessage: 'Skipped: no such unit above this participant',
    },
    reviewEscalate: { id: 'assessment/review/escalate', defaultMessage: 'Escalate for review' },
    reviewRouteNormal: { id: 'assessment/review/route-normal', defaultMessage: 'Ordinary review' },
    reviewRouteEscalation: {
      id: 'assessment/review/route-escalation',
      defaultMessage: 'Escalation',
    },
    reviewCommentAction: {
      id: 'assessment/review/comment-action',
      defaultMessage: 'Leave a note',
    },
    reviewSayTitle: { id: 'assessment/review/say-title', defaultMessage: 'What to say' },
    // the review queue, laid out three ways
    reviewStatPending: { id: 'assessment/review/stat-pending', defaultMessage: 'Waiting for me' },
    reviewStatToday: { id: 'assessment/review/stat-today', defaultMessage: 'Handled today' },
    reviewTabByItem: { id: 'assessment/review/tab-by-item', defaultMessage: 'By question' },
    reviewTabByTime: { id: 'assessment/review/tab-by-time', defaultMessage: 'By submitted' },
    reviewTabByPerson: {
      id: 'assessment/review/tab-by-person',
      defaultMessage: 'By participant',
    },
    reviewFilterAllItems: {
      id: 'assessment/review/filter-all-items',
      defaultMessage: 'All questions',
    },
    reviewFilterAllUnits: {
      id: 'assessment/review/filter-all-units',
      defaultMessage: 'All units',
    },
    reviewSearchPlaceholder: {
      id: 'assessment/review/search-placeholder',
      defaultMessage: 'Search name, number or content',
    },
    reviewMatchesNone: {
      id: 'assessment/review/matches-none',
      defaultMessage: 'Nothing waiting matches.',
    },
    reviewGroupCount: {
      id: 'assessment/review/group-count',
      defaultMessage: '{count} waiting',
    },
    reviewColumnParticipant: {
      id: 'assessment/review/column-participant',
      defaultMessage: 'Participant',
    },
    reviewColumnTime: { id: 'assessment/review/column-time', defaultMessage: 'Time' },
    reviewColumnSummary: { id: 'assessment/review/column-summary', defaultMessage: 'Summary' },
    reviewColumnState: { id: 'assessment/review/column-state', defaultMessage: 'Status' },
    reviewStateWaiting: {
      id: 'assessment/review/state-waiting',
      defaultMessage: 'Waiting for me',
    },
    reviewStateRound: { id: 'assessment/review/state-round', defaultMessage: 'Round {round}' },
    reviewStateEscalated: {
      id: 'assessment/review/state-escalated',
      defaultMessage: 'Escalated',
    },
    reviewFilesCount: { id: 'assessment/review/files-count', defaultMessage: '{count} files' },
    reviewNoStandingHint: {
      id: 'assessment/review/no-standing-hint',
      defaultMessage: 'To take part, ask whoever runs this round to assign you a reviewing role.',
    },
    // the workbench: one submission, judged in a run
    reviewQueueTitle: { id: 'assessment/review/queue-title', defaultMessage: 'Queue' },
    reviewRunPosition: {
      id: 'assessment/review/run-position',
      defaultMessage: '{at}/{count}',
    },
    reviewRunExit: { id: 'assessment/review/run-exit', defaultMessage: 'Leave the run' },
    reviewPrior: { id: 'assessment/review/prior', defaultMessage: 'Said so far' },
    reviewPreviousTitle: {
      id: 'assessment/review/previous-title',
      defaultMessage: 'Why it was sent back',
    },
    reviewPreviousHint: {
      id: 'assessment/review/previous-hint',
      defaultMessage: 'Check the asked-for changes were made.',
    },
    reviewInsight: { id: 'assessment/review/insight', defaultMessage: 'Smart review' },
    reviewInsightSoon: {
      id: 'assessment/review/insight-soon',
      defaultMessage: 'No hints yet.',
    },
    reviewAboutTitle: {
      id: 'assessment/review/about-title',
      defaultMessage: 'Scoring',
    },
    reviewAboutEach: {
      id: 'assessment/review/about-each',
      defaultMessage: 'Counts when approved',
    },
    reviewAboutMax: {
      id: 'assessment/review/about-max',
      defaultMessage: 'Entries per person',
    },
    reviewAboutGroupCap: { id: 'assessment/review/about-group-cap', defaultMessage: 'Group cap' },
    reviewSiblingsTitle: {
      id: 'assessment/review/siblings-title',
      defaultMessage: 'Their other claims',
    },
    reviewSiblingThis: { id: 'assessment/review/sibling-this', defaultMessage: 'This one' },
    reviewSiblingsFull: {
      id: 'assessment/review/siblings-full',
      defaultMessage: 'Approving reaches their limit on this question.',
    },
    reviewCommentPlaceholder: {
      id: 'assessment/review/comment-placeholder',
      defaultMessage: 'Say why',
    },
    reviewCommentPlaceholderAdvise: {
      id: 'assessment/review/comment-placeholder-advise',
      defaultMessage: 'Your opinion, for the step that decides',
    },
    reviewActionNote: { id: 'assessment/review/action-note', defaultMessage: 'Note' },
    reviewSubmitDecision: {
      id: 'assessment/review/submit-decision',
      defaultMessage: 'Submit decision',
    },
    reviewSubmitHint: {
      id: 'assessment/review/submit-hint',
      defaultMessage: 'Five seconds to take it back after submitting.',
    },
    reviewSubmitHintAdvise: {
      id: 'assessment/review/submit-hint-advise',
      defaultMessage: 'This step gives an opinion, not a decision.',
    },
    reviewPickDecision: {
      id: 'assessment/review/pick-decision',
      defaultMessage: 'Choose a decision first.',
    },
    reviewUndo: { id: 'assessment/review/undo', defaultMessage: 'Undo' },
    reviewWriteMore: { id: 'assessment/review/write-more', defaultMessage: 'Write in a box' },
    reviewBackToQueue: { id: 'assessment/review/back-to-queue', defaultMessage: 'Back to queue' },
    reviewRunStart: { id: 'assessment/review/run-start', defaultMessage: 'Start reviewing' },
    reviewFiled: { id: 'assessment/review/filed', defaultMessage: 'What was filed' },
    reviewFiledVersion: {
      id: 'assessment/review/filed-version',
      defaultMessage: 'Version {no}\u3000{at}',
    },
    // the button says what pressing it does, not what the screen is doing:
    // a toggle labelled with its own state reads as a claim, not a control
    reviewCompareOn: { id: 'assessment/review/compare-on', defaultMessage: 'Compare versions' },
    reviewCompareOff: { id: 'assessment/review/compare-off', defaultMessage: 'Stop comparing' },
    reviewPickVersion: { id: 'assessment/review/pick-version', defaultMessage: 'Pick a version' },
    reviewCompareCount: {
      id: 'assessment/review/compare-count',
      defaultMessage:
        '{count, plural, =0 {No change against version {no}} one {# change against version {no}} other {# changes against version {no}}}',
    },
    reviewComparePrevious: { id: 'assessment/review/compare-previous', defaultMessage: 'Was' },
    reviewCompareBlank: { id: 'assessment/review/compare-blank', defaultMessage: 'Not filled in' },
    reviewVersionsTitle: {
      id: 'assessment/review/versions-title',
      defaultMessage: 'Which version to compare against',
    },
    reviewVersionsSubtitle: {
      id: 'assessment/review/versions-subtitle',
      defaultMessage: '{name}\u3000{item}, {count} versions',
    },
    reviewVersionName: { id: 'assessment/review/version-name', defaultMessage: 'Version {no}' },
    reviewVersionJudged: {
      id: 'assessment/review/version-judged',
      defaultMessage: 'Being judged',
    },
    reviewVersionComparing: {
      id: 'assessment/review/version-comparing',
      defaultMessage: 'Comparing',
    },
    reviewVersionBy: { id: 'assessment/review/version-by', defaultMessage: 'Filed by {who}' },
    reviewVersionsFoot: {
      id: 'assessment/review/versions-foot',
      defaultMessage: 'What changed is marked on the filing itself.',
    },
    reviewVersionsConfirm: {
      id: 'assessment/review/versions-confirm',
      defaultMessage: 'Compare version {no}',
    },
    reviewVersionsConfirmNone: {
      id: 'assessment/review/versions-confirm-none',
      defaultMessage: 'Pick a version',
    },
    reviewTrailFullOpen: {
      id: 'assessment/review/trail-full-open',
      defaultMessage: 'The whole account of this claim',
    },
    reviewTrailTitle: { id: 'assessment/review/trail-title', defaultMessage: 'The whole story' },
    reviewTrailOpen: { id: 'assessment/review/trail-open', defaultMessage: 'Full story' },
    reviewTrailRound: { id: 'assessment/review/trail-round', defaultMessage: 'Round {no}' },
    reviewDownloadAll: { id: 'assessment/review/download-all', defaultMessage: 'Download all' },
    reviewTipApprove: {
      id: 'assessment/review/tip-approve',
      defaultMessage: 'Counts towards their score',
    },
    reviewTipReject: {
      id: 'assessment/review/tip-reject',
      defaultMessage: 'Goes back for them to revise',
    },
    reviewTipEscalate: {
      id: 'assessment/review/tip-escalate',
      defaultMessage: 'Goes to the escalation route',
    },
    reviewTipComment: {
      id: 'assessment/review/tip-comment',
      defaultMessage: 'Records a word; it stays with you',
    },
    reviewTipSubmit: {
      id: 'assessment/review/tip-submit',
      defaultMessage: 'Sends what you chose',
    },
    reviewHintArmedApprove: {
      id: 'assessment/review/hint-armed-approve',
      defaultMessage: 'Approve counts it towards their score. Five seconds to take it back.',
    },
    reviewHintArmedComment: {
      id: 'assessment/review/hint-armed-comment',
      defaultMessage: 'A note is recorded and nothing moves.',
    },
    reviewHintPickFirst: {
      id: 'assessment/review/hint-pick-first',
      defaultMessage: 'Choose a decision, then submit.',
    },
    reviewHintLastStep: {
      id: 'assessment/review/hint-last-step',
      defaultMessage: 'This is the last step: approving ends the round.',
    },
    // the three ways a queue is empty
    reviewAllDoneTitle: {
      id: 'assessment/review/all-done-title',
      defaultMessage: 'Everything waiting for you is handled',
    },
    reviewAllDoneBody: {
      id: 'assessment/review/all-done-body',
      defaultMessage: '{count} handled today.',
    },
    reviewNothingTitle: {
      id: 'assessment/review/nothing-title',
      defaultMessage: 'Nothing is waiting for you',
    },
    reviewNothingBody: {
      id: 'assessment/review/nothing-body',
      defaultMessage: 'New submissions appear here on their own.',
    },
    reviewNoRoleTitle: {
      id: 'assessment/review/no-role-title',
      defaultMessage: 'You review nothing in this round',
    },
    reviewFirstOne: {
      id: 'assessment/review/first-one',
      defaultMessage: 'Already at the first one',
    },
    reviewLastOne: {
      id: 'assessment/review/last-one',
      defaultMessage: 'Already at the last one',
    },
    reviewUndoPending: {
      id: 'assessment/review/undo-pending',
      defaultMessage: 'Submitting in {seconds}s; undo until then',
    },
    reviewEscBannerTitle: {
      id: 'assessment/review/esc-banner-title',
      defaultMessage: 'This round is on the escalation route',
    },
    reviewEscBannerBody: {
      id: 'assessment/review/esc-banner-body',
      defaultMessage: 'The last step decides; your opinion goes with it.',
    },
    // the supplement exchange: ask for more backing, answer, take back
    reviewFileAdded: { id: 'assessment/review/file-added', defaultMessage: 'New' },
    reviewFileGone: {
      id: 'assessment/review/file-gone',
      defaultMessage: 'Taken out this version',
    },
    reviewFilesNote: {
      id: 'assessment/review/files-note',
      defaultMessage:
        'Materials sit under the field that asked for them. A file this version took out is named in grey below it, so what the last reviewer saw can still be checked.',
    },
    reviewThisRound: { id: 'assessment/review/this-round', defaultMessage: 'This round' },
    reviewAwaitingYou: {
      id: 'assessment/review/awaiting-you',
      defaultMessage: 'Waiting on your decision',
    },
    reviewStagePassed: {
      id: 'assessment/review/stage-passed',
      defaultMessage: 'Done',
    },
    reviewAboutGroupCapNamed: {
      id: 'assessment/review/about-group-cap-named',
      defaultMessage: '{group} cap',
    },
    reviewSiblingsKeys: {
      id: 'assessment/review/siblings-keys',
      defaultMessage: '⌥ 1 to {count}',
    },
    reviewInsightCaveat: {
      id: 'assessment/review/insight-caveat',
      defaultMessage: 'May be wrong; check it yourself',
    },
    reviewFileSupplement: {
      id: 'assessment/review/file-supplement',
      defaultMessage: 'Supplement',
    },
    reviewSupplementSection: {
      id: 'assessment/review/supplement-section',
      defaultMessage: 'Supplied on request',
    },
    reviewSupplementSectionNote: {
      id: 'assessment/review/supplement-section-note',
      defaultMessage: 'Asked for by a reviewer, so the questions differ from the ones above',
    },
    reviewPreviousWithdrawn: {
      id: 'assessment/review/previous-withdrawn',
      defaultMessage: 'Last round went unjudged: the participant withdrew it',
    },
    reviewEarlierWithdrawn: {
      id: 'assessment/review/earlier-withdrawn',
      defaultMessage: 'Withdrawn by the participant',
    },
    reviewEarlierReturned: {
      id: 'assessment/review/earlier-returned',
      defaultMessage: 'Sent back',
    },
    reviewEarlierRounds: {
      id: 'assessment/review/earlier-rounds',
      defaultMessage: 'Rounds before that',
    },
    reviewEarlierCount: {
      id: 'assessment/review/earlier-count',
      defaultMessage: '{count, plural, one {# more} other {# more}}',
    },
    reviewHadSupplements: {
      id: 'assessment/review/had-supplements',
      defaultMessage: 'Material was requested',
    },
    reviewKeysHint: { id: 'assessment/review/keys-hint', defaultMessage: 'Keyboard ?' },
    reviewQueueFold: { id: 'assessment/review/queue-fold', defaultMessage: 'Fold the queue away' },
    reviewQueueUnfold: { id: 'assessment/review/queue-unfold', defaultMessage: 'Show the queue' },
    reviewSupplementAsk: {
      id: 'assessment/review/supplement-ask',
      defaultMessage: 'Request material',
    },
    reviewSupplementAsked: {
      id: 'assessment/review/supplement-asked',
      defaultMessage: 'asked for material',
    },
    reviewKeySiblings: {
      id: 'assessment/review/key-siblings',
      defaultMessage: 'Open one of their other claims',
    },
    reviewKeySupplement: {
      id: 'assessment/review/key-supplement',
      defaultMessage: 'Ask for more material',
    },
    // the queue's other half: what this step is waiting on somebody else for
    reviewAwaitingEmpty: {
      id: 'assessment/review/awaiting-empty',
      defaultMessage: 'Nothing is out with anybody right now.',
    },
    reviewAwaitingTitle: {
      id: 'assessment/review/awaiting-title',
      defaultMessage: 'Waiting on material',
    },
    reviewAwaitingCount: { id: 'assessment/review/awaiting-count', defaultMessage: '{count}' },
    reviewAwaitingBack: {
      id: 'assessment/review/awaiting-back',
      defaultMessage: '{count} answered',
    },
    reviewAwaitingNote: {
      id: 'assessment/review/awaiting-note',
      defaultMessage: 'Not counted as waiting on you; answered ones return to the queue',
    },
    reviewAwaitingColAsk: { id: 'assessment/review/awaiting-col-ask', defaultMessage: 'Question' },
    reviewAwaitingColWaited: {
      id: 'assessment/review/awaiting-col-waited',
      defaultMessage: 'Waiting',
    },
    reviewAwaitingColAskedAt: {
      id: 'assessment/review/awaiting-col-asked-at',
      defaultMessage: 'Asked',
    },
    reviewAwaitingWant: {
      id: 'assessment/review/awaiting-want',
      defaultMessage: 'Asked for　{what}',
    },
    reviewAwaitingAnswered: {
      id: 'assessment/review/awaiting-answered',
      defaultMessage: 'Answered, waiting on you',
    },
    reviewAwaitingGo: { id: 'assessment/review/awaiting-go', defaultMessage: 'Take it up' },
    reviewAwaitingFoot: {
      id: 'assessment/review/awaiting-foot',
      defaultMessage:
        'Withdrawing a request puts the filing straight back in the queue; whatever was added stays in its account.',
    },
    reviewAwaitingHint: {
      id: 'assessment/review/awaiting-hint',
      defaultMessage: 'Filings you asked more of stay here until they come back.',
    },
    reviewTipSupplement: {
      id: 'assessment/review/tip-supplement',
      defaultMessage: 'Asks for more backing; the filing stays as it is',
    },
    supplementDialogTitle: {
      id: 'assessment/supplement/dialog-title',
      defaultMessage: 'Request supporting material',
    },
    supplementDialogHint: {
      id: 'assessment/supplement/dialog-hint',
      defaultMessage: 'Say what to add. It returns to your queue once submitted.',
    },
    supplementInstructionsLabel: {
      id: 'assessment/supplement/instructions-label',
      defaultMessage: 'What to add, and why',
    },
    supplementPiecesLabel: {
      id: 'assessment/supplement/pieces-label',
      defaultMessage: 'What you are asking for',
    },
    supplementAddText: {
      id: 'assessment/supplement/add-text',
      defaultMessage: 'Written answer',
    },
    supplementAddFile: { id: 'assessment/supplement/add-file', defaultMessage: 'Files' },
    supplementPieceLabel: {
      id: 'assessment/supplement/piece-label',
      defaultMessage: 'Name this piece',
    },
    supplementPieceRequired: {
      id: 'assessment/supplement/piece-required',
      defaultMessage: 'Required',
    },
    supplementPieceRemove: { id: 'assessment/supplement/piece-remove', defaultMessage: 'Remove' },
    supplementSend: { id: 'assessment/supplement/send', defaultMessage: 'Send request' },
    supplementSent: { id: 'assessment/supplement/sent', defaultMessage: 'Request sent.' },
    supplementWaitingTitle: {
      id: 'assessment/supplement/waiting-title',
      defaultMessage: 'Waiting for requested material',
    },
    supplementWaitingBody: {
      id: 'assessment/supplement/waiting-body',
      defaultMessage: 'It returns to the queue once {who} submits.',
    },
    supplementWithdraw: {
      id: 'assessment/supplement/withdraw',
      defaultMessage: 'Withdraw request',
    },
    supplementWithdrawn: {
      id: 'assessment/supplement/withdrawn',
      defaultMessage: 'Request withdrawn.',
    },
    supplementSectionTitle: {
      id: 'assessment/supplement/section-title',
      defaultMessage: 'Requested material',
    },
    supplementRequestHeading: {
      id: 'assessment/supplement/request-heading',
      defaultMessage: 'Request {no}',
    },
    supplementStatusOpen: {
      id: 'assessment/supplement/status-open',
      defaultMessage: 'Waiting',
    },
    supplementStatusAnswered: {
      id: 'assessment/supplement/status-answered',
      defaultMessage: 'Submitted',
    },
    supplementStatusCancelled: {
      id: 'assessment/supplement/status-cancelled',
      defaultMessage: 'Withdrawn',
    },
    eventSupplementRequested: {
      id: 'assessment/event/supplement-requested',
      defaultMessage: '{who} asked for more material',
    },
    eventSupplementSubmitted: {
      id: 'assessment/event/supplement-submitted',
      defaultMessage: '{who} added the requested material',
    },
    eventSupplementCancelled: {
      id: 'assessment/event/supplement-cancelled',
      defaultMessage: '{who} withdrew the request',
    },
    entryRefusedTitle: {
      id: 'assessment/entry/refused-title',
      defaultMessage: 'The reviewer sent this back',
    },
    entryReturnedTitle: {
      id: 'assessment/entry/returned-title',
      defaultMessage: 'This was sent back for revision',
    },
    entryRefusedBy: { id: 'assessment/entry/refused-by', defaultMessage: '{who}, {at}' },
    entrySupplementTitle: {
      id: 'assessment/entry/supplement-title',
      defaultMessage: 'The reviewer asked for more material',
    },
    supplementNeeds: { id: 'assessment/supplement/needs', defaultMessage: 'What to provide' },
    entrySupplementAsked: {
      id: 'assessment/entry/supplement-asked',
      defaultMessage:
        '{who} asked on {at}. Review continues once you add it; what you already filed stays as it is.',
    },
    entryDraftSavedFoot: {
      id: 'assessment/entry/draft-saved-foot',
      defaultMessage: 'Not submitted yet, saved {at}',
    },
    // what a claim's number is: granted, waiting, or worth this much if approved
    entryScoreCounted: { id: 'assessment/entry/score-counted', defaultMessage: 'Counted' },
    entryScorePending: { id: 'assessment/entry/score-pending', defaultMessage: 'Not counted yet' },
    entryScoreIfApproved: {
      id: 'assessment/entry/score-if-approved',
      defaultMessage: 'If approved',
    },
    entryStatusAwaitingSupplement: {
      id: 'assessment/entry/status-awaiting-supplement',
      defaultMessage: 'Material requested',
    },
    entryVersionNo: { id: 'assessment/entry/version-no', defaultMessage: 'Version {no}' },
    myEntriesHeadEach: {
      id: 'assessment/my-entries/head-each',
      defaultMessage: '{value} each',
    },
    myEntriesHeadMost: {
      id: 'assessment/my-entries/head-most',
      defaultMessage: 'up to {count}',
    },
    myEntriesHeadSteps: {
      id: 'assessment/my-entries/head-steps',
      defaultMessage: '{count, plural, one {# reviewer} other {# reviewers}}',
    },
    myEntriesQuota: {
      id: 'assessment/my-entries/quota',
      defaultMessage: 'Places used',
    },
    myEntriesCountedHere: {
      id: 'assessment/my-entries/counted-here',
      defaultMessage: 'Counted from this question',
    },
    myEntriesClaimsAll: {
      id: 'assessment/my-entries/claims-all',
      defaultMessage: 'All',
    },
    myEntriesClaimsTodo: {
      id: 'assessment/my-entries/claims-todo',
      defaultMessage: 'Open',
    },
    myEntriesClaimsDone: {
      id: 'assessment/my-entries/claims-done',
      defaultMessage: 'Approved',
    },
    myEntriesClaimsNote: {
      id: 'assessment/my-entries/claims-note',
      defaultMessage: '{todo, plural, other {# open}}, {done, plural, other {# approved}}',
    },
    myEntriesMoreFields: {
      id: 'assessment/my-entries/more-fields',
      defaultMessage: '{count, plural, other {# more fields not shown}}',
    },
    myEntriesNoMoreFields: {
      id: 'assessment/my-entries/no-more-fields',
      defaultMessage: 'The account and actions are inside',
    },
    myEntriesAddMore: {
      id: 'assessment/my-entries/add-more',
      defaultMessage: 'File another',
    },
    myEntriesAddRoom: {
      id: 'assessment/my-entries/add-room',
      defaultMessage: '{count, plural, other {Room for # more}}',
    },
    myEntriesAddFull: {
      id: 'assessment/my-entries/add-full',
      defaultMessage: 'All places used',
    },
    myEntriesAddFullHint: {
      id: 'assessment/my-entries/add-full-hint',
      defaultMessage: '{count, plural, other {This question takes at most #}}',
    },
    myEntriesViewDetail: {
      id: 'assessment/my-entries/view-detail',
      defaultMessage: 'View details',
    },
    myEntriesFilesNone: {
      id: 'assessment/my-entries/files-none',
      defaultMessage: 'Nothing uploaded yet',
    },
    myEntriesPaperCap: {
      id: 'assessment/my-entries/paper-cap',
      defaultMessage: 'Out of {value}',
    },
    myEntriesPaperMeta: {
      id: 'assessment/my-entries/paper-meta',
      defaultMessage: '{groups, plural, other {# groups}}, {items, plural, other {# questions}}',
    },
    myEntriesPaperUnit: {
      id: 'assessment/my-entries/paper-unit',
      defaultMessage: 'pts',
    },
    entrySheetTitle: {
      id: 'assessment/entry-sheet/title',
      defaultMessage: 'Claim details',
    },
    entrySheetContent: {
      id: 'assessment/entry-sheet/content',
      defaultMessage: 'Filed content',
    },
    entrySheetTrail: {
      id: 'assessment/entry-sheet/trail',
      defaultMessage: 'Review account',
    },
    entrySheetContentCount: {
      id: 'assessment/entry-sheet/content-count',
      defaultMessage: '{count, plural, other {# fields}}',
    },
    entrySheetTrailCount: {
      id: 'assessment/entry-sheet/trail-count',
      defaultMessage: '{count, plural, other {# versions}}',
    },
    entrySheetOwn: {
      id: 'assessment/entry-sheet/own',
      defaultMessage: 'Filled in by me',
    },
    entrySheetSupHead: {
      id: 'assessment/entry-sheet/sup-head',
      defaultMessage: 'Added at the reviewer\u2019s request',
    },
    entrySheetSupNote: {
      id: 'assessment/entry-sheet/sup-note',
      defaultMessage: 'Round {round}, asked {asked}, answered {answered}',
    },
    entrySheetSupAsk: {
      id: 'assessment/entry-sheet/sup-ask',
      defaultMessage: 'What the reviewer asked for',
    },
    itemDescTitle: {
      id: 'assessment/item/desc-title',
      defaultMessage: 'About this question',
    },
    itemScoringTitle: {
      id: 'assessment/item/scoring-title',
      defaultMessage: 'Scoring details',
    },
    itemScoreEach: {
      id: 'assessment/item/score-each',
      defaultMessage: 'Per approved claim',
    },
    itemScoreMaxHere: {
      id: 'assessment/item/score-max-here',
      defaultMessage: 'At most from this question',
    },
    itemGroupSubtotal: {
      id: 'assessment/item/group-subtotal',
      defaultMessage: '{group} subtotal',
    },
    itemGroupCapNamed: {
      id: 'assessment/item/group-cap-named',
      defaultMessage: '{group} cap',
    },
    itemCounted: { id: 'assessment/entry/item-counted', defaultMessage: 'Counted here' },
    // the claim's story, as one timeline
    entryTrailSubtitle: {
      id: 'assessment/entry/trail-subtitle',
      defaultMessage: '{item}　{versions} versions, {rounds} rounds, {asks} requests for material',
    },
    entryTrailVersion: {
      id: 'assessment/entry/trail-version',
      defaultMessage: 'I submitted version {no}',
    },
    // the same moments, told to somebody who is not the person they are
    // about: a reviewer reading "I submitted" is reading the wrong sentence
    entryTrailVersionBy: {
      id: 'assessment/entry/trail-version-by',
      defaultMessage: '{who} submitted version {no}',
    },
    entryTrailAnsweredBy: {
      id: 'assessment/entry/trail-answered-by',
      defaultMessage: '{who} added the material',
    },
    entryTrailAskOut: {
      id: 'assessment/entry/trail-ask-out',
      defaultMessage: 'More material was requested',
    },
    entryTrailAnswerKeptOut: {
      id: 'assessment/entry/trail-answer-kept-out',
      defaultMessage: 'Kept beside version {no} rather than over it; both are on record.',
    },
    entrySuggestionHintOut: {
      id: 'assessment/entry/suggestion-hint-out',
      defaultMessage: 'For reference only; whether to take it up is theirs to decide.',
    },
    entryTrailRoundOpened: {
      id: 'assessment/entry/trail-round-opened',
      defaultMessage: 'Round {no} began',
    },
    entryTrailAnswered: {
      id: 'assessment/entry/trail-answered',
      defaultMessage: 'I added the material',
    },
    entryTrailAnswerKept: {
      id: 'assessment/entry/trail-answer-kept',
      defaultMessage: 'Kept beside version {no} rather than over it; the reviewer sees both.',
    },
    entryTrailAskCancelled: {
      id: 'assessment/entry/trail-ask-cancelled',
      defaultMessage: 'Withdrawn by the reviewer',
    },
    entryTrailAskWaiting: {
      id: 'assessment/entry/trail-ask-waiting',
      defaultMessage: 'Waiting for you',
    },
    entryTrailReason: { id: 'assessment/entry/trail-reason', defaultMessage: 'Reason　{value}' },
    entryTrailRound: { id: 'assessment/entry/trail-round', defaultMessage: 'Round {no}' },
    entryTrailEmpty: {
      id: 'assessment/entry/trail-empty',
      defaultMessage: 'Nothing has happened to this claim yet.',
    },
    // narrow screens show one pane at a time
    myEntriesBack: { id: 'assessment/entry/back-to-list', defaultMessage: 'All questions' },
    entrySupplementAnswer: {
      id: 'assessment/entry/supplement-answer',
      defaultMessage: 'Add material',
    },
    entrySupplementDialogTitle: {
      id: 'assessment/entry/supplement-dialog-title',
      defaultMessage: 'Add the requested material',
    },
    entrySupplementSent: {
      id: 'assessment/entry/supplement-sent',
      defaultMessage: 'Sent back to review.',
    },
    refuseSupplementOpen: {
      id: 'assessment/refuse/supplement-open',
      defaultMessage: 'Material has already been requested here.',
    },
    refuseRequestClosed: {
      id: 'assessment/refuse/request-closed',
      defaultMessage: 'This request is no longer open.',
    },
    refuseAwaitingSupplement: {
      id: 'assessment/refuse/awaiting-supplement',
      defaultMessage: 'Waiting for requested material.',
    },
    refuseReviewNotOpen: {
      id: 'assessment/refuse/review-not-open',
      defaultMessage: 'This round is not open for decisions.',
    },
    // the keyboard panel
    reviewKeysTitle: { id: 'assessment/review/keys-title', defaultMessage: 'Keyboard' },
    reviewKeysToggle: {
      id: 'assessment/review/keys-toggle',
      defaultMessage: '? opens and closes this panel',
    },
    reviewKeysFoot: {
      id: 'assessment/review/keys-foot',
      defaultMessage: 'Letters choose, \u2318\u21b5 submits. While typing, letters are text.',
    },
    reviewKeySubmit: {
      id: 'assessment/review/key-submit',
      defaultMessage: 'Submit \u2014 the only key that does',
    },
    reviewKeyUndo: {
      id: 'assessment/review/key-undo',
      defaultMessage: 'Undo the last one, within 5 seconds',
    },
    reviewKeyApprove: { id: 'assessment/review/key-approve', defaultMessage: 'Choose approve' },
    reviewKeyReject: { id: 'assessment/review/key-reject', defaultMessage: 'Choose send back' },
    reviewKeyEscalate: {
      id: 'assessment/review/key-escalate',
      defaultMessage: 'Choose escalate',
    },
    reviewKeyComment: { id: 'assessment/review/key-comment', defaultMessage: 'Choose note' },
    reviewKeyMove: { id: 'assessment/review/key-move', defaultMessage: 'Next, previous' },
    reviewKeyFiles: {
      id: 'assessment/review/key-files',
      defaultMessage: 'Open the numbered file',
    },
    reviewKeyCompare: {
      id: 'assessment/review/key-compare',
      defaultMessage: 'Compare with the previous version',
    },
    reviewKeyVersions: {
      id: 'assessment/review/key-versions',
      defaultMessage: 'Choose which version to compare',
    },
    reviewKeyTrail: { id: 'assessment/review/key-trail', defaultMessage: 'Open the whole story' },
    reviewKeyCancel: {
      id: 'assessment/review/key-cancel',
      defaultMessage: 'Clear the choice, or close this panel',
    },
    // a run finished
    reviewDoneTitle: {
      id: 'assessment/review/done-title',
      defaultMessage: 'All {count} in this run are done',
    },
    reviewDoneSpent: { id: 'assessment/review/done-spent', defaultMessage: 'Time' },
    reviewDoneNext: {
      id: 'assessment/review/done-next',
      defaultMessage: 'Next: {title} ({count})',
    },
    reviewDoneBack: { id: 'assessment/review/done-back', defaultMessage: 'Back to the queue' },
    reviewDoneLeft: {
      id: 'assessment/review/done-left',
      defaultMessage: '{count} left in the queue',
    },
    reviewDoneList: {
      id: 'assessment/review/done-list',
      defaultMessage: 'This run\u2019s decisions',
    },
    reviewDoneFinal: {
      id: 'assessment/review/done-final',
      defaultMessage: 'Submitted; no longer undoable.',
    },
    // the two dialogs that carry a word
    reviewRejectTitle: {
      id: 'assessment/review/reject-title',
      defaultMessage: 'Send back to {name}',
    },
    reviewRejectSubtitle: {
      id: 'assessment/review/reject-subtitle',
      defaultMessage: '{item}, version {no}',
    },
    reviewReasonLabel: { id: 'assessment/review/reason-label', defaultMessage: 'Reason' },
    reviewReasonHint: {
      id: 'assessment/review/reason-hint',
      defaultMessage: 'Pick one',
    },
    reviewSuggestField: { id: 'assessment/review/suggest-field', defaultMessage: 'Field' },
    reviewSuggestTheirs: { id: 'assessment/review/suggest-theirs', defaultMessage: 'As filed' },
    reviewSuggestMine: { id: 'assessment/review/suggest-mine', defaultMessage: 'Suggested' },
    reviewSuggestKeep: { id: 'assessment/review/suggest-keep', defaultMessage: 'Unchanged' },
    reviewSuggestHint: {
      id: 'assessment/review/suggest-hint',
      defaultMessage: 'They may take it or leave it.',
    },
    reviewRejectFoot: {
      id: 'assessment/review/reject-foot',
      defaultMessage: 'They will see what you write here.',
    },
    reviewRejectConfirm: {
      id: 'assessment/review/reject-confirm',
      defaultMessage: 'Send back',
    },
    reviewEscalateSubtitle: {
      id: 'assessment/review/escalate-subtitle',
      defaultMessage: '{name}\u3000{item}',
    },
    reviewEscalateCommentLabel: {
      id: 'assessment/review/escalate-comment-label',
      defaultMessage: 'What to check',
    },
    reviewEscalateCommentHint: {
      id: 'assessment/review/escalate-comment-hint',
      defaultMessage: 'The participant never sees this',
    },
    reviewEscalateFlow: { id: 'assessment/review/escalate-flow', defaultMessage: 'Where it goes' },
    reviewEscalateStageAdvise: {
      id: 'assessment/review/escalate-stage-advise',
      defaultMessage: 'Opinions only',
    },
    reviewEscalateStageDecide: {
      id: 'assessment/review/escalate-stage-decide',
      defaultMessage: 'Decides',
    },
    reviewEscalateFoot: {
      id: 'assessment/review/escalate-foot',
      defaultMessage: 'It leaves your queue.',
    },
    // the reason lists, configured with the batch
    settingsReasons: { id: 'assessment/settings/reasons', defaultMessage: 'Review reasons' },
    settingsReasonsHint: {
      id: 'assessment/settings/reasons-hint',
      defaultMessage: 'What a reviewer picks from when sending back or escalating.',
    },
    settingsRejectReasons: {
      id: 'assessment/settings/reject-reasons',
      defaultMessage: 'Send-back reasons',
    },
    settingsEscalateReasons: {
      id: 'assessment/settings/escalate-reasons',
      defaultMessage: 'Escalation reasons',
    },
    settingsReasonPlaceholder: {
      id: 'assessment/settings/reason-placeholder',
      defaultMessage: 'New reason',
    },
    settingsReasonAdd: { id: 'assessment/settings/reason-add', defaultMessage: 'Add' },
    settingsReasonsEmpty: {
      id: 'assessment/settings/reasons-empty',
      defaultMessage: 'Leave empty to ask only for a written note.',
    },
    reviewOnEscalationRoute: {
      id: 'assessment/review/on-escalation-route',
      defaultMessage: 'This has been escalated; the last step decides.',
    },
    itemsTabBasics: { id: 'assessment/items/tab-basics', defaultMessage: 'Basics' },
    itemsTabFields: { id: 'assessment/items/tab-fields', defaultMessage: 'Form fields' },
    itemsTabScoring: { id: 'assessment/items/tab-scoring', defaultMessage: 'Scoring' },
    itemsTabReview: { id: 'assessment/items/tab-review', defaultMessage: 'Review route' },
    itemsFieldDescription: {
      id: 'assessment/items/field-description',
      defaultMessage: 'Filing instructions',
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
    itemsStageWalkUp: { id: 'assessment/items/stage-walk-up', defaultMessage: 'Walks up' },
    itemsTreeSummaryNoCap: {
      id: 'assessment/items/tree-summary-no-cap',
      defaultMessage: '{count, plural, one {# question} other {# questions}}',
    },
    itemsBasicsHint: {
      id: 'assessment/items/basics-hint',
      defaultMessage: 'The title and the note appear on the filing screen.',
    },
    itemsFieldsHint: {
      id: 'assessment/items/fields-hint',
      defaultMessage: 'Filled in this order. Drag to change it.',
    },
    itemsScoringHint: {
      id: 'assessment/items/scoring-hint',
      defaultMessage: 'Every approved entry counts for this. A deduction is a negative number.',
    },
    itemsChainHintNew: {
      id: 'assessment/items/chain-hint-new',
      defaultMessage: 'In order after submitting; the last step decides.',
    },
    itemsImpactTitle: {
      id: 'assessment/items/impact-title',
      defaultMessage: 'This change reaches work already under way',
    },
    itemsImpactHint: {
      id: 'assessment/items/impact-hint',
      defaultMessage: 'Choose what happens to it, then save.',
    },
    itemsImpactInReview: {
      id: 'assessment/items/impact-in-review',
      defaultMessage: '{count} of {total} entries in review no longer fit the form',
    },
    itemsImpactApproved: {
      id: 'assessment/items/impact-approved',
      defaultMessage: '{count} of {total} approved entries no longer fit the form',
    },
    itemsImpactKeepEntries: {
      id: 'assessment/items/impact-keep-entries',
      defaultMessage: 'Leave them as they are',
    },
    itemsImpactKeepApproved: {
      id: 'assessment/items/impact-keep-approved',
      defaultMessage: 'Leave the results standing',
    },
    itemsImpactReturnEntries: {
      id: 'assessment/items/impact-return-entries',
      defaultMessage: 'Ask for more and send them back',
    },
    itemsImpactRounds: {
      id: 'assessment/items/impact-rounds',
      defaultMessage: '{open} reviews are running, {blocked} of them waiting for a reviewer',
    },
    itemsImpactRoundsKeep: {
      id: 'assessment/items/impact-rounds-keep',
      defaultMessage: 'Only new reviews follow the new route',
    },
    itemsImpactRoundsBlocked: {
      id: 'assessment/items/impact-rounds-blocked',
      defaultMessage: 'Also move the ones waiting for a reviewer',
    },
    itemsImpactRoundsAll: {
      id: 'assessment/items/impact-rounds-all',
      defaultMessage: 'Move every running review',
    },
    itemsImpactStageGone: {
      id: 'assessment/items/impact-stage-gone',
      defaultMessage:
        '{count} of them stand at a step this route no longer has, and stay where they are.',
    },
    itemsChainHintRecorded: {
      id: 'assessment/items/chain-hint-recorded',
      defaultMessage: 'A record counts at once; this runs only if somebody contests it.',
    },
    structureDragHint: {
      id: 'assessment/items/structure-drag-hint',
      defaultMessage: 'Drag a row to reorder it or move it into another group.',
    },
    structureSearch: {
      id: 'assessment/items/structure-search',
      defaultMessage: 'Find a group or question',
    },
    structureStatusAll: { id: 'assessment/items/structure-status-all', defaultMessage: 'All' },
    structureStatusLive: { id: 'assessment/items/structure-status-live', defaultMessage: 'Live' },
    structureNew: { id: 'assessment/items/structure-new', defaultMessage: 'New' },
    structureNewItem: { id: 'assessment/items/structure-new-item', defaultMessage: 'Question' },
    structureColOrdinal: { id: 'assessment/items/structure-col-ordinal', defaultMessage: 'No.' },
    structureColName: { id: 'assessment/items/structure-col-name', defaultMessage: 'Name' },
    structureColEach: { id: 'assessment/items/structure-col-each', defaultMessage: 'Each' },
    structureColMost: { id: 'assessment/items/structure-col-most', defaultMessage: 'Per person' },
    structureColSource: { id: 'assessment/items/structure-col-source', defaultMessage: 'Filed by' },
    structureColChain: { id: 'assessment/items/structure-col-chain', defaultMessage: 'Review' },
    structureColStatus: { id: 'assessment/items/structure-col-status', defaultMessage: 'Status' },
    structureNoMatch: {
      id: 'assessment/items/structure-no-match',
      defaultMessage: 'Nothing here matches.',
    },
    structureUncapped: {
      id: 'assessment/items/structure-uncapped',
      defaultMessage: 'no upper limit',
    },
    structureUnlimited: { id: 'assessment/items/structure-unlimited', defaultMessage: 'any' },
    structureSteps: {
      id: 'assessment/items/structure-steps',
      defaultMessage: '{count, plural, one {# step} other {# steps}}',
    },
    paperStartTitle: {
      id: 'assessment/items/paper-start-title',
      defaultMessage: 'Start this round a paper',
    },
    paperStartHint: {
      id: 'assessment/items/paper-start-hint',
      defaultMessage: 'Name it and set the total; sections and questions come after.',
    },
    paperStartGuided: {
      id: 'assessment/items/paper-start-guided',
      defaultMessage: 'Name it and set the total',
    },
    paperStartGuidedHint: {
      id: 'assessment/items/paper-start-guided-hint',
      defaultMessage: 'Sections and questions can be added and removed at any time afterwards.',
    },
    paperStartSuggested: {
      id: 'assessment/items/paper-start-suggested',
      defaultMessage: 'suggested',
    },
    paperStartBlank: { id: 'assessment/items/paper-start-blank', defaultMessage: 'Leave it open' },
    paperStartBlankHint: {
      id: 'assessment/items/paper-start-blank-hint',
      defaultMessage: 'No total for now. Set one whenever the rules are settled.',
    },
    paperDefaultName: {
      id: 'assessment/items/paper-default-name',
      defaultMessage: 'This batch',
    },
    paperCreateTitle: { id: 'assessment/items/paper-create-title', defaultMessage: 'The paper' },
    paperCreateHint: {
      id: 'assessment/items/paper-create-hint',
      defaultMessage: 'Name it and set the total.',
    },
    paperCreate: { id: 'assessment/items/paper-create', defaultMessage: 'Create' },
    paperTotal: { id: 'assessment/items/paper-total', defaultMessage: 'Total' },
    paperTotalHint: {
      id: 'assessment/items/paper-total-hint',
      defaultMessage: 'The sections inside cannot add up past it. Empty means no upper limit.',
    },
    paperFloorNone: { id: 'assessment/items/paper-floor-none', defaultMessage: 'no lower limit' },
    paperEdit: { id: 'assessment/items/paper-edit', defaultMessage: 'Edit the paper' },
    itemsTreeTitle: { id: 'assessment/items/tree-title', defaultMessage: 'Structure' },
    itemsPreviewTitle: {
      id: 'assessment/items/preview-title',
      defaultMessage: 'Participant view',
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
    itemsReviewCovered: {
      id: 'assessment/items/review-covered',
      defaultMessage:
        '{count, plural, one {The one unit at this level has someone who can review} other {All # units at this level have someone who can review}}',
    },
    itemsReviewUncovered: {
      id: 'assessment/items/review-uncovered',
      defaultMessage: '{names}: nobody holds any of these roles yet, so submissions there wait.',
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
    itemsFieldReason: { id: 'assessment/items/field-reason', defaultMessage: 'Reason' },
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

    /** what the whole paper adds up to, read above its structure */
    /** what goes between two things named in a row; a locale picks its own */
    paperAllocated: {
      id: 'assessment/items/paper-allocated',
      defaultMessage: 'Sections hold {sum} of {total}',
    },
    paperAllocatedFree: {
      id: 'assessment/items/paper-allocated-free',
      defaultMessage: 'Sections hold {sum}',
    },
    paperCapOver: {
      id: 'assessment/items/paper-cap-over',
      defaultMessage: 'Sections add up to {sum}, past the total {total}',
    },
    paperCapUnset: {
      id: 'assessment/items/paper-cap-unset',
      defaultMessage: 'Some top sections have no upper limit, so the paper has none either',
    },
    listSeparator: { id: 'assessment/items/list-separator', defaultMessage: ', ' },
    structureSubtotal: {
      id: 'assessment/items/structure-subtotal',
      defaultMessage: 'holds {sum}',
    },
    structureRowAddGroup: {
      id: 'assessment/items/structure-row-add-group',
      defaultMessage: 'Subgroup',
    },
    structureRowMenu: { id: 'assessment/items/structure-row-menu', defaultMessage: 'More' },
    structureOpen: { id: 'assessment/items/structure-open', defaultMessage: 'Open' },

    /** one question, opened out of the structure */
    itemsBack: { id: 'assessment/items/back', defaultMessage: 'Back to the structure' },
    itemsPaperPosition: {
      id: 'assessment/items/paper-position',
      defaultMessage: 'Question {index} of {total}',
    },
    itemsPublishedVersion: {
      id: 'assessment/items/published-version',
      defaultMessage: 'Published, version {no}',
    },
    itemsDraftVersion: {
      id: 'assessment/items/draft-version',
      defaultMessage: 'Unpublished, version {no}',
    },
    itemsLimitMaxLength: {
      id: 'assessment/items/limit-max-length',
      defaultMessage: 'up to {count} characters',
    },
    itemsLimitDates: { id: 'assessment/items/limit-dates', defaultMessage: '{from} to {until}' },
    itemsLimitFiles: {
      id: 'assessment/items/limit-files',
      defaultMessage: '{count, plural, one {# file} other {up to # files}}',
    },
    itemsFixedValueUnit: { id: 'assessment/items/fixed-value-unit', defaultMessage: 'pts' },
    itemsMaxEntriesAny: { id: 'assessment/items/max-entries-any', defaultMessage: 'No limit' },
    itemsScoringMethodFixed: {
      id: 'assessment/items/scoring-method-fixed',
      defaultMessage: 'Fixed value per entry',
    },
    itemsCeiling: {
      id: 'assessment/items/ceiling',
      defaultMessage: 'Most this question can count',
    },
    // the file kinds an administrator picks from, shared by the question's
    // own fields and by a reviewer asking for more material
    itemsGrantedRoster: {
      id: 'assessment/items/granted-roster',
      defaultMessage: 'This round\u2019s roster',
    },
    itemsGrantedRosterCount: {
      id: 'assessment/items/granted-roster-count',
      defaultMessage: '{count, plural, one {# person} other {# people}}',
    },
    fileKindPdf: { id: 'assessment/files/kind-pdf', defaultMessage: 'PDF' },
    fileKindImage: { id: 'assessment/files/kind-image', defaultMessage: 'Images' },
    fileKindWord: { id: 'assessment/files/kind-word', defaultMessage: 'Word documents' },
    fileKindSheet: { id: 'assessment/files/kind-sheet', defaultMessage: 'Spreadsheets' },
    fileKindSlides: { id: 'assessment/files/kind-slides', defaultMessage: 'Slides' },
    fileKindArchive: { id: 'assessment/files/kind-archive', defaultMessage: 'Archives' },
    itemsAcceptOther: {
      id: 'assessment/items/accept-other',
      defaultMessage: 'Also accept other formats',
    },
    itemsAcceptOtherHint: {
      id: 'assessment/items/accept-other-hint',
      defaultMessage:
        'Comma separated; extensions start with a dot. A format written wrong is refused at upload, so check one real file against it.',
    },
    itemsAcceptResolved: { id: 'assessment/items/accept-resolved', defaultMessage: 'Accepts' },
    itemsAcceptAny: { id: 'assessment/items/accept-any', defaultMessage: 'Anything' },
    itemsAcceptUnwritable: {
      id: 'assessment/items/accept-unwritable',
      defaultMessage: 'Not a format: {tokens}',
    },
    itemsFieldCount: {
      id: 'assessment/items/field-count',
      defaultMessage: '{count, plural, =0 {No fields yet} one {# field} other {# fields}}',
    },
    itemsRequiredCount: {
      id: 'assessment/items/required-count',
      defaultMessage: '{count} required',
    },
    itemsFieldOpenHint: {
      id: 'assessment/items/field-open-hint',
      defaultMessage: 'Open a line to change it',
    },
    itemsKindLocked: {
      id: 'assessment/items/kind-locked',
      defaultMessage: 'The kind cannot change once the question exists.',
    },
    itemsCeilingSource: {
      id: 'assessment/items/ceiling-source',
      defaultMessage: 'The amount comes from {name}.',
    },
    itemsCeilingHow: {
      id: 'assessment/items/ceiling-how',
      defaultMessage: '{value} × {count, plural, one {# entry} other {# entries}}.',
    },
    itemsCeilingHowAny: {
      id: 'assessment/items/ceiling-how-any',
      defaultMessage: 'No limit on entries, so this question has no upper limit of its own.',
    },
    itemsCeilingSectionCapped: {
      id: 'assessment/items/ceiling-section-capped',
      defaultMessage: '{name} up to {value}',
    },
    itemsCeilingSectionFree: {
      id: 'assessment/items/ceiling-section-free',
      defaultMessage: '{name} has no upper limit',
    },
    itemsCeilingNote: {
      id: 'assessment/items/ceiling-note',
      defaultMessage: 'Section limits: {chain}. Anything past them is cut at settlement.',
    },
    /** the same answer as itemsReviewUncovered, in the width a chain step has */
    itemsReviewUncoveredCount: {
      id: 'assessment/items/review-uncovered-count',
      defaultMessage:
        '{count, plural, one {# unit has no reviewer} other {# units have no reviewer}}',
    },
    itemsStageUnset: { id: 'assessment/items/stage-unset', defaultMessage: 'Not set up yet' },
    itemsStageUnsetHint: {
      id: 'assessment/items/stage-unset-hint',
      defaultMessage: 'Say where and who reviews here.',
    },
    itemsEscalated: { id: 'assessment/items/escalated', defaultMessage: 'Escalated' },
    itemsEscalationBy: { id: 'assessment/items/escalation-by', defaultMessage: 'By a reviewer' },
    itemsEscalationSettled: {
      id: 'assessment/items/escalation-settled',
      defaultMessage: 'Escalation settled',
    },
    itemsEscalationSettledSub: {
      id: 'assessment/items/escalation-settled-sub',
      defaultMessage: 'The last step decides',
    },
    itemsCannotSave: {
      id: 'assessment/items/cannot-save',
      defaultMessage: 'Not saved yet: {reasons}.',
    },
    itemsNeedTitle: { id: 'assessment/items/need-title', defaultMessage: 'the title is empty' },
    itemsNeedGroup: { id: 'assessment/items/need-group', defaultMessage: 'no section chosen' },
    itemsNeedValue: {
      id: 'assessment/items/need-value',
      defaultMessage: 'no value per approved entry',
    },
    itemsNeedFieldLabel: {
      id: 'assessment/items/need-field-label',
      defaultMessage: 'a form field has no name',
    },
    itemsNeedStage: {
      id: 'assessment/items/need-stage',
      defaultMessage: 'a review step is not set up',
    },
    itemsEscalationAddStep: {
      id: 'assessment/items/escalation-add-step',
      defaultMessage: 'Add an escalation step',
    },
    itemsPlacementTitle: {
      id: 'assessment/items/placement-title',
      defaultMessage: 'Where it counts',
    },
    itemsPlacementSubtotal: {
      id: 'assessment/items/placement-subtotal',
      defaultMessage: '{name} subtotal',
    },
    itemsPlacementCap: {
      id: 'assessment/items/placement-cap',
      defaultMessage: '{name} upper limit',
    },
    itemsPlacementPaper: { id: 'assessment/items/placement-paper', defaultMessage: 'Round total' },
    itemsVersionTitle: { id: 'assessment/items/version-title', defaultMessage: 'Versions' },
    itemsVersionNote: {
      id: 'assessment/items/version-note',
      defaultMessage: 'Version {no}, saved {date}.',
    },
    itemsVersionNew: {
      id: 'assessment/items/version-new',
      defaultMessage: 'Not saved yet.',
    },
    paperStartAction: { id: 'assessment/items/paper-start-action', defaultMessage: 'Start' },

    /** the filing screen: the round's structure, and one's own claims in it */
    myEntriesCounted: { id: 'assessment/entry/counted', defaultMessage: 'Counted' },
    myEntriesRows: {
      id: 'assessment/entry/rows',
      defaultMessage: '{count, plural, =0 {none} one {# entry} other {# entries}}',
    },
    myEntriesQuestions: {
      id: 'assessment/entry/questions',
      defaultMessage: '{count, plural, one {# question} other {# questions}}',
    },
    myEntriesGroupBadge: { id: 'assessment/entry/group-badge', defaultMessage: 'Section' },
    myEntriesItemBadge: { id: 'assessment/entry/item-badge', defaultMessage: 'Question' },
    myEntriesRecorded: { id: 'assessment/entry/recorded', defaultMessage: 'No filing needed' },
    myEntriesOpen: { id: 'assessment/entry/open', defaultMessage: 'Open to you' },
    myEntriesInGroup: { id: 'assessment/entry/in-group', defaultMessage: 'Yours here' },
    myEntriesHolds: { id: 'assessment/entry/holds', defaultMessage: 'Inside this section' },
    myEntriesHoldsCount: {
      id: 'assessment/entry/holds-count',
      defaultMessage: '{count, plural, one {# row} other {# rows}}',
    },
    myEntriesHoldsEmpty: {
      id: 'assessment/entry/holds-empty',
      defaultMessage: 'Nothing in this section is yours to answer.',
    },
    myEntriesMakeup: { id: 'assessment/entry/makeup', defaultMessage: 'How it adds up' },
    myEntriesFromItems: {
      id: 'assessment/entry/from-items',
      defaultMessage: 'From questions here',
    },
    myEntriesFromChildren: {
      id: 'assessment/entry/from-children',
      defaultMessage: 'From sections inside',
    },
    myEntriesGroupTotal: { id: 'assessment/entry/group-total', defaultMessage: 'Section total' },
    myEntriesMakeupNote: {
      id: 'assessment/entry/makeup-note',
      defaultMessage: 'Approved entries only.',
    },
    myEntriesRoom: {
      id: 'assessment/entry/room',
      defaultMessage: '{used} of {most} filed',
    },
    myEntriesChain: {
      id: 'assessment/entry/chain',
      defaultMessage: '{count, plural, one {# reviewer} other {# reviewers in turn}}',
    },
    myEntriesFiled: { id: 'assessment/entry/filed', defaultMessage: 'What you have filed' },
    myEntriesRecordedFiled: {
      id: 'assessment/entry/recorded-filed',
      defaultMessage: 'What has been recorded',
    },
    myEntriesRecordedNone: {
      id: 'assessment/entry/recorded-none',
      defaultMessage: 'Nothing recorded here yet.',
    },
    myEntriesFiledCount: {
      id: 'assessment/entry/filed-count',
      defaultMessage:
        '{filed, plural, =0 {nothing submitted} other {# submitted}}{drafts, plural, =0 {} other {, # draft}}',
    },
    myEntriesNoneYet: {
      id: 'assessment/entry/none-yet',
      defaultMessage: 'Nothing filed here yet.',
    },
    myEntriesDraftSaved: {
      id: 'assessment/entry/draft-saved',
      defaultMessage: 'Not submitted, saved {when}',
    },
    myEntriesResume: { id: 'assessment/entry/resume', defaultMessage: 'Keep filling in' },
    myEntriesResumeDraft: {
      id: 'assessment/entry/resume-draft',
      defaultMessage: 'Keep filling in the draft',
    },
    entryLastRoom: {
      id: 'assessment/entry/last-room',
      defaultMessage: 'This is the last one this question will take from you.',
    },
    entryAlreadyFiled: {
      id: 'assessment/entry/already-filed',
      defaultMessage: 'Already filed here',
    },
    entryNoDuplicates: {
      id: 'assessment/entry/no-duplicates',
      defaultMessage: 'Do not file the same achievement twice.',
    },
    entryDraftKept: {
      id: 'assessment/entry/draft-kept',
      defaultMessage: 'A draft can be picked up again any time.',
    },
    entrySaveDraft: { id: 'assessment/entry/save-draft', defaultMessage: 'Save as draft' },
    myEntriesWindow: { id: 'assessment/entry/window', defaultMessage: 'Material window' },
    myEntriesWindowValue: {
      id: 'assessment/entry/window-value',
      defaultMessage: '{start} to {end}',
    },
    myEntriesFilterAll: { id: 'assessment/entry/filter-all', defaultMessage: 'All' },
    myEntriesFilterTodo: {
      id: 'assessment/entry/filter-todo',
      defaultMessage: 'Waiting on you',
    },
    myEntriesFilterNone: {
      id: 'assessment/entry/filter-none',
      defaultMessage: 'Nothing is waiting on you.',
    },
    myEntriesHeadroom: {
      id: 'assessment/entry/headroom',
      defaultMessage: '{value} to the cap',
    },
    myEntriesBasis: { id: 'assessment/entry/basis', defaultMessage: 'Scoring basis' },
    myEntriesBasisSoon: {
      id: 'assessment/entry/basis-soon',
      defaultMessage: 'No clause linked yet.',
    },
    entryNth: { id: 'assessment/entry/nth', defaultMessage: 'Claim {n}' },
    entryFlow: { id: 'assessment/entry/flow', defaultMessage: 'After you submit' },
    entryFlowStep: { id: 'assessment/entry/flow-step', defaultMessage: 'Reviewer {n}' },
    entryFlowNote: {
      id: 'assessment/entry/flow-note',
      defaultMessage: 'You can withdraw and change it until the first reviewer acts.',
    },
    entryFileDrop: {
      id: 'assessment/entry/file-drop',
      defaultMessage: 'Drop files here, or click to choose',
    },
    entryFileRoom: {
      id: 'assessment/entry/file-room',
      defaultMessage: '{count, plural, one {# more allowed} other {# more allowed}}',
    },
    entryDateWithin: {
      id: 'assessment/entry/date-within',
      defaultMessage: 'Must fall between {start} and {end}',
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
    settingsUnsaved: { id: 'assessment/settings/unsaved', defaultMessage: 'Not saved yet' },
    settingsLifecycle: { id: 'assessment/settings/lifecycle', defaultMessage: 'This round' },
    settingsLifecycleHint: {
      id: 'assessment/settings/lifecycle-hint',
      defaultMessage: 'An archived batch is read-only: no more filing, no more reviewing.',
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
    'permission-hint.assessment.entry.appeal': {
      id: 'assessment/permission-hint/entry-appeal',
      defaultMessage: 'Ask for a settled entry to be looked at again.',
    },
    'permission-hint.assessment.review.escalate': {
      id: 'assessment/permission-hint/review-escalate',
      defaultMessage: 'Let a reviewer hand on a matter they cannot settle.',
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
    'permission.assessment.entry.appeal': {
      id: 'assessment/permission/entry-appeal',
      defaultMessage: 'Ask for another look',
    },
    'permission.assessment.review.escalate': {
      id: 'assessment/permission/review-escalate',
      defaultMessage: 'Escalate for review',
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
    ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED: {
      id: 'assessment/error/item-change-decision-required',
      defaultMessage: 'Say what should happen to the work already under way.',
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
