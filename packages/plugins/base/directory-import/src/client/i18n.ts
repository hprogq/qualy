import {
  defineErrorTranslations,
  defineMessage,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as directoryErrors from '../server/errors.ts'

// Everything the directory import says to a human: the two screens' copy,
// the button on the users screen, the audit action names the server sends
// by reference, and a translation for every error its contract can raise.

const rowCount = defineMessage<{ count: number }>()({
  id: 'directory-import/inspect/row-count',
  defaultMessage: '{count, plural, one {# row} other {# rows}}',
})
const previewNodes = defineMessage<{ reused: number; created: number }>()({
  id: 'directory-import/preview/nodes',
  defaultMessage: '{reused} reused, {created} to create',
})
const previewUsers = defineMessage<{ create: number; existing: number }>()({
  id: 'directory-import/preview/users',
  defaultMessage: '{create} to create, {existing} already present',
})
const previewErrors = defineMessage<{ count: number }>()({
  id: 'directory-import/preview/errors',
  defaultMessage: '{count, plural, one {# row needs fixing} other {# rows need fixing}}',
})
const done = defineMessage<{ users: number; nodes: number }>()({
  id: 'directory-import/done/summary',
  defaultMessage:
    '{users, plural, one {# person} other {# people}} and {nodes, plural, =0 {no units} one {# unit} other {# units}} created',
})
const issueRow = defineMessage<{ row: number }>()({
  id: 'directory-import/issue/row',
  defaultMessage: 'Row {row}',
})
const issueDuplicate = defineMessage<{ businessNo: string; row: string }>()({
  id: 'directory-import/issue/duplicate-in-file',
  defaultMessage: 'The same {businessNo} appears at row {row}',
})
const issueBusinessNoRequired = defineMessage<{ businessNo: string }>()({
  id: 'directory-import/issue/business-no-required',
  defaultMessage: 'No {businessNo}',
})
const issueBusinessNoTooLong = defineMessage<{ businessNo: string }>()({
  id: 'directory-import/issue/business-no-too-long',
  defaultMessage: 'The {businessNo} is too long',
})
const issueUserConflict = defineMessage<{ businessNo: string; fields: string }>()({
  id: 'directory-import/issue/user-conflict',
  defaultMessage: 'This {businessNo} belongs to somebody already, with a different {fields}',
})
const issueNodeConflict = defineMessage<{ path: string }>()({
  id: 'directory-import/issue/node-type-conflict',
  defaultMessage: '{path} exists as a unit of another type',
})
const issueOther = defineMessage<{ reason: string }>()({
  id: 'directory-import/issue/other',
  defaultMessage: 'Could not be read ({reason})',
})
const recordCounts = defineMessage<{ users: number; existing: number; nodes: number }>()({
  id: 'directory-import/record/counts',
  defaultMessage:
    '{users, plural, one {# person created} other {# people created}}, {existing} already present, {nodes, plural, =0 {no units} one {# unit} other {# units}} created',
})
const recordStanding = defineMessage<{ living: number; deleted: number }>()({
  id: 'directory-import/record/standing',
  defaultMessage: '{living} still here, {deleted} deleted',
})
const reversalHint = defineMessage<{ count: number; bindings: number; grants: number }>()({
  id: 'directory-import/reverse/hint',
  defaultMessage:
    '{count, plural, one {# person} other {# people}} created by this import will be deleted; {bindings} have sign-in credentials and {grants} hold roles today. Records they took part in are kept.',
})
const reversed = defineMessage<{ retired: number }>()({
  id: 'directory-import/reverse/done',
  defaultMessage: '{retired, plural, one {# person} other {# people}} deleted',
})
const cleaned = defineMessage<{ deleted: number; retained: number }>()({
  id: 'directory-import/clean/done',
  defaultMessage: '{deleted} units removed, {retained} still in use',
})
const eventReversed = defineMessage<{ count: number }>()({
  id: 'directory-import/event/reversed',
  defaultMessage: 'Reversed: {count, plural, one {# person} other {# people}} deleted',
})
const eventCleaned = defineMessage<{ deleted: number; retained: number }>()({
  id: 'directory-import/event/nodes-cleaned',
  defaultMessage: 'Units cleaned: {deleted} removed, {retained} kept',
})
const chainLevelColumn = defineMessage<{ type: string; column: string }>()({
  id: 'directory-import/mapping/chain-column',
  defaultMessage: '{type} from column {column}',
})
const mappingProblem = defineMessage<{ reason: string }>()({
  id: 'directory-import/mapping/problem',
  defaultMessage: 'The mapping cannot be used ({reason})',
})

const prepPeopleMessage = defineMessage<{ businessNo: string }>()({
  id: 'directory-import/prep/people',
  defaultMessage: 'One person to a row, with a column for their name and one for their {businessNo}',
})
const prepExistingMessage = defineMessage<{ businessNo: string }>()({
  id: 'directory-import/prep/existing',
  defaultMessage: 'Somebody whose {businessNo} already exists is left as they are, and nothing is written before you confirm the check',
})
const commitCount = defineMessage<{ count: number }>()({
  id: 'directory-import/preview/commit-count',
  defaultMessage: 'Import {count, plural, one {# person} other {# people}}',
})
const doneExisting = defineMessage<{ count: number }>()({
  id: 'directory-import/done/existing',
  defaultMessage:
    '{count, plural, one {# person was already here} other {# people were already here}}, left as they are',
})
const scopeNote = defineMessage<{ path: string }>()({
  id: 'directory-import/upload/scope',
  defaultMessage: 'Everyone lands under {path}',
})
const anchorSaid = defineMessage<{ path: string }>()({
  id: 'directory-import/mapping/anchor-said',
  defaultMessage: 'Everyone stands under {path}; the levels below come from the file',
})
const levelFromColumn = defineMessage<{ column: string }>()({
  id: 'directory-import/mapping/level-from',
  defaultMessage: 'from the {column} column',
})
const tableShape = defineMessage<{ rows: number; columns: number }>()({
  id: 'directory-import/sheet/shape',
  defaultMessage: '{rows} rows, {columns} columns',
})
const sheetCount = defineMessage<{ count: number }>()({
  id: 'directory-import/sheet/count',
  defaultMessage: '{count, plural, one {# sheet} other {# sheets}}',
})
const countOfMessage = defineMessage<{ count: number }>()({
  id: 'directory-import/count-of',
  defaultMessage: '{count, plural, one {# in all} other {# in all}}',
})
const i18n = definePluginMessages({
  namespace: 'directory-import',
  messages: {
    auditCommit: { id: 'directory-import/audit/commit', defaultMessage: 'Import users' },
    auditReverse: { id: 'directory-import/audit/reverse', defaultMessage: 'Reverse a user import' },
    auditCleanNodes: {
      id: 'directory-import/audit/clean-nodes',
      defaultMessage: 'Remove unused units of an import',
    },
    action: { id: 'directory-import/users/action', defaultMessage: 'Import users' },
    title: { id: 'directory-import/import/title', defaultMessage: 'Import users' },
    hint: {
      id: 'directory-import/import/hint',
      defaultMessage:
        'Bring people in from a spreadsheet you already have. Units named in it are created along the way',
    },
    stepUpload: { id: 'directory-import/step/upload', defaultMessage: 'File' },
    stepSheet: { id: 'directory-import/step/sheet', defaultMessage: 'Sheet' },
    stepMapping: { id: 'directory-import/step/mapping', defaultMessage: 'Columns' },
    stepPreview: { id: 'directory-import/step/preview', defaultMessage: 'Check' },
    stepDone: { id: 'directory-import/step/done', defaultMessage: 'Done' },
    chooseFile: { id: 'directory-import/upload/choose', defaultMessage: 'Choose an .xlsx file' },
    uploading: { id: 'directory-import/upload/uploading', defaultMessage: 'Uploading' },
    uploadRule: {
      id: 'directory-import/upload/rule',
      defaultMessage: 'One .xlsx file of up to 2000 rows; a header row, then one person per row',
    },
    replaceFile: { id: 'directory-import/upload/replace', defaultMessage: 'Choose another file' },
    sheetLabel: { id: 'directory-import/sheet/label', defaultMessage: 'Sheet' },
    headerRowLabel: { id: 'directory-import/sheet/header-row', defaultMessage: 'Header row' },
    headerRowHint: {
      id: 'directory-import/sheet/header-row-hint',
      defaultMessage: 'The row holding the column titles; the rows under it are people',
    },
    rowCount,
    tableShape,
    sheetCount,
    scopeNote,
    next: { id: 'directory-import/step/next', defaultMessage: 'Next' },
    back: { id: 'directory-import/step/back', defaultMessage: 'Back' },
    finish: { id: 'directory-import/step/finish', defaultMessage: 'Done' },
    sampleTitle: { id: 'directory-import/sheet/sample', defaultMessage: 'First rows' },
    noHeaders: {
      id: 'directory-import/sheet/no-headers',
      defaultMessage: 'No column titles on this row',
    },
    columnUnset: { id: 'directory-import/mapping/column-unset', defaultMessage: 'Pick a column' },
    columnLetter: { id: 'directory-import/mapping/column-letter', defaultMessage: 'Column {column}' },
    displayNameLabel: { id: 'directory-import/mapping/display-name', defaultMessage: 'Name' },
    userTypeLabel: { id: 'directory-import/mapping/user-type', defaultMessage: 'User type' },
    userTypeUnset: { id: 'directory-import/mapping/user-type-unset', defaultMessage: 'Pick a type' },
    userTypeHint: {
      id: 'directory-import/mapping/user-type-hint',
      defaultMessage: 'Everyone in this file gets the same type',
    },
    organizationTitle: {
      id: 'directory-import/mapping/organization',
      defaultMessage: 'Where they stand',
    },
    anchorLabel: { id: 'directory-import/mapping/anchor', defaultMessage: 'Under the unit' },
    anchorHint: {
      id: 'directory-import/mapping/anchor-hint',
      defaultMessage: 'Every row stands under this unit; the levels below come from the file',
    },
    anchorRoot: { id: 'directory-import/mapping/anchor-root', defaultMessage: 'The whole organization' },
    levelsLabel: { id: 'directory-import/mapping/levels', defaultMessage: 'Levels from the file' },
    levelsHint: {
      id: 'directory-import/mapping/levels-hint',
      defaultMessage:
        'One column per level, in any order. Units that do not exist yet are created; every row must fill every level',
    },
    levelType: { id: 'directory-import/mapping/level-type', defaultMessage: 'Unit type' },
    levelTypeUnset: { id: 'directory-import/mapping/level-type-unset', defaultMessage: 'Pick a type' },
    addLevel: { id: 'directory-import/mapping/add-level', defaultMessage: 'Add a level' },
    removeLevel: { id: 'directory-import/mapping/remove-level', defaultMessage: 'Remove' },
    chainLevelColumn,
    mappingProblem,
    anchorChosen: {
      id: 'directory-import/mapping/anchor-chosen',
      defaultMessage: 'The unit you chose',
    },
    anchorChange: { id: 'directory-import/mapping/anchor-change', defaultMessage: 'Change' },
    anchorDone: { id: 'directory-import/mapping/anchor-done', defaultMessage: 'Use this unit' },
    anchorSaid,
    levelFromColumn,
    peopleTitle: { id: 'directory-import/mapping/people', defaultMessage: 'Who they are' },
    chainTitle: { id: 'directory-import/mapping/chain', defaultMessage: 'Where they will stand' },
    exampleTitle: {
      id: 'directory-import/mapping/example',
      defaultMessage: 'The first row, as it will land',
    },
    exampleUnready: {
      id: 'directory-import/mapping/example-unready',
      defaultMessage: 'Choose the columns to see where the first row lands',
    },
    check: { id: 'directory-import/mapping/check', defaultMessage: 'Check the file' },
    checking: { id: 'directory-import/mapping/checking', defaultMessage: 'Checking' },
    previewTitle: { id: 'directory-import/preview/title', defaultMessage: 'What this import will do' },
    previewChain: { id: 'directory-import/preview/chain', defaultMessage: 'Levels' },
    previewNodesLabel: { id: 'directory-import/preview/nodes-label', defaultMessage: 'Units' },
    previewNodes,
    previewUsersLabel: { id: 'directory-import/preview/users-label', defaultMessage: 'People' },
    previewUsers,
    previewErrors,
    previewClean: { id: 'directory-import/preview/clean', defaultMessage: 'Every row can be imported' },
    previewCreatedNodes: {
      id: 'directory-import/preview/created-nodes',
      defaultMessage: 'Units to be created',
    },
    previewIssues: { id: 'directory-import/preview/issues', defaultMessage: 'Rows to fix' },
    previewIssuesHint: {
      id: 'directory-import/preview/issues-hint',
      defaultMessage: 'Fix the file and upload it again; nothing is imported while a row is wrong',
    },
    issueRow,
    issueFile: { id: 'directory-import/issue/file', defaultMessage: 'The file' },
    issueDuplicate,
    issueBusinessNoRequired,
    issueBusinessNoTooLong,
    issueDisplayNameRequired: {
      id: 'directory-import/issue/display-name-required',
      defaultMessage: 'No name',
    },
    issueDisplayNameTooLong: {
      id: 'directory-import/issue/display-name-too-long',
      defaultMessage: 'The name is too long',
    },
    issueOrgLevelRequired: {
      id: 'directory-import/issue/org-level-required',
      defaultMessage: 'A unit level is empty',
    },
    issueOrgNameTooLong: {
      id: 'directory-import/issue/org-name-too-long',
      defaultMessage: 'A unit name is too long',
    },
    issueUserConflict,
    issueNodeConflict,
    issueOther,
    fieldDisplayName: { id: 'directory-import/field/display-name', defaultMessage: 'name' },
    fieldUserType: { id: 'directory-import/field/user-type', defaultMessage: 'user type' },
    fieldOrganization: { id: 'directory-import/field/organization', defaultMessage: 'unit' },
    commit: { id: 'directory-import/preview/commit', defaultMessage: 'Import' },
    commitCount,
    previewNoNewNodes: {
      id: 'directory-import/preview/no-new-nodes',
      defaultMessage: 'Nothing new to create',
    },
    issuesTakeAway: {
      id: 'directory-import/preview/issues-take-away',
      defaultMessage: 'Download the list',
    },
    issuesColumnWhat: {
      id: 'directory-import/preview/issues-column',
      defaultMessage: 'What is wrong',
    },
    committing: { id: 'directory-import/preview/committing', defaultMessage: 'Importing' },
    doneTitle: { id: 'directory-import/done/title', defaultMessage: 'Imported' },
    done,
    doneExisting,
    doneKept: {
      id: 'directory-import/done/kept',
      defaultMessage:
        'This import is kept as a record: what it did row by row, and the ways to take it back.',
    },
    openRecord: { id: 'directory-import/done/open-record', defaultMessage: 'Open the record' },
    importAnother: { id: 'directory-import/done/another', defaultMessage: 'Import another file' },
    prepTitle: { id: 'directory-import/prep/title', defaultMessage: 'What the file should hold' },
    prepPeople: prepPeopleMessage,
    prepUnits: {
      id: 'directory-import/prep/units',
      defaultMessage: 'Optionally a column for each level of unit they stand in, such as college, year and class. Units that do not exist yet are created',
    },
    prepHeader: {
      id: 'directory-import/prep/header',
      defaultMessage: 'A header row naming the columns, which need not be the first row. Which column is which is chosen in the next steps',
    },
    prepExisting: prepExistingMessage,
    prepSampleUnits: { id: 'directory-import/prep/sample-units', defaultMessage: 'College|Year|Class' },
    prepSampleRows: {
      id: 'directory-import/prep/sample-rows',
      defaultMessage: '2023010101|Ada Chen|Software|2023|Class 1;2023010102|Bo Li|Software|2023|Class 1',
    },
    recordOutcome: { id: 'directory-import/record/outcome', defaultMessage: 'What it did' },
    recordFile: { id: 'directory-import/record/file', defaultMessage: 'File' },
    recordReversed: { id: 'directory-import/record/reversed', defaultMessage: 'Reversed' },
    recordUndoHint: {
      id: 'directory-import/record/undo-hint',
      defaultMessage: 'Reversing deletes the people it created; cleaning removes the units it created that stand empty',
    },
    undoElsewhere: {
      id: 'directory-import/record/undo-elsewhere',
      defaultMessage: 'Reversing an import and cleaning its units are done on a computer',
    },
    nodePresent: { id: 'directory-import/record/node-present', defaultMessage: 'Present' },
    pagerLabel: { id: 'directory-import/pager', defaultMessage: 'Pages' },
    countOf: countOfMessage,
    recordClose: { id: 'directory-import/record/close', defaultMessage: 'Close' },
    recordsTitle: { id: 'directory-import/records/title', defaultMessage: 'Past imports' },
    recordsHint: {
      id: 'directory-import/records/hint',
      defaultMessage: 'Every import is kept, with what it did and what became of the people',
    },
    recordsEmpty: { id: 'directory-import/records/empty', defaultMessage: 'Nothing has been imported yet' },
    recordsLoadMore: { id: 'directory-import/records/load-more', defaultMessage: 'Load more' },
    recordsLoading: { id: 'directory-import/records/loading', defaultMessage: 'Loading imports' },
    recordsFailed: { id: 'directory-import/records/failed', defaultMessage: 'Past imports could not be loaded' },
    retry: { id: 'directory-import/records/retry', defaultMessage: 'Try again' },
    recordCounts,
    recordStanding,
    recordBy: { id: 'directory-import/record/by', defaultMessage: 'By' },
    recordAt: { id: 'directory-import/record/at', defaultMessage: 'On' },
    recordUnder: { id: 'directory-import/record/under', defaultMessage: 'Under' },
    recordType: { id: 'directory-import/record/type', defaultMessage: 'Type' },
    recordRows: { id: 'directory-import/record/rows', defaultMessage: 'Rows' },
    recordNodes: { id: 'directory-import/record/nodes', defaultMessage: 'Units' },
    recordEvents: { id: 'directory-import/record/events', defaultMessage: 'History' },
    recordLoading: { id: 'directory-import/record/loading', defaultMessage: 'Loading the import' },
    recordFailed: { id: 'directory-import/record/failed', defaultMessage: 'The import could not be loaded' },
    columnRow: { id: 'directory-import/record/column-row', defaultMessage: 'Row' },
    columnName: { id: 'directory-import/record/column-name', defaultMessage: 'Name' },
    columnUnit: { id: 'directory-import/record/column-unit', defaultMessage: 'Unit' },
    columnOutcome: { id: 'directory-import/record/column-outcome', defaultMessage: 'Outcome' },
    columnStanding: { id: 'directory-import/record/column-standing', defaultMessage: 'Now' },
    dispositionCreated: { id: 'directory-import/record/created', defaultMessage: 'Created' },
    dispositionExisting: { id: 'directory-import/record/existing', defaultMessage: 'Already present' },
    dispositionReused: { id: 'directory-import/record/reused', defaultMessage: 'Reused' },
    standingActive: { id: 'directory-import/record/standing-active', defaultMessage: 'Active' },
    standingDisabled: { id: 'directory-import/record/standing-disabled', defaultMessage: 'Disabled' },
    standingDeleted: { id: 'directory-import/record/standing-deleted', defaultMessage: 'Deleted' },
    standingMissing: { id: 'directory-import/record/standing-missing', defaultMessage: 'Gone' },
    nodeGone: { id: 'directory-import/record/node-gone', defaultMessage: 'Removed' },
    reverse: { id: 'directory-import/reverse/action', defaultMessage: 'Reverse this import' },
    reverseTitle: { id: 'directory-import/reverse/title', defaultMessage: 'Delete the people this import created?' },
    reversalHint,
    reverseReason: { id: 'directory-import/reverse/reason', defaultMessage: 'Reason' },
    reverseConfirm: { id: 'directory-import/reverse/confirm', defaultMessage: 'Delete them' },
    reverseNothing: { id: 'directory-import/reverse/nothing', defaultMessage: 'Nobody from this import is left to delete' },
    reversed,
    clean: { id: 'directory-import/clean/action', defaultMessage: 'Remove unused units' },
    cleanTitle: { id: 'directory-import/clean/title', defaultMessage: 'Remove the units this import created?' },
    cleanHint: {
      id: 'directory-import/clean/hint',
      defaultMessage: 'Only units nobody uses go; a unit with people or sub-units stays and is listed',
    },
    cleanConfirm: { id: 'directory-import/clean/confirm', defaultMessage: 'Remove them' },
    cleaned,
    eventReversed,
    eventCleaned,
    cancel: { id: 'directory-import/dialog/cancel', defaultMessage: 'Cancel' },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof directoryErrors>>()({
    USER_IMPORT_NOT_FOUND: {
      id: 'directory-import/error/not-found',
      defaultMessage: 'That import does not exist.',
    },
    USER_IMPORT_INVALID: {
      id: 'directory-import/error/invalid',
      defaultMessage: 'The file cannot be imported as it is.',
    },
    USER_IMPORT_MAPPING_INVALID: {
      id: 'directory-import/error/mapping-invalid',
      defaultMessage: 'The columns do not describe a valid set of units.',
    },
    USER_IMPORT_PLAN_CHANGED: {
      id: 'directory-import/error/plan-changed',
      defaultMessage: 'Something changed since the check. Check the file again.',
    },
    USER_IMPORT_SOURCE_UNAVAILABLE: {
      id: 'directory-import/error/source-unavailable',
      defaultMessage: 'The uploaded file is no longer available. Upload it again.',
    },
    USER_IMPORT_SOURCE_USED: {
      id: 'directory-import/error/source-used',
      defaultMessage: 'This file was already imported. Upload it again to import it once more.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const directoryImportMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
