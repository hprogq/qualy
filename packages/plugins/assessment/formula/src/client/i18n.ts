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
    templatesCopiedFrom: {
      id: 'assessment-formula/templates/copied-from',
      defaultMessage: 'Started from “{name}”',
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
    trySaveExpecting: {
      id: 'assessment-formula/editor/try-save-expecting',
      defaultMessage: 'Save expecting {value}',
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
    contractIssuesTitle: {
      id: 'assessment-formula/report/contract',
      defaultMessage: 'Contract findings',
    },
    sharingPrivate: {
      id: 'assessment-formula/sharing/private',
      defaultMessage: 'Not shared',
    },
    sharingAdd: {
      id: 'assessment-formula/sharing/add',
      defaultMessage: 'Share with a unit',
    },
    sharingRemove: {
      id: 'assessment-formula/sharing/remove',
      defaultMessage: 'Stop sharing with {name}',
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
    examplesTotal: {
      id: 'assessment-formula/examples/total',
      defaultMessage:
        '{count, plural, one {# example} other {# examples}}; all must pass to publish',
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
      defaultMessage: 'Latest: {name}',
    },
    phoneSourceTab: {
      id: 'assessment-formula/editor/phone-source-tab',
      defaultMessage: 'Source',
    },
    publishOpen: {
      id: 'assessment-formula/editor/publish-open',
      defaultMessage: 'Publish…',
    },
    publishVersionMenu: {
      id: 'assessment-formula/editor/publish-version-menu',
      defaultMessage: 'Publish a version…',
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
      defaultMessage: 'History',
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
    releaseInfo: {
      id: 'assessment-formula/release/info',
      defaultMessage: 'Publication',
    },
    releaseOrdinalLabel: {
      id: 'assessment-formula/release/ordinal-label',
      defaultMessage: 'Order',
    },
    releasePublisher: {
      id: 'assessment-formula/release/publisher',
      defaultMessage: 'Published by',
    },
    releaseSharing: {
      id: 'assessment-formula/release/sharing',
      defaultMessage: 'Sharing',
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
    releaseReadOnlyBadge: {
      id: 'assessment-formula/release/read-only-badge',
      defaultMessage: 'Publication · read-only',
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
    revisionReadOnlyBadge: {
      id: 'assessment-formula/revision/read-only-badge',
      defaultMessage: 'Draft save · read-only',
    },
    revisionRestore: {
      id: 'assessment-formula/revision/restore',
      defaultMessage: 'Restore this draft',
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
    ASSESSMENT_FORMULA_FUNCTION_ARCHIVED: {
      id: 'assessment-formula/error/function-archived',
      defaultMessage: 'The formula is archived. Restore it before editing.',
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
      defaultMessage: 'Publishing is temporarily unavailable. Try again shortly.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const formulaMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
