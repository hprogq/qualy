import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as formulaErrors from '../server/errors.ts'

// Everything the formula library says to a human. Compiler diagnostics and
// test reports are content, not copy: they render as data the author reads,
// so no message here restates them - the copy only frames what to do next.

const i18n = definePluginMessages({
  namespace: 'assessment-formula',
  messages: {
    'permission.assessment.formula.author': {
      id: 'assessment-formula/permission/author',
      defaultMessage: 'Write scoring formulas',
    },
    'permission-hint.assessment.formula.author': {
      id: 'assessment-formula/permission-hint/author',
      defaultMessage: 'Write, test, publish and archive your own scoring formulas.',
    },
    'permission.assessment.formula.share': {
      id: 'assessment-formula/permission/share',
      defaultMessage: 'Share scoring formulas',
    },
    'permission-hint.assessment.formula.share': {
      id: 'assessment-formula/permission-hint/share',
      defaultMessage: 'Share your published formulas with the authors working under this unit.',
    },
    'permission-group.assessment': {
      id: 'assessment-formula/permission-group/assessment',
      defaultMessage: 'Assessment',
    },
    'audit.create': {
      id: 'assessment-formula/audit/create',
      defaultMessage: 'Create scoring formula',
    },
    'audit.draft-update': {
      id: 'assessment-formula/audit/draft-update',
      defaultMessage: 'Update formula draft',
    },
    'audit.sharing-change': {
      id: 'assessment-formula/audit/sharing-change',
      defaultMessage: 'Change formula sharing',
    },
    'audit.template-copy': {
      id: 'assessment-formula/audit/template-copy',
      defaultMessage: 'Copy formula template',
    },
    'audit.details-change': {
      id: 'assessment-formula/audit/details-change',
      defaultMessage: 'Change scoring formula details',
    },
    'audit.archive': {
      id: 'assessment-formula/audit/archive',
      defaultMessage: 'Archive scoring formula',
    },
    'audit.delete': {
      id: 'assessment-formula/audit/delete',
      defaultMessage: 'Delete scoring formula',
    },
    'audit.restore': {
      id: 'assessment-formula/audit/restore',
      defaultMessage: 'Restore scoring formula',
    },
    navigation: {
      id: 'assessment-formula/navigation/formulas',
      defaultMessage: 'Scoring formulas',
    },
    templatesTitle: {
      id: 'assessment-formula/templates/title',
      defaultMessage: 'Formula templates',
    },
    templatesHint: {
      id: 'assessment-formula/templates/hint',
      defaultMessage: 'Formulas other people have shared with you; copy one to make it your own',
    },
    templatesEmpty: {
      id: 'assessment-formula/templates/empty',
      defaultMessage: 'Nobody has shared a formula with you yet',
    },
    templatesAuthorColumn: {
      id: 'assessment-formula/templates/author-column',
      defaultMessage: 'Written by',
    },
    templatesAuthorUnknown: {
      id: 'assessment-formula/templates/author-unknown',
      defaultMessage: 'Unknown',
    },
    templatesPublishedColumn: {
      id: 'assessment-formula/templates/published-column',
      defaultMessage: 'Published',
    },
    templatesSourceArchived: {
      id: 'assessment-formula/templates/source-archived',
      defaultMessage: 'Source archived',
    },
    templatesCopy: {
      id: 'assessment-formula/templates/copy',
      defaultMessage: 'Copy to my formulas',
    },
    templatesCopyTitle: {
      id: 'assessment-formula/templates/copy-title',
      defaultMessage: 'Copy this formula',
    },
    templatesSource: {
      id: 'assessment-formula/templates/source',
      defaultMessage: 'Source',
    },
    templatesExamples: {
      id: 'assessment-formula/templates/examples',
      defaultMessage: '{count, plural, one {# example} other {# examples}}',
    },
    templatesExamplesHint: {
      id: 'assessment-formula/templates/examples-hint',
      defaultMessage: 'The examples this version was published with; copy it to run them',
    },
    templatesCopiedFrom: {
      id: 'assessment-formula/templates/copied-from',
      defaultMessage: 'Copied from',
    },
    navigationTemplates: {
      id: 'assessment-formula/navigation/templates',
      defaultMessage: 'Formula templates',
    },
    listTitle: {
      id: 'assessment-formula/list/title',
      defaultMessage: 'Scoring formulas',
    },
    listHint: {
      id: 'assessment-formula/list/hint',
      defaultMessage: 'Reusable scoring functions; publish a version before binding it to items',
    },
    emptyList: {
      id: 'assessment-formula/list/empty',
      defaultMessage: 'No formulas yet',
    },
    newFormula: {
      id: 'assessment-formula/list/new',
      defaultMessage: 'New formula',
    },
    detailsTitle: {
      id: 'assessment-formula/editor/details-title',
      defaultMessage: 'Formula details',
    },
    detailsOpen: {
      id: 'assessment-formula/editor/details-open',
      defaultMessage: 'Edit the name and description',
    },
    detailsSave: {
      id: 'assessment-formula/editor/details-save',
      defaultMessage: 'Save',
    },
    detailsSaved: {
      id: 'assessment-formula/editor/details-saved',
      defaultMessage: 'The formula details were saved.',
    },
    descriptionNone: {
      id: 'assessment-formula/editor/description-none',
      defaultMessage: 'No description yet',
    },
    descriptionHint: {
      id: 'assessment-formula/editor/description-hint',
      defaultMessage: 'How it scores, shown in the formula list and to anyone it is shared with',
    },
    nameLabel: {
      id: 'assessment-formula/field/name',
      defaultMessage: 'Name',
    },
    descriptionLabel: {
      id: 'assessment-formula/field/description',
      defaultMessage: 'Description',
    },
    createConfirm: {
      id: 'assessment-formula/create/confirm',
      defaultMessage: 'Create',
    },
    cancel: {
      id: 'assessment-formula/common/cancel',
      defaultMessage: 'Cancel',
    },
    statusActive: {
      id: 'assessment-formula/status/active',
      defaultMessage: 'Active',
    },
    statusArchived: {
      id: 'assessment-formula/status/archived',
      defaultMessage: 'Archived',
    },
    versionColumn: {
      id: 'assessment-formula/list/version-column',
      defaultMessage: 'Published',
    },
    loadMore: {
      id: 'assessment-formula/list/load-more',
      defaultMessage: 'Load more',
    },
    versionNone: {
      id: 'assessment-formula/list/version-none',
      defaultMessage: 'Draft only',
    },
    updatedColumn: {
      id: 'assessment-formula/list/updated-column',
      defaultMessage: 'Updated',
    },
    sourceLabel: {
      id: 'assessment-formula/editor/source',
      defaultMessage: 'Formula source',
    },
    editorLoading: {
      id: 'assessment-formula/editor/loading',
      defaultMessage: 'Loading the editor…',
    },
    structureSynced: {
      id: 'assessment-formula/editor/structure-synced',
      defaultMessage: 'Input structure is in sync',
    },
    structureLoading: {
      id: 'assessment-formula/editor/structure-loading',
      defaultMessage: 'Reading the input structure…',
    },
    structureStale: {
      id: 'assessment-formula/editor/structure-stale',
      defaultMessage: 'Code changed; structure updates shortly',
    },
    structureRefused: {
      id: 'assessment-formula/editor/structure-refused',
      defaultMessage: 'The code does not compile, so its input structure cannot be read yet',
    },
    tryTitle: {
      id: 'assessment-formula/editor/try-title',
      defaultMessage: 'Try it',
    },
    run: {
      id: 'assessment-formula/editor/run',
      defaultMessage: 'Run',
    },
    runNeedsCompile: {
      id: 'assessment-formula/editor/run-needs-compile',
      defaultMessage: 'The code has to compile before anything can run against it',
    },
    runNeedsSource: {
      id: 'assessment-formula/editor/run-needs-source',
      defaultMessage: 'Write the formula before running it',
    },
    runThisExample: {
      id: 'assessment-formula/editor/run-this-example',
      defaultMessage: 'Run this example',
    },
    runAll: {
      id: 'assessment-formula/editor/run-all',
      defaultMessage: 'Run all',
    },
    running: {
      id: 'assessment-formula/editor/running',
      defaultMessage: 'Running…',
    },
    trySave: {
      id: 'assessment-formula/editor/try-save',
      defaultMessage: 'Save as example',
    },
    adoptActual: {
      id: 'assessment-formula/editor/adopt-actual',
      defaultMessage: 'Use {value} as expected',
    },
    loadIntoTry: {
      id: 'assessment-formula/editor/load-into-try',
      defaultMessage: 'Load into try-run',
    },
    copyTest: {
      id: 'assessment-formula/editor/copy-test',
      defaultMessage: 'Duplicate',
    },
    resultStale: {
      id: 'assessment-formula/editor/result-stale',
      defaultMessage: 'Not yet run against the current code',
    },
    resultPassed: {
      id: 'assessment-formula/editor/result-passed',
      defaultMessage: 'Passed',
    },
    resultFailed: {
      id: 'assessment-formula/editor/result-failed',
      defaultMessage: 'Failed: got {actual}',
    },
    fieldRequired: {
      id: 'assessment-formula/editor/field-required',
      defaultMessage: 'Required',
    },
    fieldNotInteger: {
      id: 'assessment-formula/editor/field-not-integer',
      defaultMessage: 'Enter a whole number',
    },
    fieldNotDecimal: {
      id: 'assessment-formula/editor/field-not-decimal',
      defaultMessage: 'Enter a number',
    },
    testRowInvalid: {
      id: 'assessment-formula/editor/test-row-invalid',
      defaultMessage: 'This case no longer fits the input structure; fix it before saving tests',
    },
    testsHeldBack: {
      id: 'assessment-formula/editor/tests-held-back',
      defaultMessage: 'Some cases need fixing; this save keeps the code only',
    },
    expectedLabel: {
      id: 'assessment-formula/editor/expected-label',
      defaultMessage: 'Expected',
    },
    lspConnecting: {
      id: 'assessment-formula/editor/lsp-connecting',
      defaultMessage: 'Connecting to language assistance…',
    },
    lspReady: {
      id: 'assessment-formula/editor/lsp-ready',
      defaultMessage: 'Language assistance ready',
    },
    lspUnavailable: {
      id: 'assessment-formula/editor/lsp-unavailable',
      defaultMessage: 'Language assistance is unavailable. Editing and saving still work.',
    },
    testsTitle: {
      id: 'assessment-formula/editor/tests',
      defaultMessage: 'Examples',
    },
    testName: {
      id: 'assessment-formula/editor/test-name',
      defaultMessage: 'Name',
    },
    testInputLabel: {
      id: 'assessment-formula/editor/test-input-label',
      defaultMessage: 'Input',
    },
    testInput: {
      id: 'assessment-formula/editor/test-input',
      defaultMessage: 'Input (JSON)',
    },
    testExpected: {
      id: 'assessment-formula/editor/test-expected',
      defaultMessage: 'Expected amount',
    },
    addTest: {
      id: 'assessment-formula/editor/add-test',
      defaultMessage: 'Add example',
    },
    removeConfirm: {
      id: 'assessment-formula/editor/remove-confirm',
      defaultMessage: 'Press again to remove',
    },
    removeTest: {
      id: 'assessment-formula/editor/remove-test',
      defaultMessage: 'Remove',
    },
    testInputInvalid: {
      id: 'assessment-formula/editor/test-input-invalid',
      defaultMessage: 'The input of example "{label}" is not valid JSON.',
    },
    save: {
      id: 'assessment-formula/editor/save',
      defaultMessage: 'Save',
    },
    saved: {
      id: 'assessment-formula/editor/saved',
      defaultMessage: 'Draft saved.',
    },
    diagnosticsTitle: {
      id: 'assessment-formula/report/diagnostics',
      defaultMessage: 'Compiler findings',
    },
    reportFailed: {
      id: 'assessment-formula/report/failed',
      defaultMessage: 'Failed',
    },
    reportOutcome: {
      id: 'assessment-formula/report/outcome',
      defaultMessage: 'Outcome',
    },
    reportActualColumn: {
      id: 'assessment-formula/report/actual-column',
      defaultMessage: 'Actual',
    },
    problemInput: {
      id: 'assessment-formula/report/problem-input',
      defaultMessage: 'Parameter {parameter}: {detail}',
    },
    problemExpected: {
      id: 'assessment-formula/report/problem-expected',
      defaultMessage: 'Expected amount: {detail}',
    },
    problemOutput: {
      id: 'assessment-formula/report/problem-output',
      defaultMessage: 'The answer breaks the output contract: {detail}',
    },
    refusalPrefix: {
      id: 'assessment-formula/report/refusal',
      defaultMessage: 'Refused by the formula: {message}',
    },
    defectPrefix: {
      id: 'assessment-formula/report/defect',
      defaultMessage: 'Crashed while running: {message}',
    },
    reasonOverMax: {
      id: 'assessment-formula/reason/over-max',
      defaultMessage: 'above the limit of {constraint}',
    },
    reasonUnderMin: {
      id: 'assessment-formula/reason/under-min',
      defaultMessage: 'below the minimum of {constraint}',
    },
    reasonScale: {
      id: 'assessment-formula/reason/scale',
      defaultMessage: 'more than {constraint} decimal places',
    },
    reasonTooLong: {
      id: 'assessment-formula/reason/too-long',
      defaultMessage: 'longer than {constraint} characters',
    },
    reasonTooShort: {
      id: 'assessment-formula/reason/too-short',
      defaultMessage: 'shorter than {constraint} characters',
    },
    reasonEnum: {
      id: 'assessment-formula/reason/enum',
      defaultMessage: 'not one of: {constraint}',
    },
    reasonPattern: {
      id: 'assessment-formula/reason/pattern',
      defaultMessage: 'does not match the required format ({constraint})',
    },
    reasonKind: {
      id: 'assessment-formula/reason/kind',
      defaultMessage: 'not a valid {kind}',
    },
    reasonMissing: {
      id: 'assessment-formula/reason/missing',
      defaultMessage: 'missing',
    },
    reasonExtra: {
      id: 'assessment-formula/reason/extra',
      defaultMessage: 'not a parameter of this formula',
    },
    reasonOther: {
      id: 'assessment-formula/reason/other',
      defaultMessage: 'does not satisfy the contract ({reason})',
    },
    kindText: {
      id: 'assessment-formula/kind/text',
      defaultMessage: 'text',
    },
    kindInteger: {
      id: 'assessment-formula/kind/integer',
      defaultMessage: 'integer',
    },
    kindDecimal: {
      id: 'assessment-formula/kind/decimal',
      defaultMessage: 'decimal',
    },
    kindChoice: {
      id: 'assessment-formula/kind/choice',
      defaultMessage: 'choice',
    },
    kindBoolean: {
      id: 'assessment-formula/kind/boolean',
      defaultMessage: 'boolean',
    },
    kindDate: {
      id: 'assessment-formula/kind/date',
      defaultMessage: 'date',
    },
    contractNotScoreAmount: {
      id: 'assessment-formula/contract/not-score-amount',
      defaultMessage:
        'The output must fit the scoring range: use Schema.scoreAmount(), or give Schema.decimal explicit minimum/maximum bounds (within ±99999999.9999, at most 4 decimal places).',
    },
    contractNotDecimal: {
      id: 'assessment-formula/contract/not-decimal',
      defaultMessage: 'The output must be a decimal.',
    },
    contractTooLarge: {
      id: 'assessment-formula/contract/too-large',
      defaultMessage: 'The parameter structure is too large; reduce parameters or choices.',
    },
    contractError: {
      id: 'assessment-formula/contract/error',
      defaultMessage: 'A schema was rejected while loading the formula; details below.',
    },
    profileMaxScale: {
      id: 'assessment-formula/contract/max-scale',
      defaultMessage: 'maxScale must be a whole number from 0 to 18',
    },
    profileBoundsInverted: {
      id: 'assessment-formula/contract/bounds-inverted',
      defaultMessage: 'the lower bound is above the upper one',
    },
    profileIntegerBounds: {
      id: 'assessment-formula/contract/integer-bounds',
      defaultMessage: 'an integer parameter needs both a minimum and a maximum',
    },
    profileIntegerUnsafe: {
      id: 'assessment-formula/contract/integer-unsafe',
      defaultMessage: 'the bounds are outside the range integers can hold exactly',
    },
    profileDecimalBound: {
      id: 'assessment-formula/contract/decimal-bound',
      defaultMessage: 'a bound must be a plain decimal string, such as "0" or "99.99"',
    },
    profileDecimalScale: {
      id: 'assessment-formula/contract/decimal-scale',
      defaultMessage: 'a bound has more decimal places than maxScale allows',
    },
    profileLengthBounds: {
      id: 'assessment-formula/contract/length-bounds',
      defaultMessage: 'the length bounds must be whole numbers, the smallest first',
    },
    profileChoiceEmpty: {
      id: 'assessment-formula/contract/choice-empty',
      defaultMessage: 'a choice needs at least one option',
    },
    profileChoiceDuplicate: {
      id: 'assessment-formula/contract/choice-duplicate',
      defaultMessage: 'two options share one value',
    },
    profileChoiceTooMany: {
      id: 'assessment-formula/contract/choice-too-many',
      defaultMessage: 'this choice has more options than a form can take',
    },
    profileChoiceValue: {
      id: 'assessment-formula/contract/choice-value',
      defaultMessage: 'an option value must be a short identifier',
    },
    profileParameterName: {
      id: 'assessment-formula/contract/parameter-name',
      defaultMessage: 'a parameter name must be a short identifier',
    },
    profileTooManyParameters: {
      id: 'assessment-formula/contract/too-many-parameters',
      defaultMessage: 'the formula takes more parameters than a form can ask for',
    },
    profileUnknownKind: {
      id: 'assessment-formula/contract/unknown-kind',
      defaultMessage: 'this parameter is not one of the kinds a question can ask for',
    },
    profileUnknownKey: {
      id: 'assessment-formula/contract/unknown-key',
      defaultMessage: 'this parameter carries a setting the platform does not read',
    },
    profileWordsTooLong: {
      id: 'assessment-formula/contract/words-too-long',
      defaultMessage: 'a title, description or label is too long',
    },
    contractPatternInvalid: {
      id: 'assessment-formula/contract/pattern-invalid',
      defaultMessage:
        'The pattern is outside the supported regex subset (no backreferences or look-around).',
    },
    contractPatternTooLarge: {
      id: 'assessment-formula/contract/pattern-too-large',
      defaultMessage: 'The pattern is too long.',
    },
    contractPatternTooComplex: {
      id: 'assessment-formula/contract/pattern-too-complex',
      defaultMessage: 'The pattern is too complex.',
    },
    contractIssueColumn: {
      id: 'assessment-formula/contract/issue-column',
      defaultMessage: 'Detail',
    },
    contractIssuesTitle: {
      id: 'assessment-formula/report/contract',
      defaultMessage: 'Contract findings',
    },
    sharingPrivate: {
      id: 'assessment-formula/sharing/private',
      defaultMessage: 'Not shared',
    },
    sharingUnits: {
      id: 'assessment-formula/sharing/units',
      defaultMessage: 'Shared with {count, plural, one {# unit} other {# units}}',
    },
    sharingManage: {
      id: 'assessment-formula/sharing/manage',
      defaultMessage: 'Who it is shared with',
    },
    sharingTitle: {
      id: 'assessment-formula/sharing/title',
      defaultMessage: 'Share {name}',
    },
    sharingHint: {
      id: 'assessment-formula/sharing/hint',
      defaultMessage: 'Everyone in a unit you offer it to may copy this publication',
    },
    sharingCurrent: {
      id: 'assessment-formula/sharing/current',
      defaultMessage: 'Offered to',
    },
    sharingChoose: {
      id: 'assessment-formula/sharing/choose',
      defaultMessage: 'Choose units',
    },
    sharingSearch: {
      id: 'assessment-formula/sharing/search',
      defaultMessage: 'Search units',
    },
    sharingNoOptions: {
      id: 'assessment-formula/sharing/no-options',
      defaultMessage: 'No unit here can be offered this formula',
    },
    sharingNoMatches: {
      id: 'assessment-formula/sharing/no-matches',
      defaultMessage: 'No unit matches',
    },
    sharingTruncated: {
      id: 'assessment-formula/sharing/truncated',
      defaultMessage: 'Showing the first matches; search to narrow them',
    },
    sharingSave: {
      id: 'assessment-formula/sharing/save',
      defaultMessage: 'Save',
    },
    sharingSaved: {
      id: 'assessment-formula/sharing/saved',
      defaultMessage: 'Sharing updated.',
    },
    versionsEmpty: {
      id: 'assessment-formula/editor/versions-empty',
      defaultMessage: 'Nothing published yet',
    },
    remoteMovedTitle: {
      id: 'assessment-formula/editor/remote-moved',
      defaultMessage: 'The draft was changed elsewhere',
    },
    remoteMovedHint: {
      id: 'assessment-formula/editor/remote-moved-hint',
      defaultMessage:
        'Someone else saved this draft while you were editing. Your text is untouched; discard it to load theirs.',
    },
    discardLocal: {
      id: 'assessment-formula/editor/discard-local',
      defaultMessage: 'Discard my edits and reload',
    },
    loadFailed: {
      id: 'assessment-formula/editor/load-failed',
      defaultMessage: 'The formula could not be loaded.',
    },
    listAll: {
      id: 'assessment-formula/list/all',
      defaultMessage: 'All formulas',
    },
    listNameColumn: {
      id: 'assessment-formula/list/name-column',
      defaultMessage: 'Name and description',
    },
    emptyListHint: {
      id: 'assessment-formula/list/empty-hint',
      defaultMessage: 'Write one; once published it can score a question',
    },
    whenToday: {
      id: 'assessment-formula/when/today',
      defaultMessage: 'Today {time}',
    },
    whenYesterday: {
      id: 'assessment-formula/when/yesterday',
      defaultMessage: 'Yesterday {time}',
    },
    templatesOffered: {
      id: 'assessment-formula/templates/offered',
      defaultMessage: 'Shared with me',
    },
    templatesMine: {
      id: 'assessment-formula/templates/mine',
      defaultMessage: 'My scoring formulas',
    },
    templatesNameColumn: {
      id: 'assessment-formula/templates/name-column',
      defaultMessage: 'Name and parameters',
    },
    templatesEmptyHint: {
      id: 'assessment-formula/templates/empty-hint',
      defaultMessage: 'A formula someone shares with your unit shows up here',
    },
    templatesReadOnly: {
      id: 'assessment-formula/templates/read-only',
      defaultMessage: 'Read-only; copy it to edit',
    },
    versionLabel: {
      id: 'assessment-formula/version/label',
      defaultMessage: 'Version',
    },
    versionLatest: {
      id: 'assessment-formula/version/latest',
      defaultMessage: 'Latest',
    },
    parametersLabel: {
      id: 'assessment-formula/parameters/label',
      defaultMessage: 'Parameters',
    },
    parametersNone: {
      id: 'assessment-formula/parameters/none',
      defaultMessage: 'None',
    },
    parameterTitle: {
      id: 'assessment-formula/parameters/title',
      defaultMessage: 'Shown as',
    },
    parameterKind: {
      id: 'assessment-formula/parameters/kind',
      defaultMessage: 'Kind',
    },
    parameterRule: {
      id: 'assessment-formula/parameters/rule',
      defaultMessage: 'Allowed values',
    },
    parameterOutput: {
      id: 'assessment-formula/parameters/output',
      defaultMessage: 'Output',
    },
    parameterOptional: {
      id: 'assessment-formula/parameters/optional',
      defaultMessage: '(optional)',
    },
    constraintRange: {
      id: 'assessment-formula/constraint/range',
      defaultMessage: '{min} to {max}',
    },
    constraintAtLeast: {
      id: 'assessment-formula/constraint/at-least',
      defaultMessage: 'at least {min}',
    },
    constraintAtMost: {
      id: 'assessment-formula/constraint/at-most',
      defaultMessage: 'at most {max}',
    },
    constraintScale: {
      id: 'assessment-formula/constraint/scale',
      defaultMessage: 'up to {scale} decimal places',
    },
    constraintLength: {
      id: 'assessment-formula/constraint/length',
      defaultMessage: '{min} to {max} characters',
    },
    constraintMaxLength: {
      id: 'assessment-formula/constraint/max-length',
      defaultMessage: 'up to {max} characters',
    },
    constraintPattern: {
      id: 'assessment-formula/constraint/pattern',
      defaultMessage: 'matches {pattern}',
    },
    constraintNone: {
      id: 'assessment-formula/constraint/none',
      defaultMessage: 'Any',
    },
    headerPublished: {
      id: 'assessment-formula/editor/header-published',
      defaultMessage: 'Published',
    },
    draftClean: {
      id: 'assessment-formula/editor/draft-clean',
      defaultMessage: 'Draft saved',
    },
    draftDirty: {
      id: 'assessment-formula/editor/draft-dirty',
      defaultMessage: 'Unsaved changes',
    },
    draftSaving: {
      id: 'assessment-formula/editor/draft-saving',
      defaultMessage: 'Saving…',
    },
    draftPublishing: {
      id: 'assessment-formula/editor/draft-publishing',
      defaultMessage: 'Publishing…',
    },
    resultLabel: {
      id: 'assessment-formula/editor/result-label',
      defaultMessage: 'Result',
    },
    panelLabel: {
      id: 'assessment-formula/editor/panel',
      defaultMessage: 'Checks before publishing',
    },
    compileReady: {
      id: 'assessment-formula/editor/compile-ready',
      defaultMessage: 'The current code compiles',
    },
    examplesInputColumn: {
      id: 'assessment-formula/examples/input-column',
      defaultMessage: 'Input',
    },
    examplesExpectedColumn: {
      id: 'assessment-formula/examples/expected-column',
      defaultMessage: 'Expected',
    },
    exampleMenu: {
      id: 'assessment-formula/examples/menu',
      defaultMessage: 'Example actions',
    },
    exampleUnnamed: {
      id: 'assessment-formula/examples/unnamed',
      defaultMessage: 'Untitled',
    },
    examplesEmpty: {
      id: 'assessment-formula/examples/empty',
      defaultMessage: 'No examples yet; publishing needs at least one',
    },
    conclusionNotRun: {
      id: 'assessment-formula/examples/not-run',
      defaultMessage: 'Not run',
    },
    conclusionNoExpectation: {
      id: 'assessment-formula/examples/no-expectation',
      defaultMessage: 'No expected value',
    },
    conclusionNeedsFix: {
      id: 'assessment-formula/examples/needs-fix',
      defaultMessage: 'Needs fixing',
    },
    exampleFailedActual: {
      id: 'assessment-formula/examples/failed-actual',
      defaultMessage: 'Example “{name}” failed; it came to {actual}',
    },
    exampleFailed: {
      id: 'assessment-formula/examples/failed',
      defaultMessage: 'Example “{name}” failed',
    },
    exampleNeedsFixing: {
      id: 'assessment-formula/examples/needs-fixing',
      defaultMessage: 'Example “{name}” no longer fits the input structure',
    },
    exampleNoExpectation: {
      id: 'assessment-formula/examples/no-expectation-summary',
      defaultMessage: 'Example “{name}” has no expected value yet',
    },
    examplesAllPassed: {
      id: 'assessment-formula/examples/all-passed',
      defaultMessage: 'Every example passes against the current code',
    },
    examplesNotRun: {
      id: 'assessment-formula/examples/not-run-count',
      defaultMessage:
        '{count, plural, one {# example has} other {# examples have}} not run against the current code',
    },
    structureContractRefused: {
      id: 'assessment-formula/editor/structure-contract-refused',
      defaultMessage: 'The parameters were refused, so no input structure can be read yet',
    },
    structureContractKept: {
      id: 'assessment-formula/editor/structure-contract-kept',
      defaultMessage: 'The parameters were refused; showing the last structure that passed',
    },
    structureKept: {
      id: 'assessment-formula/editor/structure-kept',
      defaultMessage: 'The code does not compile; showing the last structure that did',
    },
    compileFailed: {
      id: 'assessment-formula/editor/compile-failed',
      defaultMessage: 'The code does not compile',
    },
    compileFindings: {
      id: 'assessment-formula/editor/compile-findings',
      defaultMessage: '{count, plural, one {# finding} other {# findings}}',
    },
    exampleEditTitle: {
      id: 'assessment-formula/examples/edit-title',
      defaultMessage: 'Edit example',
    },
    exampleEditHint: {
      id: 'assessment-formula/examples/edit-hint',
      defaultMessage: 'Changes take effect at once and are kept with the draft when it is saved',
    },
    exampleDone: {
      id: 'assessment-formula/examples/done',
      defaultMessage: 'Done',
    },
    resultActual: {
      id: 'assessment-formula/editor/result-actual',
      defaultMessage: 'Result: {value}',
    },
    calculatorOption: {
      id: 'assessment-formula/binding/calculator',
      defaultMessage: 'A published formula',
    },
    bindingTitle: {
      id: 'assessment-formula/binding/title',
      defaultMessage: 'Formula',
    },
    bindingParameters: {
      id: 'assessment-formula/binding/parameters',
      defaultMessage: 'Takes {names}',
    },
    bindingKeptOnly: {
      id: 'assessment-formula/binding/kept-only',
      defaultMessage: 'Kept, not offered',
    },
    bindingMore: {
      id: 'assessment-formula/binding/more',
      defaultMessage: 'Show more',
    },
    deleteFormula: {
      id: 'assessment-formula/editor/delete-formula',
      defaultMessage: 'Delete this formula',
    },
    deleteTitle: {
      id: 'assessment-formula/editor/delete-title',
      defaultMessage: 'Delete this formula?',
    },
    deleteDescription: {
      id: 'assessment-formula/editor/delete-description',
      defaultMessage:
        'Nothing has been published from it, so the draft and its saved revisions go with it. This cannot be undone.',
    },
    deleteConfirm: {
      id: 'assessment-formula/editor/delete-confirm',
      defaultMessage: 'Delete',
    },
    deleted: {
      id: 'assessment-formula/editor/deleted',
      defaultMessage: 'The formula was deleted.',
    },
    archiveFormula: {
      id: 'assessment-formula/editor/archive-formula',
      defaultMessage: 'Archive formula',
    },
    restoreFormula: {
      id: 'assessment-formula/editor/restore-formula',
      defaultMessage: 'Restore formula',
    },
    moreActions: {
      id: 'assessment-formula/editor/more-actions',
      defaultMessage: 'More actions',
    },
    downloadCurrent: {
      id: 'assessment-formula/editor/download-current',
      defaultMessage: 'Download current code',
    },
    emptySourceTitle: {
      id: 'assessment-formula/editor/empty-source-title',
      defaultMessage: 'No scoring formula written yet',
    },
    emptySourceHint: {
      id: 'assessment-formula/editor/empty-source-hint',
      defaultMessage:
        'Start from a blank page, or load a minimal example to see how the Formula API works',
    },
    loadExample: {
      id: 'assessment-formula/editor/load-example',
      defaultMessage: 'Load a minimal example',
    },
    loadExampleMenu: {
      id: 'assessment-formula/editor/load-example-menu',
      defaultMessage: 'Load a minimal example…',
    },
    loadExampleTitle: {
      id: 'assessment-formula/editor/load-example-title',
      defaultMessage: 'Replace the editor content?',
    },
    loadExampleDescription: {
      id: 'assessment-formula/editor/load-example-description',
      defaultMessage:
        'Loading the example replaces what is in the editor, including anything not yet saved.',
    },
    loadExampleConfirm: {
      id: 'assessment-formula/editor/load-example-confirm',
      defaultMessage: 'Load example',
    },
    startBlank: {
      id: 'assessment-formula/editor/start-blank',
      defaultMessage: 'Start from a blank file',
    },
    leaveForTemplatesTitle: {
      id: 'assessment-formula/editor/leave-for-templates-title',
      defaultMessage: 'Leave this formula?',
    },
    leaveForTemplatesDescription: {
      id: 'assessment-formula/editor/leave-for-templates-description',
      defaultMessage: 'This draft has unsaved changes, and leaving the page lets them go.',
    },
    leaveForTemplatesConfirm: {
      id: 'assessment-formula/editor/leave-for-templates-confirm',
      defaultMessage: 'Leave',
    },
    browseTemplates: {
      id: 'assessment-formula/editor/browse-templates',
      defaultMessage: 'Browse formula templates',
    },
    compileBlank: {
      id: 'assessment-formula/editor/compile-blank',
      defaultMessage: 'No formula written yet',
    },
    tryBlank: {
      id: 'assessment-formula/editor/try-blank',
      defaultMessage: 'Write the formula, then try it here',
    },
    contractReady: {
      id: 'assessment-formula/editor/contract-ready',
      defaultMessage: 'Parameters read from the code',
    },
    contractFailed: {
      id: 'assessment-formula/editor/contract-failed',
      defaultMessage: 'The parameter check did not pass',
    },
    latestRelease: {
      id: 'assessment-formula/editor/latest-release',
      defaultMessage: 'Latest release',
    },
    phoneSourceTab: {
      id: 'assessment-formula/editor/phone-source-tab',
      defaultMessage: 'Source',
    },
    publishOpen: {
      id: 'assessment-formula/editor/publish-open',
      defaultMessage: 'Publish',
    },
    publishedAs: {
      id: 'assessment-formula/editor/published-as',
      defaultMessage: 'Published “{name}”.',
    },
    replaceDraftTitle: {
      id: 'assessment-formula/editor/replace-draft-title',
      defaultMessage: 'Replace the current draft?',
    },
    replaceDraftDescription: {
      id: 'assessment-formula/editor/replace-draft-description',
      defaultMessage:
        'The current draft has unsaved changes. Using “{name}” replaces the draft; the publications themselves stay as they are.',
    },
    replaceDraftConfirm: {
      id: 'assessment-formula/editor/replace-draft-confirm',
      defaultMessage: 'Replace current draft',
    },
    restored: {
      id: 'assessment-formula/editor/restored',
      defaultMessage: 'Put back as the current draft.',
    },
    publishTitle: {
      id: 'assessment-formula/publish/title',
      defaultMessage: 'Publish a version',
    },
    releaseNameLabel: {
      id: 'assessment-formula/publish/name',
      defaultMessage: 'Release name',
    },
    releaseNamePlaceholder: {
      id: 'assessment-formula/publish/name-placeholder',
      defaultMessage: 'For example: 2026 autumn rules',
    },
    releaseNotesLabel: {
      id: 'assessment-formula/publish/notes',
      defaultMessage: 'Release notes',
    },
    publishLasting: {
      id: 'assessment-formula/publish/lasting',
      defaultMessage:
        'Publishing freezes the code, examples and contract; the name and notes cannot be changed afterwards',
    },
    publishConfirm: {
      id: 'assessment-formula/publish/confirm',
      defaultMessage: 'Publish',
    },
    publishSaveAndConfirm: {
      id: 'assessment-formula/publish/save-and-confirm',
      defaultMessage: 'Save and publish',
    },
    publishCheckUnsaved: {
      id: 'assessment-formula/publish/check-unsaved',
      defaultMessage: 'Unsaved changes are saved first',
    },
    historyTitle: {
      id: 'assessment-formula/history/title',
      defaultMessage: 'Versions',
    },
    historyReleases: {
      id: 'assessment-formula/history/releases',
      defaultMessage: 'Publications',
    },
    historyRevisions: {
      id: 'assessment-formula/history/revisions',
      defaultMessage: 'Draft saves',
    },
    releaseOrdinal: {
      id: 'assessment-formula/history/release-ordinal',
      defaultMessage: 'Publication #{number}',
    },
    releaseUnnamed: {
      id: 'assessment-formula/history/release-unnamed',
      defaultMessage: 'Untitled publication',
    },
    revisionNumber: {
      id: 'assessment-formula/history/revision-number',
      defaultMessage: 'Revision {number}',
    },
    revisionCurrent: {
      id: 'assessment-formula/history/revision-current',
      defaultMessage: 'Current',
    },
    revisionCreated: {
      id: 'assessment-formula/history/revision-created',
      defaultMessage: 'Created',
    },
    revisionSaved: {
      id: 'assessment-formula/history/revision-saved',
      defaultMessage: 'Saved',
    },
    revisionCopied: {
      id: 'assessment-formula/history/revision-copied',
      defaultMessage: 'Copied from a template',
    },
    revisionMigration: {
      id: 'assessment-formula/history/revision-migration',
      defaultMessage: 'Kept at a system upgrade',
    },
    revisionRestoredRelease: {
      id: 'assessment-formula/history/revision-restored-release',
      defaultMessage: 'Restored from “{name}”',
    },
    revisionRestoredRevision: {
      id: 'assessment-formula/history/revision-restored-revision',
      defaultMessage: 'Restored from revision {number}',
    },
    backToDraft: {
      id: 'assessment-formula/history/back-to-draft',
      defaultMessage: 'Back to the draft',
    },
    downloadCode: {
      id: 'assessment-formula/history/download-code',
      defaultMessage: 'Download code',
    },
    readOnly: {
      id: 'assessment-formula/history/read-only',
      defaultMessage: 'Read-only',
    },
    releaseSource: {
      id: 'assessment-formula/release/source',
      defaultMessage: 'Source as published',
    },
    releaseOrdinalLabel: {
      id: 'assessment-formula/release/ordinal-label',
      defaultMessage: 'Order',
    },
    releasePublisher: {
      id: 'assessment-formula/release/publisher',
      defaultMessage: 'Published by',
    },
    releaseNoReport: {
      id: 'assessment-formula/release/no-report',
      defaultMessage: 'No test results were kept for this publication',
    },
    releaseReportTab: {
      id: 'assessment-formula/release/report-tab',
      defaultMessage: 'Test results',
    },
    releaseContractTab: {
      id: 'assessment-formula/release/contract-tab',
      defaultMessage: 'Contract',
    },
    releaseEnvironmentTab: {
      id: 'assessment-formula/release/environment-tab',
      defaultMessage: 'Environment',
    },
    releaseRestore: {
      id: 'assessment-formula/release/restore',
      defaultMessage: 'Edit from this version',
    },
    envTypescript: {
      id: 'assessment-formula/release/env-typescript',
      defaultMessage: 'TypeScript',
    },
    envEsbuild: {
      id: 'assessment-formula/release/env-esbuild',
      defaultMessage: 'esbuild',
    },
    envQuickjs: {
      id: 'assessment-formula/release/env-quickjs',
      defaultMessage: 'QuickJS engine',
    },
    envFormulaAbi: {
      id: 'assessment-formula/release/env-formula-abi',
      defaultMessage: 'Formula ABI',
    },
    envSandboxAbi: {
      id: 'assessment-formula/release/env-sandbox-abi',
      defaultMessage: 'Sandbox ABI',
    },
    envValueSchema: {
      id: 'assessment-formula/release/env-value-schema',
      defaultMessage: 'Value schema profile',
    },
    envRegex: {
      id: 'assessment-formula/release/env-regex',
      defaultMessage: 'Pattern profile',
    },
    envSourcePolicy: {
      id: 'assessment-formula/release/env-source-policy',
      defaultMessage: 'Source policy',
    },
    envAuthoringBuild: {
      id: 'assessment-formula/release/env-authoring-build',
      defaultMessage: 'Compiler build',
    },
    envRuntimeBuild: {
      id: 'assessment-formula/release/env-runtime-build',
      defaultMessage: 'Runtime build',
    },
    envSourceSha: {
      id: 'assessment-formula/release/env-source-sha',
      defaultMessage: 'Source SHA-256',
    },
    envRuntimeSha: {
      id: 'assessment-formula/release/env-runtime-sha',
      defaultMessage: 'Bundle SHA-256',
    },
    envContractSha: {
      id: 'assessment-formula/release/env-contract-sha',
      defaultMessage: 'Contract SHA-256',
    },
    envFormulaRuntimeSha: {
      id: 'assessment-formula/release/env-formula-runtime-sha',
      defaultMessage: 'Formula runtime SHA-256',
    },
    revisionEmptySource: {
      id: 'assessment-formula/revision/empty-source',
      defaultMessage: 'No code in this save',
    },
    revisionSource: {
      id: 'assessment-formula/revision/source',
      defaultMessage: 'Source as saved',
    },
    revisionLabel: {
      id: 'assessment-formula/revision/label',
      defaultMessage: 'Revision',
    },
    revisionSavedAt: {
      id: 'assessment-formula/revision/saved-at',
      defaultMessage: 'Saved at',
    },
    revisionSavedBy: {
      id: 'assessment-formula/revision/saved-by',
      defaultMessage: 'Saved by',
    },
    revisionOrigin: {
      id: 'assessment-formula/revision/origin',
      defaultMessage: 'Came from',
    },
    revisionNoExamples: {
      id: 'assessment-formula/revision/no-examples',
      defaultMessage: 'No examples in this save',
    },
    revisionInfo: {
      id: 'assessment-formula/revision/info',
      defaultMessage: 'Save details',
    },
    revisionRestore: {
      id: 'assessment-formula/revision/restore',
      defaultMessage: 'Restore this draft',
    },
    lspLimited: {
      id: 'assessment-formula/editor/lsp-limited',
      defaultMessage:
        'Too many formula windows are open; language assistance returns when one closes',
    },
    fieldUnnamed: {
      id: 'assessment-formula/editor/field-unnamed',
      defaultMessage: 'Untitled field',
    },
    releaseInfoOf: {
      id: 'assessment-formula/history/release-info-of',
      defaultMessage: 'About {name}',
    },
    revisionsEmpty: {
      id: 'assessment-formula/history/revisions-empty',
      defaultMessage: 'No draft saves yet',
    },
    copyValue: {
      id: 'assessment-formula/release/copy-value',
      defaultMessage: 'Copy',
    },
    jumpToLine: {
      id: 'assessment-formula/editor/jump-to-line',
      defaultMessage: 'Go to this line',
    },
    copyAll: {
      id: 'assessment-formula/editor/copy-all',
      defaultMessage: 'Copy all',
    },
    findInSource: {
      id: 'assessment-formula/editor/find-in-source',
      defaultMessage: 'Find it in the source',
    },
    copyTechnicalDetail: {
      id: 'assessment-formula/editor/copy-technical-detail',
      defaultMessage: 'Copy the technical detail',
    },
    copied: {
      id: 'assessment-formula/release/copied',
      defaultMessage: 'Copied.',
    },
    copyFailed: {
      id: 'assessment-formula/release/copy-failed',
      defaultMessage: 'The browser did not allow copying.',
    },
    releaseDetails: {
      id: 'assessment-formula/release/details',
      defaultMessage: 'Details',
    },
    downloaded: {
      id: 'assessment-formula/editor/downloaded',
      defaultMessage: 'Downloaded {file}.',
    },
    exampleNewTitle: {
      id: 'assessment-formula/examples/new-title',
      defaultMessage: 'Add an example',
    },
    exampleAddConfirm: {
      id: 'assessment-formula/examples/add-confirm',
      defaultMessage: 'Add',
    },
    exampleNamePlaceholder: {
      id: 'assessment-formula/examples/name-placeholder',
      defaultMessage: 'For example: 20 hours at school level',
    },
    archived: {
      id: 'assessment-formula/editor/archived',
      defaultMessage: 'Formula archived.',
    },
    unarchived: {
      id: 'assessment-formula/editor/unarchived',
      defaultMessage: 'Formula restored.',
    },
    archiveTitle: {
      id: 'assessment-formula/editor/archive-title',
      defaultMessage: 'Archive this formula?',
    },
    archiveDescription: {
      id: 'assessment-formula/editor/archive-description',
      defaultMessage:
        "An archived formula can no longer be edited or published, and questions can no longer choose it. Questions that already use it keep scoring with it, and versions you shared still appear in other people's templates. You can restore it at any time.",
    },
    archiveConfirm: {
      id: 'assessment-formula/editor/archive-confirm',
      defaultMessage: 'Archive',
    },
    saveArchivedHint: {
      id: 'assessment-formula/editor/save-archived-hint',
      defaultMessage: 'The formula is archived; restore it to edit',
    },
    saveCleanHint: {
      id: 'assessment-formula/editor/save-clean-hint',
      defaultMessage: 'Nothing has changed since the last save',
    },
    saveShortcutHint: {
      id: 'assessment-formula/editor/save-shortcut-hint',
      defaultMessage: 'Ctrl+S or ⌘S also saves',
    },
    publishHint: {
      id: 'assessment-formula/publish/hint',
      defaultMessage: 'Questions can only use a formula once it is published',
    },
    publishBlankHint: {
      id: 'assessment-formula/publish/blank-hint',
      defaultMessage: 'Write the formula before publishing it',
    },
    openRelease: {
      id: 'assessment-formula/editor/open-release',
      defaultMessage: 'Open this publication',
    },
    localDraftTitle: {
      id: 'assessment-formula/editor/local-draft-title',
      defaultMessage: 'Unsaved edits were kept in this browser',
    },
    localDraftHint: {
      id: 'assessment-formula/editor/local-draft-hint',
      defaultMessage: 'Edited {when} and never saved; put them back in the editor to keep working',
    },
    localDraftTake: {
      id: 'assessment-formula/editor/local-draft-take',
      defaultMessage: 'Restore edits',
    },
    localDraftDrop: {
      id: 'assessment-formula/editor/local-draft-drop',
      defaultMessage: 'Discard',
    },
    tryRecordsTitle: {
      id: 'assessment-formula/try/records-title',
      defaultMessage: 'Recent runs',
    },
    tryRecordsClear: {
      id: 'assessment-formula/try/records-clear',
      defaultMessage: 'Clear',
    },
    tryRecordsEmpty: {
      id: 'assessment-formula/try/records-empty',
      defaultMessage: 'Runs you try show up here',
    },
    tryRecordPick: {
      id: 'assessment-formula/try/record-pick',
      defaultMessage: 'Load these inputs again',
    },
    tryRecordOld: {
      id: 'assessment-formula/try/record-old',
      defaultMessage: 'Older code',
    },
    tryRecordRefused: {
      id: 'assessment-formula/try/record-refused',
      defaultMessage: 'Refused',
    },
    tryRecordCrashed: {
      id: 'assessment-formula/try/record-crashed',
      defaultMessage: 'Crashed',
    },
    tryRecordInvalid: {
      id: 'assessment-formula/try/record-invalid',
      defaultMessage: 'Did not validate',
    },
    draftMatchesRelease: {
      id: 'assessment-formula/editor/draft-matches-release',
      defaultMessage: 'Same as the latest release',
    },
    draftUnpublished: {
      id: 'assessment-formula/editor/draft-unpublished',
      defaultMessage: 'Draft has unpublished changes',
    },
    resizeTry: {
      id: 'assessment-formula/workbench/resize-try',
      defaultMessage: 'Resize the try-run column',
    },
    checksTitle: {
      id: 'assessment-formula/editor/checks',
      defaultMessage: 'Check results',
    },
    seeProblems: {
      id: 'assessment-formula/editor/see-problems',
      defaultMessage: 'See the problems',
    },
    seeCompile: {
      id: 'assessment-formula/editor/see-compile',
      defaultMessage: 'See the compiler output',
    },
    goExamples: {
      id: 'assessment-formula/editor/go-examples',
      defaultMessage: 'Go to the examples',
    },
    compileFailedCount: {
      id: 'assessment-formula/editor/compile-failed-count',
      defaultMessage:
        'The code does not compile, {count, plural, one {# finding} other {# findings}}',
    },
    resultNotRun: {
      id: 'assessment-formula/editor/result-not-run',
      defaultMessage: 'not run yet',
    },
    resultRanAt: {
      id: 'assessment-formula/editor/result-ran-at',
      defaultMessage: 'ran at {when}',
    },
    viewingVersion: {
      id: 'assessment-formula/editor/viewing-version',
      defaultMessage: 'Looking at {name}',
    },
    latestReleaseIs: {
      id: 'assessment-formula/editor/latest-release-is',
      defaultMessage: 'Latest publication: {name}',
    },
    expectedIs: {
      id: 'assessment-formula/examples/expected-is',
      defaultMessage: 'expects {value}',
    },
    expectedNone: {
      id: 'assessment-formula/examples/expected-none',
      defaultMessage: 'no expectation',
    },
    actualNone: {
      id: 'assessment-formula/examples/actual-none',
      defaultMessage: 'not run',
    },
    actualIs: {
      id: 'assessment-formula/examples/actual-is',
      defaultMessage: 'came to {value}',
    },
    examplesCount: {
      id: 'assessment-formula/examples/count',
      defaultMessage: '{count, plural, one {# example} other {# examples}}',
    },
    inputMore: {
      id: 'assessment-formula/examples/input-more',
      defaultMessage: '{count} more',
    },
    valueYes: {
      id: 'assessment-formula/value/yes',
      defaultMessage: 'Yes',
    },
    valueNo: {
      id: 'assessment-formula/value/no',
      defaultMessage: 'No',
    },
    tryRecordsHint: {
      id: 'assessment-formula/try/records-hint',
      defaultMessage: 'Kept on this device only, the last 20',
    },
    tryRecordFailed: {
      id: 'assessment-formula/try/record-failed',
      defaultMessage: 'Failed',
    },
    versionOpen: {
      id: 'assessment-formula/history/version-open',
      defaultMessage: 'Open this version',
    },
    versionsHint: {
      id: 'assessment-formula/history/versions-hint',
      defaultMessage: 'Open one to read it, or restore it as the draft',
    },
    releaseReadOnlyHint: {
      id: 'assessment-formula/history/release-read-only-hint',
      defaultMessage: 'A publication is read-only; restore it as the draft to change it',
    },
    revisionReadOnlyHint: {
      id: 'assessment-formula/history/revision-read-only-hint',
      defaultMessage: 'A saved revision is read-only; restore it as the draft to change it',
    },
    resizePanel: {
      id: 'assessment-formula/workbench/resize-panel',
      defaultMessage: 'Resize the bottom panel',
    },
    formatCode: {
      id: 'assessment-formula/editor/format-code',
      defaultMessage: 'Format',
    },
    formatCodeHint: {
      id: 'assessment-formula/editor/format-code-hint',
      defaultMessage: 'Format the whole source, or press Shift+Alt+F',
    },
    formatCodeWaiting: {
      id: 'assessment-formula/editor/format-code-waiting',
      defaultMessage: 'Formatting waits for language assistance to connect',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof formulaErrors>>()({
    ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND: {
      id: 'assessment-formula/error/function-not-found',
      defaultMessage: 'The formula could not be found.',
    },
    ASSESSMENT_FORMULA_SHARING_CONFLICT: {
      id: 'assessment-formula/error/sharing-conflict',
      defaultMessage: 'The sharing changed while you were editing it. Reload and try again.',
    },
    ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND: {
      id: 'assessment-formula/error/template-not-found',
      defaultMessage: 'That template could not be found.',
    },
    ASSESSMENT_FORMULA_VERSION_NOT_FOUND: {
      id: 'assessment-formula/error/version-not-found',
      defaultMessage: 'That version could not be found.',
    },
    ASSESSMENT_FORMULA_DRAFT_REVISION_NOT_FOUND: {
      id: 'assessment-formula/error/draft-revision-not-found',
      defaultMessage: 'That saved draft could not be found.',
    },
    ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN: {
      id: 'assessment-formula/error/release-name-taken',
      defaultMessage: 'Another publication of this formula already has that name. Choose another.',
    },
    ASSESSMENT_FORMULA_VERSION_UNRUNNABLE: {
      id: 'assessment-formula/error/version-unrunnable',
      defaultMessage: 'This version cannot run in the current environment.',
    },
    ASSESSMENT_FORMULA_FUNCTION_ARCHIVED: {
      id: 'assessment-formula/error/function-archived',
      defaultMessage: 'The formula is archived. Restore it before editing.',
    },
    ASSESSMENT_FORMULA_FUNCTION_PUBLISHED: {
      id: 'assessment-formula/error/function-published',
      defaultMessage: 'The formula has published versions, so it can be archived but not deleted.',
    },
    ASSESSMENT_FORMULA_DRAFT_CONFLICT: {
      id: 'assessment-formula/error/draft-conflict',
      defaultMessage: 'The draft changed elsewhere. Reload and apply your edits again.',
    },
    ASSESSMENT_FORMULA_SOURCE_TOO_LARGE: {
      id: 'assessment-formula/error/source-too-large',
      defaultMessage: 'The source is too large to save.',
    },
    ASSESSMENT_FORMULA_SOURCE_REFUSED: {
      id: 'assessment-formula/error/source-refused',
      defaultMessage: "A formula may only import '@qualy/formula'.",
    },
    ASSESSMENT_FORMULA_TYPECHECK_FAILED: {
      id: 'assessment-formula/error/typecheck-failed',
      defaultMessage: 'The source does not compile; see the compile results.',
    },
    ASSESSMENT_FORMULA_CONTRACT_INVALID: {
      id: 'assessment-formula/error/contract-invalid',
      defaultMessage: 'The input and output schemas must stay within the supported kinds.',
    },
    ASSESSMENT_FORMULA_BUNDLE_FAILED: {
      id: 'assessment-formula/error/bundle-failed',
      defaultMessage: 'The source could not be packaged; see the compile results.',
    },
    ASSESSMENT_FORMULA_EXECUTION_LIMIT_EXCEEDED: {
      id: 'assessment-formula/error/execution-limit',
      defaultMessage: 'Compiling or extracting the contract took more than the allowed resources.',
    },
    ASSESSMENT_FORMULA_TEST_FAILED: {
      id: 'assessment-formula/error/test-failed',
      defaultMessage: 'Publishing needs every example to pass, and at least one example.',
    },
    ASSESSMENT_FORMULA_COMPILE_UNAVAILABLE: {
      id: 'assessment-formula/error/compile-unavailable',
      defaultMessage: 'The compile service is unavailable. Try again shortly.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const formulaMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
