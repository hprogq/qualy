import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as formulaErrors from '../server/errors.ts'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof formulaErrors>>()({
  ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND: m.error_functionNotFound,
  ASSESSMENT_FORMULA_SHARING_CONFLICT: m.error_sharingConflict,
  ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND: m.error_templateNotFound,
  ASSESSMENT_FORMULA_VERSION_NOT_FOUND: m.error_versionNotFound,
  ASSESSMENT_FORMULA_DRAFT_REVISION_NOT_FOUND: m.error_draftRevisionNotFound,
  ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN: m.error_releaseNameTaken,
  ASSESSMENT_FORMULA_VERSION_UNCHANGED: {
    message: m.error_versionUnchanged,
    values: (data) => ({ versionNo: data.versionNo }),
  },
  ASSESSMENT_FORMULA_DETAILS_CONFLICT: m.error_detailsConflict,
  ASSESSMENT_FORMULA_VERSION_INFO_CONFLICT: m.error_versionInfoConflict,
  ASSESSMENT_FORMULA_VERSION_UNRUNNABLE: m.error_versionUnrunnable,
  ASSESSMENT_FORMULA_FUNCTION_ARCHIVED: m.error_functionArchived,
  ASSESSMENT_FORMULA_FUNCTION_PUBLISHED: m.error_functionPublished,
  ASSESSMENT_FORMULA_DRAFT_CONFLICT: m.error_draftConflict,
  ASSESSMENT_FORMULA_SOURCE_TOO_LARGE: m.error_sourceTooLarge,
  ASSESSMENT_FORMULA_TESTS_TOO_LARGE: m.error_testsTooLarge,
  ASSESSMENT_FORMULA_AUTHORING_BUSY: m.error_authoringBusy,
  ASSESSMENT_FORMULA_SOURCE_REFUSED: m.error_sourceRefused,
  ASSESSMENT_FORMULA_TYPECHECK_FAILED: m.error_typecheckFailed,
  ASSESSMENT_FORMULA_CONTRACT_INVALID: m.error_contractInvalid,
  ASSESSMENT_FORMULA_BUNDLE_FAILED: m.error_bundleFailed,
  ASSESSMENT_FORMULA_EXECUTION_LIMIT_EXCEEDED: m.error_executionLimit,
  ASSESSMENT_FORMULA_TEST_FAILED: m.error_testFailed,
  ASSESSMENT_FORMULA_COMPILE_UNAVAILABLE: m.error_compileUnavailable,
}).registry
