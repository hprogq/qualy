import {
  defineErrorTranslations,
  selectKey,
  mergeErrorTranslations,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as rbacErrors from '../server/errors.ts'
import type * as invariantErrors from '@qualy/rbac-contract/effect'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = mergeErrorTranslations(
  defineErrorTranslations<ErrorsByCode<typeof rbacErrors>>()({
    ROLE_NOT_FOUND: m.error_roleNotFound,
    ROLE_CONFLICT: m.error_roleConflict,
    ROLE_IS_SYSTEM: m.error_roleIsSystem,
    ROLE_HAS_GRANT_HISTORY: m.error_roleHasGrantHistory,
    ROLE_NEEDS_ELIGIBILITY: m.error_roleNeedsEligibility,
    ROLE_ANCHOR_MISMATCH: m.error_roleAnchorMismatch,
    GRANT_STRANDED: {
      message: m.error_grantStranded,
      values: (data) => ({ assignmentCount: data.grantCount }),
    },
    GRANT_NOT_ELIGIBLE: {
      message: m.error_grantNotEligible,
      values: (data) => ({ reason: selectKey(data.reason) }),
    },
    GRANT_NOT_FOUND: m.error_grantNotFound,
    TENANT_ADMIN_REQUIRED: m.error_tenantAdminRequired,
    ACCESS_TARGET_REQUIRED: m.error_accessTargetRequired,
    GRANT_EXISTS: m.error_grantExists,
    GRANT_RULE_REFUSED: m.error_grantRuleRefused,
    GRANT_USER_NOT_FOUND: m.error_grantUserNotFound,
    GRANT_NODE_NOT_FOUND: m.error_grantNodeNotFound,
    ROLE_VERSION_CONFLICT: m.error_roleVersionConflict,
    ROLE_NOT_DRAFT: m.error_roleNotDraft,
    ROLE_INCOMPLETE: {
      message: m.error_roleIncomplete,
      values: (data) => ({ missing: data.missing.join(', ') }),
    },
    ROLE_TARGET_MISMATCH: {
      message: m.error_roleTargetMismatch,
      values: (data) => ({ count: data.permissions.length }),
    },
    PERMISSION_NOT_FOUND: {
      message: m.error_permissionNotFound,
      values: (data) => ({ count: data.permissions.length }),
    },
    ROLE_ESCALATION_REFUSED: {
      message: m.error_roleEscalationRefused,
      values: (data) => ({ count: data.permissions.length }),
    },
    GRANT_ESCALATION_REFUSED: m.error_grantEscalationRefused,
    ROLE_APPOINTMENT_INVALID: {
      message: m.error_roleAppointmentInvalid,
      values: (data) => ({ reason: data.reason }),
    },
    GRANT_RESOURCE_BOUND: {
      message: m.error_grantResourceBound,
      values: (data) => ({ namespace: data.namespace, type: data.type }),
    },
    ROLE_USER_TYPE_NOT_FOUND: m.error_roleUserTypeNotFound,
    ROLE_ORG_TYPE_NOT_FOUND: m.error_roleOrgTypeNotFound,
  }),
  // the shared lockout invariant: auth raises it too, and one code carries
  // one translation, so the plugin that owns the rule owns the wording
  // ACCESS_DENIED comes out of the same contract but belongs to nobody in
  // particular: every plugin's authorization raises it, so the shell
  // translates it and this table declares only the invariant rbac owns
  defineErrorTranslations<Omit<ErrorsByCode<typeof invariantErrors>, 'ACCESS_DENIED'>>()({
    LAST_ADMINISTRATOR: m.error_lastAdministrator,
  }),
).registry
