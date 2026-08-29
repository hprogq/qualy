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
    'permission.assessment.formula.manage': {
      id: 'assessment-formula/permission/manage',
      defaultMessage: 'Manage scoring formulas',
    },
    'permission-hint.assessment.formula.manage': {
      id: 'assessment-formula/permission-hint/manage',
      defaultMessage: 'Write, test, publish and archive scoring formulas owned by this node.',
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
    'audit.archive': {
      id: 'assessment-formula/audit/archive',
      defaultMessage: 'Archive scoring formula',
    },
    navigation: {
      id: 'assessment-formula/navigation/formulas',
      defaultMessage: 'Scoring formulas',
    },
    listTitle: {
      id: 'assessment-formula/list/title',
      defaultMessage: 'Scoring formulas',
    },
    listHint: {
      id: 'assessment-formula/list/hint',
      defaultMessage: 'Reusable scoring functions; publish a version before binding it to items.',
    },
    emptyList: {
      id: 'assessment-formula/list/empty',
      defaultMessage: 'No formulas yet.',
    },
    newFormula: {
      id: 'assessment-formula/list/new',
      defaultMessage: 'New formula',
    },
    nameLabel: {
      id: 'assessment-formula/field/name',
      defaultMessage: 'Name',
    },
    ownerLabel: {
      id: 'assessment-formula/field/owner',
      defaultMessage: 'Owning unit',
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
    versionNone: {
      id: 'assessment-formula/list/version-none',
      defaultMessage: 'Draft only',
    },
    versionNumber: {
      id: 'assessment-formula/version/number',
      defaultMessage: 'v{number}',
    },
    updatedColumn: {
      id: 'assessment-formula/list/updated-column',
      defaultMessage: 'Updated',
    },
    sourceLabel: {
      id: 'assessment-formula/editor/source',
      defaultMessage: 'Formula source',
    },
    testsTitle: {
      id: 'assessment-formula/editor/tests',
      defaultMessage: 'Examples',
    },
    testsHint: {
      id: 'assessment-formula/editor/tests-hint',
      defaultMessage: 'Publishing runs every example; at least one is required.',
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
      defaultMessage: 'Save draft',
    },
    saved: {
      id: 'assessment-formula/editor/saved',
      defaultMessage: 'Draft saved.',
    },
    publish: {
      id: 'assessment-formula/editor/publish',
      defaultMessage: 'Publish version',
    },
    published: {
      id: 'assessment-formula/editor/published',
      defaultMessage: 'Published v{number}.',
    },
    archive: {
      id: 'assessment-formula/editor/archive',
      defaultMessage: 'Archive',
    },
    restore: {
      id: 'assessment-formula/editor/restore',
      defaultMessage: 'Restore',
    },
    diagnosticsTitle: {
      id: 'assessment-formula/report/diagnostics',
      defaultMessage: 'Compiler findings',
    },
    reportTitle: {
      id: 'assessment-formula/report/tests',
      defaultMessage: 'Example results',
    },
    reportPassed: {
      id: 'assessment-formula/report/passed',
      defaultMessage: 'Passed',
    },
    reportFailed: {
      id: 'assessment-formula/report/failed',
      defaultMessage: 'Failed',
    },
    reportActual: {
      id: 'assessment-formula/report/actual',
      defaultMessage: 'Got {amount}',
    },
    contractIssuesTitle: {
      id: 'assessment-formula/report/contract',
      defaultMessage: 'Contract findings',
    },
    versionsTitle: {
      id: 'assessment-formula/editor/versions',
      defaultMessage: 'Published versions',
    },
    versionsEmpty: {
      id: 'assessment-formula/editor/versions-empty',
      defaultMessage: 'Nothing published yet.',
    },
    loadFailed: {
      id: 'assessment-formula/editor/load-failed',
      defaultMessage: 'The formula could not be loaded.',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof formulaErrors>>()({
    ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND: {
      id: 'assessment-formula/error/function-not-found',
      defaultMessage: 'The formula could not be found.',
    },
    ASSESSMENT_FORMULA_VERSION_NOT_FOUND: {
      id: 'assessment-formula/error/version-not-found',
      defaultMessage: 'That version could not be found.',
    },
    ASSESSMENT_FORMULA_OWNER_NODE_INVALID: {
      id: 'assessment-formula/error/owner-node-invalid',
      defaultMessage: 'Choose an organizational unit for the formula.',
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
      defaultMessage: 'The source does not compile. Review the compiler findings below.',
    },
    ASSESSMENT_FORMULA_CONTRACT_INVALID: {
      id: 'assessment-formula/error/contract-invalid',
      defaultMessage: 'The input and output schemas must stay within the supported kinds.',
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
