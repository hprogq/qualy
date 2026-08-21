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
  defaultMessage:
    '{count, plural, =0 {No participants yet} one {# participant} other {# participants}}',
})

const opensCount = defineMessage<{ count: number }>()({
  id: 'assessment/phase/opens-count',
  defaultMessage:
    '{count, plural, =0 {No actions enabled} one {# action enabled} other {# actions enabled}}',
})

const addPeopleConfirm = defineMessage<{ count: number }>()({
  id: 'assessment/roster/add-confirm',
  defaultMessage: '{count, plural, =0 {Add} one {Add # participant} other {Add # participants}}',
})

const toastImported = defineMessage<{ count: number }>()({
  id: 'assessment/toast/imported',
  defaultMessage: '{count, plural, one {# participant imported} other {# participants imported}}',
})

const toastAdded = defineMessage<{ count: number }>()({
  id: 'assessment/toast/added',
  defaultMessage: '{count, plural, one {# participant added} other {# participants added}}',
})

const toastMerged = defineMessage<{ count: number }>()({
  id: 'assessment/toast/merged',
  defaultMessage: '{count, plural, one {# change applied} other {# changes applied}}',
})

const importCandidates = defineMessage<{ count: number }>()({
  id: 'assessment/roster/import-candidates',
  defaultMessage:
    '{count, plural, =0 {No new participants to add} one {# participant will be added} other {# participants will be added}}',
})

const alsoActiveIn = defineMessage<{ batches: string }>()({
  id: 'assessment/roster/also-active',
  defaultMessage: 'Also participating in: {batches}',
})

const accessSourceCount = defineMessage<{ count: number }>()({
  id: 'assessment/access/source-count',
  defaultMessage: '{count, plural, =0 {No staff yet} one {# person} other {# people}}',
})

const accessRoleAt = defineMessage<{ role: string }>()({
  id: 'assessment/access/role-at',
  defaultMessage: 'Role: {role}',
})

const accessSyncSelected = defineMessage<{ count: number }>()({
  id: 'assessment/access/sync-selected',
  defaultMessage: '{count, plural, =0 {Nothing selected} other {# selected}}',
})

const accessDeniedCount = defineMessage<{ count: number }>()({
  id: 'assessment/access/denied-count',
  defaultMessage: '{count, plural, one {# permission disabled} other {# permissions disabled}}',
})

const discardTitle = defineMessage<{ count: number }>()({
  id: 'assessment/plan/discard-title',
  defaultMessage: 'Discard {count, plural, one {# unsaved change} other {# unsaved changes}}?',
})

const describeTitle = defineMessage<{ name: string }>()({
  id: 'assessment/phase/describe-title',
  defaultMessage: 'Stage details: \u201c{name}\u201d',
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
  defaultMessage: 'Cancel the schedule for \u201c{name}\u201d?',
})

const pendingShort = defineMessage<{ count: number }>()({
  id: 'assessment/plan/pending-short',
  defaultMessage: '{count} unsaved',
})

// what a batch is, in one line: who it assesses and which materials count
const batchSummary = defineMessage<{ count: number; from: string; until: string }>()({
  id: 'assessment/batch/summary',
  defaultMessage:
    '{count, plural, one {# participant} other {# participants}} · materials from {from} to {until}',
})

const batchSummaryDraft = defineMessage<{ units: number; from: string; until: string }>()({
  id: 'assessment/batch/summary-draft',
  defaultMessage:
    '{units, plural, one {# unit} other {# units}} · materials from {from} to {until}',
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
  defaultMessage: '{count, plural, one {# day remaining} other {# days remaining}}',
})
const leftHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-hours',
  defaultMessage: '{count, plural, one {# hour remaining} other {# hours remaining}}',
})
const leftMinutes = defineMessage<{ minutes: number; seconds: number }>()({
  id: 'assessment/progress/left-minutes',
  defaultMessage: '{minutes}m {seconds}s remaining',
})
const leftDaysHours = defineMessage<{ days: number; hours: number }>()({
  id: 'assessment/progress/left-days-hours',
  defaultMessage: '{days}d {hours}h remaining',
})
const leftHoursMinutes = defineMessage<{ hours: number; minutes: number }>()({
  id: 'assessment/progress/left-hours-minutes',
  defaultMessage: '{hours}h {minutes}m remaining',
})
const leftMinutesOnly = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-minutes-only',
  defaultMessage: '{count}m remaining',
})
const leftSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/left-seconds',
  defaultMessage: '{count}s remaining',
})
// The countdown with no room for a sentence, on a bar narrow enough to have
// dropped the stage's name: it says whose clock it is in one word, because
// without it a bare number on a page about a batch reads as the batch's.
const bareDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-days',
  defaultMessage: '{count, plural, one {Stage · # day left} other {Stage · # days left}}',
})
const bareHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-hours',
  defaultMessage: '{count, plural, one {Stage · # hour left} other {Stage · # hours left}}',
})
const bareMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-minutes',
  defaultMessage: '{count, plural, one {Stage · # minute left} other {Stage · # minutes left}}',
})
const bareSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-seconds',
  defaultMessage: '{count, plural, one {Stage · # second left} other {Stage · # seconds left}}',
})
const bareSinceDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-days',
  defaultMessage: '{count, plural, one {Stage · # day elapsed} other {Stage · # days elapsed}}',
})
const bareSinceHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-hours',
  defaultMessage: '{count, plural, one {Stage · # hour elapsed} other {Stage · # hours elapsed}}',
})
const bareSinceMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-minutes',
  defaultMessage:
    '{count, plural, one {Stage · # minute elapsed} other {Stage · # minutes elapsed}}',
})
const bareSinceSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-seconds',
  defaultMessage:
    '{count, plural, one {Stage · # second elapsed} other {Stage · # seconds elapsed}}',
})
const sinceDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-days',
  defaultMessage: '{count, plural, one {Running for # day} other {Running for # days}}',
})
const sinceHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-hours',
  defaultMessage: '{count, plural, one {Running for # hour} other {Running for # hours}}',
})
const sinceMinutes = defineMessage<{ minutes: number; seconds: number }>()({
  id: 'assessment/progress/since-minutes',
  defaultMessage: 'Running for {minutes}m {seconds}s',
})
const sinceDaysHours = defineMessage<{ days: number; hours: number }>()({
  id: 'assessment/progress/since-days-hours',
  defaultMessage: 'Running for {days}d {hours}h',
})
const sinceHoursMinutes = defineMessage<{ hours: number; minutes: number }>()({
  id: 'assessment/progress/since-hours-minutes',
  defaultMessage: 'Running for {hours}h {minutes}m',
})
const sinceMinutesOnly = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-minutes-only',
  defaultMessage: 'Running for {count}m',
})
const sinceSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/since-seconds',
  defaultMessage: 'Running for {count}s',
})

// the round as the people in it read it: when a stage began, when it gives
// way to the next, and nothing about who arranges any of it
const flowFrom = defineMessage<{ when: string }>()({
  id: 'assessment/flow/from',
  defaultMessage: 'Starts {when}',
})
const flowEarlier = defineMessage<{ count: number }>()({
  id: 'assessment/flow/earlier',
  defaultMessage: '{count, plural, one {Show # earlier stage} other {Show # earlier stages}}',
})
const flowFromPending = defineMessage<{ when: string }>()({
  id: 'assessment/flow/from-pending',
  defaultMessage: 'Starts {when}; end time not set',
})
const flowUntil = defineMessage<{ when: string }>()({
  id: 'assessment/flow/until',
  defaultMessage: 'Ends {when}',
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
  defaultMessage: 'Materials: {from} to {until}',
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
  defaultMessage: 'Added {time}',
})

// a group whose own limit moved it says both numbers, so the one that counts
// is never an unexplained figure next to what its questions came to
const groupCapped = defineMessage<{ raw: string; cap: string }>()({
  id: 'assessment/result/group-capped',
  defaultMessage: 'Subtotal {raw}; capped at {cap}',
})

const groupFloored = defineMessage<{ raw: string; floor: string }>()({
  id: 'assessment/result/group-floored',
  defaultMessage: 'Subtotal {raw}; minimum applied: {floor}',
})

const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {
    // ------------------------------------------------------------------
    // the batch list
    batchesTitle: { id: 'assessment/batch/title', defaultMessage: 'Assessment batches' },
    batchesHint: {
      id: 'assessment/batch/hint',
      defaultMessage: 'Manage assessment batches, stage plans, and participant rosters.',
    },
    batchesEmpty: {
      id: 'assessment/batch/empty',
      defaultMessage: 'No assessment batches yet.',
    },
    newBatch: { id: 'assessment/batch/new', defaultMessage: 'New batch' },
    batchesEmptyHint: {
      id: 'assessment/batch/empty-hint',
      defaultMessage: 'Create a batch to configure its stages, participants, and assessment items.',
    },
    searchPlaceholder: {
      id: 'assessment/batch/search',
      defaultMessage: 'Search batch names',
    },
    filterStatus: { id: 'assessment/batch/filter-status', defaultMessage: 'Status' },
    filterAll: { id: 'assessment/batch/filter-all', defaultMessage: 'All' },
    noMatchTitle: { id: 'assessment/batch/no-match', defaultMessage: 'No matching batches' },
    noMatchHint: {
      id: 'assessment/batch/no-match-hint',
      defaultMessage: 'Try another keyword or clear the status filter.',
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
    backToList: { id: 'assessment/batch/back', defaultMessage: 'Back to batches' },

    // the batch form
    nameLabel: { id: 'assessment/batch/name', defaultMessage: 'Name' },
    namePlaceholder: {
      id: 'assessment/batch/name-placeholder',
      defaultMessage: 'e.g. Spring 2026 comprehensive assessment',
    },
    materialRange: {
      id: 'assessment/batch/material-range',
      defaultMessage: 'Material date range',
    },
    pickDateRange: { id: 'assessment/action/pick-date-range', defaultMessage: 'Select date range' },
    stepBasics: { id: 'assessment/batch/step-basics', defaultMessage: 'Basic information' },
    stepScope: { id: 'assessment/batch/step-scope', defaultMessage: 'Initial participants' },
    back: { id: 'assessment/action/back', defaultMessage: 'Back' },
    next: { id: 'assessment/action/next', defaultMessage: 'Next' },
    scopeLegend: { id: 'assessment/batch/scope', defaultMessage: 'Import from these units' },
    scopeEmpty: {
      id: 'assessment/batch/scope-empty',
      defaultMessage: 'No manageable organization units are available.',
    },
    userTypesLegend: {
      id: 'assessment/batch/user-types',
      defaultMessage: 'Participant types',
    },
    userTypesEmpty: {
      id: 'assessment/batch/user-types-empty',
      defaultMessage: 'No participant types are available.',
    },
    create: { id: 'assessment/action/create', defaultMessage: 'Create batch' },
    cancel: { id: 'assessment/action/cancel', defaultMessage: 'Cancel' },

    // status and lifecycle
    statusDraft: { id: 'assessment/status/draft', defaultMessage: 'Draft' },
    // a batch whose first stage has a time but has not arrived yet: running
    // is a promise it has made, not a state it is in
    statusPending: { id: 'assessment/status/pending', defaultMessage: 'Scheduled' },
    statusActive: { id: 'assessment/status/active', defaultMessage: 'In progress' },
    statusArchived: { id: 'assessment/status/archived', defaultMessage: 'Archived' },
    deleteBatch: { id: 'assessment/action/delete', defaultMessage: 'Delete batch' },
    deleteConfirmTitle: {
      id: 'assessment/action/delete-confirm-title',
      defaultMessage: 'Delete the batch?',
    },
    deleteConfirmBody: {
      id: 'assessment/action/delete-confirm-body',
      defaultMessage:
        'The batch has not started. Deleting it removes its configuration and cannot be undone.',
    },
    reopen: { id: 'assessment/action/reopen', defaultMessage: 'Reopen batch' },
    reopenTitle: { id: 'assessment/action/reopen-title', defaultMessage: 'Reopen the batch?' },
    reopenBody: {
      id: 'assessment/action/reopen-body',
      defaultMessage:
        'A new stage will be added at the end and started immediately. Existing stages and data remain unchanged.',
    },
    reopenReason: { id: 'assessment/action/reopen-reason', defaultMessage: 'Reason for reopening' },
    reopenReasonPlaceholder: {
      id: 'assessment/action/reopen-reason-placeholder',
      defaultMessage: 'e.g. some materials were omitted and supplementary submission is required',
    },
    reopenPhaseName: { id: 'assessment/action/reopen-phase', defaultMessage: 'New stage' },
    reopenPhaseHint: {
      id: 'assessment/action/reopen-phase-hint',
      defaultMessage: 'Creates a new stage instead of running an earlier stage again.',
    },
    reopenPhasePlaceholder: {
      id: 'assessment/action/reopen-phase-placeholder',
      defaultMessage: 'e.g. Supplementary submission period',
    },
    archive: { id: 'assessment/action/archive', defaultMessage: 'Archive' },
    archiveConfirmTitle: {
      id: 'assessment/action/archive-confirm-title',
      defaultMessage: 'Archive the batch?',
    },
    archiveConfirmBody: {
      id: 'assessment/action/archive-confirm-body',
      defaultMessage:
        'The batch will become read-only while existing data and results remain available. It can be reopened later.',
    },
    draftBanner: {
      id: 'assessment/batch/draft-banner',
      defaultMessage: 'The batch has not started. Schedule the first stage to activate it.',
    },

    // ------------------------------------------------------------------
    // the stage plan
    switchBatch: { id: 'assessment/batch/switch', defaultMessage: 'Switch batch' },
    notStartedYet: { id: 'assessment/batch/not-started', defaultMessage: 'Not started' },
    plannedStart: { id: 'assessment/batch/planned-start', defaultMessage: 'Scheduled start' },
    noStagesYet: { id: 'assessment/batch/no-stages', defaultMessage: 'No stages configured' },
    currentStage: { id: 'assessment/batch/current-stage', defaultMessage: 'Current stage' },
    flowTitle: { id: 'assessment/flow/title', defaultMessage: 'Stage progress' },
    flowFrom,
    flowUntil,
    viewFullFlow: { id: 'assessment/flow/view', defaultMessage: 'View all stages' },
    flowBackToCurrent: {
      id: 'assessment/flow/back-to-current',
      defaultMessage: 'Back to current stage',
    },
    // a stage with no time still says something about its time: an empty
    // line reads as a screen that failed to load one
    flowPending: { id: 'assessment/flow/pending', defaultMessage: 'Start time not set' },
    flowEndPending: { id: 'assessment/flow/end-pending', defaultMessage: 'End time not set' },
    flowEarlier,
    flowFromPending,
    // said on every stage: a rail of dates leaves the reader counting which
    // of them is behind and which is still to come
    flowStatusEnded: { id: 'assessment/flow/status-ended', defaultMessage: 'Ended' },
    flowStatusCurrent: { id: 'assessment/flow/status-current', defaultMessage: 'In progress' },
    flowStatusFuture: { id: 'assessment/flow/status-future', defaultMessage: 'Not started' },
    bareDays,
    bareHours,
    bareMinutes,
    bareSeconds,
    bareSinceDays,
    bareSinceHours,
    bareSinceMinutes,
    bareSinceSeconds,
    enterBatch: { id: 'assessment/batch/enter', defaultMessage: 'Open assessment' },
    configureBatch: { id: 'assessment/batch/configure', defaultMessage: 'Continue setup' },
    draftHint: {
      id: 'assessment/batch/draft-hint',
      defaultMessage: 'Configure the stages and schedule the first one to activate the batch.',
    },
    groupRunning: { id: 'assessment/batch/group-running', defaultMessage: 'In progress' },
    groupPending: { id: 'assessment/batch/group-pending', defaultMessage: 'Starting soon' },
    groupDraft: { id: 'assessment/batch/group-draft', defaultMessage: 'Drafts' },
    groupEnded: { id: 'assessment/batch/group-ended', defaultMessage: 'Ended' },
    filterEnded: { id: 'assessment/batch/filter-ended', defaultMessage: 'Ended' },
    endedOn: { id: 'assessment/batch/ended-on', defaultMessage: 'Ended {date}' },
    tabPhases: { id: 'assessment/phase/tab', defaultMessage: 'Stages' },
    tabRoster: { id: 'assessment/roster/tab', defaultMessage: 'Participants' },
    tabOverview: { id: 'assessment/overview/tab', defaultMessage: 'Overview' },
    overviewHint: {
      id: 'assessment/overview/hint',
      defaultMessage: 'View batch progress and items requiring your attention.',
    },
    overviewPlaceholder: {
      id: 'assessment/overview/placeholder',
      defaultMessage: 'No content available.',
    },
    // ------------------------------------------------------------------
    // one's own filings
    navGroupPersonal: { id: 'assessment/nav-group/personal', defaultMessage: 'Personal' },
    navGroupWork: { id: 'assessment/nav-group/work', defaultMessage: 'Work' },
    myEntriesTab: { id: 'assessment/entry/tab', defaultMessage: 'My entries' },
    myEntriesEmpty: {
      id: 'assessment/entry/empty',
      defaultMessage:
        'No items are currently open for submission. Available items will appear when the stage opens.',
    },
    itemVoided: {
      id: 'assessment/entry/item-voided',
      defaultMessage: 'The item has been disabled and no longer counts.',
    },
    entryNew: { id: 'assessment/entry/new', defaultMessage: 'New entry' },
    entryEdit: { id: 'assessment/entry/edit', defaultMessage: 'Edit' },
    entrySubmit: { id: 'assessment/entry/submit', defaultMessage: 'Submit' },
    entryWithdraw: { id: 'assessment/entry/withdraw', defaultMessage: 'Withdraw' },
    entrySave: { id: 'assessment/entry/save', defaultMessage: 'Save' },
    entryAppeal: { id: 'assessment/entry/appeal', defaultMessage: 'Appeal' },
    entryAppealTitle: {
      id: 'assessment/entry/appeal-title',
      defaultMessage: 'Appeal the review decision',
    },
    entryAppealHint: {
      id: 'assessment/entry/appeal-hint',
      defaultMessage:
        'Appealing does not change the submitted material. Edit and resubmit if the material itself needs to change.',
    },
    entryAppealReason: {
      id: 'assessment/entry/appeal-reason',
      defaultMessage: 'Reason for appeal',
    },
    entryAppealed: { id: 'assessment/entry/appealed', defaultMessage: 'Appeal submitted.' },
    refuseNothingToAppeal: {
      id: 'assessment/entry/refuse-nothing-to-appeal',
      defaultMessage: 'No review decision is currently available for appeal.',
    },
    refuseReviewOpen: {
      id: 'assessment/entry/refuse-review-open',
      defaultMessage:
        'The submission is still under review. An appeal can be filed after a decision is reached.',
    },
    entryIssueRequired: {
      id: 'assessment/entry/issue-required',
      defaultMessage: 'is required',
    },
    entryIssueOutOfRange: {
      id: 'assessment/entry/issue-out-of-range',
      defaultMessage: 'is outside the material date range',
    },
    entryIssueNotADate: {
      id: 'assessment/entry/issue-not-a-date',
      defaultMessage: 'must be a valid date',
    },
    entryIssueTooLong: {
      id: 'assessment/entry/issue-too-long',
      defaultMessage: 'exceeds the character limit',
    },
    entryIssueTooMany: {
      id: 'assessment/entry/issue-too-many',
      defaultMessage: 'contains more files than allowed',
    },
    entryIssueFileTooLarge: {
      id: 'assessment/entry/issue-file-too-large',
      defaultMessage: 'contains a file that exceeds the size limit',
    },
    entryIssueFileType: {
      id: 'assessment/entry/issue-file-type',
      defaultMessage: 'contains an unsupported file type',
    },
    entryIssueFileMissing: {
      id: 'assessment/entry/issue-file-missing',
      defaultMessage: 'references a file that no longer exists',
    },
    entryIssueFileNotYours: {
      id: 'assessment/entry/issue-file-not-yours',
      defaultMessage: 'references a file uploaded by another user',
    },
    entryIssueFileElsewhere: {
      id: 'assessment/entry/issue-file-elsewhere',
      defaultMessage: 'references a file already used by another entry',
    },
    entryIssueOther: {
      id: 'assessment/entry/issue-other',
      defaultMessage: 'did not pass validation',
    },
    refuseNotYours: {
      id: 'assessment/entry/refuse-not-yours',
      defaultMessage: 'Only the owner of the entry can modify it.',
    },
    refuseNotActive: {
      id: 'assessment/entry/refuse-not-active',
      defaultMessage: 'You are no longer a participant in this batch.',
    },
    refuseOutOfReach: {
      id: 'assessment/entry/refuse-out-of-reach',
      defaultMessage: 'The participant is outside your assigned organization scope.',
    },
    refuseNotEditable: {
      id: 'assessment/entry/refuse-not-editable',
      defaultMessage: 'The entry is under review. Withdraw it before making changes.',
    },
    refuseNeedsRevision: {
      id: 'assessment/entry/refuse-needs-revision',
      defaultMessage:
        'The item requirements have changed. Complete the fields required by the current version before resubmitting.',
    },
    refuseNotSubmittable: {
      id: 'assessment/entry/refuse-not-submittable',
      defaultMessage: 'Only draft entries can be submitted.',
    },
    refuseNotWithdrawable: {
      id: 'assessment/entry/refuse-not-withdrawable',
      defaultMessage:
        'A review decision has already been recorded, so the entry cannot be withdrawn.',
    },
    refuseMaxEntries: {
      id: 'assessment/entry/refuse-max-entries',
      defaultMessage: 'The submission limit for this item has been reached.',
    },
    refuseItemVoided: {
      id: 'assessment/entry/refuse-item-voided',
      defaultMessage: 'The item has been disabled.',
    },
    refuseItemUnconfigured: {
      id: 'assessment/entry/refuse-item-unconfigured',
      defaultMessage: 'The item has not been fully configured. Contact a batch administrator.',
    },
    refuseReviewLevelMissing: {
      id: 'assessment/entry/refuse-review-level-missing',
      defaultMessage:
        'The configured review level does not exist in your organization path, so the entry cannot be submitted. Contact a batch administrator.',
    },
    refuseBasisRequired: {
      id: 'assessment/entry/refuse-basis-required',
      defaultMessage: 'A basis is required for a staff-recorded entry.',
    },
    refuseNotParticipant: {
      id: 'assessment/entry/refuse-not-participant',
      defaultMessage: 'You are not a participant in this batch.',
    },
    refuseNoPermission: {
      id: 'assessment/entry/refuse-no-permission',
      defaultMessage: 'You do not have permission to perform this action in the batch.',
    },
    refuseNotReviewer: {
      id: 'assessment/entry/refuse-not-reviewer',
      defaultMessage: 'You are not assigned to review this submission.',
    },
    refusePhaseClosed: {
      id: 'assessment/entry/refuse-phase-closed',
      defaultMessage: 'The current stage does not allow this action.',
    },
    refuseOutOfScope: {
      id: 'assessment/entry/refuse-out-of-scope',
      defaultMessage: 'The current stage does not cover the selected item or participant.',
    },
    refuseOther: {
      id: 'assessment/entry/refuse-other',
      defaultMessage: 'The action is not available for the entry in its current state.',
    },
    entryNote: { id: 'assessment/entry/note', defaultMessage: 'Note' },
    entryStatusDraft: { id: 'assessment/entry/status-draft', defaultMessage: 'Draft' },
    entryStatusInReview: { id: 'assessment/entry/status-in-review', defaultMessage: 'In review' },
    entryStatusRevising: {
      id: 'assessment/entry/status-revising',
      defaultMessage: 'Awaiting resubmission',
    },
    entryResubmit: { id: 'assessment/entry/resubmit', defaultMessage: 'Resubmit' },
    entryAbandon: { id: 'assessment/entry/abandon', defaultMessage: 'Abandon entry' },
    entryAbandonConfirm: {
      id: 'assessment/entry/abandon-confirm',
      defaultMessage:
        'Abandon the entry? One submission slot will become available, while the historical record is retained.',
    },
    entrySubmitConfirm: {
      id: 'assessment/entry/submit-confirm',
      defaultMessage: 'Hand this claim on for review?',
    },
    entrySubmitConfirmHint: {
      id: 'assessment/entry/submit-confirm-hint',
      defaultMessage:
        'It leaves your hands until a reviewer answers; you may withdraw it while it waits.',
    },
    entryWithdrawConfirm: {
      id: 'assessment/entry/withdraw-confirm',
      defaultMessage: 'Withdraw this claim from review?',
    },
    entryWithdrawConfirmHint: {
      id: 'assessment/entry/withdraw-confirm-hint',
      defaultMessage: 'It goes back to a draft you can edit, and the round it was in ends.',
    },
    entryAbandonConfirmTitle: {
      id: 'assessment/entry/abandon-confirm-title',
      defaultMessage: 'Give this claim up?',
    },
    entryBlockedNow: {
      id: 'assessment/entry/blocked-now',
      defaultMessage: 'The required action is not available in the current stage.',
    },
    refuseNotAbandonable: {
      id: 'assessment/entry/refuse-not-abandonable',
      defaultMessage: 'Withdraw the entry from review before abandoning it.',
    },
    entryStatusNeedsRevision: {
      id: 'assessment/entry/status-needs-revision',
      defaultMessage: 'Additional material required',
    },
    entryStatusApproved: { id: 'assessment/entry/status-approved', defaultMessage: 'Approved' },
    entryStatusRejected: { id: 'assessment/entry/status-rejected', defaultMessage: 'Returned' },
    entryStatusVoided: { id: 'assessment/entry/status-voided', defaultMessage: 'Voided' },
    entryFileUploading: { id: 'assessment/entry/file-uploading', defaultMessage: 'Uploading…' },
    entryFileRemove: { id: 'assessment/entry/file-remove', defaultMessage: 'Remove' },
    entryFileFailed: {
      id: 'assessment/entry/file-failed',
      defaultMessage: 'The file could not be uploaded. Try again.',
    },
    entryFieldCleared: { id: 'assessment/entry/field-cleared', defaultMessage: 'Not provided' },
    entryFileUnnamed: { id: 'assessment/entry/file-unnamed', defaultMessage: 'Attachment' },
    entryHistoryTitle: {
      id: 'assessment/entry/history-title',
      defaultMessage: 'Submission history',
    },
    entryHistoryRound: {
      id: 'assessment/entry/history-round',
      defaultMessage: 'Review round {round}',
    },
    entryHistoryRevision: {
      id: 'assessment/entry/history-revision',
      defaultMessage: 'Version {no}',
    },
    entrySuggestionTitle: {
      id: 'assessment/entry/suggestion-title',
      defaultMessage: 'Reviewer suggestions',
    },
    entrySuggestionHint: {
      id: 'assessment/entry/suggestion-hint',
      defaultMessage: 'Suggestions are optional. Make any appropriate changes before resubmitting.',
    },
    entrySuggestionAdvisory: {
      id: 'assessment/entry/suggestion-advisory',
      defaultMessage: 'For reference',
    },
    // ------------------------------------------------------------------
    // the review queue
    recordNoStanding: {
      id: 'assessment/record/no-standing',
      defaultMessage: 'You do not have permission to record entries in this batch.',
    },
    reviewTab: { id: 'assessment/review/tab', defaultMessage: 'Review' },
    reviewHint: {
      id: 'assessment/review/hint',
      defaultMessage: 'Submissions awaiting your review, oldest first.',
    },
    reviewColumnItem: { id: 'assessment/review/column-item', defaultMessage: 'Item' },
    reviewColumnWho: { id: 'assessment/review/column-who', defaultMessage: 'Applicant' },
    reviewColumnStatus: { id: 'assessment/review/column-status', defaultMessage: 'Status' },
    reviewColumnWhen: { id: 'assessment/review/column-when', defaultMessage: 'Submitted' },
    reviewApplicant: { id: 'assessment/review/applicant', defaultMessage: 'Applicant' },
    reviewRound: { id: 'assessment/review/round', defaultMessage: 'Review round' },
    reviewSubmittedAt: { id: 'assessment/review/submitted-at', defaultMessage: 'Submitted at' },
    reviewTrail: { id: 'assessment/review/trail', defaultMessage: 'Review history' },
    entryCountsFor: {
      id: 'assessment/entry/counts-for',
      defaultMessage: 'Counts for {value} when approved',
    },
    reviewOpen: { id: 'assessment/review/open', defaultMessage: 'Review' },
    reviewDetailTab: { id: 'assessment/review/detail-tab', defaultMessage: 'Review' },
    reviewApprove: { id: 'assessment/review/approve', defaultMessage: 'Approve' },
    reviewReject: { id: 'assessment/review/reject', defaultMessage: 'Return' },
    reviewComment: {
      id: 'assessment/review/comment',
      defaultMessage: 'Review opinion',
    },
    reviewCommentHint: {
      id: 'assessment/review/comment-hint',
      defaultMessage:
        'Explain what needs to be corrected. A note is required when returning a submission.',
    },
    reviewSuggestToggle: {
      id: 'assessment/review/suggest-toggle',
      defaultMessage: 'Add suggested revisions',
    },
    eventSubmitted: {
      id: 'assessment/event/submitted',
      defaultMessage: '{who} submitted the claim for review',
    },
    eventApproved: {
      id: 'assessment/event/approved',
      defaultMessage: '{who} approved this review step',
    },
    eventRejected: {
      id: 'assessment/event/rejected',
      defaultMessage: '{who} returned the submission',
    },
    eventReturnedForRevision: {
      id: 'assessment/event/returned-for-revision',
      defaultMessage: '{who} returned the submission and requested additional material',
    },
    eventForwarded: {
      id: 'assessment/event/forwarded',
      defaultMessage: '{who} moved the submission to the next review step',
    },
    eventEscalated: {
      id: 'assessment/event/escalated',
      defaultMessage: '{who} escalated the submission for further review',
    },
    eventOpinionRejected: {
      id: 'assessment/event/opinion-rejected',
      defaultMessage: '{who} objected to approval',
    },
    eventStageSkipped: {
      id: 'assessment/event/stage-skipped',
      defaultMessage: 'Step skipped: its reviewers are recused from this round',
    },
    eventPanelApproved: {
      id: 'assessment/event/panel-approved',
      defaultMessage: 'The review step approved unanimously',
    },
    eventPanelEscalated: {
      id: 'assessment/event/panel-escalated',
      defaultMessage: 'No unanimous approval; handed to the next review step',
    },
    eventAppealed: {
      id: 'assessment/event/appealed',
      defaultMessage: '{who} appealed the review decision',
    },
    eventAbandoned: {
      id: 'assessment/event/abandoned',
      defaultMessage: '{who} abandoned the entry',
    },
    eventRerouted: {
      id: 'assessment/event/rerouted',
      defaultMessage: 'An administrator changed the review workflow',
    },
    outcomeSuperseded: {
      id: 'assessment/outcome/superseded',
      defaultMessage: 'Continued in a new review round',
    },
    originAppeal: { id: 'assessment/origin/appeal', defaultMessage: 'Appeal' },
    originReroute: {
      id: 'assessment/origin/reroute',
      defaultMessage: 'Continued after a workflow change',
    },
    originReopen: { id: 'assessment/origin/reopen', defaultMessage: 'Reopened' },
    eventComment: { id: 'assessment/event/comment', defaultMessage: '{who} added a review note' },
    eventRecommendApprove: {
      id: 'assessment/event/recommend-approve',
      defaultMessage: '{who} recommended approval',
    },
    eventRecommendReject: {
      id: 'assessment/event/recommend-reject',
      defaultMessage: '{who} recommended returning the submission',
    },
    eventWithdrawn: {
      id: 'assessment/event/withdrawn',
      defaultMessage: '{who} withdrew the entry',
    },
    eventNoReviewer: {
      id: 'assessment/event/no-reviewer',
      defaultMessage: 'No reviewer is currently available for this step',
    },
    eventReviewerFound: {
      id: 'assessment/event/reviewer-found',
      defaultMessage: 'A reviewer is now available and the review has resumed',
    },
    eventItemVoided: {
      id: 'assessment/event/item-voided',
      defaultMessage: 'The item was disabled, ending the current review',
    },
    eventOther: { id: 'assessment/event/other', defaultMessage: 'The record was updated' },
    eventSomebody: { id: 'assessment/event/somebody', defaultMessage: 'Someone' },
    eventYouSubmitted: {
      id: 'assessment/event/you-submitted',
      defaultMessage: 'You submitted the claim for review',
    },
    eventYouWithdrew: {
      id: 'assessment/event/you-withdrew',
      defaultMessage: 'You withdrew the entry',
    },
    eventYouAppealed: {
      id: 'assessment/event/you-appealed',
      defaultMessage: 'You filed an appeal',
    },
    eventYouAbandoned: {
      id: 'assessment/event/you-abandoned',
      defaultMessage: 'You abandoned the entry',
    },
    eventYouSupplemented: {
      id: 'assessment/event/you-supplemented',
      defaultMessage: 'You submitted additional material',
    },
    outcomeApproved: { id: 'assessment/outcome/approved', defaultMessage: 'Approved' },
    outcomeRejected: { id: 'assessment/outcome/rejected', defaultMessage: 'Returned' },
    outcomeCancelled: { id: 'assessment/outcome/cancelled', defaultMessage: 'Ended' },
    outcomeOther: { id: 'assessment/outcome/other', defaultMessage: 'Closed' },
    reviewStageReviewers: {
      id: 'assessment/review/stage-reviewers',
      defaultMessage: 'Current reviewers: {who}',
    },
    reviewStageNobody: {
      id: 'assessment/review/stage-nobody',
      defaultMessage: 'No reviewer is currently available',
    },
    reviewStageNoHolder: {
      id: 'assessment/review/stage-no-holder',
      defaultMessage: 'Skipped: no matching role holder was found above the participant',
    },
    reviewDecided: { id: 'assessment/review/decided', defaultMessage: 'Review decision recorded.' },
    reviewSubmittedBy: {
      id: 'assessment/review/submitted-by',
      defaultMessage: '{name} · review round {round}',
    },
    reviewPayloadTitle: {
      id: 'assessment/review/payload-title',
      defaultMessage: 'Submission content',
    },
    // ------------------------------------------------------------------
    // one's own provisional standing
    resultTab: { id: 'assessment/result/tab', defaultMessage: 'My score' },
    resultHint: {
      id: 'assessment/result/hint',
      defaultMessage:
        'Current score based on approved entries. Final results are determined by the published outcome.',
    },
    resultProvisional: {
      id: 'assessment/result/provisional',
      defaultMessage: 'Current score',
    },
    resultFull: {
      id: 'assessment/result/full',
      defaultMessage: 'Total possible: {value}',
    },
    resultCountedIn: {
      id: 'assessment/result/counted-in',
      defaultMessage: 'Approved and counted',
    },
    resultPendingLabel: {
      id: 'assessment/result/pending-label',
      defaultMessage: 'Under review · not counted yet',
    },
    resultPendingCount: {
      id: 'assessment/result/pending-count',
      defaultMessage: '{count, plural, other {#}}',
    },
    resultTrimmed: {
      id: 'assessment/result/trimmed',
      defaultMessage: 'Excluded by scoring limits',
    },
    resultTableHead: {
      id: 'assessment/result/table-head',
      defaultMessage: 'Groups and items',
    },
    resultCapChip: {
      id: 'assessment/result/cap-chip',
      defaultMessage: 'Limit {value}',
    },
    resultNoCap: {
      id: 'assessment/result/no-cap',
      defaultMessage: 'No limit',
    },
    resultEmptyTitle: {
      id: 'assessment/result/empty-title',
      defaultMessage: 'No approved items counted yet',
    },
    resultEmptyBody: {
      id: 'assessment/result/empty-body',
      defaultMessage:
        'Approved entries will appear here. Entries under review are not counted yet; progress can be checked under My entries.',
    },
    resultGoEntries: {
      id: 'assessment/result/go-entries',
      defaultMessage: 'View my entries',
    },
    resultEmptyCounts: {
      id: 'assessment/result/empty-counts',
      defaultMessage:
        '{pending, plural, other {# under review}}, {drafts, plural, other {# drafts}}',
    },
    resultTotal: { id: 'assessment/result/total', defaultMessage: 'Total' },
    resultGroupItems: { id: 'assessment/result/group-items', defaultMessage: 'Item subtotal' },
    resultGroupChildren: {
      id: 'assessment/result/group-children',
      defaultMessage: 'Subgroup subtotal',
    },
    resultGroupFinal: { id: 'assessment/result/group-final', defaultMessage: 'Counted score' },
    resultGroupCapped: groupCapped,
    resultGroupFloored: groupFloored,
    resultLineExcluded: {
      id: 'assessment/result/line-excluded',
      defaultMessage: 'Returned · not counted',
    },
    resultLineNone: { id: 'assessment/result/line-none', defaultMessage: 'Not submitted' },
    resultLineVoided: {
      id: 'assessment/result/line-voided',
      defaultMessage: 'Item disabled · not counted',
    },
    resultLineAdjustment: {
      id: 'assessment/result/line-adjustment',
      defaultMessage: 'Group limit',
    },
    // ------------------------------------------------------------------
    // recording on someone's behalf
    recordTab: { id: 'assessment/record/tab', defaultMessage: 'Record on behalf' },
    recordHint: {
      id: 'assessment/record/hint',
      defaultMessage:
        'Record an item for a participant. A basis is required, and the entry takes effect immediately.',
    },
    recordEmpty: {
      id: 'assessment/record/empty',
      defaultMessage: 'No staff-recorded items are configured for this batch.',
    },
    recordWho: { id: 'assessment/record/who', defaultMessage: 'Participant' },
    recordBasis: { id: 'assessment/record/basis', defaultMessage: 'Basis' },
    recordBasisHint: {
      id: 'assessment/record/basis-hint',
      defaultMessage:
        'Provide a verifiable source, such as a document title or reference number. Required.',
    },
    recordSubmit: { id: 'assessment/record/submit', defaultMessage: 'Record' },
    recordDone: { id: 'assessment/record/done', defaultMessage: 'Recorded.' },
    // ------------------------------------------------------------------
    // configuring the questions
    itemsTab: { id: 'assessment/items/tab', defaultMessage: 'Item configuration' },
    itemsHint: {
      id: 'assessment/items/hint',
      defaultMessage:
        'Configure groups and assessment items, including submission, scoring, and review rules.',
    },
    itemsStuckTitle: {
      id: 'assessment/items/stuck-title',
      defaultMessage: 'Review steps without an available reviewer',
    },
    itemsStuckRow: {
      id: 'assessment/items/stuck-row',
      defaultMessage:
        '{unit} · {roles} · {count, plural, one {# submission waiting} other {# submissions waiting}}',
    },
    itemsStuckConflict: {
      id: 'assessment/items/stuck-conflict',
      defaultMessage: 'every current reviewer is recused from these rounds',
    },
    itemsStuckSeat: {
      id: 'assessment/items/stuck-seat',
      defaultMessage: 'panel seats are waiting for reviewers',
    },
    itemsStuckHint: {
      id: 'assessment/items/stuck-hint',
      defaultMessage:
        'Assign any listed role in the relevant unit to resume the affected reviews automatically.',
    },
    itemsOutlineAddItem: {
      id: 'assessment/items/outline-add-item',
      defaultMessage: 'Add item',
    },
    itemsOutlineAddGroup: {
      id: 'assessment/items/outline-add-group',
      defaultMessage: 'Add subgroup',
    },
    itemsCapChip: { id: 'assessment/items/cap-chip', defaultMessage: 'Limit {value} pts' },
    itemsGroupUnnamed: { id: 'assessment/items/group-unnamed', defaultMessage: 'Unnamed group' },
    itemsGroupNew: { id: 'assessment/items/group-new', defaultMessage: 'New group' },
    itemsGroupEditing: { id: 'assessment/items/group-editing', defaultMessage: 'Group settings' },
    itemsGroupCapHint: {
      id: 'assessment/items/group-cap-hint',
      defaultMessage: 'Leave blank for no upper limit.',
    },
    itemsGroupFloorHint: {
      id: 'assessment/items/group-floor-hint',
      defaultMessage: 'Leave blank for no lower limit.',
    },
    itemsGroupName: { id: 'assessment/items/group-name', defaultMessage: 'Name' },
    itemsGroupParent: { id: 'assessment/items/group-parent', defaultMessage: 'Parent group' },
    itemsGroupParentHint: {
      id: 'assessment/items/group-parent-hint',
      defaultMessage: 'Select another group to move the current group.',
    },
    itemsGroupCap: { id: 'assessment/items/group-cap', defaultMessage: 'Upper limit' },
    itemsGroupFloor: { id: 'assessment/items/group-floor', defaultMessage: 'Lower limit' },
    itemsGroupRemove: { id: 'assessment/items/group-remove', defaultMessage: 'Delete' },
    itemsGroupRemoveTitle: {
      id: 'assessment/items/group-remove-title',
      defaultMessage: 'Remove this group?',
    },
    itemsGroupRemoveHint: {
      id: 'assessment/items/group-remove-hint',
      defaultMessage: 'Its questions stay; they will need a group before the paper adds up again.',
    },
    itemsGroupsReasonHint: {
      id: 'assessment/items/groups-reason-hint',
      defaultMessage: 'Changes to an active batch require a reason.',
    },
    itemsGroupRefusedHasItems: {
      id: 'assessment/items/group-refused-has-items',
      defaultMessage: 'still contains assessment items and cannot be deleted.',
    },
    itemsGroupRefusedHasChildren: {
      id: 'assessment/items/group-refused-has-children',
      defaultMessage: 'still contains subgroups and cannot be deleted.',
    },
    itemsGroupRefusedFloorAboveCap: {
      id: 'assessment/items/group-refused-floor-above-cap',
      defaultMessage: 'has a lower limit greater than its upper limit.',
    },
    itemsGroupRefusedReason: {
      id: 'assessment/items/group-refused-reason',
      defaultMessage: 'An upper limit changed while the batch is active. Provide a reason below.',
    },
    itemsGroupRefusedParent: {
      id: 'assessment/items/group-refused-parent',
      defaultMessage: 'cannot be moved to the selected location.',
    },
    itemsGroupRefusedNotFound: {
      id: 'assessment/items/group-refused-not-found',
      defaultMessage: 'is no longer part of this batch. Refresh to view the current structure.',
    },
    itemsGroupRefusedOnePaper: {
      id: 'assessment/items/group-refused-one-paper',
      defaultMessage:
        'must remain inside the scoring structure, which already has a top-level group.',
    },
    itemsGroupRefusedOther: {
      id: 'assessment/items/group-refused-other',
      defaultMessage: 'could not be saved.',
    },
    itemsGroupsSaved: { id: 'assessment/items/groups-saved', defaultMessage: 'Groups saved.' },
    itemsListTitle: { id: 'assessment/items/list-title', defaultMessage: 'Items' },
    itemsFieldTitle: { id: 'assessment/items/field-title', defaultMessage: 'Title' },
    itemsFieldGroup: { id: 'assessment/items/field-group', defaultMessage: 'Group' },
    itemsFieldMax: {
      id: 'assessment/items/field-max',
      defaultMessage: 'Entries per participant',
    },
    itemsFieldEntrySource: {
      id: 'assessment/items/field-entry-source',
      defaultMessage: 'Submission method',
    },
    itemsEntrySourceStudent: {
      id: 'assessment/items/entry-source-student',
      defaultMessage: 'Submitted by participants',
    },
    itemsEntrySourceAdministrative: {
      id: 'assessment/items/entry-source-administrative',
      defaultMessage: 'Recorded by staff with a basis',
    },
    itemsFieldUnnamed: { id: 'assessment/items/field-unnamed', defaultMessage: 'Unnamed field' },
    itemsStageSettings: {
      id: 'assessment/items/stage-settings',
      defaultMessage: 'Review step settings',
    },
    itemsTitlePlaceholder: {
      id: 'assessment/items/title-placeholder',
      defaultMessage: 'e.g. Discipline competition award',
    },
    itemsMoveReasonTitle: {
      id: 'assessment/items/move-reason-title',
      defaultMessage: 'Reason for moving the item',
    },
    itemsReasonTitle: { id: 'assessment/items/reason-title', defaultMessage: 'Reason for change' },
    itemsReasonHint: {
      id: 'assessment/items/reason-hint',
      defaultMessage:
        'The batch is active and the change may affect scoring rules. The reason will be visible to affected users.',
    },
    itemsNew: { id: 'assessment/items/new', defaultMessage: 'New item' },
    itemsPublishAfterSave: {
      id: 'assessment/items/publish-after-save',
      defaultMessage: 'Save before publishing.',
    },
    itemsPublish: { id: 'assessment/items/publish', defaultMessage: 'Publish' },
    itemsStatusComposing: { id: 'assessment/items/status-composing', defaultMessage: 'Draft' },
    itemsStatusDraft: { id: 'assessment/items/status-draft', defaultMessage: 'Unpublished' },
    itemsPublished: { id: 'assessment/items/published', defaultMessage: 'Published.' },
    itemsFieldAdd: { id: 'assessment/items/form-add', defaultMessage: 'Add field' },
    itemsFieldRemove: { id: 'assessment/items/form-remove', defaultMessage: 'Delete field' },
    itemsFieldLabel: { id: 'assessment/items/field-label', defaultMessage: 'Display name' },
    itemsFieldType: { id: 'assessment/items/field-type', defaultMessage: 'Type' },
    itemsTypeText: { id: 'assessment/items/type-text', defaultMessage: 'Text' },
    itemsTypeDate: { id: 'assessment/items/type-date', defaultMessage: 'Date' },
    itemsTypeAttachment: { id: 'assessment/items/type-attachment', defaultMessage: 'File' },
    itemsFieldRequired: { id: 'assessment/items/field-required', defaultMessage: 'Required' },
    itemsFieldMaxLength: {
      id: 'assessment/items/field-max-length',
      defaultMessage: 'Maximum characters',
    },
    itemsFieldMinDate: { id: 'assessment/items/field-min-date', defaultMessage: 'Earliest date' },
    itemsDateWindow: {
      id: 'assessment/items/date-window',
      defaultMessage: 'Only materials dated from {from} to {until} count in this batch.',
    },
    itemsFieldMaxDate: { id: 'assessment/items/field-max-date', defaultMessage: 'Latest date' },
    itemsFieldMaxCount: { id: 'assessment/items/field-max-count', defaultMessage: 'Maximum files' },
    itemsFieldMaxSize: {
      id: 'assessment/items/field-max-size',
      defaultMessage: 'Maximum file size (MB)',
    },
    itemsFieldAccept: {
      id: 'assessment/items/field-accept',
      defaultMessage: 'Allowed file types',
    },
    itemsFixedValue: {
      id: 'assessment/items/fixed-value',
      defaultMessage: 'Score per approved entry',
    },
    itemsEscalationTitle: {
      id: 'assessment/items/escalation-title',
      defaultMessage: 'Escalation workflow',
    },
    itemsEscalationHint: {
      id: 'assessment/items/escalation-hint',
      defaultMessage:
        'Reviewers can escalate submissions that require further review; the final step determines the outcome.',
    },
    itemsEscalationEmpty: {
      id: 'assessment/items/escalation-empty',
      defaultMessage:
        'At least one escalation step is required before reviewers can escalate submissions.',
    },
    itemsStageAdd: { id: 'assessment/items/stage-add', defaultMessage: 'Add review step' },
    itemsStageRemove: { id: 'assessment/items/stage-remove', defaultMessage: 'Delete step' },
    itemsStageKind: {
      id: 'assessment/items/stage-kind',
      defaultMessage: 'Reviewer assignment method',
    },
    itemsStageLabel: {
      id: 'assessment/items/stage-label',
      defaultMessage: 'Step name',
    },
    itemsStageLabelHint: {
      id: 'assessment/items/stage-label-hint',
      defaultMessage: 'Required. Shown wherever the route is displayed.',
    },
    itemsStageLabelPlaceholder: {
      id: 'assessment/items/stage-label-placeholder',
      defaultMessage: 'e.g. First review',
    },
    itemsStageUnnamed: {
      id: 'assessment/items/stage-unnamed',
      defaultMessage: 'Unnamed step',
    },
    itemsStageKeepOne: {
      id: 'assessment/items/stage-keep-one',
      defaultMessage: 'The ordinary route keeps at least one step',
    },
    itemsStageMoveEarlier: {
      id: 'assessment/items/stage-move-earlier',
      defaultMessage: 'Move earlier',
    },
    itemsStageMoveLater: {
      id: 'assessment/items/stage-move-later',
      defaultMessage: 'Move later',
    },
    itemsStageParticipation: {
      id: 'assessment/items/stage-participation',
      defaultMessage: 'Handling',
    },
    itemsStageAnyone: {
      id: 'assessment/items/stage-anyone',
      defaultMessage: 'Any one reviewer',
    },
    itemsStageAnyoneHint: {
      id: 'assessment/items/stage-anyone-hint',
      defaultMessage: 'One reviewer answers for this step.',
    },
    itemsStageEveryone: {
      id: 'assessment/items/stage-everyone',
      defaultMessage: 'Everyone together',
    },
    itemsStageEveryoneHint: {
      id: 'assessment/items/stage-everyone-hint',
      defaultMessage:
        'Every eligible reviewer weighs in: unanimous approval settles it, anything else hands it to the next review step.',
    },
    itemsStageRoleAt: {
      id: 'assessment/items/stage-role-at',
      defaultMessage: 'At a specified organization level',
    },
    itemsStageNearestRole: {
      id: 'assessment/items/stage-nearest-role',
      defaultMessage: 'Nearest matching role upward',
    },
    itemsStageNearestHint: {
      id: 'assessment/items/stage-nearest-hint',
      defaultMessage:
        'Searches upward from the participant\u2019s unit for the nearest person holding the selected role.',
    },
    itemsStageRole: { id: 'assessment/items/stage-role', defaultMessage: 'Role' },
    entryDeclare: { id: 'assessment/entry/declare', defaultMessage: 'Confirm submission' },
    entryDeclaredFiled: {
      id: 'assessment/entry/declared-filed',
      defaultMessage: 'Submitted and sent for review.',
    },
    entryDeclaredCounted: {
      id: 'assessment/entry/declared-counted',
      defaultMessage: 'Submitted and counted.',
    },
    myEntriesGranted: {
      id: 'assessment/entry/granted',
      defaultMessage: 'Automatically counted · no submission required',
    },
    itemsKind: { id: 'assessment/items/kind', defaultMessage: 'Item type' },
    itemsKindEvidence: {
      id: 'assessment/items/kind-evidence',
      defaultMessage: 'Form entry',
    },
    itemsKindEvidenceHint: {
      id: 'assessment/items/kind-evidence-hint',
      defaultMessage: 'Enter information or upload supporting material before submitting',
    },
    itemsKindDeclaration: {
      id: 'assessment/items/kind-declaration',
      defaultMessage: 'Confirmation',
    },
    itemsKindDeclarationHint: {
      id: 'assessment/items/kind-declaration-hint',
      defaultMessage: 'No fields required; confirm and submit',
    },
    itemsKindConstant: {
      id: 'assessment/items/kind-constant',
      defaultMessage: 'Automatic',
    },
    itemsKindConstantHint: {
      id: 'assessment/items/kind-constant-hint',
      defaultMessage: 'No participant action required; the system applies the score automatically',
    },
    itemsDeclaredHint: {
      id: 'assessment/items/declared-hint',
      defaultMessage: 'A single confirmation completes the submission',
    },
    itemsDeclaredBody: {
      id: 'assessment/items/declared-body',
      defaultMessage:
        'Participants submit the item by confirming once. Use the description above to state exactly what they are confirming.',
    },
    itemsGrantedTitle: {
      id: 'assessment/items/granted-title',
      defaultMessage: 'Eligible participants',
    },
    itemsGrantedHint: {
      id: 'assessment/items/granted-hint',
      defaultMessage: 'No submission or review required',
    },
    itemsGrantedBody: {
      id: 'assessment/items/granted-body',
      defaultMessage: 'Every participant in the batch receives the value configured below.',
    },
    itemsReviewWorkflow: {
      id: 'assessment/items/review-workflow',
      defaultMessage: 'Use review workflow',
    },
    itemsReviewNone: { id: 'assessment/items/review-none', defaultMessage: 'No review required' },
    itemsReviewNoneHint: {
      id: 'assessment/items/review-none-hint',
      defaultMessage: 'The score is counted immediately after submission.',
    },
    resultDerived: {
      id: 'assessment/result/derived',
      defaultMessage: 'Automatically counted',
    },
    itemsFolding: { id: 'assessment/items/folding', defaultMessage: 'Multiple-entry scoring' },
    itemsFoldingHint: {
      id: 'assessment/items/folding-hint',
      defaultMessage: 'Controls how multiple approved entries contribute to the item score',
    },
    itemsFoldingSum: {
      id: 'assessment/items/folding-sum',
      defaultMessage: 'Add all approved entries',
    },
    itemsFoldingMax: {
      id: 'assessment/items/folding-max',
      defaultMessage: 'Count only the highest',
    },
    itemsFoldingTopN: {
      id: 'assessment/items/folding-top-n',
      defaultMessage: 'Count the top N entries',
    },
    itemsFoldingN: { id: 'assessment/items/folding-n', defaultMessage: 'Number of entries' },
    itemsFoldingSumHint: {
      id: 'assessment/items/folding-sum-hint',
      defaultMessage: 'Every approved entry contributes to the score',
    },
    itemsFoldingMaxHint: {
      id: 'assessment/items/folding-max-hint',
      defaultMessage: 'Only the approved entry with the highest score is counted',
    },
    itemsFoldingTopNHint: {
      id: 'assessment/items/folding-top-n-hint',
      defaultMessage: 'The N highest approved entries are added together',
    },
    resultNotCounted: {
      id: 'assessment/result/not-counted',
      defaultMessage: 'Approved, but another entry is counted under this item\u2019s scoring rule',
    },
    reviewChainTitle: { id: 'assessment/review/chain-title', defaultMessage: 'Review workflow' },
    reviewStageHere: { id: 'assessment/review/stage-here', defaultMessage: 'Current step' },
    reviewStageSkipped: {
      id: 'assessment/review/stage-skipped',
      defaultMessage:
        'Skipped: the participant\u2019s organization path does not contain this level',
    },
    reviewEscalate: { id: 'assessment/review/escalate', defaultMessage: 'Escalate' },
    reviewRouteNormal: { id: 'assessment/review/route-normal', defaultMessage: 'Standard review' },
    reviewRouteEscalation: {
      id: 'assessment/review/route-escalation',
      defaultMessage: 'Escalation review',
    },
    reviewCommentAction: {
      id: 'assessment/review/comment-action',
      defaultMessage: 'Add note',
    },
    reviewSayTitle: { id: 'assessment/review/say-title', defaultMessage: 'Review note' },
    // the review queue, laid out three ways
    reviewStatPending: { id: 'assessment/review/stat-pending', defaultMessage: 'Awaiting review' },
    reviewStatToday: { id: 'assessment/review/stat-today', defaultMessage: 'Reviewed today' },
    reviewTabByItem: { id: 'assessment/review/tab-by-item', defaultMessage: 'By item' },
    reviewTabByTime: { id: 'assessment/review/tab-by-time', defaultMessage: 'By submission time' },
    reviewTabByPerson: {
      id: 'assessment/review/tab-by-person',
      defaultMessage: 'By participant',
    },
    reviewFilterAllItems: {
      id: 'assessment/review/filter-all-items',
      defaultMessage: 'All items',
    },
    reviewFilterAllUnits: {
      id: 'assessment/review/filter-all-units',
      defaultMessage: 'All units',
    },
    reviewSearchPlaceholder: {
      id: 'assessment/review/search-placeholder',
      defaultMessage: 'Search name, ID, or submission content',
    },
    reviewMatchesNone: {
      id: 'assessment/review/matches-none',
      defaultMessage: 'No pending submissions match the current filters.',
    },
    reviewGroupCount: {
      id: 'assessment/review/group-count',
      defaultMessage: '{count} pending',
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
      defaultMessage: 'Awaiting review',
    },
    reviewStateRound: { id: 'assessment/review/state-round', defaultMessage: 'Round {round}' },
    reviewStateEscalated: {
      id: 'assessment/review/state-escalated',
      defaultMessage: 'Under escalation review',
    },
    reviewFilesCount: { id: 'assessment/review/files-count', defaultMessage: '{count} files' },
    reviewNoStandingHint: {
      id: 'assessment/review/no-standing-hint',
      defaultMessage: 'Contact a batch administrator to be assigned an appropriate review role.',
    },
    // the workbench: one submission, judged in a run
    reviewQueueTitle: { id: 'assessment/review/queue-title', defaultMessage: 'Pending reviews' },
    reviewRunPosition: {
      id: 'assessment/review/run-position',
      defaultMessage: '{at}/{count}',
    },
    reviewRunExit: { id: 'assessment/review/run-exit', defaultMessage: 'Exit continuous review' },
    reviewPrior: { id: 'assessment/review/prior', defaultMessage: 'Review history' },
    reviewPreviousTitle: {
      id: 'assessment/review/previous-title',
      defaultMessage: 'Previous return reasons',
    },
    reviewPreviousHint: {
      id: 'assessment/review/previous-hint',
      defaultMessage: 'Confirm whether the requested changes have been addressed.',
    },
    reviewInsight: { id: 'assessment/review/insight', defaultMessage: 'Review assistance' },
    reviewInsightSoon: {
      id: 'assessment/review/insight-soon',
      defaultMessage: 'No review assistance is currently available.',
    },
    reviewAboutSection: {
      id: 'assessment/review/about-section',
      defaultMessage: 'About this question',
    },
    reviewQueueKey: { id: 'assessment/review/queue-key', defaultMessage: 'Queue' },
    timeYesterday: { id: 'assessment/time/yesterday', defaultMessage: 'Yesterday' },
    entrySubmittedToast: {
      id: 'assessment/entry/submitted-toast',
      defaultMessage: 'Submitted for review.',
    },
    entryDraftSavedToast: {
      id: 'assessment/entry/draft-saved-toast',
      defaultMessage: 'Draft saved.',
    },
    entryWithdrawnToast: {
      id: 'assessment/entry/withdrawn-toast',
      defaultMessage: 'Submission withdrawn; it is a draft again.',
    },
    entryAbandonedToast: {
      id: 'assessment/entry/abandoned-toast',
      defaultMessage: 'Claim abandoned.',
    },
    reviewTipApproveMid: {
      id: 'assessment/review/tip-approve-mid',
      defaultMessage: 'Pass this step; the next step of the route takes over',
    },
    reviewTipRejectMid: {
      id: 'assessment/review/tip-reject-mid',
      defaultMessage: 'Record your objection; the next review step rules on it',
    },
    reviewTipEscalateMid: {
      id: 'assessment/review/tip-escalate-mid',
      defaultMessage: 'Hand this to the next review step',
    },
    reviewBlockedNoRoute: {
      id: 'assessment/review/blocked-no-route',
      defaultMessage: 'No escalation route is configured for this question',
    },
    reviewBlockedRouteClosed: {
      id: 'assessment/review/blocked-route-closed',
      defaultMessage: 'The escalation route has no step that can take this',
    },
    reviewBlockedPhaseClosed: {
      id: 'assessment/review/blocked-phase-closed',
      defaultMessage: 'The current stage does not open escalation',
    },
    reviewBlockedRouteEnd: {
      id: 'assessment/review/blocked-route-end',
      defaultMessage: 'This is the final review step',
    },
    reviewBlockedUnavailable: {
      id: 'assessment/review/blocked-unavailable',
      defaultMessage: 'Not available here',
    },
    reviewApproveTitle: {
      id: 'assessment/review/approve-title',
      defaultMessage: 'Approve {name}’s submission',
    },
    reviewApproveSheetHint: {
      id: 'assessment/review/approve-sheet-hint',
      defaultMessage: 'The opinion is optional; the participant will see it.',
    },
    reviewApproveHint: {
      id: 'assessment/review/approve-hint',
      defaultMessage: 'Optional; the participant will see it.',
    },
    reviewSlideApprove: {
      id: 'assessment/review/slide-approve',
      defaultMessage: 'Slide to approve',
    },
    reviewSlideReject: {
      id: 'assessment/review/slide-reject',
      defaultMessage: 'Slide to send back',
    },
    reviewSlideEscalate: {
      id: 'assessment/review/slide-escalate',
      defaultMessage: 'Slide to escalate',
    },
    reviewSlideSupplement: {
      id: 'assessment/review/slide-supplement',
      defaultMessage: 'Slide to send the request',
    },
    reviewSheetFillFirst: {
      id: 'assessment/review/sheet-fill-first',
      defaultMessage: 'Complete the required fields first',
    },
    reviewBackToTop: { id: 'assessment/review/back-to-top', defaultMessage: 'Back to top' },
    reviewAboutTitle: {
      id: 'assessment/review/about-title',
      defaultMessage: 'Scoring rules',
    },
    reviewAboutEach: {
      id: 'assessment/review/about-each',
      defaultMessage: 'Score when approved',
    },
    reviewAboutMax: {
      id: 'assessment/review/about-max',
      defaultMessage: 'Submission limit per participant',
    },
    reviewAboutGroupCap: { id: 'assessment/review/about-group-cap', defaultMessage: 'Group limit' },
    reviewSiblingsTitle: {
      id: 'assessment/review/siblings-title',
      defaultMessage: 'Other entries from this participant',
    },
    reviewSiblingThis: { id: 'assessment/review/sibling-this', defaultMessage: 'Current entry' },
    reviewSiblingsFull: {
      id: 'assessment/review/siblings-full',
      defaultMessage: 'Approval will reach the submission limit for this item.',
    },
    reviewCommentPlaceholder: {
      id: 'assessment/review/comment-placeholder',
      defaultMessage: 'Enter a review note',
    },
    reviewCommentPlaceholderAdvise: {
      id: 'assessment/review/comment-placeholder-advise',
      defaultMessage: 'Enter your review opinion',
    },
    reviewUndo: { id: 'assessment/review/undo', defaultMessage: 'Undo' },
    reviewBackToQueue: {
      id: 'assessment/review/back-to-queue',
      defaultMessage: 'Back to pending reviews',
    },
    reviewRunStart: { id: 'assessment/review/run-start', defaultMessage: 'Start reviewing' },
    reviewFiled: { id: 'assessment/review/filed', defaultMessage: 'Submission content' },
    reviewFiledVersionShort: {
      id: 'assessment/review/filed-version-short',
      defaultMessage: 'v{no}',
    },
    reviewFiledVersion: {
      id: 'assessment/review/filed-version',
      defaultMessage: 'Version {no}\u3000{at}',
    },
    // the button says what pressing it does, not what the screen is doing:
    // a toggle labelled with its own state reads as a claim, not a control
    reviewCompareOn: { id: 'assessment/review/compare-on', defaultMessage: 'Compare versions' },
    reviewCompareOff: { id: 'assessment/review/compare-off', defaultMessage: 'Stop comparison' },
    reviewPickVersion: {
      id: 'assessment/review/pick-version',
      defaultMessage: 'Select comparison version',
    },
    reviewCompareCount: {
      id: 'assessment/review/compare-count',
      defaultMessage:
        '{count, plural, =0 {No changes from version {no}} one {# change from version {no}} other {# changes from version {no}}}',
    },
    reviewComparePrevious: {
      id: 'assessment/review/compare-previous',
      defaultMessage: 'Previous value',
    },
    reviewCompareBlank: { id: 'assessment/review/compare-blank', defaultMessage: 'Not provided' },
    reviewVersionsTitle: {
      id: 'assessment/review/versions-title',
      defaultMessage: 'Select a version to compare',
    },
    reviewVersionsSubtitle: {
      id: 'assessment/review/versions-subtitle',
      defaultMessage: '{name}\u3000{item}, {count} versions',
    },
    reviewVersionName: { id: 'assessment/review/version-name', defaultMessage: 'Version {no}' },
    reviewVersionJudged: {
      id: 'assessment/review/version-judged',
      defaultMessage: 'Current review version',
    },
    reviewVersionComparing: {
      id: 'assessment/review/version-comparing',
      defaultMessage: 'Comparison version',
    },
    reviewVersionBy: { id: 'assessment/review/version-by', defaultMessage: 'Submitted by {who}' },
    reviewVersionsFoot: {
      id: 'assessment/review/versions-foot',
      defaultMessage: 'Changes will be highlighted in the submission content.',
    },
    reviewVersionsConfirm: {
      id: 'assessment/review/versions-confirm',
      defaultMessage: 'Compare with version {no}',
    },
    reviewVersionsConfirmNone: {
      id: 'assessment/review/versions-confirm-none',
      defaultMessage: 'Select a version',
    },
    reviewTrailFullOpen: {
      id: 'assessment/review/trail-full-open',
      defaultMessage: 'View full history',
    },
    reviewTrailTitle: {
      id: 'assessment/review/trail-title',
      defaultMessage: 'Complete review history',
    },
    reviewTrailOpen: { id: 'assessment/review/trail-open', defaultMessage: 'View full history' },
    reviewTrailRound: { id: 'assessment/review/trail-round', defaultMessage: 'Review round {no}' },
    reviewDownloadAll: { id: 'assessment/review/download-all', defaultMessage: 'Download all' },
    reviewTipApprove: {
      id: 'assessment/review/tip-approve',
      defaultMessage: 'Approve and count toward the participant\u2019s score',
    },
    reviewTipReject: {
      id: 'assessment/review/tip-reject',
      defaultMessage: 'Return to the participant for revision and resubmission',
    },
    reviewTipEscalate: {
      id: 'assessment/review/tip-escalate',
      defaultMessage: 'Move the submission to the escalation workflow',
    },
    reviewHintPickFirst: {
      id: 'assessment/review/hint-pick-first',
      defaultMessage: 'Select a review decision before submitting.',
    },
    reviewHintLastStep: {
      id: 'assessment/review/hint-last-step',
      defaultMessage: 'This is the final review step. Approval completes the review.',
    },
    // the three ways a queue is empty
    reviewAllDoneTitle: {
      id: 'assessment/review/all-done-title',
      defaultMessage: 'All current review tasks are complete',
    },
    reviewAllDoneBody: {
      id: 'assessment/review/all-done-body',
      defaultMessage: '{count} reviewed today.',
    },
    reviewNothingTitle: {
      id: 'assessment/review/nothing-title',
      defaultMessage: 'No pending review tasks',
    },
    reviewNothingBody: {
      id: 'assessment/review/nothing-body',
      defaultMessage: 'New review tasks will appear automatically when they become available.',
    },
    reviewNoRoleTitle: {
      id: 'assessment/review/no-role-title',
      defaultMessage: 'You do not have review permission for this batch',
    },
    reviewFirstOne: {
      id: 'assessment/review/first-one',
      defaultMessage: 'Already at the first entry',
    },
    reviewLastOne: {
      id: 'assessment/review/last-one',
      defaultMessage: 'Already at the last entry',
    },
    reviewUndoPending: {
      id: 'assessment/review/undo-pending',
      defaultMessage: 'Submitting in {seconds}s · undo before submission',
    },
    reviewEscBannerTitle: {
      id: 'assessment/review/esc-banner-title',
      defaultMessage: 'The submission is in the escalation workflow',
    },
    reviewEscBannerBody: {
      id: 'assessment/review/esc-banner-body',
      defaultMessage:
        'Your review opinion will be included with the information provided to the final reviewer.',
    },
    // the supplement exchange: ask for more backing, answer, take back
    reviewFileAdded: { id: 'assessment/review/file-added', defaultMessage: 'Added' },
    reviewFileGone: {
      id: 'assessment/review/file-gone',
      defaultMessage: 'Removed in this version',
    },
    reviewFilesNote: {
      id: 'assessment/review/files-note',
      defaultMessage:
        'Materials are grouped under their corresponding fields. Files removed in this version remain listed for comparison with the previous version.',
    },
    reviewThisRound: { id: 'assessment/review/this-round', defaultMessage: 'Current review round' },
    reviewAwaitingYou: {
      id: 'assessment/review/awaiting-you',
      defaultMessage: 'Awaiting your review',
    },
    reviewStagePassed: {
      id: 'assessment/review/stage-passed',
      defaultMessage: 'Approved',
    },
    reviewStageStepped: {
      id: 'assessment/review/stage-stepped',
      defaultMessage: 'Skipped',
    },
    reviewOpinionApprove: {
      id: 'assessment/review/opinion-approve',
      defaultMessage: 'For approval',
    },
    reviewOpinionReject: {
      id: 'assessment/review/opinion-reject',
      defaultMessage: 'Against approval',
    },
    reviewAppealBannerTitle: {
      id: 'assessment/review/appeal-banner-title',
      defaultMessage: 'Appeal review',
    },
    reviewAboutGroupCapNamed: {
      id: 'assessment/review/about-group-cap-named',
      defaultMessage: '{group} limit',
    },
    reviewSiblingsKeys: {
      id: 'assessment/review/siblings-keys',
      defaultMessage: '⌥ 1 to {count}',
    },
    reviewInsightCaveat: {
      id: 'assessment/review/insight-caveat',
      defaultMessage: 'May contain errors; verify manually',
    },
    reviewFileSupplement: {
      id: 'assessment/review/file-supplement',
      defaultMessage: 'Additional material',
    },
    reviewSupplementSection: {
      id: 'assessment/review/supplement-section',
      defaultMessage: 'Additional material',
    },
    reviewSupplementSectionNote: {
      id: 'assessment/review/supplement-section-note',
      defaultMessage:
        'Provided in response to a reviewer request and separate from the original submission fields',
    },
    reviewPreviousWithdrawn: {
      id: 'assessment/review/previous-withdrawn',
      defaultMessage:
        'The previous round ended before review because the participant withdrew the entry',
    },
    reviewPreviousRerouted: {
      id: 'assessment/review/previous-rerouted',
      defaultMessage: 'The previous round ended when the review process was adjusted',
    },
    reviewPreviousApproved: {
      id: 'assessment/review/previous-approved',
      defaultMessage: 'The previous round approved this claim',
    },
    reviewEarlierWithdrawn: {
      id: 'assessment/review/earlier-withdrawn',
      defaultMessage: 'Withdrawn by the participant',
    },
    reviewEarlierReturned: {
      id: 'assessment/review/earlier-returned',
      defaultMessage: 'Returned for revision',
    },
    reviewEarlierRounds: {
      id: 'assessment/review/earlier-rounds',
      defaultMessage: 'Earlier review rounds',
    },
    reviewEarlierCount: {
      id: 'assessment/review/earlier-count',
      defaultMessage: '{count, plural, one {# earlier round} other {# earlier rounds}}',
    },
    reviewHadSupplements: {
      id: 'assessment/review/had-supplements',
      defaultMessage: 'Additional material was requested',
    },
    reviewKeysHint: { id: 'assessment/review/keys-hint', defaultMessage: 'Keyboard shortcuts ?' },
    reviewQueueFold: {
      id: 'assessment/review/queue-fold',
      defaultMessage: 'Collapse pending reviews',
    },
    reviewQueueUnfold: {
      id: 'assessment/review/queue-unfold',
      defaultMessage: 'Expand pending reviews',
    },
    reviewSupplementAsk: {
      id: 'assessment/review/supplement-ask',
      defaultMessage: 'Request additional material',
    },
    reviewSupplementAsked: {
      id: 'assessment/review/supplement-asked',
      defaultMessage: 'Additional material requested',
    },
    reviewKeySiblings: {
      id: 'assessment/review/key-siblings',
      defaultMessage: 'Open another entry from the participant',
    },
    reviewKeySupplement: {
      id: 'assessment/review/key-supplement',
      defaultMessage: 'Request additional material',
    },
    // the queue's other half: what this step is waiting on somebody else for
    reviewAwaitingEmpty: {
      id: 'assessment/review/awaiting-empty',
      defaultMessage: 'No submissions are currently awaiting additional material.',
    },
    reviewAwaitingTitle: {
      id: 'assessment/review/awaiting-title',
      defaultMessage: 'Awaiting additional material',
    },
    reviewAwaitingCount: { id: 'assessment/review/awaiting-count', defaultMessage: '{count}' },
    reviewAwaitingBack: {
      id: 'assessment/review/awaiting-back',
      defaultMessage: '{count} completed',
    },
    reviewAwaitingNote: {
      id: 'assessment/review/awaiting-note',
      defaultMessage:
        'Not included in the pending review count; completed submissions return to the review queue',
    },
    reviewAwaitingColAsk: {
      id: 'assessment/review/awaiting-col-ask',
      defaultMessage: 'Item and request',
    },
    reviewAwaitingColWaited: {
      id: 'assessment/review/awaiting-col-waited',
      defaultMessage: 'Waiting time',
    },
    reviewAwaitingColAskedAt: {
      id: 'assessment/review/awaiting-col-asked-at',
      defaultMessage: 'Requested at',
    },
    reviewAwaitingWant: {
      id: 'assessment/review/awaiting-want',
      defaultMessage: 'Requested: {what}',
    },
    reviewAwaitingAnswered: {
      id: 'assessment/review/awaiting-answered',
      defaultMessage: 'Material submitted · awaiting review',
    },
    reviewAwaitingGo: { id: 'assessment/review/awaiting-go', defaultMessage: 'Review' },
    reviewAwaitingFoot: {
      id: 'assessment/review/awaiting-foot',
      defaultMessage:
        'Withdrawing the request returns the submission to the review queue immediately. Any material already submitted remains in the review history.',
    },
    reviewAwaitingHint: {
      id: 'assessment/review/awaiting-hint',
      defaultMessage:
        'Submissions remain in this section until the requested material is provided.',
    },
    reviewTipSupplement: {
      id: 'assessment/review/tip-supplement',
      defaultMessage:
        'Request additional supporting material without changing the original submission',
    },
    supplementDialogTitle: {
      id: 'assessment/supplement/dialog-title',
      defaultMessage: 'Request additional material',
    },
    supplementDialogHint: {
      id: 'assessment/supplement/dialog-hint',
      defaultMessage:
        'Specify what is required. The submission returns to your review queue after the participant responds.',
    },
    supplementInstructionsLabel: {
      id: 'assessment/supplement/instructions-label',
      defaultMessage: 'Requirements and reason',
    },
    supplementPiecesLabel: {
      id: 'assessment/supplement/pieces-label',
      defaultMessage: 'Required material',
    },
    supplementAddText: {
      id: 'assessment/supplement/add-text',
      defaultMessage: 'Written explanation',
    },
    supplementAddFile: { id: 'assessment/supplement/add-file', defaultMessage: 'File' },
    supplementPieceLabel: {
      id: 'assessment/supplement/piece-label',
      defaultMessage: 'Material name',
    },
    supplementPieceRequired: {
      id: 'assessment/supplement/piece-required',
      defaultMessage: 'Required',
    },
    supplementPieceRemove: { id: 'assessment/supplement/piece-remove', defaultMessage: 'Delete' },
    supplementSend: { id: 'assessment/supplement/send', defaultMessage: 'Send request' },
    supplementSent: { id: 'assessment/supplement/sent', defaultMessage: 'Request sent.' },
    supplementWaitingTitle: {
      id: 'assessment/supplement/waiting-title',
      defaultMessage: 'Awaiting additional material',
    },
    supplementWaitingBody: {
      id: 'assessment/supplement/waiting-body',
      defaultMessage: 'The submission will return to the review queue after {who} responds.',
    },
    supplementWithdraw: {
      id: 'assessment/supplement/withdraw',
      defaultMessage: 'Withdraw request',
    },
    supplementWithdrawConfirm: {
      id: 'assessment/supplement/withdraw-confirm',
      defaultMessage: 'Withdraw the request for more material?',
    },
    supplementWithdrawConfirmHint: {
      id: 'assessment/supplement/withdraw-confirm-hint',
      defaultMessage:
        'The submission returns to your queue and the request stops showing on their side.',
    },
    supplementWithdrawn: {
      id: 'assessment/supplement/withdrawn',
      defaultMessage: 'Request withdrawn.',
    },
    supplementSectionTitle: {
      id: 'assessment/supplement/section-title',
      defaultMessage: 'Additional material',
    },
    supplementRequestHeading: {
      id: 'assessment/supplement/request-heading',
      defaultMessage: 'Request {no}',
    },
    supplementStatusOpen: {
      id: 'assessment/supplement/status-open',
      defaultMessage: 'Awaiting response',
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
      defaultMessage: '{who} requested additional material',
    },
    eventSupplementSubmitted: {
      id: 'assessment/event/supplement-submitted',
      defaultMessage: '{who} submitted additional material',
    },
    eventSupplementCancelled: {
      id: 'assessment/event/supplement-cancelled',
      defaultMessage: '{who} withdrew the material request',
    },
    entryRefusedTitle: {
      id: 'assessment/entry/refused-title',
      defaultMessage: 'The reviewer returned the submission',
    },
    entryReturnedTitle: {
      id: 'assessment/entry/returned-title',
      defaultMessage: 'The submission was returned for revision',
    },
    entrySupplementTitle: {
      id: 'assessment/entry/supplement-title',
      defaultMessage: 'The reviewer requested additional material',
    },
    supplementNeeds: { id: 'assessment/supplement/needs', defaultMessage: 'Required material' },
    // what a claim's number is: granted, waiting, or worth this much if approved
    entryScoreCounted: { id: 'assessment/entry/score-counted', defaultMessage: 'Counted' },
    entryScorePending: { id: 'assessment/entry/score-pending', defaultMessage: 'Not counted yet' },
    entryScoreIfApproved: {
      id: 'assessment/entry/score-if-approved',
      defaultMessage: 'If approved',
    },
    entryStatusAwaitingSupplement: {
      id: 'assessment/entry/status-awaiting-supplement',
      defaultMessage: 'Additional material required',
    },
    entryVersionNo: { id: 'assessment/entry/version-no', defaultMessage: 'Version {no}' },
    myEntriesHeadEach: {
      id: 'assessment/my-entries/head-each',
      defaultMessage: '{value} per entry',
    },
    myEntriesHeadMost: {
      id: 'assessment/my-entries/head-most',
      defaultMessage: 'Up to {count}',
    },
    myEntriesQuota: {
      id: 'assessment/my-entries/quota',
      defaultMessage: 'Entries used',
    },
    paperStructure: {
      id: 'assessment/paper/structure',
      defaultMessage: 'Scoring structure',
    },
    paperStructureShort: {
      id: 'assessment/paper/structure-short',
      defaultMessage: 'Structure',
    },
    paperViewAll: {
      id: 'assessment/paper/view-all',
      defaultMessage: 'All items',
    },
    paperViewTodo: {
      id: 'assessment/paper/view-todo',
      defaultMessage: 'Pending only',
    },
    paperBandShare: {
      id: 'assessment/paper/band-share',
      defaultMessage: '{pct}% of total score',
    },
    paperCap: {
      id: 'assessment/paper/cap',
      defaultMessage: 'Limit {value}',
    },
    paperColContent: {
      id: 'assessment/paper/col-content',
      defaultMessage: 'Content',
    },
    paperColContentVersion: {
      id: 'assessment/paper/col-content-version',
      defaultMessage: 'Content and version',
    },
    paperColVersion: {
      id: 'assessment/paper/col-version',
      defaultMessage: 'Version and time',
    },
    paperColStatus: {
      id: 'assessment/paper/col-status',
      defaultMessage: 'Status',
    },
    paperColScore: {
      id: 'assessment/paper/col-score',
      defaultMessage: 'Score',
    },
    paperUnsubmitted: {
      id: 'assessment/paper/unsubmitted',
      defaultMessage: 'Not submitted',
    },
    paperFoldMore: {
      id: 'assessment/paper/fold-more',
      defaultMessage: '{count, plural, other {# more}}',
    },
    paperFoldLess: {
      id: 'assessment/paper/fold-less',
      defaultMessage: 'Collapse',
    },
    paperEmptyTitle: {
      id: 'assessment/paper/empty-title',
      defaultMessage: 'No entries yet',
    },
    paperEmptyHint: {
      id: 'assessment/paper/empty-hint',
      defaultMessage:
        'Select an item on the left to create an entry. Drafts can be saved at any time.',
    },
    paperEmptyRecorded: {
      id: 'assessment/paper/empty-recorded',
      defaultMessage: 'Awaiting staff entry',
    },
    paperEmptyRecordedHint: {
      id: 'assessment/paper/empty-recorded-hint',
      defaultMessage: 'No staff entry has been recorded yet',
    },
    paperEmptyFile: { id: 'assessment/paper/empty-file', defaultMessage: 'New entry' },
    paperGrantedEach: {
      id: 'assessment/paper/granted-each',
      defaultMessage: '{value} per participant',
    },
    paperVoidedWhy: {
      id: 'assessment/paper/voided-why',
      defaultMessage: 'Disabled because: {reason}',
    },
    paperEmptyGranted: {
      id: 'assessment/paper/empty-granted',
      defaultMessage: 'Automatically counted',
    },
    paperEmptyGrantedHint: {
      id: 'assessment/paper/empty-granted-hint',
      defaultMessage: 'No submission is required; the score is applied automatically',
    },
    myEntriesAddFull: {
      id: 'assessment/my-entries/add-full',
      defaultMessage: 'Submission limit reached',
    },
    myEntriesFilesNone: {
      id: 'assessment/my-entries/files-none',
      defaultMessage: 'No files uploaded',
    },
    myEntriesPaperCap: {
      id: 'assessment/my-entries/paper-cap',
      defaultMessage: 'Total {value}',
    },
    myEntriesPaperMeta: {
      id: 'assessment/my-entries/paper-meta',
      defaultMessage: '{groups, plural, other {# groups}}, {items, plural, other {# items}}',
    },
    myEntriesPaperUnit: {
      id: 'assessment/my-entries/paper-unit',
      defaultMessage: 'pts',
    },
    entrySheetTitle: {
      id: 'assessment/entry-sheet/title',
      defaultMessage: 'Entry details',
    },
    entrySheetContent: {
      id: 'assessment/entry-sheet/content',
      defaultMessage: 'Submission content',
    },
    entrySheetTrail: {
      id: 'assessment/entry-sheet/trail',
      defaultMessage: 'Review history',
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
      defaultMessage: 'Original submission',
    },
    entrySheetSupHead: {
      id: 'assessment/entry-sheet/sup-head',
      defaultMessage: 'Added at reviewer request',
    },
    entrySheetSupNote: {
      id: 'assessment/entry-sheet/sup-note',
      defaultMessage: 'Round {round}, requested {asked}, completed {answered}',
    },
    entrySheetSupAsk: {
      id: 'assessment/entry-sheet/sup-ask',
      defaultMessage: 'Reviewer request',
    },
    // the claim's story, as one timeline
    entryTrailSubtitle: {
      id: 'assessment/entry/trail-subtitle',
      defaultMessage:
        '{item}　{versions} versions, {rounds} review rounds, {asks} material requests',
    },
    entryTrailVersion: {
      id: 'assessment/entry/trail-version',
      defaultMessage: 'You updated the claim, creating version {no}',
    },
    entryTrailVersionFirst: {
      id: 'assessment/entry/trail-version-first',
      defaultMessage: 'You created the claim, version {no}',
    },
    // the same moments, told to somebody who is not the person they are
    // about: a reviewer reading "I submitted" is reading the wrong sentence
    entryTrailVersionBy: {
      id: 'assessment/entry/trail-version-by',
      defaultMessage: '{who} updated the claim, creating version {no}',
    },
    entryTrailVersionFirstBy: {
      id: 'assessment/entry/trail-version-first-by',
      defaultMessage: '{who} created the claim, version {no}',
    },
    entryTrailSubmitted: {
      id: 'assessment/entry/trail-submitted',
      defaultMessage: 'You submitted version {no} for review',
    },
    entryTrailSubmittedBy: {
      id: 'assessment/entry/trail-submitted-by',
      defaultMessage: '{who} submitted version {no} for review',
    },
    entryTrailAnsweredBy: {
      id: 'assessment/entry/trail-answered-by',
      defaultMessage: '{who} submitted additional material',
    },
    entryTrailAskOut: {
      id: 'assessment/entry/trail-ask-out',
      defaultMessage: 'Additional material requested',
    },
    entryTrailAnswerKeptOut: {
      id: 'assessment/entry/trail-answer-kept-out',
      defaultMessage:
        'Stored separately from version {no}; the original submission remains unchanged.',
    },
    entrySuggestionHintOut: {
      id: 'assessment/entry/suggestion-hint-out',
      defaultMessage:
        'Suggestions are for reference only; the participant decides whether to apply them.',
    },
    entryTrailAnswered: {
      id: 'assessment/entry/trail-answered',
      defaultMessage: 'You submitted additional material',
    },
    entryTrailAnswerKept: {
      id: 'assessment/entry/trail-answer-kept',
      defaultMessage:
        'Stored separately from version {no}; reviewers can view both the original and additional material.',
    },
    entryTrailAskCancelled: {
      id: 'assessment/entry/trail-ask-cancelled',
      defaultMessage: 'Material request withdrawn',
    },
    entryTrailAskWaiting: {
      id: 'assessment/entry/trail-ask-waiting',
      defaultMessage: 'Awaiting your additional material',
    },
    entryTrailReason: { id: 'assessment/entry/trail-reason', defaultMessage: 'Reason: {value}' },
    entryTrailRound: { id: 'assessment/entry/trail-round', defaultMessage: 'Review round {no}' },
    entryRoundOngoing: {
      id: 'assessment/entry/round-ongoing',
      defaultMessage: 'In progress',
    },
    entryRoundEnded: {
      id: 'assessment/entry/round-ended',
      defaultMessage: 'Ended',
    },
    entryRoundStartedMark: {
      id: 'assessment/entry/round-started-mark',
      defaultMessage: 'Review round {no} began',
    },
    entryRoundEndedMark: {
      id: 'assessment/entry/round-ended-mark',
      defaultMessage: 'Review round {no} ended',
    },
    entryRoundReroutedStart: {
      id: 'assessment/entry/round-rerouted-start',
      defaultMessage: 'Review continued here after a process change',
    },
    entryRoundReroutedFrom: {
      id: 'assessment/entry/round-rerouted-from',
      defaultMessage: 'Carries on from round {no} under the adjusted process',
    },
    entryRoundReroutedNext: {
      id: 'assessment/entry/round-rerouted-next',
      defaultMessage: 'Round {no} carries on under the adjusted process',
    },
    entryTrailEmpty: {
      id: 'assessment/entry/trail-empty',
      defaultMessage: 'No submission or review history is available yet.',
    },
    // narrow screens show one pane at a time
    entrySupplementAnswer: {
      id: 'assessment/entry/supplement-answer',
      defaultMessage: 'Add material',
    },
    entrySupplementDialogTitle: {
      id: 'assessment/entry/supplement-dialog-title',
      defaultMessage: 'Provide requested material',
    },
    entrySupplementSent: {
      id: 'assessment/entry/supplement-sent',
      defaultMessage: 'Additional material submitted; review resumed.',
    },
    refuseSupplementOpen: {
      id: 'assessment/refuse/supplement-open',
      defaultMessage: 'An additional-material request is already open for this submission.',
    },
    refuseRequestClosed: {
      id: 'assessment/refuse/request-closed',
      defaultMessage: 'The material request has already been closed.',
    },
    refuseAwaitingSupplement: {
      id: 'assessment/refuse/awaiting-supplement',
      defaultMessage: 'The submission is awaiting additional material.',
    },
    refuseReviewNotOpen: {
      id: 'assessment/refuse/review-not-open',
      defaultMessage: 'The current review round does not allow this action.',
    },
    // the keyboard panel
    reviewKeysTitle: { id: 'assessment/review/keys-title', defaultMessage: 'Keyboard shortcuts' },
    reviewKeysToggle: {
      id: 'assessment/review/keys-toggle',
      defaultMessage: 'Press ? to open or close this panel',
    },
    reviewKeysFoot: {
      id: 'assessment/review/keys-foot',
      defaultMessage:
        'Letter keys select actions; \u2318\u21b5 submits. Shortcuts are disabled while typing.',
    },
    reviewKeySubmit: {
      id: 'assessment/review/key-submit',
      defaultMessage: 'Confirm the open act',
    },
    reviewKeyUndo: {
      id: 'assessment/review/key-undo',
      defaultMessage: 'Undo the previous decision within 5 seconds',
    },
    reviewKeyApprove: { id: 'assessment/review/key-approve', defaultMessage: 'Open approve' },
    reviewKeyReject: { id: 'assessment/review/key-reject', defaultMessage: 'Open send back' },
    reviewKeyEscalate: {
      id: 'assessment/review/key-escalate',
      defaultMessage: 'Open escalate',
    },
    reviewKeyMove: {
      id: 'assessment/review/key-move',
      defaultMessage: 'Next entry / previous entry',
    },
    reviewKeyFiles: {
      id: 'assessment/review/key-files',
      defaultMessage: 'Open the numbered material',
    },
    reviewKeyCompare: {
      id: 'assessment/review/key-compare',
      defaultMessage: 'Compare with the previous version',
    },
    reviewKeyVersions: {
      id: 'assessment/review/key-versions',
      defaultMessage: 'Select a comparison version',
    },
    reviewKeyTrail: {
      id: 'assessment/review/key-trail',
      defaultMessage: 'Open full review history',
    },
    reviewKeyCancel: {
      id: 'assessment/review/key-cancel',
      defaultMessage: 'Close the open panel',
    },
    // a run finished
    reviewDoneTitle: {
      id: 'assessment/review/done-title',
      defaultMessage: 'All {count} submissions in this group have been reviewed',
    },
    reviewDoneSpent: { id: 'assessment/review/done-spent', defaultMessage: 'Time spent' },
    reviewDoneNext: {
      id: 'assessment/review/done-next',
      defaultMessage: 'Continue with {title} ({count})',
    },
    reviewDoneBack: {
      id: 'assessment/review/done-back',
      defaultMessage: 'Back to pending reviews',
    },
    reviewDoneLeft: {
      id: 'assessment/review/done-left',
      defaultMessage: '{count} submissions remain',
    },
    // the two dialogs that carry a word
    reviewRejectTitle: {
      id: 'assessment/review/reject-title',
      defaultMessage: 'Return to {name}',
    },
    reviewRejectSubtitle: {
      id: 'assessment/review/reject-subtitle',
      defaultMessage: '{item}, version {no}',
    },
    reviewReasonLabel: { id: 'assessment/review/reason-label', defaultMessage: 'Reason' },
    reviewReasonHint: {
      id: 'assessment/review/reason-hint',
      defaultMessage: 'Select one',
    },
    reviewSuggestField: { id: 'assessment/review/suggest-field', defaultMessage: 'Field' },
    reviewSuggestTheirs: {
      id: 'assessment/review/suggest-theirs',
      defaultMessage: 'Participant entry',
    },
    reviewSuggestMine: {
      id: 'assessment/review/suggest-mine',
      defaultMessage: 'Suggested revision',
    },
    reviewSuggestKeep: { id: 'assessment/review/suggest-keep', defaultMessage: 'Keep unchanged' },
    reviewSuggestHint: {
      id: 'assessment/review/suggest-hint',
      defaultMessage: 'The participant may choose whether to apply the suggestion.',
    },
    reviewRejectFoot: {
      id: 'assessment/review/reject-foot',
      defaultMessage: 'The participant will be able to see the review note.',
    },
    reviewRejectConfirm: {
      id: 'assessment/review/reject-confirm',
      defaultMessage: 'Confirm return',
    },
    reviewEscalateSubtitle: {
      id: 'assessment/review/escalate-subtitle',
      defaultMessage: '{name}\u3000{item}',
    },
    reviewEscalateCommentLabel: {
      id: 'assessment/review/escalate-comment-label',
      defaultMessage: 'Items requiring further review',
    },
    reviewEscalateCommentHint: {
      id: 'assessment/review/escalate-comment-hint',
      defaultMessage: 'Visible to reviewers only',
    },
    reviewEscalateFlow: {
      id: 'assessment/review/escalate-flow',
      defaultMessage: 'Escalation workflow',
    },
    reviewEscalateFoot: {
      id: 'assessment/review/escalate-foot',
      defaultMessage: 'After submission, the entry will leave your review queue.',
    },
    // the reason lists, configured with the batch
    settingsReasonsHint: {
      id: 'assessment/settings/reasons-hint',
      defaultMessage:
        'Returning a submission requires a primary reason and a written note. Changes to these reasons affect future reviews only; existing review records remain unchanged.',
    },
    settingsRejectReasons: {
      id: 'assessment/settings/reject-reasons',
      defaultMessage: 'Return reasons',
    },
    settingsEscalateReasons: {
      id: 'assessment/settings/escalate-reasons',
      defaultMessage: 'Escalation reasons',
    },
    settingsEscalateHint: {
      id: 'assessment/settings/escalate-hint',
      defaultMessage: 'A primary reason is also selected when escalating a submission.',
    },
    settingsReasonPlaceholder: {
      id: 'assessment/settings/reason-placeholder',
      defaultMessage: 'Reason name',
    },
    settingsReasonAdd: { id: 'assessment/settings/reason-add', defaultMessage: 'Add' },
    settingsRejectReasonsNone: {
      id: 'assessment/settings/reject-reasons-none',
      defaultMessage:
        'No preset return reasons are configured; reviewers will provide a written note instead.',
    },
    settingsEscalateReasonsNone: {
      id: 'assessment/settings/escalate-reasons-none',
      defaultMessage:
        'No preset escalation reasons are configured; reviewers will provide a written note instead.',
    },
    settingsReasonRestore: {
      id: 'assessment/settings/reason-restore',
      defaultMessage: 'Restore system defaults',
    },
    reviewOnEscalationRoute: {
      id: 'assessment/review/on-escalation-route',
      defaultMessage:
        'The submission is in the escalation workflow; the final review step determines the outcome.',
    },
    itemsTabBasics: { id: 'assessment/items/tab-basics', defaultMessage: 'Basic information' },
    itemsTabFields: { id: 'assessment/items/tab-fields', defaultMessage: 'Submission fields' },
    itemsTabScoring: { id: 'assessment/items/tab-scoring', defaultMessage: 'Scoring' },
    itemsTabReview: { id: 'assessment/items/tab-review', defaultMessage: 'Review workflow' },
    itemsFieldDescription: {
      id: 'assessment/items/field-description',
      defaultMessage: 'Submission instructions',
    },
    itemsFlowSubmit: { id: 'assessment/items/flow-submit', defaultMessage: 'Submitted' },
    itemsFlowSubmitBy: {
      id: 'assessment/items/flow-submit-by',
      defaultMessage: 'By participant',
    },
    itemsFlowDone: { id: 'assessment/items/flow-done', defaultMessage: 'Review complete' },
    itemsFlowDoneSub: {
      id: 'assessment/items/flow-done-sub',
      defaultMessage: 'Approved entries are counted',
    },
    itemsStageWalkUp: { id: 'assessment/items/stage-walk-up', defaultMessage: 'Search upward' },
    itemsTreeSummaryNoCap: {
      id: 'assessment/items/tree-summary-no-cap',
      defaultMessage: '{count, plural, one {# item} other {# items}}',
    },
    itemsBasicsHint: {
      id: 'assessment/items/basics-hint',
      defaultMessage: 'The title and instructions are shown on the participant submission screen.',
    },
    itemsFieldsHint: {
      id: 'assessment/items/fields-hint',
      defaultMessage: 'Participants complete the fields in this order. Drag to reorder them.',
    },
    itemsScoringHint: {
      id: 'assessment/items/scoring-hint',
      defaultMessage: 'Set the score for each approved entry. Use a negative value for deductions.',
    },
    itemsChainHintNew: {
      id: 'assessment/items/chain-hint-new',
      defaultMessage:
        'Submissions move through the review steps in order; the final step determines the outcome.',
    },
    itemsImpactTitle: {
      id: 'assessment/items/impact-title',
      defaultMessage: 'The change affects work already in progress',
    },
    itemsImpactHint: {
      id: 'assessment/items/impact-hint',
      defaultMessage: 'Choose how existing submissions should be handled before saving.',
    },
    itemsImpactInReview: {
      id: 'assessment/items/impact-in-review',
      defaultMessage:
        '{count} of {total} submissions under review no longer satisfy the updated form',
    },
    itemsImpactApproved: {
      id: 'assessment/items/impact-approved',
      defaultMessage: '{count} of {total} approved submissions no longer satisfy the updated form',
    },
    itemsImpactKeepEntries: {
      id: 'assessment/items/impact-keep-entries',
      defaultMessage: 'Keep existing submissions unchanged',
    },
    itemsImpactKeepApproved: {
      id: 'assessment/items/impact-keep-approved',
      defaultMessage: 'Keep existing review results',
    },
    itemsImpactReturnEntries: {
      id: 'assessment/items/impact-return-entries',
      defaultMessage: 'Return affected submissions for revision',
    },
    itemsImpactRounds: {
      id: 'assessment/items/impact-rounds',
      defaultMessage: '{open} reviews are in progress, including {blocked} waiting for a reviewer',
    },
    itemsImpactRoundsKeep: {
      id: 'assessment/items/impact-rounds-keep',
      defaultMessage:
        'Existing reviews keep the old workflow; new reviews use the updated workflow',
    },
    itemsImpactRoundsBlocked: {
      id: 'assessment/items/impact-rounds-blocked',
      defaultMessage: 'Move only reviews waiting for a reviewer to the updated workflow',
    },
    itemsImpactRoundsAll: {
      id: 'assessment/items/impact-rounds-all',
      defaultMessage: 'Move all active reviews to the updated workflow',
    },
    itemsImpactStageGone: {
      id: 'assessment/items/impact-stage-gone',
      defaultMessage:
        '{count} submissions stand at a review step the updated workflow no longer has. Decide what happens to them:',
    },
    itemsImpactLanding: {
      id: 'assessment/items/impact-landing',
      defaultMessage: 'Where do the moved reviews continue?',
    },
    itemsImpactLandingContinue: {
      id: 'assessment/items/impact-landing-continue',
      defaultMessage: 'From the step each one stands at; steps already passed do not run again',
    },
    itemsImpactLandingRestart: {
      id: 'assessment/items/impact-landing-restart',
      defaultMessage:
        'From the start of their own route - a full re-review under the updated workflow',
    },
    itemsImpactPastChanged: {
      id: 'assessment/items/impact-past-changed',
      defaultMessage:
        'For {count} of them the steps before the current one changed in this update; steps added or reordered there will not run.',
    },
    itemsImpactOrphanKeep: {
      id: 'assessment/items/impact-orphan-keep',
      defaultMessage: 'Keep them on the existing workflow',
    },
    itemsImpactOrphanRestart: {
      id: 'assessment/items/impact-orphan-restart',
      defaultMessage: 'Restart them from the start of their own route on the updated workflow',
    },
    itemsChainHintRecorded: {
      id: 'assessment/items/chain-hint-recorded',
      defaultMessage:
        'Staff-recorded entries count immediately; the review workflow is used only if the result is contested.',
    },
    structureDragHint: {
      id: 'assessment/items/structure-drag-hint',
      defaultMessage: 'Drag a row to reorder it or move it to another group.',
    },
    structureSearch: {
      id: 'assessment/items/structure-search',
      defaultMessage: 'Search groups or items',
    },
    structureStatusAll: { id: 'assessment/items/structure-status-all', defaultMessage: 'All' },
    structureStatusLive: {
      id: 'assessment/items/structure-status-live',
      defaultMessage: 'Published',
    },
    structureNew: { id: 'assessment/items/structure-new', defaultMessage: 'New' },
    structureNewItem: { id: 'assessment/items/structure-new-item', defaultMessage: 'Item' },
    structureColOrdinal: { id: 'assessment/items/structure-col-ordinal', defaultMessage: 'No.' },
    structureColName: { id: 'assessment/items/structure-col-name', defaultMessage: 'Name' },
    structureColEach: {
      id: 'assessment/items/structure-col-each',
      defaultMessage: 'Score per entry',
    },
    structureColMost: { id: 'assessment/items/structure-col-most', defaultMessage: 'Entry limit' },
    structureColSource: {
      id: 'assessment/items/structure-col-source',
      defaultMessage: 'Submission method',
    },
    structureColChain: {
      id: 'assessment/items/structure-col-chain',
      defaultMessage: 'Review workflow',
    },
    structureColStatus: { id: 'assessment/items/structure-col-status', defaultMessage: 'Status' },
    structureNoMatch: {
      id: 'assessment/items/structure-no-match',
      defaultMessage: 'No content matches the current filters.',
    },
    structureUncapped: {
      id: 'assessment/items/structure-uncapped',
      defaultMessage: 'No upper limit',
    },
    structureUnlimited: { id: 'assessment/items/structure-unlimited', defaultMessage: 'Unlimited' },
    structureSteps: {
      id: 'assessment/items/structure-steps',
      defaultMessage: '{count, plural, one {# step} other {# steps}}',
    },
    paperStartTitle: {
      id: 'assessment/items/paper-start-title',
      defaultMessage: 'Set up the scoring structure',
    },
    paperStartHint: {
      id: 'assessment/items/paper-start-hint',
      defaultMessage: 'Set a name and total score, then add groups and assessment items.',
    },
    paperStartGuided: {
      id: 'assessment/items/paper-start-guided',
      defaultMessage: 'Set a name and total score',
    },
    paperStartGuidedHint: {
      id: 'assessment/items/paper-start-guided-hint',
      defaultMessage: 'Groups and items can be added or removed later.',
    },
    paperStartSuggested: {
      id: 'assessment/items/paper-start-suggested',
      defaultMessage: 'Recommended',
    },
    paperStartBlank: {
      id: 'assessment/items/paper-start-blank',
      defaultMessage: 'No total score for now',
    },
    paperStartBlankHint: {
      id: 'assessment/items/paper-start-blank-hint',
      defaultMessage:
        'Leave the total unrestricted for now and set it after the scoring rules are finalized.',
    },
    paperDefaultName: {
      id: 'assessment/items/paper-default-name',
      defaultMessage: 'Assessment structure',
    },
    paperCreateTitle: {
      id: 'assessment/items/paper-create-title',
      defaultMessage: 'Scoring structure',
    },
    paperCreateHint: {
      id: 'assessment/items/paper-create-hint',
      defaultMessage: 'Set a name and total score.',
    },
    paperCreate: { id: 'assessment/items/paper-create', defaultMessage: 'Create' },
    paperTotal: { id: 'assessment/items/paper-total', defaultMessage: 'Total score' },
    paperTotalHint: {
      id: 'assessment/items/paper-total-hint',
      defaultMessage:
        'The upper limits of top-level groups cannot exceed the total. Leave blank for no total-score limit.',
    },
    paperFloorNone: { id: 'assessment/items/paper-floor-none', defaultMessage: 'No lower limit' },
    paperEdit: { id: 'assessment/items/paper-edit', defaultMessage: 'Edit scoring structure' },
    itemsTreeTitle: { id: 'assessment/items/tree-title', defaultMessage: 'Structure' },
    itemsPreviewTitle: {
      id: 'assessment/items/preview-title',
      defaultMessage: 'Participant view',
    },
    itemsPreviewMax: {
      id: 'assessment/items/preview-max',
      defaultMessage: '{count, plural, one {Up to # entry} other {Up to # entries}}',
    },
    itemsPreviewNoMax: {
      id: 'assessment/items/preview-no-max',
      defaultMessage: 'No entry limit',
    },
    itemsPreviewValue: {
      id: 'assessment/items/preview-value',
      defaultMessage: '{value} pts when approved',
    },
    itemsPreviewUpload: {
      id: 'assessment/items/preview-upload',
      defaultMessage: '{count, plural, one {Up to # file} other {Up to # files}}',
    },
    itemsUntitled: { id: 'assessment/items/untitled', defaultMessage: 'Unnamed item' },
    itemsReviewCovered: {
      id: 'assessment/items/review-covered',
      defaultMessage:
        '{count, plural, one {The unit at this level has an available reviewer} other {All # units at this level have an available reviewer}}',
    },
    itemsReviewUncovered: {
      id: 'assessment/items/review-uncovered',
      defaultMessage:
        '{names}: no one currently holds any selected review role, so affected submissions will wait.',
    },
    itemsReviewNoUnits: {
      id: 'assessment/items/review-no-units',
      defaultMessage:
        'No participants in this batch belong to a unit at the selected level, so review cannot be configured at this level.',
    },
    itemsReviewLevel: {
      id: 'assessment/items/review-level',
      defaultMessage: 'Review level',
    },
    itemsReviewRoles: { id: 'assessment/items/review-roles', defaultMessage: 'Reviewer roles' },
    itemsReviewRolesHint: {
      id: 'assessment/items/review-roles-hint',
      defaultMessage: 'Reviewers are people holding any selected role in the relevant unit.',
    },
    itemsFormEmpty: {
      id: 'assessment/items/form-empty',
      defaultMessage: 'No fields have been added. At least one field is required.',
    },
    itemsFieldReason: { id: 'assessment/items/field-reason', defaultMessage: 'Reason for change' },
    itemsSaved: { id: 'assessment/items/saved', defaultMessage: 'Item saved.' },
    itemsVoid: { id: 'assessment/items/void', defaultMessage: 'Disable' },
    itemsVoidTitle: { id: 'assessment/items/void-title', defaultMessage: 'Disable the item' },
    itemsVoidHint: {
      id: 'assessment/items/void-hint',
      defaultMessage:
        'Incomplete submissions will be voided; existing review outcomes remain unchanged. Provide a reason, which will be visible to affected users.',
    },
    itemsVoidReason: { id: 'assessment/items/void-reason', defaultMessage: 'Reason' },
    itemsRestore: { id: 'assessment/items/restore', defaultMessage: 'Re-enable' },
    itemsDelete: { id: 'assessment/items/delete', defaultMessage: 'Delete' },
    itemsDeleteConfirm: {
      id: 'assessment/items/delete-confirm',
      defaultMessage: 'Delete “{title}”?',
    },
    itemsDeleteConfirmHint: {
      id: 'assessment/items/delete-confirm-hint',
      defaultMessage: 'It leaves no record and cannot be brought back.',
    },
    itemsStatusVoided: { id: 'assessment/items/status-voided', defaultMessage: 'Disabled' },

    /** what the whole paper adds up to, read above its structure */
    /** what goes between two things named in a row; a locale picks its own */
    paperAllocated: {
      id: 'assessment/items/paper-allocated',
      defaultMessage: 'Group limits allocated: {sum} of {total}',
    },
    paperAllocatedFree: {
      id: 'assessment/items/paper-allocated-free',
      defaultMessage: 'Combined group limits: {sum}',
    },
    paperCapOver: {
      id: 'assessment/items/paper-cap-over',
      defaultMessage: 'Combined group limits are {sum}, exceeding the total score of {total}',
    },
    paperCapUnset: {
      id: 'assessment/items/paper-cap-unset',
      defaultMessage:
        'At least one top-level group has no upper limit, so the scoring structure has no overall upper limit',
    },
    listSeparator: { id: 'assessment/items/list-separator', defaultMessage: ', ' },
    structureSubtotal: {
      id: 'assessment/items/structure-subtotal',
      defaultMessage: 'Subtotal {sum}',
    },
    structureRowAddGroup: {
      id: 'assessment/items/structure-row-add-group',
      defaultMessage: 'Subgroup',
    },
    structureRowMenu: { id: 'assessment/items/structure-row-menu', defaultMessage: 'More' },
    structureOpen: { id: 'assessment/items/structure-open', defaultMessage: 'Open' },

    /** one question, opened out of the structure */
    itemsBack: { id: 'assessment/items/back', defaultMessage: 'Back to structure' },
    itemsPaperPosition: {
      id: 'assessment/items/paper-position',
      defaultMessage: 'Item {index} of {total}',
    },
    itemsPublishedVersion: {
      id: 'assessment/items/published-version',
      defaultMessage: 'Published · version {no}',
    },
    itemsDraftVersion: {
      id: 'assessment/items/draft-version',
      defaultMessage: 'Unpublished · version {no}',
    },
    itemsLimitMaxLength: {
      id: 'assessment/items/limit-max-length',
      defaultMessage: 'Up to {count} characters',
    },
    itemsLimitDates: { id: 'assessment/items/limit-dates', defaultMessage: '{from} to {until}' },
    itemsLimitFiles: {
      id: 'assessment/items/limit-files',
      defaultMessage: '{count, plural, one {Up to # file} other {Up to # files}}',
    },
    itemsFixedValueUnit: { id: 'assessment/items/fixed-value-unit', defaultMessage: 'pts' },
    itemsMaxEntriesAny: { id: 'assessment/items/max-entries-any', defaultMessage: 'No limit' },
    itemsScoringMethodFixed: {
      id: 'assessment/items/scoring-method-fixed',
      defaultMessage: 'Fixed score per entry',
    },
    itemsCeiling: {
      id: 'assessment/items/ceiling',
      defaultMessage: 'Maximum score from this item',
    },
    // the file kinds an administrator picks from, shared by the question's
    // own fields and by a reviewer asking for more material
    itemsGrantedRoster: {
      id: 'assessment/items/granted-roster',
      defaultMessage: 'Batch participant roster',
    },
    itemsGrantedRosterCount: {
      id: 'assessment/items/granted-roster-count',
      defaultMessage: '{count, plural, one {# participant} other {# participants}}',
    },
    fileKindPdf: { id: 'assessment/files/kind-pdf', defaultMessage: 'PDF' },
    fileKindImage: { id: 'assessment/files/kind-image', defaultMessage: 'Images' },
    fileKindWord: { id: 'assessment/files/kind-word', defaultMessage: 'Word documents' },
    fileKindSheet: { id: 'assessment/files/kind-sheet', defaultMessage: 'Spreadsheets' },
    fileKindSlides: { id: 'assessment/files/kind-slides', defaultMessage: 'Presentations' },
    fileKindArchive: { id: 'assessment/files/kind-archive', defaultMessage: 'Archives' },
    itemsAcceptOther: {
      id: 'assessment/items/accept-other',
      defaultMessage: 'Also allow other formats',
    },
    itemsAcceptOtherHint: {
      id: 'assessment/items/accept-other-hint',
      defaultMessage:
        'Separate extensions with commas and include the leading dot. Invalid entries will cause uploads to be rejected, so verify them against actual files.',
    },
    itemsAcceptResolved: {
      id: 'assessment/items/accept-resolved',
      defaultMessage: 'Allowed formats',
    },
    itemsAcceptAny: { id: 'assessment/items/accept-any', defaultMessage: 'Any format' },
    itemsAcceptUnwritable: {
      id: 'assessment/items/accept-unwritable',
      defaultMessage: 'Invalid formats: {tokens}',
    },
    itemsFieldCount: {
      id: 'assessment/items/field-count',
      defaultMessage: '{count, plural, =0 {No fields} one {# field} other {# fields}}',
    },
    itemsRequiredCount: {
      id: 'assessment/items/required-count',
      defaultMessage: '{count} required',
    },
    itemsFieldOpenHint: {
      id: 'assessment/items/field-open-hint',
      defaultMessage: 'Select a field to edit its settings',
    },
    itemsKindLocked: {
      id: 'assessment/items/kind-locked',
      defaultMessage: 'The item type cannot be changed after creation.',
    },
    itemsCeilingSource: {
      id: 'assessment/items/ceiling-source',
      defaultMessage: 'Score source: {name}.',
    },
    itemsCeilingHow: {
      id: 'assessment/items/ceiling-how',
      defaultMessage: '{value} × {count, plural, one {# entry} other {# entries}}.',
    },
    itemsGrantedValue: {
      id: 'assessment/items/granted-value',
      defaultMessage: 'Score per participant',
    },
    itemsCeilingHowGranted: {
      id: 'assessment/items/ceiling-how-granted',
      defaultMessage: '{value} for every participant on the roster.',
    },
    itemsCeilingHowAny: {
      id: 'assessment/items/ceiling-how-any',
      defaultMessage: 'Entry count is unlimited, so the item has no upper limit of its own.',
    },
    itemsCeilingSectionCapped: {
      id: 'assessment/items/ceiling-section-capped',
      defaultMessage: '{name} limit {value}',
    },
    itemsCeilingSectionFree: {
      id: 'assessment/items/ceiling-section-free',
      defaultMessage: '{name} has no upper limit',
    },
    itemsCeilingNote: {
      id: 'assessment/items/ceiling-note',
      defaultMessage:
        'Group path: {chain}. Scores above a group limit are capped during calculation.',
    },
    /** the same answer as itemsReviewUncovered, in the width a chain step has */
    itemsReviewUncoveredCount: {
      id: 'assessment/items/review-uncovered-count',
      defaultMessage:
        '{count, plural, one {# unit has no reviewer} other {# units have no reviewer}}',
    },
    itemsStageUnset: { id: 'assessment/items/stage-unset', defaultMessage: 'Not configured' },
    itemsStageUnsetHint: {
      id: 'assessment/items/stage-unset-hint',
      defaultMessage: 'Select the review level and reviewer roles.',
    },
    itemsEscalated: { id: 'assessment/items/escalated', defaultMessage: 'Escalated' },
    itemsEscalationBy: {
      id: 'assessment/items/escalation-by',
      defaultMessage: 'Initiated by a reviewer',
    },
    itemsEscalationSettled: {
      id: 'assessment/items/escalation-settled',
      defaultMessage: 'Escalation complete',
    },
    itemsEscalationSettledSub: {
      id: 'assessment/items/escalation-settled-sub',
      defaultMessage: 'The final review step determines the outcome',
    },
    itemsCannotSave: {
      id: 'assessment/items/cannot-save',
      defaultMessage: 'Cannot save yet: {reasons}.',
    },
    itemsNeedTitle: { id: 'assessment/items/need-title', defaultMessage: 'item title is missing' },
    itemsNeedGroup: { id: 'assessment/items/need-group', defaultMessage: 'no group is selected' },
    itemsNeedValue: {
      id: 'assessment/items/need-value',
      defaultMessage: 'score per approved entry is missing',
    },
    itemsNeedFieldLabel: {
      id: 'assessment/items/need-field-label',
      defaultMessage: 'a submission field has no name',
    },
    itemsNeedStage: {
      id: 'assessment/items/need-stage',
      defaultMessage: 'a review step is incomplete',
    },
    itemsEscalationAddStep: {
      id: 'assessment/items/escalation-add-step',
      defaultMessage: 'Add escalation step',
    },
    itemsPlacementTitle: {
      id: 'assessment/items/placement-title',
      defaultMessage: 'Scoring position',
    },
    itemsPlacementSubtotal: {
      id: 'assessment/items/placement-subtotal',
      defaultMessage: '{name} subtotal',
    },
    itemsPlacementCap: {
      id: 'assessment/items/placement-cap',
      defaultMessage: '{name} limit',
    },
    itemsPlacementPaper: { id: 'assessment/items/placement-paper', defaultMessage: 'Batch total' },
    itemsVersionTitle: { id: 'assessment/items/version-title', defaultMessage: 'Version' },
    itemsVersionNote: {
      id: 'assessment/items/version-note',
      defaultMessage: 'Version {no}, saved {date}.',
    },
    itemsVersionNew: {
      id: 'assessment/items/version-new',
      defaultMessage: 'Not saved yet.',
    },
    paperStartAction: { id: 'assessment/items/paper-start-action', defaultMessage: 'Start setup' },

    /** the filing screen: the round's structure, and one's own claims in it */
    myEntriesCounted: { id: 'assessment/entry/counted', defaultMessage: 'Counted' },
    myEntriesQuestions: {
      id: 'assessment/entry/questions',
      defaultMessage: '{count, plural, one {# item} other {# items}}',
    },
    myEntriesRecorded: { id: 'assessment/entry/recorded', defaultMessage: 'Recorded by staff' },
    myEntriesOpen: { id: 'assessment/entry/open', defaultMessage: 'Open for submission' },
    myEntriesResume: { id: 'assessment/entry/resume', defaultMessage: 'Continue editing' },
    entryLastRoom: {
      id: 'assessment/entry/last-room',
      defaultMessage: 'One submission slot remains for this item.',
    },
    entryAlreadyFiled: {
      id: 'assessment/entry/already-filed',
      defaultMessage: 'Already submitted',
    },
    entryNoDuplicates: {
      id: 'assessment/entry/no-duplicates',
      defaultMessage: 'Do not submit the same achievement more than once.',
    },
    entryDraftKept: {
      id: 'assessment/entry/draft-kept',
      defaultMessage: 'Saved drafts can be continued at any time.',
    },
    entrySaveDraft: { id: 'assessment/entry/save-draft', defaultMessage: 'Save as draft' },
    // filing writes the claim down and may hand it on in the same press, so
    // the key says both; submitting an already-written claim says only the one
    entrySaveAndSubmit: {
      id: 'assessment/entry/save-and-submit',
      defaultMessage: 'Save and submit for review',
    },
    entrySaveThenSubmit: {
      id: 'assessment/entry/save-then-submit',
      defaultMessage: 'Save and submit',
    },
    entrySaveOnly: { id: 'assessment/entry/save-only', defaultMessage: 'Save only' },
    myEntriesFilterAll: { id: 'assessment/entry/filter-all', defaultMessage: 'All' },
    myEntriesFilterTodo: {
      id: 'assessment/entry/filter-todo',
      defaultMessage: 'Action required',
    },
    myEntriesFilterNone: {
      id: 'assessment/entry/filter-none',
      defaultMessage: 'No items currently require your action.',
    },
    myEntriesBasis: { id: 'assessment/entry/basis', defaultMessage: 'Scoring basis' },
    myEntriesBasisSoon: {
      id: 'assessment/entry/basis-soon',
      defaultMessage: 'No scoring rule has been linked yet.',
    },
    entryNth: { id: 'assessment/entry/nth', defaultMessage: 'Entry {n}' },
    entryFlow: { id: 'assessment/entry/flow', defaultMessage: 'Review workflow' },
    entryFlowStep: { id: 'assessment/entry/flow-step', defaultMessage: 'Review step {n}' },
    entryFlowNote: {
      id: 'assessment/entry/flow-note',
      defaultMessage:
        'The entry can be withdrawn and edited until the first reviewer takes action.',
    },
    entryFileDrop: {
      id: 'assessment/entry/file-drop',
      defaultMessage: 'Drop files here or click to select',
    },
    entryFileRoom: {
      id: 'assessment/entry/file-room',
      defaultMessage: '{count, plural, one {# more file allowed} other {# more files allowed}}',
    },
    entryDateWithin: {
      id: 'assessment/entry/date-within',
      defaultMessage: 'Date must be between {start} and {end}',
    },

    tabAccess: { id: 'assessment/access/tab', defaultMessage: 'Staff permissions' },
    tabSettings: { id: 'assessment/settings/tab', defaultMessage: 'Batch settings' },
    settingsHint: {
      id: 'assessment/settings/hint',
      defaultMessage: 'Edit the batch name, material date range, and other settings.',
    },
    settingsBasics: { id: 'assessment/settings/basics', defaultMessage: 'Basic information' },
    settingsBasicsHint: {
      id: 'assessment/settings/basics-hint',
      defaultMessage:
        'The material date range determines which achievements may be submitted in this batch.',
    },
    settingsNote: { id: 'assessment/settings/note', defaultMessage: 'Notes' },
    settingsNoteHint: {
      id: 'assessment/settings/note-hint',
      defaultMessage:
        'Visible to batch participants and staff. Do not include sensitive information.',
    },
    settingsUnsaved: { id: 'assessment/settings/unsaved', defaultMessage: 'Not saved' },
    settingsLifecycle: { id: 'assessment/settings/lifecycle', defaultMessage: 'Batch status' },
    settingsLifecycleHint: {
      id: 'assessment/settings/lifecycle-hint',
      defaultMessage:
        'Archived batches are read-only and no longer allow submissions, reviews, or configuration changes.',
    },
    phasesHint: {
      id: 'assessment/phase/hint',
      defaultMessage:
        'Configure stage order, start times, and the actions available during each stage.',
    },
    phasesEmpty: {
      id: 'assessment/phase/empty',
      defaultMessage: 'No stages have been added. Add stages manually or from a template.',
    },
    addPhase: { id: 'assessment/phase/add', defaultMessage: 'Add stage' },
    colStage: { id: 'assessment/plan/col-stage', defaultMessage: 'Stage' },
    colOpens: { id: 'assessment/plan/col-opens', defaultMessage: 'Available actions' },
    colPlannedStart: { id: 'assessment/plan/col-start', defaultMessage: 'Start time' },
    colStatus: { id: 'assessment/plan/col-status', defaultMessage: 'Status' },
    descriptionLabel: { id: 'assessment/phase/description', defaultMessage: 'Stage description' },
    entryNoteLabel: { id: 'assessment/phase/entry-note', defaultMessage: 'Scheduling note' },
    entryNoteHint: {
      id: 'assessment/phase/entry-note-hint',
      defaultMessage: 'Shown to participants until a start time is scheduled for the stage.',
    },
    entryNotePlaceholder: {
      id: 'assessment/phase/entry-note-placeholder',
      defaultMessage: 'e.g. Expected to begin after the participant list is approved',
    },
    descriptionPlaceholder: {
      id: 'assessment/phase/description-placeholder',
      defaultMessage: 'Describe the main work performed during this stage',
    },
    notScheduled: { id: 'assessment/plan/not-scheduled', defaultMessage: 'Not scheduled' },
    awaitingEarlier: {
      id: 'assessment/plan/awaiting-earlier',
      defaultMessage: 'Schedule the previous stage first',
    },
    lockedBySchedule: { id: 'assessment/plan/locked', defaultMessage: 'Scheduled' },
    upNextBadge: { id: 'assessment/plan/up-next', defaultMessage: 'Ready to schedule' },
    enterEditing: {
      id: 'assessment/plan/enter-editing',
      defaultMessage: 'Add or edit stages',
    },
    unscheduledFrom: {
      id: 'assessment/plan/unscheduled-from',
      defaultMessage: 'The following stages are not yet scheduled',
    },
    insertHere: { id: 'assessment/plan/insert-here', defaultMessage: 'Add stage here' },
    editDetails: { id: 'assessment/phase/edit-details', defaultMessage: 'Edit details' },
    saveShort: { id: 'assessment/plan/save-short', defaultMessage: 'Save' },
    moveUp: { id: 'assessment/plan/move-up', defaultMessage: 'Move up' },
    moveDown: { id: 'assessment/plan/move-down', defaultMessage: 'Move down' },
    done: { id: 'assessment/action/done', defaultMessage: 'Done' },
    pendingShort,
    goSchedule: { id: 'assessment/schedule/go', defaultMessage: 'Set start time' },
    scheduleTitle,
    describeTitle,
    describeBody: {
      id: 'assessment/phase/describe-body',
      defaultMessage:
        'The stage name and description are visible to administrators and participants.',
    },
    startModeLegend: { id: 'assessment/schedule/mode', defaultMessage: 'Start method' },
    startModeLater: { id: 'assessment/schedule/mode-later', defaultMessage: 'Scheduled start' },
    startModeLaterHint: {
      id: 'assessment/schedule/mode-later-hint',
      defaultMessage: 'The batch automatically enters the stage at the selected time.',
    },
    justNow: { id: 'assessment/plan/just-now', defaultMessage: 'Just now' },
    scheduleBody: {
      id: 'assessment/schedule/body',
      defaultMessage: 'The batch automatically enters the stage at the selected time.',
    },
    scheduleConfirm: { id: 'assessment/schedule/confirm', defaultMessage: 'Confirm schedule' },
    plannedStartLabel: { id: 'assessment/schedule/planned-at', defaultMessage: 'Start time' },
    startNow: { id: 'assessment/schedule/start-now', defaultMessage: 'Start now' },
    startNowTitle,
    startNowBody: {
      id: 'assessment/schedule/start-now-body',
      defaultMessage: 'The current stage will end immediately and the selected stage will begin.',
    },
    unschedule: { id: 'assessment/schedule/unschedule', defaultMessage: 'Cancel schedule' },
    unscheduleTitle,
    templateAdd: { id: 'assessment/template/add', defaultMessage: 'Add from template' },
    templateAddBody: {
      id: 'assessment/template/add-body',
      defaultMessage:
        'Stages from the template are appended in order without start times and can be scheduled individually afterwards.',
    },
    'refusal.schedule-out-of-order': {
      id: 'assessment/refusal/schedule-out-of-order',
      defaultMessage: 'Stages must be scheduled in order. Schedule the previous stage first.',
    },
    'refusal.unschedule-not-from-tail': {
      id: 'assessment/refusal/unschedule-not-from-tail',
      defaultMessage:
        'Cancel the last scheduled stage first; schedules must be removed in reverse order.',
    },
    'refusal.scheduled-phase-immutable': {
      id: 'assessment/refusal/scheduled-phase-immutable',
      defaultMessage: 'A scheduled stage cannot be moved or deleted.',
    },
    removePhase: { id: 'assessment/phase/remove', defaultMessage: 'Delete stage' },

    // how a stage starts
    displayNameLabel: { id: 'assessment/phase/display-name', defaultMessage: 'Stage name' },
    unnamedSegment: { id: 'assessment/plan/unnamed', defaultMessage: 'Unnamed stage' },
    newBadge: { id: 'assessment/plan/new-badge', defaultMessage: 'Not saved' },
    discardTitle,
    discardEdits: { id: 'assessment/plan/discard', defaultMessage: 'Discard changes' },
    pickDate: { id: 'assessment/phase/pick-date', defaultMessage: 'Select date' },
    pickTime: { id: 'assessment/phase/pick-time', defaultMessage: 'Select time' },
    clearTime: { id: 'assessment/phase/clear-time', defaultMessage: 'Clear' },
    currentBadge: { id: 'assessment/phase/current', defaultMessage: 'In progress' },
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
      defaultMessage: 'Timeline template',
    },
    timelineTemplateEmpty: {
      id: 'assessment/template/timeline-empty',
      defaultMessage: 'No timeline templates are available. Stages can still be added manually.',
    },
    timelineTemplateChoose: {
      id: 'assessment/template/timeline-choose',
      defaultMessage: 'Select a timeline template…',
    },
    phaseTemplateLegend: {
      id: 'assessment/template/phase-legend',
      defaultMessage: 'Apply stage template',
    },
    phaseTemplateChoose: {
      id: 'assessment/template/phase-choose',
      defaultMessage: 'Select a stage template…',
    },
    phaseTemplateApply: { id: 'assessment/template/phase-apply', defaultMessage: 'Apply' },

    // what a stage opens
    profileTitle: {
      id: 'assessment/profile/title',
      defaultMessage: 'Actions available during this stage',
    },
    profileHint: {
      id: 'assessment/profile/hint',
      defaultMessage: 'Applies only during this stage and does not change global role permissions.',
    },

    // ------------------------------------------------------------------
    // participants
    rosterHint: {
      id: 'assessment/roster/hint',
      defaultMessage:
        'Manage batch participants and process roster changes caused by organization updates.',
    },
    importFromOrganization: {
      id: 'assessment/roster/import',
      defaultMessage: 'Import from organization',
    },
    importTitle: { id: 'assessment/roster/import-title', defaultMessage: 'Import participants' },
    importHint: {
      id: 'assessment/roster/import-hint',
      defaultMessage: 'Participants already on the roster are skipped automatically.',
    },
    importChoose: {
      id: 'assessment/roster/import-choose',
      defaultMessage: 'Select organization units and participant types.',
    },
    importConfirm: { id: 'assessment/roster/import-confirm', defaultMessage: 'Import' },
    importCandidates,
    toastImported,
    toastAdded,
    toastMerged,
    toastExcluded: { id: 'assessment/toast/excluded', defaultMessage: 'Removed from roster' },
    toastRestored: { id: 'assessment/toast/restored', defaultMessage: 'Restored to roster' },
    toastAdjusted: { id: 'assessment/toast/adjusted', defaultMessage: 'Saved' },
    toastBatchCreated: { id: 'assessment/toast/batch-created', defaultMessage: 'Batch created' },
    toastBatchSaved: { id: 'assessment/toast/batch-saved', defaultMessage: 'Saved' },
    toastBatchArchived: { id: 'assessment/toast/batch-archived', defaultMessage: 'Batch archived' },
    toastBatchReopened: { id: 'assessment/toast/batch-reopened', defaultMessage: 'Batch reopened' },
    toastBatchDeleted: { id: 'assessment/toast/batch-deleted', defaultMessage: 'Batch deleted' },
    toastPlanSaved: { id: 'assessment/toast/plan-saved', defaultMessage: 'Stage plan saved' },
    toastPhaseScheduled: {
      id: 'assessment/toast/phase-scheduled',
      defaultMessage: 'Start time saved',
    },
    toastPhaseAdvanced: {
      id: 'assessment/toast/phase-advanced',
      defaultMessage: 'Advanced to the next stage',
    },
    toastLapsedCleared: {
      id: 'assessment/toast/lapsed-cleared',
      defaultMessage: 'Expired records cleared',
    },
    toastStaffAdded: { id: 'assessment/toast/staff-added', defaultMessage: 'Staff member added' },
    toastStaffRemoved: {
      id: 'assessment/toast/staff-removed',
      defaultMessage: 'Removed from the batch',
    },
    addPeople: { id: 'assessment/roster/add', defaultMessage: 'Add participants' },
    addPeopleTitle: { id: 'assessment/roster/add-title', defaultMessage: 'Add participants' },
    addPeopleHint: {
      id: 'assessment/roster/add-hint',
      defaultMessage: 'Search by name or ID, or browse the organization.',
    },
    addPeopleConfirm,
    pickerUnavailable: {
      id: 'assessment/roster/picker-unavailable',
      defaultMessage: 'Your account does not have permission to browse people.',
    },
    rosterUnits: { id: 'assessment/roster/units', defaultMessage: 'Organization unit' },
    rosterEmpty: {
      id: 'assessment/roster/empty',
      defaultMessage: 'No participants yet.',
    },
    columnParticipant: { id: 'assessment/roster/column-name', defaultMessage: 'Name' },
    columnParticipantStatus: {
      id: 'assessment/roster/column-status',
      defaultMessage: 'Status',
    },
    participantActive: { id: 'assessment/roster/active', defaultMessage: 'Participating' },
    excludedBadge: { id: 'assessment/roster/excluded', defaultMessage: 'Removed' },
    exclude: { id: 'assessment/roster/exclude', defaultMessage: 'Remove' },
    excludeTitle: {
      id: 'assessment/roster/exclude-title',
      defaultMessage: 'Remove {name} from the roster?',
    },
    excludeBody: {
      id: 'assessment/roster/exclude-body',
      defaultMessage:
        'The participant will no longer take part in the batch. Existing submissions and review records are retained, and the participant can be added again later.',
    },
    restore: { id: 'assessment/roster/restore', defaultMessage: 'Restore' },
    participantCount,
    alsoActiveIn,
    noBusinessNoShort: {
      id: 'assessment/roster/no-business-no',
      defaultMessage: 'No institutional ID',
    },
    includedAt,

    // ------------------------------------------------------------------
    // who may work on the round, and what this round accepted of it
    accessHint: {
      id: 'assessment/access/hint',
      defaultMessage:
        'Manage staff permissions for this batch and process permission changes from the organization.',
    },
    accessEmpty: {
      id: 'assessment/access/empty',
      defaultMessage: 'No staff members are assigned to this batch.',
    },
    accessEmptyHint: {
      id: 'assessment/access/empty-hint',
      defaultMessage: 'Sync organization permissions or add staff members manually.',
    },
    accessColumnPerson: { id: 'assessment/access/column-person', defaultMessage: 'Person' },
    accessColumnSources: {
      id: 'assessment/access/column-sources',
      defaultMessage: 'Permission source',
    },
    accessColumnPermissions: {
      id: 'assessment/access/column-permissions',
      defaultMessage: 'Batch permissions',
    },
    accessOriginInherited: {
      id: 'assessment/access/origin-inherited',
      defaultMessage: 'Organization role',
    },
    accessOriginExplicit: {
      id: 'assessment/access/origin-explicit',
      defaultMessage: 'Batch-specific assignment',
    },
    accessSourceLapsed: {
      id: 'assessment/access/source-lapsed',
      defaultMessage: 'Organization permission expired',
    },
    accessNothing: {
      id: 'assessment/access/nothing',
      defaultMessage: 'None',
    },
    accessAdjust: { id: 'assessment/access/adjust', defaultMessage: 'Adjust' },
    accessAdjustTitle: {
      id: 'assessment/access/adjust-title',
      defaultMessage: 'Adjust {name}\u2019s batch permissions',
    },
    accessAdjustHint: {
      id: 'assessment/access/adjust-hint',
      defaultMessage:
        'Changes apply only to this batch and do not modify the user\u2019s organization roles.',
    },
    accessRemove: { id: 'assessment/access/remove', defaultMessage: 'Remove from batch' },
    accessRemoveTitle: {
      id: 'assessment/access/remove-title',
      defaultMessage: 'Remove {name} from the batch?',
    },
    accessRemoveBody: {
      id: 'assessment/access/remove-body',
      defaultMessage:
        'The user will no longer be able to work on this batch. Existing activity records are retained.',
    },
    accessSyncTitle: {
      id: 'assessment/access/sync-title',
      defaultMessage: 'Organization permissions changed',
    },
    // the bar: what happened, and the one thing to do about it
    accessSyncPrompt: {
      id: 'assessment/access/sync-prompt',
      defaultMessage:
        'Organization permissions changed. Review the changes before applying them to this batch.',
    },
    accessSyncLapsedPrompt: {
      id: 'assessment/access/sync-lapsed-prompt',
      defaultMessage:
        'Some organization permissions were revoked and the corresponding batch permissions are no longer active.',
    },
    accessSyncOpen: { id: 'assessment/access/sync-open', defaultMessage: 'Review changes' },
    accessSyncSelectPage: {
      id: 'assessment/access/sync-select-page',
      defaultMessage: 'Select all on this page',
    },
    accessSyncHint: {
      id: 'assessment/access/sync-hint',
      defaultMessage: 'Select the organization permission changes to apply to this batch.',
    },
    accessSyncNew: { id: 'assessment/access/sync-new', defaultMessage: 'New authorization' },
    accessSyncWidened: {
      id: 'assessment/access/sync-widened',
      defaultMessage: 'Additional permissions',
    },
    accessSyncLapsed: {
      id: 'assessment/access/sync-lapsed',
      defaultMessage: 'Authorization revoked',
    },
    accessSyncLapsedHint: {
      id: 'assessment/access/sync-lapsed-hint',
      defaultMessage:
        'The organization authorization was revoked and the corresponding batch permission is already inactive.',
    },
    accessSyncApply: { id: 'assessment/access/sync-apply', defaultMessage: 'Apply changes' },
    accessSyncClear: {
      id: 'assessment/access/sync-clear',
      defaultMessage: 'Clear expired records',
    },
    accessSyncQuiet: {
      id: 'assessment/access/sync-quiet',
      defaultMessage: 'Batch permissions are consistent with the organization.',
    },
    accessSourceCount,
    accessRoleAt,
    accessDeniedCount,
    accessSyncSelected,
    addStaff: { id: 'assessment/access/add-staff', defaultMessage: 'Add staff member' },
    addStaffTitle: {
      id: 'assessment/access/add-staff-title',
      defaultMessage: 'Add staff member to this batch',
    },
    addStaffHint: {
      id: 'assessment/access/add-staff-hint',
      defaultMessage: 'Assigned permissions apply only to this batch.',
    },
    addStaffStepWho: { id: 'assessment/access/add-staff-step-who', defaultMessage: 'Person' },
    addStaffStepWhere: { id: 'assessment/access/add-staff-step-where', defaultMessage: 'Unit' },
    addStaffStepAs: { id: 'assessment/access/add-staff-step-as', defaultMessage: 'Role' },
    addStaffWhereHint: {
      id: 'assessment/access/add-staff-where-hint',
      defaultMessage:
        'Select the organization scope the user will be responsible for in this batch.',
    },
    addStaffAsHint: {
      id: 'assessment/access/add-staff-as-hint',
      defaultMessage: 'The selected role determines the user\u2019s permissions in this batch.',
    },
    roleRefusedUserType: {
      id: 'assessment/access/role-refused-user-type',
      defaultMessage: 'The role is not available for this user type',
    },
    roleRefusedAuthority: {
      id: 'assessment/access/role-refused-authority',
      defaultMessage: 'You do not have permission to assign this role',
    },
    roleRefusedSelfEscalation: {
      id: 'assessment/access/role-refused-self-escalation',
      defaultMessage: 'Granting yourself this role would add authority you do not hold',
    },
    roleRefusedUnavailable: {
      id: 'assessment/access/role-refused-unavailable',
      defaultMessage: 'The role is no longer available',
    },
    roleRefusedBeyondBatch: {
      id: 'assessment/access/role-refused-beyond-batch',
      defaultMessage: 'The role includes permissions outside the batch scope',
    },
    addStaffNoRoles: {
      id: 'assessment/access/add-staff-no-roles',
      defaultMessage: 'No assignable roles are available',
    },
    addStaffConfirm: { id: 'assessment/access/add-staff-confirm', defaultMessage: 'Add' },

    // ------------------------------------------------------------------
    // the three families the gate itself distinguishes
    permissionGroupEntry: {
      id: 'assessment/permission-group/entry',
      defaultMessage: 'Submission',
    },
    permissionGroupReview: {
      id: 'assessment/permission-group/review',
      defaultMessage: 'Review',
    },
    permissionGroupResult: {
      id: 'assessment/permission-group/result',
      defaultMessage: 'Results',
    },

    // one sentence per gated code: what opening it lets a participant do
    'permission-hint.assessment.entry.create': {
      id: 'assessment/permission-hint/entry-create',
      defaultMessage: 'Create new entries for items available in the current stage.',
    },
    'permission-hint.assessment.entry.edit': {
      id: 'assessment/permission-hint/entry-edit',
      defaultMessage: 'Edit owned entries that have not yet been submitted.',
    },
    'permission-hint.assessment.entry.submit': {
      id: 'assessment/permission-hint/entry-submit',
      defaultMessage: 'Submit draft entries to the review workflow.',
    },
    'permission-hint.assessment.entry.withdraw': {
      id: 'assessment/permission-hint/entry-withdraw',
      defaultMessage: 'Withdraw submitted entries before the first reviewer takes action.',
    },
    'permission-hint.assessment.entry.proxy': {
      id: 'assessment/permission-hint/entry-proxy',
      defaultMessage:
        'Create and submit entries on behalf of participants while keeping the entries assigned to them.',
    },
    'permission-hint.assessment.entry.record': {
      id: 'assessment/permission-hint/entry-record',
      defaultMessage:
        'Record institutionally recognized items that do not require participant submission.',
    },
    // still spoken of on the phase editor: the gate opens and closes it by
    // name whoever it belongs to, and it belongs to the participant (§32.14)
    'permission-hint.assessment.entry.appeal': {
      id: 'assessment/permission-hint/entry-appeal',
      defaultMessage: 'Appeal an entry that already has a review decision.',
    },
    'permission-hint.assessment.review.escalate': {
      id: 'assessment/permission-hint/review-escalate',
      defaultMessage: 'Escalate submissions that require further review.',
    },
    'permission-hint.assessment.review.process': {
      id: 'assessment/permission-hint/review-process',
      defaultMessage: 'Review submitted entries and approve or return them.',
    },
    'permission-hint.assessment.review.reopen': {
      id: 'assessment/permission-hint/review-reopen',
      defaultMessage: 'Reopen a review that has already ended.',
    },
    'permission-hint.assessment.result.view-peers': {
      id: 'assessment/permission-hint/result-view-peers',
      defaultMessage: 'View the results of other participants.',
    },
    'permission-hint.assessment.ranking.view': {
      id: 'assessment/permission-hint/ranking-view',
      defaultMessage: 'View the batch ranking.',
    },
    'permission-hint.assessment.publication.manage': {
      id: 'assessment/permission-hint/publication-manage',
      defaultMessage: 'Announce, publish, or withdraw the batch results.',
    },

    // one label per gated code; the matrix is built from PHASE_GATED_CODES,
    // so a code without a label here does not compile
    'permission.assessment.entry.create': {
      id: 'assessment/permission/entry-create',
      defaultMessage: 'Create entries',
    },
    'permission.assessment.entry.edit': {
      id: 'assessment/permission/entry-edit',
      defaultMessage: 'Edit drafts',
    },
    'permission.assessment.entry.submit': {
      id: 'assessment/permission/entry-submit',
      defaultMessage: 'Submit for review',
    },
    'permission.assessment.entry.withdraw': {
      id: 'assessment/permission/entry-withdraw',
      defaultMessage: 'Withdraw submissions',
    },
    'permission.assessment.entry.proxy': {
      id: 'assessment/permission/entry-proxy',
      defaultMessage: 'Submit on behalf of participants',
    },
    'permission.assessment.entry.record': {
      id: 'assessment/permission/entry-record',
      defaultMessage: 'Record recognized items',
    },
    'permission.assessment.entry.appeal': {
      id: 'assessment/permission/entry-appeal',
      defaultMessage: 'File appeals',
    },
    'permission.assessment.review.escalate': {
      id: 'assessment/permission/review-escalate',
      defaultMessage: 'Escalate reviews',
    },
    'permission.assessment.review.process': {
      id: 'assessment/permission/review-process',
      defaultMessage: 'Review submissions',
    },
    'permission.assessment.review.reopen': {
      id: 'assessment/permission/review-reopen',
      defaultMessage: 'Reopen completed reviews',
    },
    'permission.assessment.result.view-peers': {
      id: 'assessment/permission/result-view-peers',
      defaultMessage: 'View other participants\u2019 results',
    },
    'permission.assessment.ranking.view': {
      id: 'assessment/permission/ranking-view',
      defaultMessage: 'View ranking',
    },
    // not gated by a phase, so the phase editor never lists it; the access
    // page does, because a role can carry it into a round
    'permission.assessment.publication.manage': {
      id: 'assessment/permission/publication-manage',
      defaultMessage: 'Manage result publication',
    },

    // ------------------------------------------------------------------
    // the engine's refusals, in words an administrator can act on
    'refusal.phase-not-found': {
      id: 'assessment/refusal/phase-not-found',
      defaultMessage:
        'One or more stages are no longer part of the current plan. Refresh and try again.',
    },
    'refusal.actual-immutable': {
      id: 'assessment/refusal/actual-immutable',
      defaultMessage: 'The start time of a stage that has already begun cannot be changed.',
    },
    'refusal.phase-already-entered': {
      id: 'assessment/refusal/phase-already-entered',
      defaultMessage: 'The stage has already started, so its schedule can no longer be changed.',
    },
    'refusal.ended-phase-name-only': {
      id: 'assessment/refusal/ended-phase-name-only',
      defaultMessage: 'Only the name of an ended stage can still be changed.',
    },
    'refusal.display-name-blank': {
      id: 'assessment/refusal/display-name-blank',
      defaultMessage: 'A stage name is required.',
    },
    'refusal.planned-not-in-future': {
      id: 'assessment/refusal/planned-not-in-future',
      defaultMessage: 'The start time must be in the future.',
    },
    'refusal.planned-out-of-order': {
      id: 'assessment/refusal/planned-out-of-order',
      defaultMessage: 'Scheduled start times must follow the stage order.',
    },
    'refusal.profile-code-not-gated': {
      id: 'assessment/refusal/profile-code-not-gated',
      defaultMessage: 'One or more selected actions cannot be controlled by stage availability.',
    },
    'refusal.insert-not-after-current': {
      id: 'assessment/refusal/insert-not-after-current',
      defaultMessage:
        'While the batch is active, new stages can only be added after the current stage.',
    },
    'refusal.plan-empty': {
      id: 'assessment/refusal/plan-empty',
      defaultMessage: 'At least one valid stage is required before the batch can start.',
    },
    'refusal.template-requires-draft': {
      id: 'assessment/refusal/template-requires-draft',
      defaultMessage: 'Timeline templates can only be applied while the batch is still a draft.',
    },
    'refusal.phase-removed': {
      id: 'assessment/refusal/phase-removed',
      defaultMessage: 'A stage cannot be deleted after it has started.',
    },
    'refusal.reorder-not-allowed': {
      id: 'assessment/refusal/reorder-not-allowed',
      defaultMessage: 'Started stages cannot be reordered.',
    },
    'refusal.phase-key-immutable': {
      id: 'assessment/refusal/phase-key-immutable',
      defaultMessage:
        'The participant type associated with a stage cannot be changed after the batch starts.',
    },
    'refusal.scope-in-template': {
      id: 'assessment/refusal/scope-in-template',
      defaultMessage:
        'Reusable templates cannot reference items or participants from a specific batch.',
    },
    'refusal.participant-not-in-batch': {
      id: 'assessment/refusal/participant-not-in-batch',
      defaultMessage: 'One or more selected users are not participants in this batch.',
    },
    'refusal.item-not-in-batch': {
      id: 'assessment/refusal/item-not-in-batch',
      defaultMessage: 'One or more selected items do not belong to this batch.',
    },
    'refusal.phase-template-shape': {
      id: 'assessment/refusal/phase-template-shape',
      defaultMessage:
        'A stage template defines the basic information and available actions for a single stage, without scheduling information.',
    },
    'refusal.template-not-a-timeline': {
      id: 'assessment/refusal/template-not-a-timeline',
      defaultMessage:
        'The selected template defines a single stage rather than a complete timeline and cannot replace the stage plan.',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof assessmentErrors>>()({
    ASSESSMENT_BATCH_NOT_FOUND: {
      id: 'assessment/error/batch-not-found',
      defaultMessage: 'The batch could not be found.',
    },
    ASSESSMENT_PHASE_NOT_FOUND: {
      id: 'assessment/error/phase-not-found',
      defaultMessage: 'The stage is no longer part of the batch. Refresh and try again.',
    },
    ASSESSMENT_PARTICIPANT_NOT_FOUND: {
      id: 'assessment/error/participant-not-found',
      defaultMessage: 'The user is not on the participant roster for this batch.',
    },
    ASSESSMENT_PARTICIPANT_INVALID: {
      id: 'assessment/error/participant-invalid',
      defaultMessage:
        'The participant roster could not be updated. Check the selected information and try again.',
    },
    ASSESSMENT_TEMPLATE_NOT_FOUND: {
      id: 'assessment/error/template-not-found',
      defaultMessage: 'The template could not be found or has been deleted.',
    },
    ASSESSMENT_TEMPLATE_CONFLICT: {
      id: 'assessment/error/template-conflict',
      defaultMessage: 'A template with the same name already exists.',
    },
    ASSESSMENT_BATCH_READ_ONLY: {
      id: 'assessment/error/batch-read-only',
      defaultMessage: 'The batch is archived and cannot be modified.',
    },
    ASSESSMENT_BATCH_STATUS_INVALID: {
      id: 'assessment/error/batch-status-invalid',
      defaultMessage: 'The current batch status does not allow this operation.',
    },
    ASSESSMENT_BATCH_NO_PARTICIPANTS: {
      id: 'assessment/error/batch-no-participants',
      defaultMessage: 'Add or import at least one participant before starting the batch.',
    },
    ASSESSMENT_BATCH_REFERENCE_INVALID: {
      id: 'assessment/error/batch-reference-invalid',
      defaultMessage: 'One or more selected units or participant types are no longer valid.',
    },
    ASSESSMENT_PLAN_INVALID: {
      id: 'assessment/error/plan-invalid',
      defaultMessage: 'The stage plan could not be saved. Correct the listed issues and try again.',
    },
    ASSESSMENT_ADVANCE_INVALID: {
      id: 'assessment/error/advance-invalid',
      defaultMessage:
        'The batch cannot advance to the selected stage. Check the stage settings and prerequisites.',
    },
    ASSESSMENT_ACCESS_INVALID: {
      id: 'assessment/error/access-invalid',
      defaultMessage:
        'The permission change could not be applied. Check the selected settings and try again.',
    },
    ASSESSMENT_MATERIAL_RANGE_INVALID: {
      id: 'assessment/error/material-range-invalid',
      defaultMessage:
        'The new material date range conflicts with existing entries. Resolve the affected entries before changing the range.',
    },
    ASSESSMENT_ENTRY_NOT_FOUND: {
      id: 'assessment/error/entry-not-found',
      defaultMessage: 'The entry could not be found or has been deleted.',
    },
    ASSESSMENT_ENTRY_ACTION_REFUSED: {
      id: 'assessment/error/entry-action-refused',
      defaultMessage: 'The action is not available for the entry in its current state.',
    },
    ASSESSMENT_ENTRY_PAYLOAD_INVALID: {
      id: 'assessment/error/entry-payload-invalid',
      defaultMessage: 'The entry could not be saved. Correct the listed fields and try again.',
    },
    ASSESSMENT_ITEM_ACTION_REFUSED: {
      id: 'assessment/error/item-action-refused',
      defaultMessage: 'The action is not available for the item in its current state.',
    },
    ASSESSMENT_ATTACHMENT_NOT_FOUND: {
      id: 'assessment/error/attachment-not-found',
      defaultMessage: 'The file could not be found or has been deleted.',
    },
    ASSESSMENT_REVIEW_NOT_FOUND: {
      id: 'assessment/error/review-not-found',
      defaultMessage: 'The review task could not be found.',
    },
    ASSESSMENT_REVIEW_CONFLICT: {
      id: 'assessment/error/review-conflict',
      defaultMessage:
        'The review task has already been handled by another reviewer. Refresh to view the latest result.',
    },
    ASSESSMENT_ITEM_NOT_FOUND: {
      id: 'assessment/error/item-not-found',
      defaultMessage: 'The item could not be found or has been deleted.',
    },
    ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED: {
      id: 'assessment/error/item-change-decision-required',
      defaultMessage: 'Choose how existing work affected by the change should be handled.',
    },
    ASSESSMENT_ITEM_CONFIG_INVALID: {
      id: 'assessment/error/item-config-invalid',
      defaultMessage: 'The item could not be saved. Correct the listed issues and try again.',
    },
    ASSESSMENT_SCORE_GROUP_INVALID: {
      id: 'assessment/error/score-group-invalid',
      defaultMessage:
        'The scoring groups could not be saved. Correct the listed issues and try again.',
    },
    ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT: {
      id: 'assessment/error/score-group-version-conflict',
      defaultMessage:
        'The scoring groups were changed by another user while you were editing. Refresh and apply the changes again.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
