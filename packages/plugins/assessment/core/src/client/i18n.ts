import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import { defineMessage, selectKey } from '@qualy/i18n-contract'
import type * as assessmentErrors from '../errors.ts'

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

// the rule's own sentence travels as a value: it is what the person
// determining needs to read, and it is nobody's translation key
// one code, and the two answers behind it that are not the same news: a
// request that may not be made, and one that has already been made
const accessInvalid = defineMessage<{ reason: string }>()({
  id: 'assessment/error/access-invalid',
  defaultMessage:
    '{reason, select, alreadyStaffed {That person already holds this role in the selected unit.} tooMany {Too many people and units at once. Add them in smaller groups.} other {The permission change could not be applied. Check the selected settings and try again.}}',
})

const batchStatusInvalid = defineMessage<{ refusal: string; openRounds: number }>()({
  id: 'assessment/error/batch-status-invalid',
  defaultMessage:
    '{refusal, select, roundsOpen {{openRounds, plural, one {# entry is still in review.} other {# entries are still in review.}} Finish reviewing them before archiving.} other {The current batch status does not allow this operation.}}',
})

const determinationRefused = defineMessage<{ reason: string }>()({
  id: 'assessment/error/determination-refused',
  defaultMessage: 'The current scoring rule does not accept this determination: {reason}',
})

// how many determinations in force the candidate rule cannot take, and how
const scoringIncompatible = defineMessage<{
  /** `derived`: a question nobody files, whose own rule was tried; `standing`: claims already determined */
  case: string
  affected: number
  refused: number
  executionFailed: number
}>()({
  id: 'assessment/error/item-scoring-incompatible',
  defaultMessage:
    "{case, select, derived {The question's scoring rule cannot give a score. Correct the rule and try again.} other {The new scoring rule cannot handle {affected, plural, one {# determination} other {# determinations}} already in force ({refused} refused by the rule, {executionFailed} failed to compute). Correct the rule and try again.}}",
})

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
    '{count, plural, one {# participant} other {# participants}} 　 materials from {from} to {until}',
})

const batchSummaryDraft = defineMessage<{ units: number; from: string; until: string }>()({
  id: 'assessment/batch/summary-draft',
  defaultMessage:
    '{units, plural, one {# unit} other {# units}} 　 materials from {from} to {until}',
})

const pageOfTotal = defineMessage<{ page: number; pages: number }>()({
  id: 'assessment/batch/page-of-total',
  defaultMessage: 'Page {page} of {pages}',
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
  defaultMessage: '{count, plural, one {Stage 　 # day left} other {Stage 　 # days left}}',
})
const bareHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-hours',
  defaultMessage: '{count, plural, one {Stage 　 # hour left} other {Stage 　 # hours left}}',
})
const bareMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-minutes',
  defaultMessage: '{count, plural, one {Stage 　 # minute left} other {Stage 　 # minutes left}}',
})
const bareSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-seconds',
  defaultMessage: '{count, plural, one {Stage 　 # second left} other {Stage 　 # seconds left}}',
})
const bareSinceDays = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-days',
  defaultMessage: '{count, plural, one {Stage 　 # day elapsed} other {Stage 　 # days elapsed}}',
})
const bareSinceHours = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-hours',
  defaultMessage: '{count, plural, one {Stage 　 # hour elapsed} other {Stage 　 # hours elapsed}}',
})
const bareSinceMinutes = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-minutes',
  defaultMessage:
    '{count, plural, one {Stage 　 # minute elapsed} other {Stage 　 # minutes elapsed}}',
})
const bareSinceSeconds = defineMessage<{ count: number }>()({
  id: 'assessment/progress/bare-since-seconds',
  defaultMessage:
    '{count, plural, one {Stage 　 # second elapsed} other {Stage 　 # seconds elapsed}}',
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

const submissionsCount = defineMessage<{ count: number }>()({
  id: 'assessment/batch/submissions-count',
  defaultMessage: '{count, plural, one {# submission} other {# submissions}}',
})

const toRevise = defineMessage<{ count: number }>()({
  id: 'assessment/batch/to-revise',
  defaultMessage: '{count, plural, one {# to revise} other {# to revise}}',
})

const toSubmit = defineMessage<{ count: number }>()({
  id: 'assessment/batch/to-submit',
  defaultMessage: '{count, plural, one {# not sent} other {# not sent}}',
})

const toAnswer = defineMessage<{ count: number }>()({
  id: 'assessment/batch/to-answer',
  defaultMessage: '{count, plural, one {# needs more from you} other {# need more from you}}',
})

const notAccepted = defineMessage<{ count: number }>()({
  id: 'assessment/batch/not-accepted',
  defaultMessage: '{count, plural, one {# not accepted} other {# not accepted}}',
})

const accepted = defineMessage<{ count: number }>()({
  id: 'assessment/batch/accepted',
  defaultMessage: '{count, plural, one {# accepted} other {# accepted}}',
})

const underReview = defineMessage<{ count: number }>()({
  id: 'assessment/batch/under-review',
  defaultMessage: '{count, plural, one {# with the reviewers} other {# with the reviewers}}',
})

/** the stage's place in the run, where the run itself is drawn alongside */
const stageAt = defineMessage<{ current: number; total: number }>()({
  id: 'assessment/batch/stage-at',
  defaultMessage: '{current} / {total}',
})

const stageDeadline = defineMessage<{ when: string }>()({
  id: 'assessment/batch/stage-deadline',
  defaultMessage: 'Closes {when}',
})

const stageUntil = defineMessage<{ date: string }>()({
  id: 'assessment/batch/stage-until',
  defaultMessage: 'This stage until {date}',
})

const startsOn = defineMessage<{ date: string }>()({
  id: 'assessment/batch/starts-on',
  defaultMessage: 'Starts {date}',
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

const personIncludedAtMessage = defineMessage<{ when: string }>()({
  id: 'assessment/person/included-at',
  defaultMessage: 'Added {when}',
})
const personExcludedAtMessage = defineMessage<{ when: string }>()({
  id: 'assessment/person/excluded-at',
  defaultMessage: 'Taken off {when}',
})

const reviewTagLinkedMessage = defineMessage<{ name: string }>()({
  id: 'assessment/review/tag-linked',
  defaultMessage: 'Linked: {name}',
})
const reviewAdjustHintMessage = defineMessage<{ names: string }>()({
  id: 'assessment/review/adjust-hint',
  defaultMessage:
    '{names} differ from the filing. Say why; it is kept with the determination for later review and appeals.',
})
const reviewFillFirstMessage = defineMessage<{ name: string }>()({
  id: 'assessment/review/fill-first',
  defaultMessage: 'Fill in {name} before approving',
})
const reviewSummaryCountMessage = defineMessage<{ count: number }>()({
  id: 'assessment/review/summary-count',
  defaultMessage: '{count, plural, one {# field} other {# fields}}',
})
const reviewSummaryDifferMessage = defineMessage<{ count: number }>()({
  id: 'assessment/review/summary-differ',
  defaultMessage: '{count} differ from the filing',
})
const rosterRowActionsMessage = defineMessage<{ name: string }>()({
  id: 'assessment/roster/row-actions',
  defaultMessage: 'What can be done about {name}',
})
const recognitionAfterLatestMessage = defineMessage<{ constraint: string }>()({
  id: 'assessment/review/recognition-after-latest',
  defaultMessage: 'No later than {constraint}',
})
const recognitionBeforeEarliestMessage = defineMessage<{ constraint: string }>()({
  id: 'assessment/review/recognition-before-earliest',
  defaultMessage: 'No earlier than {constraint}',
})
const recordUnitRosterPageMessage = defineMessage<{ page: number }>()({
  id: 'assessment/record/unit-roster-page',
  defaultMessage: 'Page {page}',
})
const reviewDraftRestoredMessage = defineMessage<{ when: string }>()({
  id: 'assessment/review/draft-restored',
  defaultMessage: 'Put back from what you wrote here on {when}, still unsent',
})
const reviewSummaryWrongMessage = defineMessage<{ count: number }>()({
  id: 'assessment/review/summary-wrong',
  defaultMessage: '{count} filled in wrongly',
})
const reviewSummaryMissingMessage = defineMessage<{ count: number }>()({
  id: 'assessment/review/summary-missing',
  defaultMessage: '{count} to fill in',
})
const reviewLinkedToMessage = defineMessage<{ names: string }>()({
  id: 'assessment/review/linked-to',
  defaultMessage: 'Filled into: {names}',
})
const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {
    personBatchColumn: { id: 'assessment/person/batch-column', defaultMessage: 'Round' },
    personAnchorColumn: { id: 'assessment/person/anchor-column', defaultMessage: 'Recorded at' },
    personMembershipColumn: {
      id: 'assessment/person/membership-column',
      defaultMessage: 'Standing',
    },
    personIncludedColumn: { id: 'assessment/person/included-column', defaultMessage: 'Joined' },
    reviewLinkedTag: { id: 'assessment/review/linked-tag', defaultMessage: 'Linked' },
    reviewTagLinked: reviewTagLinkedMessage,
    reviewTagLocked: {
      id: 'assessment/review/tag-locked',
      defaultMessage: 'Settled by the sitting',
    },
    reviewFiledWas: { id: 'assessment/review/filed-was', defaultMessage: 'Filed as' },
    reviewAdjustHint: reviewAdjustHintMessage,
    reviewFillFirst: reviewFillFirstMessage,
    reviewStandingReady: {
      id: 'assessment/review/standing-ready',
      defaultMessage: 'Ready to approve',
    },
    reviewStandingRefused: {
      id: 'assessment/review/standing-refused',
      defaultMessage: 'The scoring rule does not accept these values',
    },
    reviewStandingReasonOwed: {
      id: 'assessment/review/standing-reason-owed',
      defaultMessage: 'Say why the determination was adjusted',
    },
    reviewPreviewStands: {
      id: 'assessment/review/preview-stands',
      defaultMessage: 'Under the determination as it stands',
    },
    reviewPreviewFixFirst: {
      id: 'assessment/review/preview-fix-first',
      defaultMessage: 'Correct it before approving',
    },
    reviewPreviewUnit: { id: 'assessment/review/preview-unit', defaultMessage: 'pts' },
    reviewSummaryCount: reviewSummaryCountMessage,
    reviewSummaryDiffer: reviewSummaryDifferMessage,
    reviewSummaryMissing: reviewSummaryMissingMessage,
    reviewSummaryWrong: reviewSummaryWrongMessage,
    reviewDraftRestored: reviewDraftRestoredMessage,
    reviewDraftDiscard: { id: 'assessment/review/draft-discard', defaultMessage: 'Start again' },
    reviewLinkedTo: reviewLinkedToMessage,
    reviewResetToFiled: { id: 'assessment/review/reset-to-filed', defaultMessage: 'Restore' },
    nodeUsageManaged: {
      id: 'assessment/node-usage/managed',
      defaultMessage: 'Rounds administered from here',
    },
    nodeUsageManagedArchived: {
      id: 'assessment/node-usage/managed-archived',
      defaultMessage: 'Archived rounds administered from here',
    },
    nodeUsageParticipantsArchived: {
      id: 'assessment/node-usage/participants-archived',
      defaultMessage: 'Archived rounds whose participants were recorded here',
    },
    nodeUsageParticipants: {
      id: 'assessment/node-usage/participants',
      defaultMessage: 'Rounds whose participants were recorded here',
    },
    // one label per permission this plugin declares. The definition
    // carries a message reference, so the role editor renders whatever
    // language its reader asked for rather than the one it was authored in.
    'permission.assessment.batch.manage': {
      id: 'assessment/permission/batch-manage',
      defaultMessage: 'Manage assessment batches',
    },
    'audit.assessment.batch.create': {
      id: 'assessment/audit/batch-create',
      defaultMessage: 'Create assessment batch',
    },
    'audit.assessment.batch.delete': {
      id: 'assessment/audit/batch-delete',
      defaultMessage: 'Delete assessment batch',
    },
    'permission-hint.assessment.batch.manage': {
      id: 'assessment/permission-hint/batch-manage',
      defaultMessage: 'The whole life of a batch: stages, questions and the roster.',
    },
    'permission.assessment.batch.force-advance': {
      id: 'assessment/permission/batch-force-advance',
      defaultMessage: 'Force a stage change',
    },
    'permission-hint.assessment.batch.force-advance': {
      id: 'assessment/permission-hint/batch-force-advance',
      defaultMessage: 'Move a batch past its guard conditions; a reason is required.',
    },
    // ------------------------------------------------------------------
    // the batch list
    // one person's record: the rounds they were in, and what they filed
    personGroup: { id: 'assessment/nav-group/user-detail', defaultMessage: 'Assessment' },
    personBatchesTab: {
      id: 'assessment/person/batches-tab',
      defaultMessage: 'Rounds taken part in',
    },
    personEntriesTab: { id: 'assessment/person/entries-tab', defaultMessage: 'Claims filed' },
    personBatchesEmpty: {
      id: 'assessment/person/batches-empty',
      defaultMessage: 'Not in any round yet',
    },
    personEntriesEmpty: {
      id: 'assessment/person/entries-empty',
      defaultMessage: 'Nothing filed yet',
    },
    personMembershipActive: {
      id: 'assessment/person/membership-active',
      defaultMessage: 'Taking part',
    },
    personMembershipExcluded: {
      id: 'assessment/person/membership-excluded',
      defaultMessage: 'Taken off the list',
    },
    personIncludedAt: personIncludedAtMessage,
    personExcludedAt: personExcludedAtMessage,
    personAnchorGone: {
      id: 'assessment/person/anchor-gone',
      defaultMessage: 'Unit no longer exists',
    },
    personOpenBatch: { id: 'assessment/person/open-batch', defaultMessage: 'Open the round' },
    personColumnBatch: { id: 'assessment/person/column-batch', defaultMessage: 'Round' },
    personColumnItem: { id: 'assessment/person/column-item', defaultMessage: 'Question' },
    personColumnStatus: { id: 'assessment/person/column-status', defaultMessage: 'Status' },
    personColumnSource: { id: 'assessment/person/column-source', defaultMessage: 'Source' },
    personColumnWhen: { id: 'assessment/person/column-when', defaultMessage: 'Filed' },
    personLoadMore: { id: 'assessment/person/load-more', defaultMessage: 'Load more' },
    // a grant confined to one round, explained on the grants screen
    grantFromSomeBatch: {
      id: 'assessment/access/grant-from-some-batch',
      defaultMessage: 'From an assessment round',
    },
    batchesTitle: { id: 'assessment/batch/title', defaultMessage: 'Assessment batches' },
    batchesHint: {
      id: 'assessment/batch/hint',
      defaultMessage: 'Manage assessment batches, stage plans, and participant rosters.',
    },
    // the list with nothing in it, said for why: nothing for this reader,
    // a filter that left nothing, a search that found nothing
    batchesEmpty: {
      id: 'assessment/batch/empty',
      defaultMessage: 'No assessment batches to show',
    },
    newBatch: { id: 'assessment/batch/new', defaultMessage: 'New batch' },
    batchesEmptyHint: {
      id: 'assessment/batch/empty-hint',
      defaultMessage: 'No assessment batch involves you yet',
    },
    emptyFilteredTitle: {
      id: 'assessment/batch/empty-filtered',
      defaultMessage: 'No batches match',
    },
    emptyFilteredHint: {
      id: 'assessment/batch/empty-filtered-hint',
      defaultMessage: 'Try other filters or another search',
    },
    emptySearchTitle: { id: 'assessment/batch/empty-search', defaultMessage: 'No batches found' },
    emptySearchHint: {
      id: 'assessment/batch/empty-search-hint',
      defaultMessage: 'Try another word',
    },
    searchPlaceholder: {
      id: 'assessment/batch/search',
      defaultMessage: 'Search batch names',
    },
    /** names the section under the hero card: the whole list, not just the running rounds */
    batchesAll: { id: 'assessment/batch/all', defaultMessage: 'All batches' },
    filterStatus: { id: 'assessment/batch/filter-status', defaultMessage: 'Status' },
    filterAll: { id: 'assessment/batch/filter-all', defaultMessage: 'All' },
    noMatchTitle: { id: 'assessment/batch/no-match', defaultMessage: 'No matching batches' },
    switcherOnlyThis: {
      id: 'assessment/batch/switcher-only-this',
      defaultMessage: 'This is the only batch you are in.',
    },
    previousPage: { id: 'assessment/action/previous-page', defaultMessage: 'Previous' },
    nextPage: { id: 'assessment/action/next-page', defaultMessage: 'Next' },
    pageOfTotal,
    submissionsCount,
    toRevise,
    toSubmit,
    underReview,
    toAnswer,
    notAccepted,
    accepted,
    stageAt,
    stageDeadline,
    stageUntil,
    startsOn,
    previousBatch: { id: 'assessment/batch/previous', defaultMessage: 'Previous batch' },
    nextBatch: { id: 'assessment/batch/next', defaultMessage: 'Next batch' },
    pickBatch: { id: 'assessment/batch/pick', defaultMessage: 'Choose a batch' },
    awaitingReview: {
      id: 'assessment/batch/awaiting-review',
      defaultMessage: 'Awaiting your review',
    },
    startReview: { id: 'assessment/batch/start-review', defaultMessage: 'Start reviewing' },
    /**
     * A reader who judges here and has nothing pending: still their post.
     * Neutral about why the queue is empty - in a round that has not
     * reached its first review, "all caught up" credits them with work
     * they have not been given yet.
     */
    reviewsClear: { id: 'assessment/batch/reviews-clear', defaultMessage: 'Nothing waiting' },
    myEntries: { id: 'assessment/batch/my-entries', defaultMessage: 'My entries' },
    continueEntries: { id: 'assessment/batch/continue-entries', defaultMessage: 'Continue' },
    continueDraft: { id: 'assessment/batch/continue-draft', defaultMessage: 'Keep filling in' },
    /** on the roster, nothing filed yet */
    entriesNone: { id: 'assessment/batch/entries-none', defaultMessage: 'Nothing filed yet' },
    startEntries: { id: 'assessment/batch/start-entries', defaultMessage: 'Start filing' },
    /** on the roster, nothing filed, and filing opens at a later stage */
    filingUpcoming: {
      id: 'assessment/batch/filing-upcoming',
      defaultMessage: 'Filing not open yet',
    },
    /** on the roster, nothing filed, and filing is over */
    filingMissed: { id: 'assessment/batch/filing-missed', defaultMessage: 'Nothing filed' },
    /** a reviewer asked for more material */
    answerAsk: { id: 'assessment/batch/answer-ask', defaultMessage: 'Respond' },
    /** a filing was not accepted: its reasons come first */
    seeWhy: { id: 'assessment/batch/see-why', defaultMessage: 'See why' },
    /** the quiet way in, for a line that is open without asking anything */
    viewLine: { id: 'assessment/batch/view', defaultMessage: 'View' },
    today: { id: 'assessment/batch/today', defaultMessage: 'Today' },
    columnBatch: { id: 'assessment/batch/column-batch', defaultMessage: 'Batch' },
    columnStage: { id: 'assessment/batch/column-stage', defaultMessage: 'Stage' },
    columnTime: { id: 'assessment/batch/column-time', defaultMessage: 'Time' },
    // a draft's two cells: what it lacks, and that its time is not a time yet
    stageIncomplete: {
      id: 'assessment/batch/stage-incomplete',
      defaultMessage: 'Stages not fully configured',
    },
    timeUnset: { id: 'assessment/batch/time-unset', defaultMessage: 'Not set' },
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
    backToList: { id: 'assessment/batch/back', defaultMessage: 'All rounds' },

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
    statusArchived: { id: 'assessment/status/archived', defaultMessage: 'Ended' },
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
    archive: { id: 'assessment/action/archive', defaultMessage: 'End batch' },
    archiveConfirmTitle: {
      id: 'assessment/action/archive-confirm-title',
      defaultMessage: 'End the batch?',
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
    plannedStart: { id: 'assessment/batch/planned-start', defaultMessage: 'Scheduled start' },
    noStagesYet: { id: 'assessment/batch/no-stages', defaultMessage: 'No stages configured' },
    currentStage: { id: 'assessment/batch/current-stage', defaultMessage: 'Current stage' },
    notStartedYet: { id: 'assessment/batch/not-started', defaultMessage: 'Not started' },
    /** the head's strip where the round has no stages to be in yet */
    noPhasesYet: { id: 'assessment/batch/no-phases', defaultMessage: 'No stages arranged yet' },
    /** the same strip once there is no stage left to be in */
    phasesOver: { id: 'assessment/batch/phases-over', defaultMessage: 'All stages have ended' },
    flowTitle: { id: 'assessment/flow/title', defaultMessage: 'Stage progress' },
    flowFrom,
    flowUntil,
    viewFullFlow: { id: 'assessment/flow/view', defaultMessage: 'View all stages' },
    /** the same door, named for a strip with no room for a sentence */
    fullFlow: { id: 'assessment/flow/full', defaultMessage: 'Full flow' },
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
    // a stage with no time still says something about its time: an empty
    // line reads as a screen that failed to load one
    // said on every stage: a rail of dates leaves the reader counting which
    // of them is behind and which is still to come
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
        'The review may change the original result, up or down, and a result can be appealed only once. To change the material itself, edit it and submit again',
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
    refuseDecisionSuperseded: {
      id: 'assessment/entry/refuse-decision-superseded',
      defaultMessage:
        'This is no longer the claim\u2019s current decision. Refresh to see where it stands.',
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
    refuseChannelClosed: {
      id: 'assessment/entry/refuse-channel-closed',
      defaultMessage: 'This item is recorded by staff and cannot be filed by participants.',
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
    refuseEntryChanged: {
      id: 'assessment/entry/refuse-entry-changed',
      defaultMessage:
        'The entry was changed elsewhere after you opened it. Reopen it to see the latest version.',
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
    refuseNotRequester: {
      id: 'assessment/entry/refuse-not-requester',
      defaultMessage: 'The supplement request is managed by the reviewer who sent it.',
    },
    refuseReviewUnderWay: {
      id: 'assessment/entry/refuse-review-under-way',
      defaultMessage:
        'Review of this entry has already begun; it can no longer be withdrawn for editing. You may abandon it instead.',
    },
    refuseAppealNotWithdrawable: {
      id: 'assessment/entry/refuse-appeal-not-withdrawable',
      defaultMessage: 'An appeal in progress cannot be withdrawn.',
    },
    staffReopen: { id: 'assessment/staff/reopen', defaultMessage: 'Re-examine' },
    staffReopenTitle: {
      id: 'assessment/staff/reopen-title',
      defaultMessage: 'Re-examine this result',
    },
    staffReopenHint: {
      id: 'assessment/staff/reopen-hint',
      defaultMessage:
        'It goes through the escalation workflow from the first step. The participant keeps their own appeal',
    },
    staffReopenNoRoute: {
      id: 'assessment/staff/reopen-no-route',
      defaultMessage: 'This item has no escalation workflow. Re-determine the result instead',
    },
    staffReopened: { id: 'assessment/staff/reopened', defaultMessage: 'Re-examination started' },
    staffRedetermine: { id: 'assessment/staff/redetermine', defaultMessage: 'Re-determine' },
    staffRedetermineTitle: {
      id: 'assessment/staff/redetermine-title',
      defaultMessage: 'Re-determine the result',
    },
    staffRedetermineHint: {
      id: 'assessment/staff/redetermine-hint',
      defaultMessage: 'Give the result directly. The participant can appeal the new result once',
    },
    staffRedetermineDecision: {
      id: 'assessment/staff/redetermine-decision',
      defaultMessage: 'Result',
    },
    staffRedetermineReject: {
      id: 'assessment/staff/redetermine-reject',
      defaultMessage: 'Do not pass',
    },
    staffRedetermineReason: {
      id: 'assessment/staff/redetermine-reason',
      defaultMessage: 'Reason',
    },
    staffRedetermineEndsRound: {
      id: 'assessment/staff/redetermine-ends-round',
      defaultMessage: 'An appeal or re-examination of this claim is under way. Confirming ends it',
    },
    staffRedetermined: { id: 'assessment/staff/redetermined', defaultMessage: 'Result updated' },
    refuseRedeterminationUnchanged: {
      id: 'assessment/entry/refuse-redetermination-unchanged',
      defaultMessage: 'The result has not changed.',
    },
    refuseNothingToRedetermine: {
      id: 'assessment/entry/refuse-nothing-to-redetermine',
      defaultMessage: 'This claim has no result to correct yet.',
    },
    refuseOwnClaim: {
      id: 'assessment/entry/refuse-own-claim',
      defaultMessage: 'You cannot do this to your own claim.',
    },
    refuseAppealExhausted: {
      id: 'assessment/entry/refuse-appeal-exhausted',
      defaultMessage: 'This result has already been appealed once.',
    },
    refuseNoAppealRoute: {
      id: 'assessment/entry/refuse-no-appeal-route',
      defaultMessage:
        'This item has no escalation workflow, so it cannot be appealed. Contact the batch administrator.',
    },
    refuseAppealUnderWay: {
      id: 'assessment/entry/refuse-appeal-under-way',
      defaultMessage: 'Your appeal is being decided. You can edit or resubmit once it is.',
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
    refuseSelfRecord: {
      id: 'assessment/entry/refuse-self-record',
      defaultMessage: 'A record about yourself has to be handled by somebody else',
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
    refuseNotFileable: {
      id: 'assessment/entry/refuse-not-fileable',
      defaultMessage: 'The item is scored automatically and takes no entries.',
    },
    refuseOwnerCannotRefile: {
      id: 'assessment/entry/refuse-owner-cannot-refile',
      defaultMessage:
        'The participant cannot edit and resubmit right now, so the entry cannot be returned. Reopen it for review or redetermine it instead.',
    },
    refuseNotReturnable: {
      id: 'assessment/entry/refuse-not-returnable',
      defaultMessage:
        'Only a participant\u2019s entry that is under review or approved can be returned for revision.',
    },
    refuseReasonRequired: {
      id: 'assessment/entry/refuse-reason-required',
      defaultMessage: 'Enter a reason.',
    },
    refuseNotAdministrative: {
      id: 'assessment/entry/refuse-not-administrative',
      defaultMessage: 'The item is not open to staff records.',
    },
    refuseAttachmentRequired: {
      id: 'assessment/entry/refuse-attachment-required',
      defaultMessage: 'The item needs attachments, so record it one person at a time.',
    },
    refuseChainUnreadable: {
      id: 'assessment/entry/refuse-chain-unreadable',
      defaultMessage:
        'The review step the submission is at cannot be found. Contact a batch administrator.',
    },
    refuseChainEndsHere: {
      id: 'assessment/entry/refuse-chain-ends-here',
      defaultMessage:
        'No later review step can take the submission. Contact a batch administrator.',
    },
    refuseDecisionNotAvailable: {
      id: 'assessment/entry/refuse-decision-not-available',
      defaultMessage: 'The current review step does not allow the decision.',
    },
    refuseFileTooLarge: {
      id: 'assessment/entry/refuse-file-too-large',
      defaultMessage: 'The file is larger than allowed.',
    },
    refuseStorageFull: {
      id: 'assessment/entry/refuse-storage-full',
      defaultMessage: 'There is no storage space left for the upload. Contact an administrator.',
    },
    refuseUploadBusy: {
      id: 'assessment/entry/refuse-upload-busy',
      defaultMessage: 'Too many uploads at once. Wait a moment and try again.',
    },
    refuseUploadAgain: {
      id: 'assessment/entry/refuse-upload-again',
      defaultMessage: 'The file did not finish uploading. Upload it again.',
    },
    refuseOther: {
      id: 'assessment/entry/refuse-other',
      defaultMessage: 'The action is not available for the entry in its current state.',
    },
    entryNote: { id: 'assessment/entry/note', defaultMessage: 'Note' },
    entryRecordBasis: { id: 'assessment/entry/record-basis', defaultMessage: 'Basis' },
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
    entryWithdrawFinalHint: {
      id: 'assessment/entry/withdraw-final-hint',
      defaultMessage:
        'Submitting is closed in the current stage. Once withdrawn, the claim goes back to a draft and cannot be handed in again until submitting reopens.',
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
    rowPartialApproved: {
      id: 'assessment/entry/row-partial',
      defaultMessage: 'Partly refused',
    },
    rowUnread: {
      id: 'assessment/entry/row-unread',
      defaultMessage: 'New change you have not seen',
    },
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
      defaultMessage: 'You may not make administrative records in this batch.',
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
      defaultMessage: 'Every reviewer at this step agreed; approved',
    },
    eventPanelEscalated: {
      id: 'assessment/event/panel-escalated',
      defaultMessage: 'No agreement at this step; handed to the next one',
    },
    // a middle step of the escalation route agreeing: an opinion the next
    // step starts from, never the verdict
    eventRecognitionCorrected: {
      id: 'assessment/event/recognition-corrected',
      defaultMessage: '{who} re-determined the result and corrected it',
    },
    eventApprovalRevoked: {
      id: 'assessment/event/approval-revoked',
      defaultMessage: '{who} re-determined the result and revoked the approval',
    },
    eventRejectionOverturned: {
      id: 'assessment/event/rejection-overturned',
      defaultMessage: '{who} re-determined the claim as approved',
    },
    eventSupersededByRedetermination: {
      id: 'assessment/event/superseded-by-redetermination',
      defaultMessage: '{who} re-determined the result, which ended this round',
    },
    entryEffectUpheld: { id: 'assessment/entry/effect-upheld', defaultMessage: 'Upheld' },
    entryEffectCorrected: {
      id: 'assessment/entry/effect-corrected',
      defaultMessage: 'Result corrected',
    },
    entryEffectRevoked: {
      id: 'assessment/entry/effect-revoked',
      defaultMessage: 'Approval revoked',
    },
    entryEffectOverturned: {
      id: 'assessment/entry/effect-overturned',
      defaultMessage: 'Now approved',
    },
    eventReopened: {
      id: 'assessment/event/reopened',
      defaultMessage: '{who} asked for the result to be examined again',
    },
    eventOpinionApproved: {
      id: 'assessment/event/opinion-approved',
      defaultMessage: '{who} agreed and passed it to the next step',
    },
    eventPanelOpinionApproved: {
      id: 'assessment/event/panel-opinion-approved',
      defaultMessage: 'Every reviewer at this step agreed; passed to the next step',
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
    eventCancelledByStaff: {
      id: 'assessment/event/cancelled-by-staff',
      defaultMessage: '{who} withdrew the recorded entry',
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
    eventEntryItemVoided: {
      id: 'assessment/event/entry-item-voided',
      defaultMessage: 'The item was disabled, voiding the entry',
    },
    eventSubjectExcluded: {
      id: 'assessment/event/subject-excluded',
      defaultMessage: 'Removed from the roster, ending the current review',
    },
    eventOther: { id: 'assessment/event/other', defaultMessage: 'The record was updated' },
    eventSomebody: { id: 'assessment/event/somebody', defaultMessage: 'Someone' },
    eventReviewer: { id: 'assessment/event/reviewer', defaultMessage: 'A reviewer' },
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
    outcomeSubjectExcluded: {
      id: 'assessment/outcome/subject-excluded',
      defaultMessage: 'Participant removed',
    },
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
      defaultMessage: '{name} 　 review round {round}',
    },
    reviewPayloadTitle: {
      id: 'assessment/review/payload-title',
      defaultMessage: 'Submission content',
    },
    // what the determination being typed would come to, said as it is typed
    reviewPreviewTitle: { id: 'assessment/review/preview-title', defaultMessage: 'Score preview' },
    reviewPreviewChecking: {
      id: 'assessment/review/preview-checking',
      defaultMessage: 'Working it out',
    },
    reviewPreviewRefused: {
      id: 'assessment/review/preview-refused',
      defaultMessage: 'The rule does not accept this determination: {reason}',
    },
    reviewPreviewIncomplete: {
      id: 'assessment/review/preview-incomplete',
      defaultMessage: 'The score appears once every field is filled in',
    },
    reviewPreviewUnavailable: {
      id: 'assessment/review/preview-unavailable',
      defaultMessage: 'The score cannot be worked out right now; it is checked again on approval',
    },
    reviewPreviewNoFiles: {
      id: 'assessment/review/preview-no-files',
      defaultMessage: 'No files',
    },
    // ------------------------------------------------------------------
    // one participant's whole account, as whoever runs the round reads it
    participantResultsTab: {
      id: 'assessment/participant-results/tab',
      defaultMessage: 'Participants',
    },
    columnItem: { id: 'assessment/column/item', defaultMessage: 'Question' },
    columnEntrySource: { id: 'assessment/column/entry-source', defaultMessage: 'How it arrived' },
    columnEntryStanding: { id: 'assessment/column/entry-standing', defaultMessage: 'Standing' },
    columnEntryAmount: { id: 'assessment/column/entry-amount', defaultMessage: 'Counted' },
    participantResultsOpen: {
      id: 'assessment/participant-results/open',
      defaultMessage: 'Open the account',
    },
    rosterRowActions: rosterRowActionsMessage,
    participantResultsHint: {
      id: 'assessment/participant-results/hint',
      defaultMessage: 'Who takes part, and what the round has decided about each of them.',
    },
    participantResultsPick: {
      id: 'assessment/participant-results/pick',
      defaultMessage: 'Select a participant to see their account.',
    },
    participantResultsScoreTab: {
      id: 'assessment/participant-results/score-tab',
      defaultMessage: 'Score breakdown',
    },
    participantResultsEntriesTab: {
      id: 'assessment/participant-results/entries-tab',
      defaultMessage: 'Entries and determinations',
    },
    participantResultsBack: {
      id: 'assessment/participant-results/back',
      defaultMessage: 'Back to participants',
    },
    participantResultsEntriesEmpty: {
      id: 'assessment/participant-results/entries-empty',
      defaultMessage: 'This participant has not filed anything yet.',
    },
    participantResultsUngrouped: {
      id: 'assessment/participant-results/ungrouped',
      defaultMessage: 'Other',
    },
    participantResultsClaimCount: {
      id: 'assessment/participant-results/claim-count',
      defaultMessage: '{count, plural, other {# entries}}',
    },
    participantResultsMore: {
      id: 'assessment/participant-results/more',
      defaultMessage: 'Show more',
    },
    // where a claim came from, in the product's words rather than the wire's
    entrySourceSelf: { id: 'assessment/entry/source-self', defaultMessage: 'Filed by participant' },
    entrySourceProxy: {
      id: 'assessment/entry/source-proxy',
      defaultMessage: 'Filed on their behalf',
    },
    entrySourceRecord: {
      id: 'assessment/entry/source-record',
      defaultMessage: 'Recorded by staff',
    },
    entrySourceImport: { id: 'assessment/entry/source-import', defaultMessage: 'Imported in bulk' },
    entrySourceSystem: {
      id: 'assessment/entry/source-system',
      defaultMessage: 'Created by system',
    },
    entrySourceRedetermination: {
      id: 'assessment/entry/source-redetermination',
      defaultMessage: 'Re-determined',
    },
    // the determination in force, and where it came from
    recognitionTitle: {
      id: 'assessment/recognition/title',
      defaultMessage: 'Current determination',
    },
    recognitionNoValuesShort: {
      id: 'assessment/recognition/no-values-short',
      defaultMessage: 'Not applicable',
    },
    recognitionNoValues: {
      id: 'assessment/recognition/no-values',
      defaultMessage: 'This item carries no determined values.',
    },
    recognitionNone: {
      id: 'assessment/recognition/none',
      defaultMessage: 'Nothing has been determined on this entry yet.',
    },
    recognitionBy: {
      id: 'assessment/recognition/by',
      defaultMessage: 'Determined by {who}, {when}',
    },
    recognitionByPanel: {
      id: 'assessment/recognition/by-panel',
      defaultMessage: 'Determined by a review panel, {when}',
    },
    recognitionYes: { id: 'assessment/recognition/yes', defaultMessage: 'Yes' },
    recognitionNo: { id: 'assessment/recognition/no', defaultMessage: 'No' },
    recognitionOpaque: {
      id: 'assessment/recognition/opaque',
      defaultMessage:
        'This determination was made against a version of the question it no longer has.',
    },
    recognitionStale: {
      id: 'assessment/recognition/stale',
      defaultMessage: 'Determined on an earlier version of this entry.',
    },
    // what staff may do about a claim that is wrong
    staffReturnEntry: {
      id: 'assessment/staff/return-entry',
      defaultMessage: 'Return for revision',
    },
    staffReturnTitle: {
      id: 'assessment/staff/return-title',
      defaultMessage: 'Return this entry to the participant?',
    },
    staffReturnHint: {
      id: 'assessment/staff/return-hint',
      defaultMessage:
        'They will be able to change it and hand it in again. Nothing already recorded is deleted.',
    },
    staffVoidEntry: { id: 'assessment/staff/void-entry', defaultMessage: 'Withdraw determination' },
    staffVoidTitle: {
      id: 'assessment/staff/void-title',
      defaultMessage: 'Withdraw this administrative entry?',
    },
    staffVoidHint: {
      id: 'assessment/staff/void-hint',
      defaultMessage:
        'The entry stops counting towards the score. The determination and its history are kept.',
    },
    staffReasonLabel: { id: 'assessment/staff/reason-label', defaultMessage: 'Reason' },
    staffReasonRequired: {
      id: 'assessment/staff/reason-required',
      defaultMessage: 'Say why, so the participant and the next reader can see it.',
    },
    staffReturned: { id: 'assessment/staff/returned', defaultMessage: 'Returned for revision' },
    staffVoided: { id: 'assessment/staff/voided', defaultMessage: 'Determination withdrawn' },

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
      defaultMessage: 'Under review 　 not counted yet',
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
    resultUnavailableTitle: {
      id: 'assessment/result/unavailable-title',
      defaultMessage: 'Scoring is temporarily unavailable',
    },
    resultUnavailableHint: {
      id: 'assessment/result/unavailable-hint',
      defaultMessage: 'Your score could not be calculated just now. Try again in a moment.',
    },
    resultStaleTitle: {
      id: 'assessment/result/stale-title',
      defaultMessage: 'The score shown may be out of date',
    },
    resultRecalculate: { id: 'assessment/result/recalculate', defaultMessage: 'Recalculate' },
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
      defaultMessage: 'Returned 　 not counted',
    },
    resultLineNone: { id: 'assessment/result/line-none', defaultMessage: 'Not submitted' },
    resultLineVoided: {
      id: 'assessment/result/line-voided',
      defaultMessage: 'Item disabled 　 not counted',
    },
    resultLineAdjustment: {
      id: 'assessment/result/line-adjustment',
      defaultMessage: 'Group limit',
    },
    // ------------------------------------------------------------------
    // recording on someone's behalf
    recordTab: { id: 'assessment/record/tab', defaultMessage: 'Administrative records' },
    recordHint: {
      id: 'assessment/record/hint',
      defaultMessage:
        'Record the additions, deductions and other findings the institution has already settled.',
    },
    recordEmpty: {
      id: 'assessment/record/empty',
      defaultMessage: 'No item in this batch is settled by this office',
    },
    recordEmptyHint: {
      id: 'assessment/record/empty-hint',
      defaultMessage: 'Items appear here once they are set to be settled by the institution.',
    },
    recordItem: { id: 'assessment/record/item', defaultMessage: 'Which item' },
    recordNeedsTargets: {
      id: 'assessment/record/needs-targets',
      defaultMessage: 'Nobody has been chosen yet',
    },
    recordNeedsMaterial: {
      id: 'assessment/record/needs-material',
      defaultMessage: 'The supporting material is not filled in',
    },
    recordNeedsUpload: {
      id: 'assessment/record/needs-upload',
      defaultMessage: 'A file is still uploading',
    },
    recordNeedsResult: {
      id: 'assessment/record/needs-result',
      defaultMessage: 'The determination is not filled in',
    },
    recordNeedsCorrection: {
      id: 'assessment/record/needs-correction',
      defaultMessage: 'A determination value needs correcting',
    },
    recordNeedsFormula: {
      id: 'assessment/record/needs-formula',
      defaultMessage: 'The scoring rule does not accept this determination',
    },
    recordNeedsBasis: {
      id: 'assessment/record/needs-basis',
      defaultMessage: 'No reason has been written',
    },
    recordReadyToCheck: {
      id: 'assessment/record/ready-to-check',
      defaultMessage: 'Ready to check who this reaches',
    },
    recordCheckTitle: {
      id: 'assessment/record/check-title',
      defaultMessage: 'Check who this reaches',
    },
    recordDropBlockedMany: {
      id: 'assessment/record/drop-blocked-many',
      defaultMessage:
        '{count, plural, one {Leave # out and check again} other {Leave these # out and check again}}',
    },
    recordDropBlockedHint: {
      id: 'assessment/record/drop-blocked-hint',
      defaultMessage: 'Checking runs again, so you see the list once more before confirming.',
    },
    recordStandingSettled: {
      id: 'assessment/record/standing-settled',
      defaultMessage: 'Settled',
    },
    recordStandingAppealed: {
      id: 'assessment/record/standing-appealed',
      defaultMessage: 'Under appeal',
    },
    recordStandingOverturned: {
      id: 'assessment/record/standing-overturned',
      defaultMessage: 'Not upheld',
    },
    recordStandingWithdrawn: {
      id: 'assessment/record/standing-withdrawn',
      defaultMessage: 'Withdrawn',
    },
    recordStepBack: { id: 'assessment/record/step-back', defaultMessage: 'Back' },
    recordStepNext: { id: 'assessment/record/step-next', defaultMessage: 'Next' },
    recordStepItem: { id: 'assessment/record/step-item', defaultMessage: 'Item' },
    recordStepFill: { id: 'assessment/record/step-fill', defaultMessage: 'Details' },
    recordStepConfirm: { id: 'assessment/record/step-confirm', defaultMessage: 'Confirm' },
    importStepFile: { id: 'assessment/record/import/step-file', defaultMessage: 'File' },
    importStepConfirm: {
      id: 'assessment/record/import/step-confirm',
      defaultMessage: 'Confirm',
    },
    importNeedsFile: {
      id: 'assessment/record/import/needs-file',
      defaultMessage: 'No list has been uploaded',
    },
    importReadyToCheck: {
      id: 'assessment/record/import/ready-to-check',
      defaultMessage: 'The file will be checked before anything is written',
    },
    recordUnitRosterTitle: { id: 'assessment/record/unit-roster', defaultMessage: 'Who that is' },
    recordUnitRosterNote: {
      id: 'assessment/record/unit-roster-note',
      defaultMessage: 'In these units today',
    },
    recordUnitRosterEmpty: {
      id: 'assessment/record/unit-roster-empty',
      defaultMessage: 'Nobody in this round stands in these units',
    },
    recordUnitRosterPage: recordUnitRosterPageMessage,
    recordUnitsOnce: {
      id: 'assessment/record/units-once',
      defaultMessage:
        'This picks whoever is in the chosen part of the organization right now; later moves do not change it.',
    },
    recordNeedsBlocked: {
      id: 'assessment/record/needs-blocked',
      defaultMessage: 'people on the list who cannot be recorded',
    },
    recordTargetsNote: {
      id: 'assessment/record/targets-note',
      defaultMessage: 'The same finding is written for everyone chosen',
    },
    recordDialogHint: {
      id: 'assessment/record/dialog-hint',
      defaultMessage: 'One finding, settled on one or more participants. It takes effect at once.',
    },
    importDialogHint: {
      id: 'assessment/record/import/dialog-hint',
      defaultMessage: 'One file, one item. The findings take effect as soon as they are imported.',
    },
    recordActsTab: { id: 'assessment/record/acts-tab', defaultMessage: 'Bulk records' },
    recordActsEmpty: {
      id: 'assessment/record/acts-empty',
      defaultMessage: 'No bulk records yet',
    },
    recordActsEmptyHint: {
      id: 'assessment/record/acts-empty-hint',
      defaultMessage: 'They appear here once a finding is settled on several people at once.',
    },
    recordActBack: { id: 'assessment/record/act-back', defaultMessage: 'Back to the bulk records' },
    recordActTitle: { id: 'assessment/record/act-title', defaultMessage: 'Bulk record' },
    recordActDetailTitle: {
      id: 'assessment/record/act-detail-title',
      defaultMessage: 'Bulk record detail',
    },
    importDetailHeading: {
      id: 'assessment/record/import/detail-heading',
      defaultMessage: 'Import detail',
    },
    recordActItem: { id: 'assessment/record/act-item', defaultMessage: 'Item' },
    recordActRows: { id: 'assessment/record/act-rows', defaultMessage: 'Who it reached' },
    recordActByPeople: { id: 'assessment/record/act-by-people', defaultMessage: 'Chosen by name' },
    recordActByUnits: { id: 'assessment/record/act-by-units', defaultMessage: 'Chosen by unit' },
    recordActCount: {
      id: 'assessment/record/act-count',
      defaultMessage: '{count, plural, one {# record} other {# records}}',
    },
    recordActVoided: {
      id: 'assessment/record/act-voided',
      defaultMessage: '{count, plural, one {# withdrawn} other {# withdrawn}}',
    },
    recordActReverse: { id: 'assessment/record/act-reverse', defaultMessage: 'Withdraw this act' },
    recordActReverseTitle: {
      id: 'assessment/record/act-reverse-title',
      defaultMessage: 'Withdraw this bulk record?',
    },
    recordActReverseHint: {
      id: 'assessment/record/act-reverse-hint',
      defaultMessage:
        'Every record of this act that still counts stops counting. What was already withdrawn is left alone, and the history is kept.',
    },
    recordActReversed: {
      id: 'assessment/record/act-reversed',
      defaultMessage:
        '{count, plural, =0 {Nothing was left to withdraw.} one {Withdrew # record.} other {Withdrew # records.}}',
    },
    recordActEvents: { id: 'assessment/record/act-events', defaultMessage: 'Withdrawals' },
    recordActEventLine: {
      id: 'assessment/record/act-event-line',
      defaultMessage: '{when} {actor} withdrew {count}: {reason}',
    },
    recordActOpen: {
      id: 'assessment/record/act-open',
      defaultMessage: 'See the bulk record it came from',
    },
    recordTargets: { id: 'assessment/record/targets', defaultMessage: 'Who is being recorded' },
    recordPickPeople: {
      id: 'assessment/record/pick-people',
      defaultMessage: 'Choose participants',
    },
    recordPickUnits: { id: 'assessment/record/pick-units', defaultMessage: 'Choose by unit' },
    recordTargetsChosen: {
      id: 'assessment/record/targets-chosen',
      defaultMessage: '{count, plural, one {# participant chosen} other {# participants chosen}}',
    },
    recordTargetsUnits: {
      id: 'assessment/record/targets-units',
      defaultMessage: '{count, plural, one {# unit chosen} other {# units chosen}}',
    },
    recordTargetsNone: {
      id: 'assessment/record/targets-none',
      defaultMessage: 'Nobody chosen yet',
    },
    recordTargetsClear: { id: 'assessment/record/targets-clear', defaultMessage: 'Clear' },
    recordTargetsSummary: {
      id: 'assessment/record/targets-summary',
      defaultMessage:
        '{count, plural, one {# participant will be recorded} other {# participants will be recorded}}',
    },
    recordTargetsBlocked: {
      id: 'assessment/record/targets-blocked',
      defaultMessage: '{count, plural, one {# cannot be recorded} other {# cannot be recorded}}',
    },
    recordSubmitMany: {
      id: 'assessment/record/submit-many',
      defaultMessage:
        '{count, plural, one {Confirm for # participant} other {Confirm for # participants}}',
    },
    recordDoneMany: {
      id: 'assessment/record/done-many',
      defaultMessage:
        '{count, plural, one {Recorded for # participant.} other {Recorded for # participants.}}',
    },
    recordBlockerSelf: {
      id: 'assessment/record/blocker-self',
      defaultMessage: 'You cannot record on yourself',
    },
    recordBlockerQuota: {
      id: 'assessment/record/blocker-quota',
      defaultMessage: 'Already at the limit for this item',
    },
    recordBlockerOther: {
      id: 'assessment/record/blocker-other',
      defaultMessage: 'Cannot be recorded on right now',
    },
    recordItemCap: {
      id: 'assessment/record/item-cap',
      defaultMessage:
        '{count, plural, one {# record per person} other {Up to # records per person}}',
    },
    recordListTab: { id: 'assessment/record/list-tab', defaultMessage: 'Records' },
    recordNewAction: { id: 'assessment/record/new-action', defaultMessage: 'Record one' },
    recordBack: { id: 'assessment/record/back', defaultMessage: 'Back to the records' },
    recordListEmpty: {
      id: 'assessment/record/list-empty',
      defaultMessage: 'No administrative records yet',
    },
    recordListEmptyHint: {
      id: 'assessment/record/list-empty-hint',
      defaultMessage: 'They appear here once anything is recorded.',
    },
    recordSearchList: defineMessage<{ businessNo: string }>()({
      id: 'assessment/record/search-list',
      defaultMessage: 'Name or {businessNo}',
    }),
    recordColumnWho: { id: 'assessment/record/column-who', defaultMessage: 'Participant' },
    recordColumnItem: { id: 'assessment/record/column-item', defaultMessage: 'Item' },
    recordColumnSource: { id: 'assessment/record/column-source', defaultMessage: 'How' },
    recordColumnActor: { id: 'assessment/record/column-actor', defaultMessage: 'Recorded by' },
    recordColumnWhen: { id: 'assessment/record/column-when', defaultMessage: 'When' },
    recordWhenToday: { id: 'assessment/record/when-today', defaultMessage: 'Today {time}' },
    recordWhenYesterday: {
      id: 'assessment/record/when-yesterday',
      defaultMessage: 'Yesterday {time}',
    },
    recordActorUnknown: { id: 'assessment/record/actor-unknown', defaultMessage: 'Not recorded' },
    recordSourceManual: { id: 'assessment/record/source-manual', defaultMessage: 'Recorded' },
    recordSourceImport: { id: 'assessment/record/source-import', defaultMessage: 'Imported' },
    recordPickWho: { id: 'assessment/record/pick-who', defaultMessage: 'Choose a participant' },
    recordSearchWho: defineMessage<{ businessNo: string }>()({
      id: 'assessment/record/search-who',
      defaultMessage: 'Name or {businessNo}',
    }),
    recordNobodyFound: {
      id: 'assessment/record/nobody-found',
      defaultMessage: 'Nobody in this round matches.',
    },
    recordMoreWho: { id: 'assessment/record/more-who', defaultMessage: 'Load more' },
    recordBasis: { id: 'assessment/record/basis', defaultMessage: 'Reason' },
    recordBasisHint: {
      id: 'assessment/record/basis-hint',
      defaultMessage:
        'Required. Say what this rests on, such as a document title or reference number; the participant is shown it.',
    },
    recordEffectNotice: {
      id: 'assessment/record/effect-notice',
      defaultMessage:
        'A record takes effect the moment you file it, with no review, and the participant can see it from then on.',
    },
    recordSectionEvidence: {
      id: 'assessment/record/section-evidence',
      defaultMessage: 'Supporting material',
    },
    recordSectionEvidenceNote: {
      id: 'assessment/record/section-evidence-note',
      defaultMessage: 'As this item currently asks for it',
    },
    recordSectionResultNote: {
      id: 'assessment/record/section-result-note',
      defaultMessage: 'Filled in from the material above, and yours to change',
    },
    // ------------------------------------------------------------------
    // importing a workbook of them, and looking back on what was imported
    importAction: { id: 'assessment/record/import/action', defaultMessage: 'Import' },
    importTab: { id: 'assessment/record/import/tab', defaultMessage: 'Imports' },
    importBack: { id: 'assessment/record/import/back', defaultMessage: 'Back to the imports' },
    importTemplate: {
      id: 'assessment/record/import/template',
      defaultMessage: 'Download the template: {item}',
    },
    importTemplateTitle: {
      id: 'assessment/record/import/template-title',
      defaultMessage: 'Fill in the template from this page',
    },
    importTemplateHint: {
      id: 'assessment/record/import/template-hint',
      defaultMessage:
        'Built for the item chosen above. Leave the header row as it is, and fill in one participant per row.',
    },
    importFile: { id: 'assessment/record/import/file', defaultMessage: 'List to import' },
    importFileHint: {
      id: 'assessment/record/import/file-hint',
      defaultMessage: 'Upload the file you filled in from the template above.',
    },
    importChooseFile: {
      id: 'assessment/record/import/choose-file',
      defaultMessage: 'Choose a file',
    },
    importUploading: { id: 'assessment/record/import/uploading', defaultMessage: 'Uploading…' },
    importChooseAnother: {
      id: 'assessment/record/import/choose-another',
      defaultMessage: 'Choose another file',
    },
    importDefaultBasis: {
      id: 'assessment/record/import/default-basis',
      defaultMessage: 'Default reason',
    },
    importDefaultBasisHint: {
      id: 'assessment/record/import/default-basis-hint',
      defaultMessage: 'Rows that leave that column empty use what you put here.',
    },
    importChecking: {
      id: 'assessment/record/import/checking',
      defaultMessage: 'Checking the file…',
    },
    importResult: { id: 'assessment/record/import/result', defaultMessage: 'Check result' },
    importSummaryRows: {
      id: 'assessment/record/import/summary-rows',
      defaultMessage: '{count, plural, one {# row} other {# rows}}',
    },
    importSummaryValid: {
      id: 'assessment/record/import/summary-valid',
      defaultMessage: '{count} ready',
    },
    importSummaryWarnings: {
      id: 'assessment/record/import/summary-warnings',
      defaultMessage: '{count} to check',
    },
    importSummaryErrors: {
      id: 'assessment/record/import/summary-errors',
      defaultMessage: '{count} with errors',
    },
    importFixAndRetry: {
      id: 'assessment/record/import/fix-and-retry',
      defaultMessage: 'Some rows on the list have errors. Correct them and upload the file again.',
    },
    importAllReady: {
      id: 'assessment/record/import/all-ready',
      defaultMessage: 'Every row can be imported.',
    },
    importConfirmWarnings: {
      id: 'assessment/record/import/confirm-warnings',
      defaultMessage: 'I have checked the rows marked to check',
    },
    importCommit: {
      id: 'assessment/record/import/commit',
      defaultMessage: '{count, plural, one {Import # record} other {Import # records}}',
    },
    importDone: {
      id: 'assessment/record/import/done',
      defaultMessage: '{count, plural, one {Imported # record.} other {Imported # records.}}',
    },
    importColumnRow: { id: 'assessment/record/import/column-row', defaultMessage: 'Row' },

    importColumnName: { id: 'assessment/record/import/column-name', defaultMessage: 'Name' },
    importColumnIssues: {
      id: 'assessment/record/import/column-issues',
      defaultMessage: 'What to check',
    },
    importShowAll: {
      id: 'assessment/record/import/show-all',
      defaultMessage: 'Show all {count} rows',
    },
    importShowProblems: {
      id: 'assessment/record/import/show-problems',
      defaultMessage: 'Show only rows to check',
    },
    importSeverityWarning: {
      id: 'assessment/record/import/severity-warning',
      defaultMessage: 'Check',
    },
    importSeverityError: { id: 'assessment/record/import/severity-error', defaultMessage: 'Error' },
    importIssueAt: { id: 'assessment/record/import/issue-at', defaultMessage: '{field}: {reason}' },
    importFileUnreadable: {
      id: 'assessment/record/import/file-unreadable',
      defaultMessage: 'This file cannot be imported',
    },
    importRefusedHint: {
      id: 'assessment/record/import/refused-hint',
      defaultMessage: 'Download the template again, fill it in, and upload that.',
    },
    importReasonBusinessNoRequired: defineMessage<{ businessNo: string }>()({
      id: 'assessment/record/import/reason/business-no-required',
      defaultMessage: 'No {businessNo}',
    }),
    importReasonParticipantNotFound: defineMessage<{ businessNo: string }>()({
      id: 'assessment/record/import/reason/participant-not-found',
      defaultMessage: 'That {businessNo} is not among the people you may record on',
    }),
    importReasonSelfRecord: {
      id: 'assessment/record/import/reason/self-record-refused',
      defaultMessage: 'You cannot record on yourself',
    },
    importReasonNameMismatch: {
      id: 'assessment/record/import/reason/name-mismatch',
      defaultMessage: 'The name differs from the roster',
    },
    importReasonBasisRequired: {
      id: 'assessment/record/import/reason/basis-required',
      defaultMessage: 'No reason given',
    },
    importReasonRecognitionRequired: {
      id: 'assessment/record/import/reason/recognition-required',
      defaultMessage: 'No determination',
    },
    importReasonMaxEntries: {
      id: 'assessment/record/import/reason/max-entries-reached',
      defaultMessage: 'This person has reached the limit for this item',
    },
    importReasonDuplicate: {
      id: 'assessment/record/import/reason/duplicate-in-file',
      defaultMessage: 'The same as another row in this file',
    },
    importReasonDecimal: {
      id: 'assessment/record/import/reason/decimal-syntax',
      defaultMessage: 'Not a number',
    },
    importReasonInteger: {
      id: 'assessment/record/import/reason/integer-syntax',
      defaultMessage: 'Not a whole number',
    },
    importReasonIntegerRange: {
      id: 'assessment/record/import/reason/integer-range',
      defaultMessage: 'The number is too large',
    },
    importReasonDate: {
      id: 'assessment/record/import/reason/date-syntax',
      defaultMessage: 'Write the date as 2026-03-01',
    },
    importReasonChoice: {
      id: 'assessment/record/import/reason/choice-unknown',
      defaultMessage: 'Not one of the choices',
    },
    importReasonBoolean: {
      id: 'assessment/record/import/reason/boolean-syntax',
      defaultMessage: 'Write 是 or 否',
    },
    importReasonRequired: {
      id: 'assessment/record/import/reason/required',
      defaultMessage: 'Required',
    },
    importReasonOutOfRange: {
      id: 'assessment/record/import/reason/out-of-range',
      defaultMessage: 'Outside the dates this round covers',
    },
    importReasonTooLong: {
      id: 'assessment/record/import/reason/too-long',
      defaultMessage: 'Too long',
    },
    importReasonDetermination: {
      id: 'assessment/record/import/reason/determination-refused',
      defaultMessage: 'The scoring rule does not accept this determination: {detail}',
    },
    importReasonOutOfScope: {
      id: 'assessment/record/import/reason/participant-out-of-scope',
      defaultMessage: 'The current stage does not include this person',
    },
    importReasonPhaseClosed: {
      id: 'assessment/record/import/reason/phase-closed',
      defaultMessage: 'The current stage does not allow recording',
    },
    importReasonNoPhase: {
      id: 'assessment/record/import/reason/no-active-phase',
      defaultMessage: 'No stage is under way',
    },
    importReasonItemOutOfScope: {
      id: 'assessment/record/import/reason/item-out-of-scope',
      defaultMessage: 'The current stage does not include this item',
    },
    importReasonNotHeld: {
      id: 'assessment/record/import/reason/permission-not-held',
      defaultMessage: 'You cannot record in this round',
    },
    importReasonNotAbandonable: {
      id: 'assessment/record/import/reason/entry-not-abandonable',
      defaultMessage: 'This record cannot be withdrawn now',
    },
    importReasonNotXlsx: {
      id: 'assessment/record/import/reason/not-xlsx',
      defaultMessage: 'Not an .xlsx file',
    },
    importReasonTooLarge: {
      id: 'assessment/record/import/reason/file-too-large',
      defaultMessage: 'The file is too large',
    },
    importReasonTooManyRows: {
      id: 'assessment/record/import/reason/too-many-rows',
      defaultMessage: 'More than 2,000 rows',
    },
    importReasonTooManyColumns: {
      id: 'assessment/record/import/reason/too-many-columns',
      defaultMessage: 'Too many columns',
    },
    importReasonTooManySheets: {
      id: 'assessment/record/import/reason/too-many-sheets',
      defaultMessage: 'Too many sheets',
    },
    importReasonTooManyCells: {
      id: 'assessment/record/import/reason/too-many-cells',
      defaultMessage: 'Too many cells. Delete the sheets and rows you are not importing',
    },
    importReasonSheetMissing: {
      id: 'assessment/record/import/reason/data-sheet-missing',
      defaultMessage: 'The 行政认定 sheet is missing',
    },
    importReasonExtraSheet: {
      id: 'assessment/record/import/reason/extra-sheet',
      defaultMessage: 'Remove every sheet other than 行政认定, then upload again',
    },
    importReasonExtraColumn: {
      id: 'assessment/record/import/reason/extra-column',
      defaultMessage: 'Remove what is written outside the template columns, then upload again',
    },
    importReasonColumnMissing: {
      id: 'assessment/record/import/reason/column-missing',
      defaultMessage: 'A column this question asks for is not in the file',
    },
    importReasonColumnUnknown: {
      id: 'assessment/record/import/reason/column-unknown',
      defaultMessage: 'The file has a column this question does not ask for',
    },
    importReasonColumnHeader: {
      id: 'assessment/record/import/reason/column-header-mismatch',
      defaultMessage: 'A column heading is not the one the template was written with',
    },
    importReasonMetadataMissing: {
      id: 'assessment/record/import/reason/metadata-missing',
      defaultMessage: 'Not the template downloaded from this page',
    },
    importReasonMetadataCorrupt: {
      id: 'assessment/record/import/reason/metadata-corrupt',
      defaultMessage: 'The template has been altered and can no longer be read',
    },
    importReasonOldTemplate: {
      id: 'assessment/record/import/reason/unsupported-template-version',
      defaultMessage: 'The template is out of date',
    },
    importBlockedErrors: {
      id: 'assessment/record/import/blocked-errors',
      defaultMessage: 'Correct the rows with errors and upload the file again',
    },
    importBlockedWarnings: {
      id: 'assessment/record/import/blocked-warnings',
      defaultMessage: 'Tick off the rows that need a look first',
    },
    importBlockedBusy: {
      id: 'assessment/record/import/blocked-busy',
      defaultMessage: 'The import is running',
    },
    importReasonOtherItem: {
      id: 'assessment/record/import/reason/template-for-another-item',
      defaultMessage: 'This template was downloaded for a different item',
    },
    importReasonFormula: {
      id: 'assessment/record/import/reason/formula-not-allowed',
      defaultMessage: 'A cell holds a formula. Paste the values instead.',
    },
    importReasonPercent: {
      id: 'assessment/record/import/reason/percent-not-allowed',
      defaultMessage: 'Type the number itself, without a percent sign',
    },
    importReasonCellTooLong: {
      id: 'assessment/record/import/reason/cell-too-long',
      defaultMessage: 'A cell is too long',
    },
    importReasonCellError: {
      id: 'assessment/record/import/reason/cell-error',
      defaultMessage: 'A cell holds an error value',
    },
    importReasonUnavailable: {
      id: 'assessment/record/import/reason/source-unavailable',
      defaultMessage: 'The file cannot be read right now. Try again.',
    },
    importReasonNoRows: {
      id: 'assessment/record/import/reason/no-rows',
      defaultMessage: 'Nobody is filled in on this list',
    },
    importReasonUnreadable: {
      id: 'assessment/record/import/reason/unreadable',
      defaultMessage: 'This cell cannot be read',
    },
    importReasonOther: {
      id: 'assessment/record/import/reason/other',
      defaultMessage: 'Something is wrong here ({reason})',
    },
    importHistoryEmpty: {
      id: 'assessment/record/import/history-empty',
      defaultMessage: 'No imports yet',
    },
    importHistoryEmptyHint: {
      id: 'assessment/record/import/history-empty-hint',
      defaultMessage: 'They appear here once a list has been imported.',
    },
    importColumnFile: { id: 'assessment/record/import/column-file', defaultMessage: 'File' },
    importColumnStanding: { id: 'assessment/record/import/column-standing', defaultMessage: 'Now' },
    importStandingCount: {
      id: 'assessment/record/import/standing-count',
      defaultMessage: '{count, plural, one {# record} other {# records}}',
    },
    importStandingVoided: {
      id: 'assessment/record/import/standing-voided',
      defaultMessage: '{count} withdrawn',
    },
    importDetailBy: {
      id: 'assessment/record/import/detail-by',
      defaultMessage: 'Imported by {actor}, {when}',
    },
    importDetailRevision: {
      id: 'assessment/record/import/detail-revision',
      defaultMessage: 'Item version',
    },
    importDetailRevisionNo: {
      id: 'assessment/record/import/detail-revision-no',
      defaultMessage: 'Version {no}',
    },
    importDetailBasisNone: {
      id: 'assessment/record/import/detail-basis-none',
      defaultMessage: 'None',
    },
    importDetailSource: {
      id: 'assessment/record/import/detail-source',
      defaultMessage: 'Original file',
    },
    importDetailTitle: {
      id: 'assessment/record/import/detail-title',
      defaultMessage: 'Excel import',
    },
    importDetailSourceWithheld: {
      id: 'assessment/record/import/detail-source-withheld',
      defaultMessage: 'Shown to administrators whose reach covers everyone in this import',
    },
    importDetailDownload: {
      id: 'assessment/record/import/detail-download',
      defaultMessage: 'Download',
    },
    importDetailCount: { id: 'assessment/record/import/detail-count', defaultMessage: 'Imported' },
    importDetailNow: { id: 'assessment/record/import/detail-now', defaultMessage: 'Now' },
    importNowApproved: {
      id: 'assessment/record/import/now-approved',
      defaultMessage: '{count} in effect',
    },
    importNowInReview: {
      id: 'assessment/record/import/now-in-review',
      defaultMessage: '{count} under appeal',
    },
    importNowRejected: {
      id: 'assessment/record/import/now-rejected',
      defaultMessage: '{count} not upheld',
    },
    importNowVoided: {
      id: 'assessment/record/import/now-voided',
      defaultMessage: '{count} withdrawn',
    },
    importReverse: {
      id: 'assessment/record/import/reverse',
      defaultMessage: 'Withdraw this import',
    },
    importReverseTitle: {
      id: 'assessment/record/import/reverse-title',
      defaultMessage: 'Withdraw this import?',
    },
    importReverseHint: {
      id: 'assessment/record/import/reverse-hint',
      defaultMessage:
        'Records from this import that are still in effect will stop counting. The records and their history stay.',
    },
    importReversed: {
      id: 'assessment/record/import/reversed',
      defaultMessage:
        '{count, plural, =0 {Nothing was left to withdraw.} one {Withdrew # record.} other {Withdrew # records.}}',
    },
    importReverseRefused: {
      id: 'assessment/record/import/reverse-refused',
      defaultMessage:
        '{count, plural, one {# record in this import cannot be withdrawn now.} other {# records in this import cannot be withdrawn now.}} Handle them one by one, then try again.',
    },
    importReversals: { id: 'assessment/record/import/reversals', defaultMessage: 'Withdrawals' },
    importReversalLine: {
      id: 'assessment/record/import/reversal-line',
      defaultMessage: '{actor} withdrew {count} on {when}: {reason}',
    },
    importReversalLineBare: {
      id: 'assessment/record/import/reversal-line-bare',
      defaultMessage: '{actor} withdrew {count} on {when}',
    },
    importRows: { id: 'assessment/record/import/rows', defaultMessage: 'Rows' },
    importColumnStatus: { id: 'assessment/record/import/column-status', defaultMessage: 'Status' },
    importColumnDetermination: {
      id: 'assessment/record/import/column-determination',
      defaultMessage: 'Determination',
    },
    importViewImport: {
      id: 'assessment/record/import/view-import',
      defaultMessage: 'View its import',
    },
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
        '{unit} 　 {roles} 　 {count, plural, one {# submission waiting} other {# submissions waiting}}',
    },
    itemsStuckNowhere: {
      id: 'assessment/items/stuck-nowhere',
      defaultMessage:
        '{roles} 　 {count, plural, one {# submission waiting} other {# submissions waiting}}, with nobody holding this duty anywhere above them',
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
    itemsFieldTitle: { id: 'assessment/items/field-title', defaultMessage: 'Title' },
    itemsFieldGroup: { id: 'assessment/items/field-group', defaultMessage: 'Group' },
    itemsFieldMax: {
      id: 'assessment/items/field-max',
      defaultMessage: 'Entries per participant',
    },
    itemsEntrySourceStudent: {
      id: 'assessment/items/entry-source-student',
      defaultMessage: 'Submitted by participants',
    },
    itemsEntrySourceBoth: {
      id: 'assessment/items/entry-source-both',
      defaultMessage: 'Participants and staff',
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
    itemsFieldType: { id: 'assessment/items/field-type', defaultMessage: 'Type' },
    itemsTypeText: { id: 'assessment/items/type-text', defaultMessage: 'Text' },
    itemsTypeDate: { id: 'assessment/items/type-date', defaultMessage: 'Date' },
    itemsTypeBoolean: { id: 'assessment/items/type-boolean', defaultMessage: 'Yes/no' },
    entryIssueNotAnInteger: {
      id: 'assessment/entry/issue-not-an-integer',
      defaultMessage: 'Enter a whole number',
    },
    entryIssueNotADecimal: {
      id: 'assessment/entry/issue-not-a-decimal',
      defaultMessage: 'Enter an amount like 3.5',
    },
    entryIssueTooPrecise: {
      id: 'assessment/entry/issue-too-precise',
      defaultMessage: 'Too many decimal places for this field',
    },
    entryIssueNotAChoice: {
      id: 'assessment/entry/issue-not-a-choice',
      defaultMessage: 'Pick one of the listed options',
    },
    entryIssueNotText: {
      id: 'assessment/entry/issue-not-text',
      defaultMessage: 'Enter text here',
    },
    entryIssueNotABoolean: {
      id: 'assessment/entry/issue-not-a-boolean',
      defaultMessage: 'Answer yes or no here',
    },
    recordRecognition: {
      id: 'assessment/record/recognition',
      defaultMessage: 'Determination',
    },
    entryNumberUnreadable: {
      id: 'assessment/entry/number-unreadable',
      defaultMessage: 'Finish the number before submitting',
    },
    entryChoiceUnset: {
      id: 'assessment/entry/choice-unset',
      defaultMessage: 'Pick an option',
    },
    itemsTypeInteger: {
      id: 'assessment/items/type-integer',
      defaultMessage: 'Number',
    },
    itemsTypeChoice: {
      id: 'assessment/items/type-choice',
      defaultMessage: 'Choice',
    },
    itemsFieldMinValue: {
      id: 'assessment/items/field-min-value',
      defaultMessage: 'Minimum',
    },
    itemsFieldMaxValue: {
      id: 'assessment/items/field-max-value',
      defaultMessage: 'Maximum',
    },
    itemsFieldMaxScale: {
      id: 'assessment/items/field-max-scale',
      defaultMessage: 'Decimal places',
    },
    itemsChoiceAdd: {
      id: 'assessment/items/choice-add',
      defaultMessage: 'Add an option',
    },
    itemsTypeAttachment: { id: 'assessment/items/type-attachment', defaultMessage: 'File' },
    itemsFieldRequired: { id: 'assessment/items/field-required', defaultMessage: 'Required' },
    itemsFieldMaxLength: {
      id: 'assessment/items/field-max-length',
      defaultMessage: 'Maximum characters',
    },
    itemsFieldMinDate: { id: 'assessment/items/field-min-date', defaultMessage: 'Earliest date' },
    itemsDateInRange: {
      id: 'assessment/items/date-in-range',
      defaultMessage: 'Check against the round\u2019s material window',
    },
    itemsDateInRangeHint: {
      id: 'assessment/items/date-in-range-hint',
      defaultMessage: 'Leave off for a date that is true outside the round, such as a birthday',
    },
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
    itemsScoringUnsupported: {
      id: 'assessment/items/scoring-unsupported',
      defaultMessage:
        'This scoring setup was written by a newer version and cannot be edited here. Everything else about the question can still be changed.',
    },
    itemsScoringUnreadable: {
      id: 'assessment/items/scoring-unreadable',
      defaultMessage: 'This arithmetic could not be read; check its configuration',
    },
    itemsContractRetrying: {
      id: 'assessment/items/contract-retrying',
      defaultMessage: 'The scoring parameters could not be read just now',
    },
    itemsContractPending: {
      id: 'assessment/items/contract-pending',
      defaultMessage: 'Reading what this arithmetic needs…',
    },
    itemsCalculatorFixed: {
      id: 'assessment/items/calculator-fixed',
      defaultMessage: 'A fixed amount',
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
        'At least one escalation step is required before reviewers can escalate submissions or participants can appeal.',
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
    itemsStageEveryoneLast: {
      id: 'assessment/items/stage-everyone-last',
      defaultMessage:
        'The last review step speaks with one voice: a split there has nowhere left to go. Add a step after this one to make this a panel.',
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
      defaultMessage: 'Automatically counted 　 no submission required',
    },
    itemsGrantedBody: {
      id: 'assessment/items/granted-body',
      defaultMessage: 'Every participant in the batch receives the value configured below.',
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
    reviewPrior: { id: 'assessment/review/prior', defaultMessage: 'Review process' },
    // the phone's filing page carries a two-line situation summary, and the
    // decision dialogs a last quiet word about faces not yet read
    reviewSummaryFirstRound: {
      id: 'assessment/review/summary-first-round',
      defaultMessage: 'First round of review',
    },
    reviewSummaryRound: {
      id: 'assessment/review/summary-round',
      defaultMessage: 'Round {round}',
    },
    reviewSummaryPrevRejected: {
      id: 'assessment/review/summary-prev-rejected',
      defaultMessage: 'Previous round returned{reason, select, none {} other {: {reason}}}',
    },
    reviewSummaryPrevRevision: {
      id: 'assessment/review/summary-prev-revision',
      defaultMessage:
        'Previous round asked for changes{reason, select, none {} other {: {reason}}}',
    },
    reviewSummarySupplemented: {
      id: 'assessment/review/summary-supplemented',
      defaultMessage: '{count, plural, one {# supplement filed} other {# supplements filed}}',
    },
    reviewGuardUnseenFlow: {
      id: 'assessment/review/guard-unseen-flow',
      defaultMessage: 'This entry has review history you have not looked at.',
    },
    reviewGuardUnseenAbout: {
      id: 'assessment/review/guard-unseen-about',
      defaultMessage: 'This item carries scoring and filing limits you have not looked at.',
    },
    reviewGuardOpen: { id: 'assessment/review/guard-open', defaultMessage: 'View' },
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
    reviewQueueKey: { id: 'assessment/review/queue-key', defaultMessage: 'Pending' },
    reviewStageVeiled: { id: 'assessment/review/stage-veiled', defaultMessage: 'A later step' },
    reviewResizeFlow: {
      id: 'assessment/review/resize-flow',
      defaultMessage: 'Resize the review trail column',
    },
    reviewResizeAbout: {
      id: 'assessment/review/resize-about',
      defaultMessage: 'Resize the reference column',
    },
    reviewQueueKeysMove: { id: 'assessment/review/queue-keys-move', defaultMessage: 'Move' },
    reviewQueueKeysOpen: { id: 'assessment/review/queue-keys-open', defaultMessage: 'Open' },
    reviewQueueCurrent: { id: 'assessment/review/queue-current', defaultMessage: 'Open now' },
    reviewQueueEmpty: {
      id: 'assessment/review/queue-empty',
      defaultMessage: 'Nothing else is waiting',
    },
    reviewKeyQueue: { id: 'assessment/review/key-queue', defaultMessage: 'Pending reviews' },
    timeYesterday: { id: 'assessment/time/yesterday', defaultMessage: 'Yesterday' },
    entrySubmittedToast: {
      id: 'assessment/entry/submitted-toast',
      defaultMessage: 'Submitted for review.',
    },
    entryDraftSavedToast: {
      id: 'assessment/entry/draft-saved-toast',
      defaultMessage: 'Draft saved.',
    },
    entrySubmitFailedDraftKept: {
      id: 'assessment/entry/submit-failed-draft-kept',
      defaultMessage: 'Your draft was saved; only handing it on did not go through.',
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
    reviewTipApproveRevisit: {
      id: 'assessment/review/tip-approve-revisit',
      defaultMessage: 'Pass it; this becomes the result of the review',
    },
    reviewTipRejectRevisit: {
      id: 'assessment/review/tip-reject-revisit',
      defaultMessage:
        'Do not pass it; this becomes the result of the review and may revoke an approval',
    },
    reviewRejectRevisitTitle: {
      id: 'assessment/review/reject-revisit-title',
      defaultMessage: 'Do not pass {name}\u2019s claim',
    },
    reviewTipApproveOpinion: {
      id: 'assessment/review/tip-approve-opinion',
      defaultMessage: 'Agree and suggest a determination; the next review step decides',
    },
    reviewApproveOpinionTitle: {
      id: 'assessment/review/approve-opinion-title',
      defaultMessage: 'Agree with {name}’s claim',
    },
    reviewRejectOpinionTitle: {
      id: 'assessment/review/reject-opinion-title',
      defaultMessage: 'Disagree with {name}’s claim',
    },
    reviewOpinionFoot: {
      id: 'assessment/review/opinion-foot',
      defaultMessage: 'The next review step reads your opinion and decides.',
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
    recognitionSection: {
      id: 'assessment/review/recognition-section',
      defaultMessage: 'Determination',
    },
    recognitionLockedNote: {
      id: 'assessment/review/recognition-locked-note',
      defaultMessage:
        'The sitting has settled on this determination; approving confirms it as written',
    },
    recognitionReasonLabel: {
      id: 'assessment/review/recognition-reason-label',
      defaultMessage: 'Why the determination changed',
    },
    recognitionFieldRequired: {
      id: 'assessment/review/recognition-field-required',
      defaultMessage: 'Fill this in before approving',
    },
    recognitionNotInteger: {
      id: 'assessment/review/recognition-not-integer',
      defaultMessage: 'Enter a whole number',
    },
    recognitionNotDecimal: {
      id: 'assessment/review/recognition-not-decimal',
      defaultMessage: 'Enter an amount like 3.5',
    },
    recognitionOutOfMaterialRange: {
      id: 'assessment/review/recognition-out-of-material-range',
      defaultMessage: 'Outside the period this round counts material from',
    },
    recognitionAfterLatest: recognitionAfterLatestMessage,
    recognitionBeforeEarliest: recognitionBeforeEarliestMessage,
    recognitionNotBoolean: {
      id: 'assessment/review/recognition-not-boolean',
      defaultMessage: 'Answer yes or no here',
    },
    recognitionOverMax: {
      id: 'assessment/review/recognition-over-max',
      defaultMessage: 'At most {constraint}',
    },
    recognitionUnderMin: {
      id: 'assessment/review/recognition-under-min',
      defaultMessage: 'At least {constraint}',
    },
    recognitionScale: {
      id: 'assessment/review/recognition-scale',
      defaultMessage: 'At most {constraint} decimal places',
    },
    recognitionTooLong: {
      id: 'assessment/review/recognition-too-long',
      defaultMessage: 'At most {constraint} characters',
    },
    recognitionTooShort: {
      id: 'assessment/review/recognition-too-short',
      defaultMessage: 'At least {constraint} characters',
    },
    recognitionEnum: {
      id: 'assessment/review/recognition-enum',
      defaultMessage: 'Pick one of the listed options',
    },
    recognitionKind: {
      id: 'assessment/review/recognition-kind',
      defaultMessage: 'This is not the kind of value the field takes',
    },
    recognitionPattern: {
      id: 'assessment/review/recognition-pattern',
      defaultMessage: 'This does not match the required format',
    },
    recognitionOther: {
      id: 'assessment/review/recognition-other',
      defaultMessage: 'The value does not satisfy the field ({reason})',
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
      defaultMessage: 'A word for the participant. Optional; they see it once this is approved.',
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
    reviewClosedTitle: {
      id: 'assessment/review/closed-title',
      defaultMessage: 'Reviewing is closed in this phase',
    },
    reviewClosedBody: {
      id: 'assessment/review/closed-body',
      defaultMessage: 'Entries waiting for your review will show here once reviewing opens',
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
      defaultMessage: 'Submitting in {seconds}s 　 undo before submission',
    },
    // the round moved on while this reader was mid-thought: say so where
    // they stand, keep what they typed, and shut only the acts
    reviewReadOnly: {
      id: 'assessment/review/read-only',
      defaultMessage:
        'You are viewing this review in read-only mode; no review actions are available to you.',
    },
    reviewGoneTitle: {
      id: 'assessment/review/gone-title',
      defaultMessage: 'This review task has moved on',
    },
    reviewGoneBody: {
      id: 'assessment/review/gone-body',
      defaultMessage: 'It was settled by another reviewer, withdrawn, or re-routed.',
    },
    reviewGoneWithdrawn: {
      id: 'assessment/review/gone-withdrawn',
      defaultMessage: 'The participant has withdrawn this entry; the review round is closed.',
    },
    reviewGoneRerouted: {
      id: 'assessment/review/gone-rerouted',
      defaultMessage: 'The review route was changed; a new round has taken this one over.',
    },
    reviewGoneExcluded: {
      id: 'assessment/review/gone-excluded',
      defaultMessage: 'The participant was removed from the roster; the review round is closed.',
    },
    reviewGoneDecided: {
      id: 'assessment/review/gone-decided',
      defaultMessage: 'Another reviewer has already handled this entry.',
    },
    reviewGoneKept: {
      id: 'assessment/review/gone-kept',
      defaultMessage: 'Nothing you typed has been submitted.',
    },
    reviewGoneNext: {
      id: 'assessment/review/gone-next',
      defaultMessage: 'Continue with the next task',
    },
    reviewGoneFinish: {
      id: 'assessment/review/gone-finish',
      defaultMessage: 'Finish reviewing',
    },
    reviewGoneUndone: {
      id: 'assessment/review/gone-undone',
      defaultMessage:
        'The task was just handled elsewhere; your pending decision was not submitted.',
    },
    reviewEscBannerTitle: {
      id: 'assessment/review/esc-banner-title',
      defaultMessage: 'The submission is in the escalation workflow',
    },
    reviewAppealBannerBody: {
      id: 'assessment/review/appeal-banner-body',
      defaultMessage: 'The participant contests the original result. Judge again whether it passes',
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
    reviewReopenBannerTitle: {
      id: 'assessment/review/reopen-banner-title',
      defaultMessage: 'Re-examination',
    },
    reviewReopenBannerBody: {
      id: 'assessment/review/reopen-banner-body',
      defaultMessage:
        'Staff asked for the original result to be examined again. Judge again whether it passes',
    },
    staffReopenReason: {
      id: 'assessment/staff/reopen-reason',
      defaultMessage: 'Reason for re-examination',
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
    reviewAwaitingTab: {
      id: 'assessment/review/awaiting-tab',
      defaultMessage: 'Awaiting',
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
      defaultMessage: 'Material submitted 　 awaiting review',
    },
    reviewAwaitingGo: { id: 'assessment/review/awaiting-go', defaultMessage: 'Review' },
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
    entrySuggestedTitle: {
      id: 'assessment/entry/suggested-title',
      defaultMessage: 'What the reviewer suggested instead',
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
    entryStatusAppealing: {
      id: 'assessment/entry/status-appealing',
      defaultMessage: 'Under appeal',
    },
    entryStatusReopened: {
      id: 'assessment/entry/status-reopened',
      defaultMessage: 'Reopened for review',
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
    // A fact the office settled was never claimed by anybody, so it is not a
    // version of a claim and nobody "filed" it. Told by what the revision
    // says it is, never by the item's type - a question may one day accept
    // both a claim and a record, and each fact still knows its own origin.
    entryTrailRecorded: {
      id: 'assessment/entry/trail-recorded',
      defaultMessage: 'Recorded by the institution',
    },
    entryTrailRecordedBy: {
      id: 'assessment/entry/trail-recorded-by',
      defaultMessage: '{who} recorded this',
    },
    entryTrailImported: {
      id: 'assessment/entry/trail-imported',
      defaultMessage: 'Imported from a list',
    },
    entryTrailImportedBy: {
      id: 'assessment/entry/trail-imported-by',
      defaultMessage: '{who} imported this from a list',
    },
    entrySheetRecorded: {
      id: 'assessment/entry-sheet/recorded',
      defaultMessage: 'What was entered',
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
    entryTrailAskSuperseded: {
      id: 'assessment/entry/trail-ask-superseded',
      defaultMessage: 'No longer applicable',
    },
    entryTrailAskWaiting: {
      id: 'assessment/entry/trail-ask-waiting',
      defaultMessage: 'Awaiting your additional material',
    },
    entryTrailReason: { id: 'assessment/entry/trail-reason', defaultMessage: 'Reason: {value}' },
    entryTrailReasonLabel: { id: 'assessment/entry/trail-reason-label', defaultMessage: 'Reason' },
    reviewEscalateReason: {
      id: 'assessment/review/escalate-reason',
      defaultMessage: 'Why it was sent up',
    },
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
    refuseSupplementUnreadable: {
      id: 'assessment/refuse/supplement-unreadable',
      defaultMessage:
        'This supplement request cannot be answered in this version. Contact an administrator.',
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
    itemsTabScoring: { id: 'assessment/items/tab-scoring', defaultMessage: 'Scoring' },
    itemsSummaryTitle: { id: 'assessment/items/summary-title', defaultMessage: 'Claim summary' },
    itemsSummaryHint: {
      id: 'assessment/items/summary-hint',
      defaultMessage:
        'Pick up to {most} fields that identify one claim; the first one is its title.',
    },
    itemsSummaryChosen: {
      id: 'assessment/items/summary-chosen',
      defaultMessage: 'Chosen fields, drag to reorder',
    },
    itemsSummaryEmptyTitle: {
      id: 'assessment/items/summary-empty-title',
      defaultMessage: 'No claim summary yet',
    },
    itemsSummaryCount: {
      id: 'assessment/items/summary-count',
      defaultMessage: '{count} / {most}',
    },
    itemsSummaryOthers: { id: 'assessment/items/summary-others', defaultMessage: 'Other fields' },
    itemsSummaryFallback: {
      id: 'assessment/items/summary-fallback',
      defaultMessage:
        "A claim summary tells claims apart in a list. Without one, the form's first fields are used.",
    },
    itemsSummaryCapFull: {
      id: 'assessment/items/summary-cap-full',
      defaultMessage: '{most} fields chosen. Remove one to choose another.',
    },
    itemsSummaryLead: { id: 'assessment/items/summary-lead', defaultMessage: 'Leads' },
    itemsSummaryRemove: { id: 'assessment/items/summary-remove', defaultMessage: 'Remove' },
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
    itemsImpactScoringTitle: {
      id: 'assessment/items/impact-scoring-title',
      defaultMessage: 'Scoring rule changed',
    },
    itemsImpactScoringApproved: {
      id: 'assessment/items/impact-scoring-approved',
      defaultMessage: 'Determinations in force',
    },
    itemsImpactScoringComparable: {
      id: 'assessment/items/impact-scoring-comparable',
      defaultMessage: 'Scored by both rules',
    },
    itemsImpactScoringAmountChanged: {
      id: 'assessment/items/impact-scoring-amount-changed',
      defaultMessage: 'Amounts that change',
    },
    itemsImpactScoringDerived: {
      id: 'assessment/items/impact-scoring-derived',
      defaultMessage: 'The fixed amount this question grants will change.',
    },
    itemsImpactScoringStuck: {
      id: 'assessment/items/impact-scoring-stuck',
      defaultMessage:
        'The rule in force cannot compute {count, plural, one {# determination} other {# determinations}} already made, so they were left out of the comparison above.',
    },
    itemsImpactScoringNote: {
      id: 'assessment/items/impact-scoring-note',
      defaultMessage:
        'Saving applies the new rule to every determination already in force; the amounts above are recalculated when results are read.',
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
    itemsPublishedVersion: {
      id: 'assessment/items/published-version',
      defaultMessage: 'Published 　 version {no}',
    },
    itemsDraftVersion: {
      id: 'assessment/items/draft-version',
      defaultMessage: 'Unpublished 　 version {no}',
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
    fileKindPdf: { id: 'assessment/files/kind-pdf', defaultMessage: 'PDF' },
    fileKindImage: { id: 'assessment/files/kind-image', defaultMessage: 'Images' },
    // the other whole families a field can be opened to, said as words
    fileKindVideo: { id: 'assessment/files/kind-video', defaultMessage: 'Video' },
    fileKindAudio: { id: 'assessment/files/kind-audio', defaultMessage: 'Audio' },
    fileKindText: { id: 'assessment/files/kind-text', defaultMessage: 'Text' },
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
    /** the tile that says a field takes whatever is brought to it */
    itemsAcceptAnyTile: {
      id: 'assessment/items/accept-any-tile',
      defaultMessage: 'No restriction',
    },
    itemsAcceptAnyTokens: {
      id: 'assessment/items/accept-any-tokens',
      defaultMessage: 'Any file the size limit allows',
    },
    itemsAcceptUnwritable: {
      id: 'assessment/items/accept-unwritable',
      defaultMessage: 'Invalid formats: {tokens}',
    },
    itemsCeilingSource: {
      id: 'assessment/items/ceiling-source',
      defaultMessage: 'Score source: {name}.',
    },
    itemsCeilingByRule: {
      id: 'assessment/items/ceiling-by-rule',
      defaultMessage: 'Set by the rule',
    },
    itemsCeilingHowRule: {
      id: 'assessment/items/ceiling-how-rule',
      defaultMessage: 'The amount is worked out by {name} for each determination.',
    },
    itemsCeilingHow: {
      id: 'assessment/items/ceiling-how',
      defaultMessage: '{value} each × {count, plural, one {# entry} other {# entries}}',
    },
    itemsCeilingHowMax: {
      id: 'assessment/items/ceiling-how-max',
      defaultMessage: '{value} each, counting the highest entry only',
    },
    itemsCeilingHowTopN: {
      id: 'assessment/items/ceiling-how-top-n',
      defaultMessage:
        '{value} each × {count, plural, one {the highest entry} other {the # highest entries}}',
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
      defaultMessage: '{value} each, any number of entries',
    },
    itemsCeilingLine: {
      id: 'assessment/items/ceiling-line',
      defaultMessage: '{how}; the item is capped at {value}.',
    },
    itemsCeilingLineOpen: {
      id: 'assessment/items/ceiling-line-open',
      defaultMessage: '{how}; the item has no cap of its own.',
    },
    itemsCeilingLineRule: {
      id: 'assessment/items/ceiling-line-rule',
      defaultMessage:
        'Each determination is worth what {name} works out; the cap follows the formula.',
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
    itemsEscalationAddStep: {
      id: 'assessment/items/escalation-add-step',
      defaultMessage: 'Add escalation step',
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
    rowGranted: { id: 'assessment/entry/auto-granted', defaultMessage: 'Granted automatically' },
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
    entrySaveAfterUpload: {
      id: 'assessment/entry/save-after-upload',
      defaultMessage: 'You can save once the files finish uploading',
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
    myEntriesRefresh: { id: 'assessment/entry/refresh', defaultMessage: 'Refresh' },
    // the overview's two blocks (§32.72): what needs the reader's hand, and
    // what has happened to their claims lately
    overviewActionsTitle: {
      id: 'assessment/overview/actions-title',
      defaultMessage: 'Needs your attention',
    },
    overviewActionsNone: {
      id: 'assessment/overview/actions-none',
      defaultMessage: 'Nothing needs your attention right now.',
    },
    overviewActionSupplement: {
      id: 'assessment/overview/action-supplement',
      defaultMessage: '{who} asked you for more material',
    },
    overviewActionRevision: {
      id: 'assessment/overview/action-revision',
      defaultMessage: 'Revise and resubmit was requested',
    },
    overviewGoSupplement: {
      id: 'assessment/overview/go-supplement',
      defaultMessage: 'Supply it',
    },
    overviewGoRevision: {
      id: 'assessment/overview/go-revision',
      defaultMessage: 'Revise it',
    },
    overviewActivityTitle: {
      id: 'assessment/overview/activity-title',
      defaultMessage: 'Recent activity',
    },
    overviewActivityUnread: {
      id: 'assessment/overview/activity-unread',
      defaultMessage: '{count, plural, one {# question has news} other {# questions have news}}',
    },
    overviewActivityNone: {
      id: 'assessment/overview/activity-none',
      defaultMessage: 'Nothing has happened around you here yet.',
    },
    overviewActivityMore: {
      id: 'assessment/overview/activity-more',
      defaultMessage: 'Show more',
    },
    overviewPendingReviews: {
      id: 'assessment/overview/pending-reviews',
      defaultMessage:
        '{count, plural, one {# claim is} other {# claims are}} waiting for your review',
    },
    overviewGoReview: { id: 'assessment/overview/go-review', defaultMessage: 'Start reviewing' },
    overviewAskAnswered: {
      id: 'assessment/overview/ask-answered',
      defaultMessage:
        '{count, plural, one {# of your supplement requests has} other {# of your supplement requests have}} been answered',
    },
    overviewGoAsked: { id: 'assessment/overview/go-asked', defaultMessage: 'View replies' },
    overviewQueueGroup: {
      id: 'assessment/overview/queue-group',
      defaultMessage: '{name} {count}',
    },
    overviewAskEntry: {
      id: 'assessment/overview/ask-entry',
      defaultMessage: '{who} ({item})',
    },
    overviewLaneEntry: { id: 'assessment/overview/lane-entry', defaultMessage: 'Filing' },
    overviewLaneReview: { id: 'assessment/overview/lane-review', defaultMessage: 'Reviewing' },
    overviewFilterAll: { id: 'assessment/overview/filter-all', defaultMessage: 'All' },
    overviewToday: { id: 'assessment/overview/today', defaultMessage: 'Today' },
    overviewYesterday: { id: 'assessment/overview/yesterday', defaultMessage: 'Yesterday' },
    'activity.r.review-approved': {
      id: 'assessment/activity/reviewer-approved',
      defaultMessage: "You approved {who}'s claim",
    },
    'activity.r.review-stage-approved': {
      id: 'assessment/activity/reviewer-stage-approved',
      defaultMessage: "You approved {who}'s claim at this stage",
    },
    'activity.r.review-rejected': {
      id: 'assessment/activity/reviewer-rejected',
      defaultMessage: "You sent {who}'s claim back",
    },
    'activity.r.review-escalated': {
      id: 'assessment/activity/reviewer-escalated',
      defaultMessage: "You escalated {who}'s claim for further review",
    },
    'activity.r.review-opinion-rejected': {
      id: 'assessment/activity/reviewer-opinion-rejected',
      defaultMessage: "You advised sending {who}'s claim back",
    },
    'activity.r.supplement-requested': {
      id: 'assessment/activity/reviewer-supplement-requested',
      defaultMessage: 'You asked {who} for supplementary material',
    },
    'activity.r.supplement-cancelled': {
      id: 'assessment/activity/reviewer-supplement-cancelled',
      defaultMessage: 'You took back the ask you sent {who}',
    },
    'activity.r.supplement-answered': {
      id: 'assessment/activity/reviewer-supplement-answered',
      defaultMessage: '{who} supplied the material you asked for',
    },
    'activity.r.review-vote-approved': {
      id: 'assessment/activity/reviewer-vote-approved',
      defaultMessage: "You voted to approve {who}'s claim",
    },
    'activity.r.review-vote-rejected': {
      id: 'assessment/activity/reviewer-vote-rejected',
      defaultMessage: "You voted to send {who}'s claim back",
    },
    // one sentence per activity kind, second person for the reader's own acts
    'activity.entry-created': {
      id: 'assessment/activity/entry-created',
      defaultMessage: 'You wrote the entry',
    },
    'activity.entry-revised': {
      id: 'assessment/activity/entry-revised',
      defaultMessage: 'You revised the entry',
    },
    'activity.entry-submitted': {
      id: 'assessment/activity/entry-submitted',
      defaultMessage: 'You submitted the entry for review',
    },
    'activity.entry-withdrawn': {
      id: 'assessment/activity/entry-withdrawn',
      defaultMessage: 'You withdrew the entry from review',
    },
    'activity.entry-abandoned': {
      id: 'assessment/activity/entry-abandoned',
      defaultMessage: 'You abandoned the entry',
    },
    'activity.entry-voided': {
      id: 'assessment/activity/entry-voided',
      defaultMessage: '{who} withdrew the recorded entry',
    },
    'activity.entry-voided-with-item': {
      id: 'assessment/activity/entry-voided-with-item',
      defaultMessage: 'The item was disabled, voiding your entry',
    },
    'activity.review-approved': {
      id: 'assessment/activity/review-approved',
      defaultMessage: '{who} approved the entry',
    },
    'activity.review-rejected': {
      id: 'assessment/activity/review-rejected',
      defaultMessage: '{who} returned the entry',
    },
    'activity.review-escalated': {
      id: 'assessment/activity/review-escalated',
      defaultMessage: 'The review moved to the escalation route',
    },
    'activity.appeal-filed': {
      id: 'assessment/activity/appeal-filed',
      defaultMessage: 'You filed an appeal',
    },
    'activity.supplement-requested': {
      id: 'assessment/activity/supplement-requested',
      defaultMessage: '{who} asked you for more material',
    },
    'activity.supplement-submitted': {
      id: 'assessment/activity/supplement-submitted',
      defaultMessage: 'You supplied the requested material',
    },
    'activity.supplement-cancelled': {
      id: 'assessment/activity/supplement-cancelled',
      defaultMessage: '{who} withdrew the request for material',
    },
    'activity.revision-required': {
      id: 'assessment/activity/revision-required',
      defaultMessage: '{who} asked you to revise the entry',
    },
    'activity.somebody': {
      id: 'assessment/activity/somebody',
      defaultMessage: 'A reviewer',
    },
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
    // what the field will take, said before anybody picks a file, and what
    // it would not take, said about the file by name
    // the question moved under a filing in progress: said where the work is,
    // never over it, and never by taking the work away
    entryRulesChangedTitle: {
      id: 'assessment/entry/rules-changed-title',
      defaultMessage: 'The requirements have been updated',
    },
    entryRulesChangedBody: {
      id: 'assessment/entry/rules-changed-body',
      defaultMessage:
        'An administrator has just updated what this item asks for. Take a look and carry on - what you have filled in is kept.',
    },
    entryRulesChangedAction: {
      id: 'assessment/entry/rules-changed-action',
      defaultMessage: 'Show the latest requirements',
    },
    entryRulesRefreshed: {
      id: 'assessment/entry/rules-refreshed',
      defaultMessage: 'Now showing the latest requirements. Check the fields before saving.',
    },
    entryFileKinds: {
      id: 'assessment/entry/file-kinds',
      defaultMessage: '{kinds} accepted',
    },
    entryFileMaxSize: {
      id: 'assessment/entry/file-max-size',
      defaultMessage: 'Up to {size} each',
    },
    entryFileRefusedSize: {
      id: 'assessment/entry/file-refused-size',
      defaultMessage: '{name} was not added: larger than {size}',
    },
    entryFileRefusedKind: {
      id: 'assessment/entry/file-refused-kind',
      defaultMessage: '{name} was not added: not an accepted file type',
    },
    entryFileRefusedRoom: {
      id: 'assessment/entry/file-refused-room',
      defaultMessage:
        '{name} was not added: {count, plural, one {# file allowed} other {# files allowed}}',
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
        'A batch that has ended is read-only: no more submissions, reviews or changes to its setup.',
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
    pickDateTime: {
      id: 'assessment/phase/pick-datetime',
      defaultMessage: 'Select a start time',
    },
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
    toastBatchArchived: { id: 'assessment/toast/batch-archived', defaultMessage: 'Batch ended' },
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
    addPeopleHint: defineMessage<{ businessNo: string }>()({
      id: 'assessment/roster/add-hint',
      defaultMessage: 'Search by name or {businessNo}, or browse the organization.',
    }),
    addPeopleConfirm,
    pickerUnavailable: {
      id: 'assessment/roster/picker-unavailable',
      defaultMessage: 'Your account does not have permission to browse people.',
    },
    rosterUnitsResize: {
      id: 'assessment/roster/units-resize',
      defaultMessage: 'Resize the unit column',
    },
    /** the one line a phone gives the unit filter, and what it opens */
    rosterUnitsAll: { id: 'assessment/roster/units-all', defaultMessage: 'Every unit' },
    rosterUnitsSome: {
      id: 'assessment/roster/units-some',
      defaultMessage: '{count, plural, other {# units}} chosen',
    },
    rosterUnitsChange: { id: 'assessment/roster/units-change', defaultMessage: 'Change' },
    rosterUnits: { id: 'assessment/roster/units', defaultMessage: 'Organization unit' },
    rosterEmpty: {
      id: 'assessment/roster/empty',
      defaultMessage: 'No participants yet.',
    },
    /** a roster row whose person the organization now has elsewhere */
    placementChangedMark: {
      id: 'assessment/roster/placement-changed',
      defaultMessage: 'Organization changed',
    },
    placementUnavailableMark: {
      id: 'assessment/roster/placement-unavailable',
      defaultMessage: 'Not in the organization',
    },
    placementPrompt: {
      id: 'assessment/placement/prompt',
      defaultMessage:
        'Organization details changed for {count, plural, one {# person} other {# people}}.',
    },
    placementUnavailablePrompt: {
      id: 'assessment/placement/unavailable-prompt',
      defaultMessage:
        '{count, plural, one {# person has} other {# people have}} no place in the organization any more.',
    },
    placementOpen: { id: 'assessment/placement/open', defaultMessage: 'Review changes' },
    placementTitle: { id: 'assessment/placement/title', defaultMessage: 'Organization changes' },
    placementHint: {
      id: 'assessment/placement/hint',
      defaultMessage:
        "The roster does not follow the organization on its own. Sync each change to this batch, or keep the batch's placement.",
    },
    placementQuiet: {
      id: 'assessment/placement/quiet',
      defaultMessage: 'Everyone is where the organization has them.',
    },
    placementRound: { id: 'assessment/placement/round', defaultMessage: 'This batch' },
    placementCurrent: { id: 'assessment/placement/current', defaultMessage: 'Organization' },
    placementBeyond: {
      id: 'assessment/placement/beyond',
      defaultMessage: 'A unit outside what you manage',
    },
    placementBeyondHint: {
      id: 'assessment/placement/beyond-hint',
      defaultMessage: 'Syncing needs someone who manages both units.',
    },
    placementGone: {
      id: 'assessment/placement/gone',
      defaultMessage: 'Deleted from the organization',
    },
    placementDisabled: { id: 'assessment/placement/disabled', defaultMessage: 'Account disabled' },
    placementUnplaced: { id: 'assessment/placement/unplaced', defaultMessage: 'Not in any unit' },
    placementUnavailableHint: {
      id: 'assessment/placement/unavailable-hint',
      defaultMessage: 'Remove them from the roster if they no longer take part.',
    },
    placementChangePlacement: {
      id: 'assessment/placement/change-placement',
      defaultMessage: 'Moved',
    },
    placementChangeAncestry: {
      id: 'assessment/placement/change-ancestry',
      defaultMessage: 'Unit moved',
    },
    placementChangeUserType: {
      id: 'assessment/placement/change-user-type',
      defaultMessage: 'Type changed',
    },
    placementSync: { id: 'assessment/placement/sync', defaultMessage: 'Sync' },
    placementKeep: { id: 'assessment/placement/keep', defaultMessage: "Keep the batch's" },
    placementSyncSelected: {
      id: 'assessment/placement/sync-selected',
      defaultMessage: 'Sync selected',
    },
    placementKeepSelected: {
      id: 'assessment/placement/keep-selected',
      defaultMessage: 'Keep selected',
    },
    placementSelectPage: { id: 'assessment/placement/select-page', defaultMessage: 'Select page' },
    placementSelected: {
      id: 'assessment/placement/selected',
      defaultMessage: '{count, plural, other {# selected}}',
    },
    placementSelectOne: { id: 'assessment/placement/select-one', defaultMessage: 'Select {name}' },
    placementReason: { id: 'assessment/placement/reason', defaultMessage: 'Note (optional)' },
    placementReasonPlaceholder: {
      id: 'assessment/placement/reason-placeholder',
      defaultMessage: 'For example: finishes this term in the old class',
    },
    placementSettled: {
      id: 'assessment/placement/settled',
      defaultMessage: '{count, plural, one {# change handled} other {# changes handled}}',
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
        'The participant will no longer take part in the batch, and reviews in progress will end. Existing submissions and review records are retained, and the participant can be added again later.',
    },
    restore: { id: 'assessment/roster/restore', defaultMessage: 'Restore' },
    participantCount,
    alsoActiveIn,
    noBusinessNoShort: defineMessage<{ businessNo: string }>()({
      id: 'assessment/roster/no-business-no',
      defaultMessage: 'No {businessNo}',
    }),
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
    accessAdjustArchivedHint: {
      id: 'assessment/access/adjust-archived-hint',
      defaultMessage: 'The batch has ended. Permissions can be turned off but not back on',
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
    accessSyncArchivedHint: {
      id: 'assessment/access/sync-archived-hint',
      defaultMessage: 'The batch has ended. Only expired records can be cleared',
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
    'permission-hint.assessment.entry.abandon': {
      id: 'assessment/permission-hint/entry-abandon',
      defaultMessage: 'Give up an entry for good, approved entries included; history is kept.',
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
    'permission-hint.assessment.review.view-reviewers': {
      id: 'assessment/permission-hint/review-view-reviewers',
      defaultMessage: 'Participants see who reviewed their own filings.',
    },
    'permission-hint.assessment.review.view-chain': {
      id: 'assessment/permission-hint/review-view-chain',
      defaultMessage: 'Reviewers see the steps after their own and who holds them.',
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
      defaultMessage:
        'Send a concluded claim through the escalation workflow again on the participant\u2019s behalf.',
    },
    'permission-hint.assessment.entry.redetermine': {
      id: 'assessment/permission-hint/entry-redetermine',
      defaultMessage:
        'Correct the result of a concluded claim directly; the participant can appeal the new result.',
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
    'permission.assessment.entry.abandon': {
      id: 'assessment/permission/entry-abandon',
      defaultMessage: 'Abandon entries',
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
    'permission.assessment.review.view-reviewers': {
      id: 'assessment/permission/review-view-reviewers',
      defaultMessage: 'See who reviewed',
    },
    'permission.assessment.review.view-chain': {
      id: 'assessment/permission/review-view-chain',
      defaultMessage: 'See later review steps',
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
      defaultMessage: 'Re-examine concluded claims',
    },
    'permission.assessment.entry.redetermine': {
      id: 'assessment/permission/entry-redetermine',
      defaultMessage: 'Re-determine concluded claims',
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
    'refusal.phase-duplicated': {
      id: 'assessment/refusal/phase-duplicated',
      defaultMessage: 'A stage appears more than once in this timeline.',
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
    'refusal.plan-too-long': {
      id: 'assessment/refusal/plan-too-long',
      defaultMessage: 'A timeline holds at most {most} stages. Remove some stages first.',
    },
    'refusal.plan-changed': {
      id: 'assessment/refusal/plan-changed',
      defaultMessage:
        'Someone else changed the stage plan while you were editing. Discard your changes and edit again.',
    },
    // ---- the question editor: shell, tabs and the list of what is left ----
    itemsMode: { id: 'assessment/items/mode', defaultMessage: 'Handling' },
    itemsModeReview: {
      id: 'assessment/items/mode-review',
      defaultMessage: 'Takes effect after review',
    },
    itemsModeReviewHint: {
      id: 'assessment/items/mode-review-hint',
      defaultMessage: 'Participants submit, then reviewers confirm.',
    },
    itemsModeDirect: {
      id: 'assessment/items/mode-direct',
      defaultMessage: 'Takes effect on submission',
    },
    itemsModeDirectHint: {
      id: 'assessment/items/mode-direct-hint',
      defaultMessage: 'Participants submit and it counts at once, without review.',
    },
    itemsModeAutomatic: {
      id: 'assessment/items/mode-automatic',
      defaultMessage: 'Scored automatically',
    },
    itemsModeAutomaticHint: {
      id: 'assessment/items/mode-automatic-hint',
      defaultMessage: 'Nothing to submit; the system scores every participant once.',
    },
    itemsModeLocked: {
      id: 'assessment/items/mode-locked',
      defaultMessage:
        'Once published, a question cannot move between automatic scoring and the other ways of handling',
    },
    itemsChannels: { id: 'assessment/items/channels', defaultMessage: 'Entry method' },
    itemsChannelsHint: {
      id: 'assessment/items/channels-hint',
      defaultMessage: 'More than one may be chosen',
    },
    itemsChannelParticipant: {
      id: 'assessment/items/channel-participant',
      defaultMessage: 'Participants submit',
    },
    itemsChannelParticipantHint: {
      id: 'assessment/items/channel-participant-hint',
      defaultMessage: 'Participants fill in the form and submit it themselves.',
    },
    itemsChannelAdministrative: {
      id: 'assessment/items/channel-administrative',
      defaultMessage: 'Staff record',
    },
    itemsChannelAdministrativeHint: {
      id: 'assessment/items/channel-administrative-hint',
      defaultMessage:
        'Authorised staff record the determination directly, by hand or by import, and it takes effect at once.',
    },
    itemsTabForm: { id: 'assessment/items/tab-form', defaultMessage: 'Form and scoring' },
    itemsTabRules: { id: 'assessment/items/tab-rules', defaultMessage: 'Records and review' },
    itemsPendingCount: {
      id: 'assessment/items/pending-count',
      defaultMessage: '{count, plural, one {# item} other {# items}} still to complete',
    },
    itemsPendingHint: {
      id: 'assessment/items/pending-hint',
      defaultMessage: 'Save before publishing',
    },
    itemsPendingNone: {
      id: 'assessment/items/pending-none',
      defaultMessage: 'Nothing to correct, ready to save',
    },
    itemsUnsaved: { id: 'assessment/items/unsaved', defaultMessage: 'Unsaved changes' },
    itemsLeaveUnsaved: {
      id: 'assessment/items/leave-unsaved',
      defaultMessage: 'Discard the changes you have not saved?',
    },
    itemsSavedAt: { id: 'assessment/items/saved-at', defaultMessage: 'Saved {when}' },
    itemsMoreActions: { id: 'assessment/items/more-actions', defaultMessage: 'More actions' },
    itemsDescriptionHint: {
      id: 'assessment/items/description-hint',
      defaultMessage:
        'Shown on the submission and determination pages: scope, required materials and the like',
    },
    itemsDone: { id: 'assessment/items/done', defaultMessage: 'Done' },
    itemsAdd: { id: 'assessment/items/add', defaultMessage: 'Add' },
    itemsPrevious: { id: 'assessment/items/previous', defaultMessage: 'Previous' },
    itemsNext: { id: 'assessment/items/next', defaultMessage: 'Next' },
    itemsName: { id: 'assessment/items/name', defaultMessage: 'Name' },
    itemsOptional: { id: 'assessment/items/optional', defaultMessage: 'Optional' },
    // ---- scoring tab ----
    itemsScoringMethod: { id: 'assessment/items/scoring-method', defaultMessage: 'Scoring method' },
    itemsScoringChange: { id: 'assessment/items/scoring-change', defaultMessage: 'Change formula' },
    itemsScoringPick: {
      id: 'assessment/items/scoring-pick',
      defaultMessage: 'Choose the scoring method',
    },
    itemsScoringUse: { id: 'assessment/items/scoring-use', defaultMessage: 'Use this method' },
    itemsScoringFixedNote: {
      id: 'assessment/items/scoring-fixed-note',
      defaultMessage: 'Every approved record counts the same amount',
    },
    itemsPreview: { id: 'assessment/items/preview', defaultMessage: 'Preview' },
    itemsTodayAt: { id: 'assessment/items/today-at', defaultMessage: 'Today {time}' },
    itemsVersionNo: { id: 'assessment/items/version-no', defaultMessage: 'Version {no}' },
    itemsRangeWithScale: {
      id: 'assessment/items/range-with-scale',
      defaultMessage:
        '{range}, up to {scale, plural, one {# decimal place} other {# decimal places}}',
    },
    itemsTypeSingleChoice: {
      id: 'assessment/items/type-single-choice',
      defaultMessage: 'Single choice',
    },
    itemsParameters: { id: 'assessment/items/parameters', defaultMessage: 'Formula parameters' },
    itemsParametersHint: {
      id: 'assessment/items/parameters-hint',
      defaultMessage: 'Parameters that take a determined value become determination fields below.',
    },
    itemsParametersNone: {
      id: 'assessment/items/parameters-none',
      defaultMessage: 'This method takes no parameters',
    },
    itemsColumnParameter: { id: 'assessment/items/column-parameter', defaultMessage: 'Parameter' },
    itemsColumnTypeRange: {
      id: 'assessment/items/column-type-range',
      defaultMessage: 'Type and range',
    },
    itemsColumnSource: { id: 'assessment/items/column-source', defaultMessage: 'Value from' },
    itemsColumnValue: { id: 'assessment/items/column-value', defaultMessage: 'Value' },
    itemsColumnField: { id: 'assessment/items/column-field', defaultMessage: 'Field' },
    itemsColumnRange: {
      id: 'assessment/items/column-range',
      defaultMessage: 'Determination range',
    },
    itemsColumnLinkedField: {
      id: 'assessment/items/column-linked-field',
      defaultMessage: 'Submission field',
    },
    itemsColumnRequirement: {
      id: 'assessment/items/column-requirement',
      defaultMessage: 'Requirement',
    },
    itemsSourceRecognition: {
      id: 'assessment/items/source-recognition',
      defaultMessage: 'Determined value',
    },
    itemsSourceConstant: { id: 'assessment/items/source-constant', defaultMessage: 'Fixed value' },
    itemsSourceFiled: { id: 'assessment/items/source-filed', defaultMessage: 'Submitted value' },
    itemsSourceUnset: { id: 'assessment/items/source-unset', defaultMessage: 'To be set' },
    itemsRecognitions: {
      id: 'assessment/items/recognitions',
      defaultMessage: 'Determination fields',
    },
    itemsRecognitionsHint: {
      id: 'assessment/items/recognitions-hint',
      defaultMessage:
        'Determined by reviewers. Once linked to a submission field, the submitted value is filled in by default and may be changed during review.',
    },
    itemsRecognitionsEmpty: {
      id: 'assessment/items/recognitions-empty',
      defaultMessage: 'No parameter takes a determined value yet',
    },
    itemsLinked: { id: 'assessment/items/linked', defaultMessage: 'Linked' },
    itemsLinkedTag: { id: 'assessment/items/linked-tag', defaultMessage: 'Linked determination' },
    itemsParameterTag: {
      id: 'assessment/items/parameter-tag',
      defaultMessage: 'Formula parameter',
    },
    itemsUnlinkedRow: {
      id: 'assessment/items/unlinked-row',
      defaultMessage: 'No submission field; determined by reviewers',
    },
    itemsForm: { id: 'assessment/items/form', defaultMessage: 'Submission form' },
    itemsFormHint: {
      id: 'assessment/items/form-hint',
      defaultMessage: 'Participants fill in the fields in this order; drag to reorder.',
    },
    itemsFormNone: {
      id: 'assessment/items/form-none',
      defaultMessage: 'No fields yet; participants confirm with one press',
    },
    itemsSummaryBlock: { id: 'assessment/items/summary-block', defaultMessage: 'List display' },
    itemsSummaryAuto: { id: 'assessment/items/summary-auto', defaultMessage: 'Automatic' },
    itemsSummaryCustom: { id: 'assessment/items/summary-custom', defaultMessage: 'Custom' },
    itemsSummaryEdit: { id: 'assessment/items/summary-edit', defaultMessage: 'Edit' },
    itemsFilesWithKinds: {
      id: 'assessment/items/files-with-kinds',
      defaultMessage: 'up to {count, plural, one {# file} other {# files}}, {kinds}',
    },
    itemsSummaryBlockHint: {
      id: 'assessment/items/summary-block-hint',
      defaultMessage: 'Used as the summary in record lists.',
    },
    itemsSummaryAutoHint: {
      id: 'assessment/items/summary-auto-hint',
      defaultMessage: 'The first fields are shown until you choose',
    },
    itemsAutomaticNote: {
      id: 'assessment/items/automatic-note',
      defaultMessage: 'Scored once for every participant.',
    },
    itemsAutomaticResult: {
      id: 'assessment/items/automatic-result',
      defaultMessage: 'Result {value} pts.',
    },
    itemsAutomaticCap: {
      id: 'assessment/items/automatic-cap',
      defaultMessage: 'Counted under the {cap} pts limit of {group}.',
    },
    // ---- the determination field panel ----
    itemsRecognitionTag: {
      id: 'assessment/items/recognition-tag',
      defaultMessage: 'Determination field',
    },
    itemsFieldTag: { id: 'assessment/items/field-tag', defaultMessage: 'Submission field' },
    itemsRecognitionDescription: {
      id: 'assessment/items/recognition-description',
      defaultMessage: 'Description',
    },
    itemsRecognitionDescriptionPlaceholder: {
      id: 'assessment/items/recognition-description-placeholder',
      defaultMessage: 'Shown on the determination page',
    },
    itemsRange: { id: 'assessment/items/range', defaultMessage: 'Determination range' },
    itemsOptions: { id: 'assessment/items/options', defaultMessage: 'Options' },
    itemsRestoreDefault: {
      id: 'assessment/items/restore-default',
      defaultMessage: 'Restore default',
    },
    itemsFieldMinLength: {
      id: 'assessment/items/field-min-length',
      defaultMessage: 'Minimum length',
    },
    itemsLinkSection: { id: 'assessment/items/link-section', defaultMessage: 'Submission field' },
    itemsLinkedHint: {
      id: 'assessment/items/linked-hint',
      defaultMessage:
        'The submitted value is filled in by default and may be changed during review.',
    },
    itemsLinkRequired: {
      id: 'assessment/items/link-required',
      defaultMessage: 'Required on submission',
    },
    itemsLinkRequiredHint: {
      id: 'assessment/items/link-required-hint',
      defaultMessage: 'When off, reviewers determine it if left blank',
    },
    itemsUnlink: { id: 'assessment/items/unlink', defaultMessage: 'Unlink' },
    itemsUnlinkedHint: {
      id: 'assessment/items/unlinked-hint',
      defaultMessage: 'No submission field; determined by reviewers.',
    },
    itemsLinkNew: {
      id: 'assessment/items/link-new',
      defaultMessage: 'Add a submission field and link it',
    },
    itemsLinkExisting: {
      id: 'assessment/items/link-existing',
      defaultMessage: 'Link an existing field',
    },
    itemsLinkExistingHint: {
      id: 'assessment/items/link-existing-hint',
      defaultMessage:
        'Choose a submission field for {name} ({type}). The type must match and the range must agree.',
    },
    itemsLinkExistingNone: {
      id: 'assessment/items/link-existing-none',
      defaultMessage: 'No submission field to link yet',
    },
    itemsLinkFits: { id: 'assessment/items/link-fits', defaultMessage: 'Range matches' },
    itemsLinkDiffers: { id: 'assessment/items/link-differs', defaultMessage: 'Range differs' },
    itemsLinkAdjustAction: {
      id: 'assessment/items/link-adjust-action',
      defaultMessage: 'Adjust and link',
    },
    itemsLinkAction: { id: 'assessment/items/link-action', defaultMessage: 'Link' },
    itemsLinkKindMismatch: {
      id: 'assessment/items/link-kind-mismatch',
      defaultMessage: 'Different type; cannot link',
    },
    itemsLinkTaken: {
      id: 'assessment/items/link-taken',
      defaultMessage: 'Linked to another determination field',
    },
    itemsGoToRecognition: {
      id: 'assessment/items/go-to-recognition',
      defaultMessage: 'Go to determination field',
    },
    itemsLinkedFromRecognition: {
      id: 'assessment/items/linked-from-recognition',
      defaultMessage: 'All settings of this field come from its determination field',
    },
    itemsGoToSettings: { id: 'assessment/items/go-to-settings', defaultMessage: 'Go to settings' },
    // ---- the submission field panel and the add-field dialog ----
    itemsFieldHint: { id: 'assessment/items/field-hint', defaultMessage: 'Hint' },
    itemsFieldAdvanced: { id: 'assessment/items/field-advanced', defaultMessage: 'More settings' },
    itemsFieldPattern: { id: 'assessment/items/field-pattern', defaultMessage: 'Pattern' },
    itemsFieldPatternHint: {
      id: 'assessment/items/field-pattern-hint',
      defaultMessage: 'A regular expression the whole answer must match; leave blank for none',
    },
    itemsFieldHintPlaceholder: {
      id: 'assessment/items/field-hint-placeholder',
      defaultMessage: 'Shown below the field',
    },
    itemsOptionPlaceholder: {
      id: 'assessment/items/option-placeholder',
      defaultMessage: 'Option name',
    },
    itemsOptionEmpty: {
      id: 'assessment/items/option-empty',
      defaultMessage: 'Option name is required',
    },
    itemsOptionRemove: { id: 'assessment/items/option-remove', defaultMessage: 'Remove option' },
    itemsOptionDisable: { id: 'assessment/items/option-disable', defaultMessage: 'Disable option' },
    itemsDisabledOptions: {
      id: 'assessment/items/disabled-options',
      defaultMessage: 'Disabled options',
    },
    itemsOptionRestore: { id: 'assessment/items/option-restore', defaultMessage: 'Restore' },
    itemsAddFieldSearch: {
      id: 'assessment/items/add-field-search',
      defaultMessage: 'Search field types',
    },
    itemsAddFieldNoMatch: {
      id: 'assessment/items/add-field-no-match',
      defaultMessage: 'No field type matches',
    },
    itemsTypeGroupBasic: { id: 'assessment/items/type-group-basic', defaultMessage: 'Basic' },
    itemsTypeGroupChoice: { id: 'assessment/items/type-group-choice', defaultMessage: 'Choice' },
    itemsTypeGroupOther: { id: 'assessment/items/type-group-other', defaultMessage: 'Other' },
    itemsTypeTextHint: {
      id: 'assessment/items/type-text-hint',
      defaultMessage: 'One or more lines of text',
    },
    itemsTypeNumber: { id: 'assessment/items/type-number', defaultMessage: 'Number' },
    itemsTypeNumberHint: {
      id: 'assessment/items/type-number-hint',
      defaultMessage: 'Whole number or decimal',
    },
    itemsTypeDateHint: { id: 'assessment/items/type-date-hint', defaultMessage: 'Pick a date' },
    itemsTypeChoiceHint: {
      id: 'assessment/items/type-choice-hint',
      defaultMessage: 'Pick one option',
    },
    itemsTypeBooleanHint: { id: 'assessment/items/type-boolean-hint', defaultMessage: 'Yes or no' },
    itemsTypeAttachmentHint: {
      id: 'assessment/items/type-attachment-hint',
      defaultMessage: 'Upload supporting files',
    },
    itemsNewField: { id: 'assessment/items/new-field', defaultMessage: 'New submission field' },
    itemsNumberKind: { id: 'assessment/items/number-kind', defaultMessage: 'Number kind' },
    itemsBackToTypes: {
      id: 'assessment/items/back-to-types',
      defaultMessage: 'Back to field types',
    },
    // ---- dialogs ----
    itemsUnlinkTitle: { id: 'assessment/items/unlink-title', defaultMessage: 'Unlink' },
    itemsUnlinkHint: {
      id: 'assessment/items/unlink-hint',
      defaultMessage:
        'After unlinking, {field} stays on the form and can be edited freely; it no longer fills in the determination field.',
    },
    itemsToDirectTitle: {
      id: 'assessment/items/to-direct-title',
      defaultMessage: 'Change to take effect on submission',
    },
    itemsToDirectHint: {
      id: 'assessment/items/to-direct-hint',
      defaultMessage:
        '{count, plural, one {# determination field has} other {# determination fields have}} no submission field: {names}. Continuing adds a required submission field for each and links it.',
    },
    itemsToDirectConfirm: {
      id: 'assessment/items/to-direct-confirm',
      defaultMessage: 'Add and switch',
    },
    itemsToAutomaticTitle: {
      id: 'assessment/items/to-automatic-title',
      defaultMessage: 'Change to automatic scoring',
    },
    itemsToAutomaticHint: {
      id: 'assessment/items/to-automatic-hint',
      defaultMessage:
        '{count, plural, one {# parameter takes} other {# parameters take}} a determined value: {names}. Automatic scoring uses fixed values only; change them under form and scoring first.',
    },
    itemsGoToScoring: {
      id: 'assessment/items/go-to-scoring',
      defaultMessage: 'Go to form and scoring',
    },
    itemsDeleteFieldTitle: {
      id: 'assessment/items/delete-field-title',
      defaultMessage: 'Delete field {name}',
    },
    itemsDeleteFieldHint: {
      id: 'assessment/items/delete-field-hint',
      defaultMessage:
        'Records already filed no longer show this answer once the change is saved. This cannot be undone.',
    },
    itemsDeleteBlockedTitle: {
      id: 'assessment/items/delete-blocked-title',
      defaultMessage: 'Cannot delete {name}',
    },
    itemsDeleteBlockedHint: {
      id: 'assessment/items/delete-blocked-hint',
      defaultMessage:
        'This field is linked to the determination field {recognition}. Unlink it first.',
    },
    itemsDisableOptionTitle: {
      id: 'assessment/items/disable-option-title',
      defaultMessage: 'Disable option {name}',
    },
    itemsDisableOptionHint: {
      id: 'assessment/items/disable-option-hint',
      defaultMessage:
        'New submissions can no longer choose it. Existing records are unaffected, and it can be restored at any time.',
    },
    itemsDisable: { id: 'assessment/items/disable', defaultMessage: 'Disable' },
    itemsAdjustTitle: { id: 'assessment/items/adjust-title', defaultMessage: 'Adjust and link' },
    itemsAdjustHint: {
      id: 'assessment/items/adjust-hint',
      defaultMessage: '{field} currently allows {current}; once linked it allows {next}.',
    },
    itemsMappingTitle: {
      id: 'assessment/items/mapping-title',
      defaultMessage: 'Confirm option mapping',
    },
    itemsMappingHint: {
      id: 'assessment/items/mapping-hint',
      defaultMessage:
        'Linking submission field {field} to determination field {recognition}. Choose the determination option each submission option stands for; both sides then share one set of options.',
    },
    itemsMappingNote: {
      id: 'assessment/items/mapping-note',
      defaultMessage:
        'Existing records convert by this mapping. One determination option cannot stand for two submission options.',
    },
    itemsMappingConfirm: {
      id: 'assessment/items/mapping-confirm',
      defaultMessage: 'Confirm and link',
    },
    itemsMappingPick: { id: 'assessment/items/mapping-pick', defaultMessage: 'Choose' },
    itemsMappingFrom: {
      id: 'assessment/items/mapping-from',
      defaultMessage: 'Submission field {name}',
    },
    itemsMappingTo: {
      id: 'assessment/items/mapping-to',
      defaultMessage: 'Determination field {name}',
    },
    // ---- rules tab ----
    itemsRulesCounts: {
      id: 'assessment/items/rules-counts',
      defaultMessage: 'Records and scoring',
    },
    itemsReviewChain: { id: 'assessment/items/review-chain', defaultMessage: 'Review process' },
    itemsReviewChainHint: {
      id: 'assessment/items/review-chain-hint',
      defaultMessage: 'Submissions pass these steps in order.',
    },
    itemsDirectNote: {
      id: 'assessment/items/direct-note',
      defaultMessage: 'Takes effect on submission; there are no review steps.',
    },
    // ---- what stands between the question and a save ----
    itemsProblemTitle: { id: 'assessment/items/problem-title', defaultMessage: 'Title is missing' },
    itemsProblemGroup: { id: 'assessment/items/problem-group', defaultMessage: 'No group chosen' },
    itemsProblemChannels: {
      id: 'assessment/items/problem-channels',
      defaultMessage: 'Choose at least one entry method',
    },
    itemsProblemFieldUnnamed: {
      id: 'assessment/items/problem-field-unnamed',
      defaultMessage: 'Field has no name',
    },
    itemsProblemFieldOptions: {
      id: 'assessment/items/problem-field-options',
      defaultMessage: 'Choice needs at least one option',
    },
    itemsProblemFieldInvalid: {
      id: 'assessment/items/problem-field-invalid',
      defaultMessage: 'Field settings are not valid',
    },
    itemsProblemFieldDateWindow: {
      id: 'assessment/items/problem-field-date-window',
      defaultMessage: 'Date window falls outside the batch range',
    },
    itemsProblemFixedValue: {
      id: 'assessment/items/problem-fixed-value',
      defaultMessage: 'Score per entry is missing',
    },
    itemsProblemCalculatorUnset: {
      id: 'assessment/items/problem-calculator-unset',
      defaultMessage: 'Scoring method is not configured',
    },
    itemsProblemContractPending: {
      id: 'assessment/items/problem-contract-pending',
      defaultMessage: 'Reading the formula parameters',
    },
    itemsProblemContractRefused: {
      id: 'assessment/items/problem-contract-refused',
      defaultMessage: 'The formula parameters could not be read',
    },
    itemsProblemParameterUnset: {
      id: 'assessment/items/problem-parameter-unset',
      defaultMessage: 'Parameter has no value yet',
    },
    itemsProblemConstantRequired: {
      id: 'assessment/items/problem-constant-required',
      defaultMessage: 'Fixed value is missing',
    },
    itemsProblemRecognitionAutomatic: {
      id: 'assessment/items/problem-recognition-automatic',
      defaultMessage: 'Automatic scoring uses fixed values only',
    },
    itemsProblemRecognitionUnnamed: {
      id: 'assessment/items/problem-recognition-unnamed',
      defaultMessage: 'Determination field has no name',
    },
    itemsProblemRefinementWidens: {
      id: 'assessment/items/problem-refinement-widens',
      defaultMessage: 'Determination range exceeds what the formula allows',
    },
    itemsProblemLinkMissing: {
      id: 'assessment/items/problem-link-missing',
      defaultMessage: 'Linked submission field no longer exists',
    },
    itemsProblemUnlinked: {
      id: 'assessment/items/problem-unlinked',
      defaultMessage: 'Needs a submission field',
    },
    itemsProblemBindingOrphan: {
      id: 'assessment/items/problem-binding-orphan',
      defaultMessage: 'The formula no longer has this parameter',
    },
    itemsProblemStagesRequired: {
      id: 'assessment/items/problem-stages-required',
      defaultMessage: 'Add at least one review step',
    },
    itemsProblemEscalationRequired: {
      id: 'assessment/items/problem-escalation-required',
      defaultMessage: 'Add an escalation step so participants can appeal staff records',
    },
    itemsProblemStageUnset: {
      id: 'assessment/items/problem-stage-unset',
      defaultMessage: 'Review step is not set up',
    },
    itemsProblemMaxEntries: {
      id: 'assessment/items/problem-max-entries',
      defaultMessage: 'Entries per person must be a whole number from 1 to {max}',
    },
    itemsProblemTopN: {
      id: 'assessment/items/problem-top-n',
      defaultMessage: 'Number of entries must be at least 1',
    },
    itemsProblemStrandsValue: {
      id: 'assessment/items/problem-strands-value',
      defaultMessage:
        '{count, plural, one {# record is} other {# records are}} already determined as {names}: keep it in the range',
    },
    itemsProblemStrands: {
      id: 'assessment/items/problem-strands',
      defaultMessage:
        '{count, plural, one {# record has} other {# records have}} a determined value outside this range',
    },
    itemsProblemStrandsMissing: {
      id: 'assessment/items/problem-strands-missing',
      defaultMessage:
        '{count, plural, one {# record is} other {# records are}} already determined without it: a determination cannot be added now',
    },
    itemsProblemStrandsRound: {
      id: 'assessment/items/problem-strands-round',
      defaultMessage:
        '{count, plural, one {# record is} other {# records are}} under review: the range cannot be narrowed until that ends',
    },
    itemsProblemStrandsRoundNew: {
      id: 'assessment/items/problem-strands-round-new',
      defaultMessage:
        '{count, plural, one {# record is} other {# records are}} under review: a determination cannot be added until that ends',
    },
    itemsProblemStrandsRemoved: {
      id: 'assessment/items/problem-strands-removed',
      defaultMessage:
        '{count, plural, one {# record relies} other {# records rely}} on a determination that was taken away: set its parameter back to a determined value',
    },
    itemsProblemRecognitionsRefused: {
      id: 'assessment/items/problem-recognitions-refused',
      defaultMessage: 'The determinations as set are not accepted',
    },
    itemsProblemParametersRefused: {
      id: 'assessment/items/problem-parameters-refused',
      defaultMessage: 'The parameters as set are not accepted',
    },
    itemsOptionHeldDetermined: {
      id: 'assessment/items/option-held-determined',
      defaultMessage: 'A record is already determined as this option, so it stays',
    },
    itemsOptionsHeldHint: {
      id: 'assessment/items/options-held-hint',
      defaultMessage: 'Options that records already use stay in the range',
    },
    itemsModeLockedToAutomatic: {
      id: 'assessment/items/mode-locked-to-automatic',
      defaultMessage: 'A published question cannot be changed to automatic scoring',
    },
    itemsModeLockedFromAutomatic: {
      id: 'assessment/items/mode-locked-from-automatic',
      defaultMessage: 'A published automatic question cannot be changed to another handling',
    },
    itemsMaxEntriesSome: {
      id: 'assessment/items/max-entries-some',
      defaultMessage: 'A set number',
    },
    itemsFoldingNUnit: {
      id: 'assessment/items/folding-n-unit',
      defaultMessage: 'entries',
    },
    itemsPreviewFill: {
      id: 'assessment/items/preview-fill',
      defaultMessage: 'Filled in by the participant',
    },
    itemsPreviewChoose: {
      id: 'assessment/items/preview-choose',
      defaultMessage: 'Chosen by the participant',
    },
    itemsPreviewDate: {
      id: 'assessment/items/preview-date',
      defaultMessage: 'A date chosen by the participant',
    },
    itemsProblemFieldOptionUnnamed: {
      id: 'assessment/items/problem-field-option-unnamed',
      defaultMessage: 'An option has no name',
    },
    itemsProblemFieldOptionDuplicate: {
      id: 'assessment/items/problem-field-option-duplicate',
      defaultMessage: 'Two options share a name',
    },
    itemsProblemFieldRangeInverted: {
      id: 'assessment/items/problem-field-range-inverted',
      defaultMessage: 'The lower bound is above the upper one',
    },
    itemsProblemFieldDuplicate: {
      id: 'assessment/items/problem-field-duplicate',
      defaultMessage: 'Another field has the same identity',
    },
    itemsProblemFieldRetyped: {
      id: 'assessment/items/problem-field-retyped',
      defaultMessage: 'A saved field cannot change type; remove it and add a new one',
    },
    itemsProblemFixedValueInvalid: {
      id: 'assessment/items/problem-fixed-value-invalid',
      defaultMessage: 'The amount per entry must be a number',
    },
    itemsProblemConstantRange: {
      id: 'assessment/items/problem-constant-range',
      defaultMessage: 'Out of range: between {min} and {max}',
    },
    itemsProblemConstantBelow: {
      id: 'assessment/items/problem-constant-below',
      defaultMessage: 'Must not be below {min}',
    },
    itemsProblemConstantAbove: {
      id: 'assessment/items/problem-constant-above',
      defaultMessage: 'Must not be above {max}',
    },
    itemsProblemConstantScale: {
      id: 'assessment/items/problem-constant-scale',
      defaultMessage: 'At most {scale} decimal places',
    },
    itemsProblemConstantNotInteger: {
      id: 'assessment/items/problem-constant-not-integer',
      defaultMessage: 'Enter a whole number',
    },
    itemsProblemConstantNotNumber: {
      id: 'assessment/items/problem-constant-not-number',
      defaultMessage: 'Enter a number',
    },
    itemsProblemConstantNotDate: {
      id: 'assessment/items/problem-constant-not-date',
      defaultMessage: 'Enter a valid date',
    },
    itemsProblemConstantTooShort: {
      id: 'assessment/items/problem-constant-too-short',
      defaultMessage: 'At least {min} characters',
    },
    itemsProblemConstantTooLong: {
      id: 'assessment/items/problem-constant-too-long',
      defaultMessage: 'At most {max} characters',
    },
    itemsProblemConstantNotOffered: {
      id: 'assessment/items/problem-constant-not-offered',
      defaultMessage: 'Choose one of the options the formula offers',
    },
    itemsProblemConstantPattern: {
      id: 'assessment/items/problem-constant-pattern',
      defaultMessage: 'Does not match the format the formula asks for',
    },
    itemsProblemConstantInvalid: {
      id: 'assessment/items/problem-constant-invalid',
      defaultMessage: 'The formula does not accept this value',
    },
    itemsProblemParameterRefused: {
      id: 'assessment/items/problem-parameter-refused',
      defaultMessage: 'The formula does not accept this source for the parameter',
    },
    itemsProblemRefinementEmpty: {
      id: 'assessment/items/problem-refinement-empty',
      defaultMessage: 'Keep at least one option in the range',
    },
    itemsProblemRecognitionReused: {
      id: 'assessment/items/problem-recognition-reused',
      defaultMessage: 'One determination cannot feed two parameters',
    },
    itemsProblemRecognitionUnattainable: {
      id: 'assessment/items/problem-recognition-unattainable',
      defaultMessage: 'Not linked to a field, and nobody on this question can determine it',
    },
    itemsProblemLinkNotGuaranteed: {
      id: 'assessment/items/problem-link-not-guaranteed',
      defaultMessage: 'The linked field has to be required',
    },
    itemsProblemLinkMismatch: {
      id: 'assessment/items/problem-link-mismatch',
      defaultMessage: 'The linked field does not fit the range determined',
    },
    itemsProblemRecognitionUnbound: {
      id: 'assessment/items/problem-recognition-unbound',
      defaultMessage: 'No parameter of the formula reads this determination',
    },
    itemsProblemRecognitionRefused: {
      id: 'assessment/items/problem-recognition-refused',
      defaultMessage: 'The determination as set is not accepted',
    },
    itemsProblemStageUnnamed: {
      id: 'assessment/items/problem-stage-unnamed',
      defaultMessage: 'The step has no name',
    },
    itemsProblemStageQuorum: {
      id: 'assessment/items/problem-stage-quorum',
      defaultMessage: 'This step cannot be reviewed by everyone together',
    },
    itemsProblemStageRefused: {
      id: 'assessment/items/problem-stage-refused',
      defaultMessage: 'The step as set is not accepted',
    },
    itemsProblemPolicyRefused: {
      id: 'assessment/items/problem-policy-refused',
      defaultMessage: 'The review route as set is not accepted',
    },
    itemsProblemChannelsFrozen: {
      id: 'assessment/items/problem-channels-frozen',
      defaultMessage: 'A way in that records came through cannot be closed',
    },
    itemsProblemGroupGone: {
      id: 'assessment/items/problem-group-gone',
      defaultMessage: 'The group is no longer in this round',
    },
    itemsProblemModeFrozen: {
      id: 'assessment/items/problem-mode-frozen',
      defaultMessage:
        'A published question, or one with records, cannot move to or from automatic scoring',
    },
    itemsProblemModeUnavailable: {
      id: 'assessment/items/problem-mode-unavailable',
      defaultMessage: 'This handling is not available right now',
    },
    itemsProblemSummaryInvalid: {
      id: 'assessment/items/problem-summary-invalid',
      defaultMessage: 'The fields shown in lists are not valid',
    },
    itemsProblemFoldingRefused: {
      id: 'assessment/items/problem-folding-refused',
      defaultMessage: 'This way of counting several records is not accepted',
    },
    itemsProblemCalculatorGone: {
      id: 'assessment/items/problem-calculator-gone',
      defaultMessage: 'The scoring method chosen is no longer available',
    },
    itemsProblemCalculatorOutput: {
      id: 'assessment/items/problem-calculator-output',
      defaultMessage: 'The formula chosen does not produce a score',
    },
    itemsProblemCalculatorRefused: {
      id: 'assessment/items/problem-calculator-refused',
      defaultMessage: 'The scoring method as set is not accepted',
    },
    itemsProblemFormRefused: {
      id: 'assessment/items/problem-form-refused',
      defaultMessage: 'The form as set is not accepted',
    },
    itemsCrumbRoot: {
      id: 'assessment/items/crumb-root',
      defaultMessage: 'Questions',
    },
    itemsFixCount: {
      id: 'assessment/items/fix-count',
      defaultMessage: '{count, plural, one {# thing to correct} other {# things to correct}}',
    },
    itemsSaveFailedCount: {
      id: 'assessment/items/save-failed-count',
      defaultMessage:
        'Not saved: {count, plural, one {# thing to correct} other {# things to correct}}',
    },
    itemsSaveFailedHint: {
      id: 'assessment/items/save-failed-hint',
      defaultMessage: 'Correct them and save again; everything else is kept',
    },
    itemsGo: {
      id: 'assessment/items/go',
      defaultMessage: 'Go',
    },
    itemsDismiss: {
      id: 'assessment/items/dismiss',
      defaultMessage: 'Dismiss',
    },
    itemsBlockPending: {
      id: 'assessment/items/block-pending',
      defaultMessage: '{count, plural, one {# to set} other {# to set}}',
    },
    itemsBlockFix: {
      id: 'assessment/items/block-fix',
      defaultMessage: '{count, plural, one {# to correct} other {# to correct}}',
    },
    itemsParametersWrong: {
      id: 'assessment/items/parameters-wrong',
      defaultMessage:
        '{count, plural, one {# parameter value is not acceptable} other {# parameter values are not acceptable}}',
    },
    itemsStagesWrong: {
      id: 'assessment/items/stages-wrong',
      defaultMessage:
        '{count, plural, one {# step is set wrongly} other {# steps are set wrongly}}',
    },
    itemsFailConflictTitle: {
      id: 'assessment/items/fail-conflict-title',
      defaultMessage: 'Not saved: somebody else has just changed this question',
    },
    itemsFailConflictHint: {
      id: 'assessment/items/fail-conflict-hint',
      defaultMessage:
        'Reloading drops what you changed here. Saving over it keeps yours and replaces theirs.',
    },
    itemsFailReload: {
      id: 'assessment/items/fail-reload',
      defaultMessage: 'Reload',
    },
    itemsFailOverwrite: {
      id: 'assessment/items/fail-overwrite',
      defaultMessage: 'Save over it',
    },
    itemsFailVoidedTitle: {
      id: 'assessment/items/fail-voided-title',
      defaultMessage: 'Not saved: the question has been withdrawn',
    },
    itemsFailVoidedHint: {
      id: 'assessment/items/fail-voided-hint',
      defaultMessage: 'Restore it from the menu before changing how it is set',
    },
    itemsFailReadOnlyTitle: {
      id: 'assessment/items/fail-read-only-title',
      defaultMessage: 'Not saved: the round is archived',
    },
    itemsFailReadOnlyHint: {
      id: 'assessment/items/fail-read-only-hint',
      defaultMessage: 'Questions of an archived round can no longer be changed',
    },
    itemsFailDeniedTitle: {
      id: 'assessment/items/fail-denied-title',
      defaultMessage: 'Not saved: you may not change this question',
    },
    itemsFailDeniedHint: {
      id: 'assessment/items/fail-denied-hint',
      defaultMessage: 'Ask whoever administers the round',
    },
    itemsFailGoneTitle: {
      id: 'assessment/items/fail-gone-title',
      defaultMessage: 'Not saved: the question no longer exists',
    },
    itemsFailGoneHint: {
      id: 'assessment/items/fail-gone-hint',
      defaultMessage: 'Somebody deleted it while it was open here',
    },
    itemsFailFullTitle: {
      id: 'assessment/items/fail-full-title',
      defaultMessage: 'Not added: the round holds as many questions as it can',
    },
    itemsFailFullHint: {
      id: 'assessment/items/fail-full-hint',
      defaultMessage: 'Delete a draft question the round no longer needs, then add this one',
    },
    itemsFailScoringTitle: {
      id: 'assessment/items/fail-scoring-title',
      defaultMessage: 'Not saved: scoring is unavailable right now',
    },
    itemsFailScoringHint: {
      id: 'assessment/items/fail-scoring-hint',
      defaultMessage: 'What you entered is kept. Try again in a moment.',
    },
    itemsFailIncompatibleTitle: {
      id: 'assessment/items/fail-incompatible-title',
      defaultMessage: 'Not saved: records already determined do not fit the new rule',
    },
    itemsFailOtherTitle: {
      id: 'assessment/items/fail-other-title',
      defaultMessage: 'Not saved',
    },
    itemsFailLooseTitle: {
      id: 'assessment/items/fail-loose-title',
      defaultMessage:
        'Not saved: {count, plural, one {# setting was} other {# settings were}} not accepted',
    },
    itemsFailLooseHint: {
      id: 'assessment/items/fail-loose-hint',
      defaultMessage:
        'The page has no place for these. Reload and try again, and tell whoever runs the system if it repeats.',
    },
    itemsFailRetry: {
      id: 'assessment/items/fail-retry',
      defaultMessage: 'Try again',
    },
    itemsOptionsEmptyTitle: {
      id: 'assessment/items/options-empty-title',
      defaultMessage: 'No options yet',
    },
    itemsOptionsEmptyHint: {
      id: 'assessment/items/options-empty-hint',
      defaultMessage: 'Add at least one so there is something to choose',
    },
    itemsNarrowedCount: {
      id: 'assessment/items/narrowed-count',
      defaultMessage: '{kept}/{total}',
    },
    itemsEntriesUnit: {
      id: 'assessment/items/entries-unit',
      defaultMessage: 'per person',
    },
    itemsCeilingHowLine: {
      id: 'assessment/items/ceiling-how-line',
      defaultMessage: '{how}.',
    },
    itemsCeilingOpen: {
      id: 'assessment/items/ceiling-open',
      defaultMessage: 'No ceiling',
    },
    itemsCeilingAmount: {
      id: 'assessment/items/ceiling-amount',
      defaultMessage: '{value}',
    },
    itemsStageNew: {
      id: 'assessment/items/stage-new',
      defaultMessage: 'New step',
    },
    itemsStageAddConfirm: {
      id: 'assessment/items/stage-add-confirm',
      defaultMessage: 'Add step',
    },
    itemsStageLabelRequired: {
      id: 'assessment/items/stage-label-required',
      defaultMessage: 'Name the step',
    },
    itemsStageLevelRequired: {
      id: 'assessment/items/stage-level-required',
      defaultMessage: 'Choose a level',
    },
    itemsStageRolesRequired: {
      id: 'assessment/items/stage-roles-required',
      defaultMessage: 'Choose at least one role',
    },
    itemsStageRoleRequired: {
      id: 'assessment/items/stage-role-required',
      defaultMessage: 'Choose a role',
    },
    itemsStageRuleAny: {
      id: 'assessment/items/stage-rule-any',
      defaultMessage: 'any one of them',
    },
    itemsStageRuleAll: {
      id: 'assessment/items/stage-rule-all',
      defaultMessage: 'all of them',
    },
    itemsFlowDoneLine: {
      id: 'assessment/items/flow-done-line',
      defaultMessage: 'Reviewed; counted once approved',
    },
    itemsFlowSubmitLine: {
      id: 'assessment/items/flow-submit-line',
      defaultMessage: 'A participant files',
    },
    itemsEscalationStartLine: {
      id: 'assessment/items/escalation-start-line',
      defaultMessage: 'A reviewer asks for a second look',
    },
    itemsEscalationDoneLine: {
      id: 'assessment/items/escalation-done-line',
      defaultMessage: 'Looked at again; the last step decides',
    },
    itemsReviewChainLong: {
      id: 'assessment/items/review-chain-long',
      defaultMessage:
        'Filed records are reviewed step by step in this order. Records entered by staff do not go through it.',
    },
    itemsEscalationLong: {
      id: 'assessment/items/escalation-long',
      defaultMessage:
        'Used when an approved record is disputed. With no step here a reviewer cannot ask for one, and participants cannot appeal.',
    },
    itemsSummarySectionHint: {
      id: 'assessment/items/summary-section-hint',
      defaultMessage:
        'The fields that name a record wherever records are listed; the first is its title',
    },
    itemsSummaryNoFields: {
      id: 'assessment/items/summary-no-fields',
      defaultMessage: 'Add a field to the form first',
    },
    itemsFieldLinkedRange: {
      id: 'assessment/items/field-linked-range',
      defaultMessage: 'The type and range come from the determination it is linked to',
    },
    // ---- the words for a type and its bounds ----
    itemsKindNumber: { id: 'assessment/items/kind-number', defaultMessage: 'Decimal' },
    itemsRangeBetween: { id: 'assessment/items/range-between', defaultMessage: '{min} to {max}' },
    itemsRangeMin: { id: 'assessment/items/range-min', defaultMessage: 'at least {min}' },
    itemsRangeMax: { id: 'assessment/items/range-max', defaultMessage: 'at most {max}' },
    itemsScaleNote: {
      id: 'assessment/items/scale-note',
      defaultMessage: 'up to {scale, plural, one {# decimal place} other {# decimal places}}',
    },
    itemsLengthMin: {
      id: 'assessment/items/length-min',
      defaultMessage: 'at least {min} characters',
    },
    itemsLengthBetween: {
      id: 'assessment/items/length-between',
      defaultMessage: '{min} to {max} characters',
    },
    itemsAnyValue: { id: 'assessment/items/any-value', defaultMessage: 'Any value' },
    itemsYes: { id: 'assessment/items/yes', defaultMessage: 'Yes' },
    itemsNo: { id: 'assessment/items/no', defaultMessage: 'No' },
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
      defaultMessage: 'The batch has ended and cannot be modified.',
    },
    ASSESSMENT_BATCH_STATUS_INVALID: {
      message: batchStatusInvalid,
      values: (data) => ({
        refusal: selectKey(data.refusal ?? 'other'),
        openRounds: data.openRounds ?? 0,
      }),
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
      message: accessInvalid,
      values: (data) => ({ reason: selectKey(data.reason) }),
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
    ASSESSMENT_ITEM_REVISION_CONFLICT: {
      id: 'assessment/error/item-revision-conflict',
      defaultMessage:
        'The requirements for this item changed while you were working. Review the latest requirements before continuing.',
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
    ASSESSMENT_DETERMINATION_REFUSED: {
      message: determinationRefused,
      values: (data) => ({ reason: data.reason }),
    },
    ASSESSMENT_SCORING_UNAVAILABLE: {
      id: 'assessment/error/scoring-unavailable',
      defaultMessage: 'Scoring is temporarily unavailable. Try again in a moment.',
    },
    ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE: {
      id: 'assessment/error/scoring-account-too-large',
      defaultMessage:
        'This result holds more approved entries than one calculation allows. Contact the batch administrator.',
    },
    ASSESSMENT_ADMINISTRATIVE_IMPORT_NOT_FOUND: {
      id: 'assessment/error/administrative-import-not-found',
      defaultMessage: 'That import no longer exists.',
    },
    // the issues themselves are drawn row by row on the preview; this is the
    // sentence for the moment the api refuses, which is a different place
    ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID: {
      id: 'assessment/error/administrative-import-invalid',
      defaultMessage: 'This file cannot be imported as it stands.',
    },
    ASSESSMENT_ADMINISTRATIVE_IMPORT_BUSY: {
      id: 'assessment/error/administrative-import-busy',
      defaultMessage: 'Other files are being read right now. Try again in a moment.',
    },
    ASSESSMENT_PARTICIPANT_PLACEMENT_CHANGED: {
      id: 'assessment/error/participant-placement-changed',
      defaultMessage: 'The organization changed while you were deciding. Check the changes again.',
    },
    ASSESSMENT_ADMINISTRATIVE_RECORD_TARGETS_CHANGED: {
      id: 'assessment/error/administrative-record-targets-changed',
      defaultMessage: 'The people this would apply to have changed. Check them and confirm again.',
    },
    ASSESSMENT_ADMINISTRATIVE_RECORD_FILES_NOT_SHAREABLE: {
      id: 'assessment/error/administrative-record-files-not-shareable',
      defaultMessage: 'A record with an attached file has to be made for one person at a time.',
    },
    ASSESSMENT_ADMINISTRATIVE_RECORD_NOT_FOUND: {
      id: 'assessment/error/administrative-record-not-found',
      defaultMessage: 'That record no longer exists.',
    },
    ASSESSMENT_ADMINISTRATIVE_RECORD_REFUSED: {
      id: 'assessment/error/administrative-record-refused',
      defaultMessage: 'Some of these people can no longer be recorded on, so nothing was recorded.',
    },
    ASSESSMENT_ITEM_SCORING_INCOMPATIBLE: {
      message: scoringIncompatible,
      values: (data) => {
        const refused = data.approved.refused + (data.derived?.refused === true ? 1 : 0)
        const executionFailed =
          data.approved.executionFailed + (data.derived?.executionFailed === true ? 1 : 0)
        return {
          // a question nobody files has no determinations in force: what
          // failed is its own rule, tried as it is published or restored
          case: data.derived !== null && data.approved.total === 0 ? 'derived' : 'standing',
          affected: refused + executionFailed,
          refused,
          executionFailed,
        }
      },
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
