import {
  defineErrorTranslations,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as assessmentErrors from '../server/errors.ts'

// Everything the assessment plugin says to a human. Page copy arrives with
// the admin screens; for now this carries a translation for every error the
// contract can raise, which the error-code gate demands the moment a code is
// declared. The descriptor declares this module (Ui.i18n) once there is a
// page to mount - the codes are translated either way.

const i18n = definePluginMessages({
  namespace: 'assessment',
  messages: {},
  errors: defineErrorTranslations<ErrorsByCode<typeof assessmentErrors>>()({
    ASSESSMENT_BATCH_NOT_FOUND: {
      id: 'assessment/error/batch-not-found',
      defaultMessage: 'Assessment batch not found.',
    },
    ASSESSMENT_PHASE_NOT_FOUND: {
      id: 'assessment/error/phase-not-found',
      defaultMessage: 'That phase does not exist in this batch.',
    },
    ASSESSMENT_TEMPLATE_NOT_FOUND: {
      id: 'assessment/error/template-not-found',
      defaultMessage: 'Phase template not found.',
    },
    ASSESSMENT_TEMPLATE_CONFLICT: {
      id: 'assessment/error/template-conflict',
      defaultMessage: 'A phase template with that name already exists.',
    },
    ASSESSMENT_BATCH_READ_ONLY: {
      id: 'assessment/error/batch-read-only',
      defaultMessage: 'This batch is archived and can no longer be changed.',
    },
    ASSESSMENT_BATCH_SCOPE_LOCKED: {
      id: 'assessment/error/batch-scope-locked',
      defaultMessage: 'The batch scope cannot change once the batch is active.',
    },
    ASSESSMENT_BATCH_STATUS_INVALID: {
      id: 'assessment/error/batch-status-invalid',
      defaultMessage: 'The batch cannot move to that status from where it is.',
    },
    ASSESSMENT_BATCH_NO_USER_TYPES: {
      id: 'assessment/error/batch-no-user-types',
      defaultMessage: 'Select at least one user type before activating the batch.',
    },
    ASSESSMENT_BATCH_REFERENCE_INVALID: {
      id: 'assessment/error/batch-reference-invalid',
      defaultMessage: 'The scope node or a selected user type does not exist.',
    },
    ASSESSMENT_PLAN_INVALID: {
      id: 'assessment/error/plan-invalid',
      defaultMessage: 'The phase plan change was refused; review the reported problems.',
    },
    ASSESSMENT_ADVANCE_INVALID: {
      id: 'assessment/error/advance-invalid',
      defaultMessage: 'The phase cannot be advanced that way.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const assessmentMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
