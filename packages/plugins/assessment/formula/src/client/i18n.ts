import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as formulaErrors from '../server/errors.ts'
import type { Message } from '@qualy/i18n-contract'
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

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'assessment-formula/audit/archive': m.audit_archive,
  'assessment-formula/audit/create': m.audit_create,
  'assessment-formula/audit/delete': m.audit_delete,
  'assessment-formula/audit/details-change': m.audit_detailsChange,
  'assessment-formula/audit/draft-update': m.audit_draftUpdate,
  'assessment-formula/audit/restore': m.audit_restore,
  'assessment-formula/audit/sharing-change': m.audit_sharingChange,
  'assessment-formula/audit/template-copy': m.audit_templateCopy,
  'assessment-formula/audit/version-info-change': m.audit_versionInfoChange,
  'assessment-formula/binding/calculator': m.binding_calculator,
  'assessment-formula/list/title': m.list_title,
  'assessment-formula/nav-group/library': m.navGroup_library,
  'assessment-formula/navigation/formulas': m.navigation_formulas,
  'assessment-formula/navigation/templates': m.navigation_templates,
  'assessment-formula/permission-group/assessment': m.permissionGroup_assessment,
  'assessment-formula/permission/author': m.permission_author,
  'assessment-formula/permission/share': m.permission_share,
  'assessment-formula/templates/title': m.templates_title,
}
