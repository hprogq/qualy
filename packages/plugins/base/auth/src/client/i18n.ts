import { defineErrorTranslations, selectKey, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as authErrors from '../server/errors.ts'
import type * as signInFailures from '@qualy/auth-contract/sign-in-failure'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<
  ErrorsByCode<typeof authErrors & typeof signInFailures>
>()({
  // what the sign-in page says when a redirect sign-in comes back without one
  AUTH_METHOD_UNAVAILABLE: m.error_methodUnavailable,
  AUTH_FLOW_REJECTED: m.error_flowRejected,
  AUTH_EXTERNAL_ACCOUNT_UNBOUND: m.error_externalAccountUnbound,
  AUTH_BINDING_SUBJECT_TAKEN: m.error_bindingSubjectTaken,
  AUTH_BINDING_ALREADY_BOUND: m.error_bindingAlreadyBound,
  AUTH_PERSON_NOT_FOUND: m.error_personNotFound,
  USER_TYPE_NOT_FOUND: m.error_userTypeNotFound,
  USER_TYPE_CONFLICT: m.error_userTypeConflict,
  USER_TYPE_IS_SYSTEM: m.error_userTypeIsSystem,
  USER_TYPE_IN_USE: {
    message: m.error_userTypeInUse,
    values: (data) => ({ userCount: data.userCount }),
  },
  USER_TYPE_LAST_FOR_ROLE: {
    message: m.error_userTypeLastForRole,
    values: (data) => ({ roleCount: data.roleCount }),
  },
  USER_TYPE_REFERENCED: m.error_userTypeReferenced,
  RECOVERY_CHANNEL_REQUIRED: m.error_recoveryChannelRequired,
  USER_TYPE_PLACEMENT_NOT_ALLOWED: m.error_userTypePlacementNotAllowed,
  USER_TYPE_PLACEMENT_IN_USE: {
    message: m.error_userTypePlacementInUse,
    values: (data) => ({ userCount: data.userCount }),
  },
  USER_TYPE_VERSION_CONFLICT: m.error_userTypeVersionConflict,
  AUTH_PROVIDER_NOT_FOUND: m.error_providerNotFound,
  AUTH_PROVIDER_ARRANGEMENT_INVALID: m.error_providerArrangementInvalid,
  AUTH_PROVIDER_ICON_INVALID: {
    message: m.error_providerIconInvalid,
    values: (data) => ({ reason: selectKey(data.reason) }),
  },
  AUTH_LOGIN_METHOD_ICON_UNAVAILABLE: m.error_loginMethodIconUnavailable,
  AUTH_PROVIDER_VERSION_CONFLICT: m.error_providerVersionConflict,
  USER_TYPE_ORG_TYPE_NOT_FOUND: m.error_userTypeOrgTypeNotFound,
  USER_TYPE_DISABLED: m.error_userTypeDisabled,
  USER_NOT_FOUND: m.error_userNotFound,
  USER_CONFLICT: m.error_userConflict,
  USER_PLACEMENT_NOT_FOUND: m.error_userPlacementNotFound,
  GRANT_INCOMPATIBLE: {
    message: m.error_grantIncompatible,
    values: (data) => ({ grantCount: data.grantCount }),
  },
  SYSTEM_ACCOUNT_PROTECTED: m.error_systemAccountProtected,
  USER_VERSION_CONFLICT: m.error_userVersionConflict,
  USER_EMAIL_CONFLICT: m.error_userEmailConflict,
  AUTH_PROVIDER_CONFLICT: m.error_providerConflict,
  AUTH_PROVIDER_KIND_UNAVAILABLE: m.error_providerKindUnavailable,
  AUTH_PROVIDER_CONFIG_INVALID: m.error_providerConfigInvalid,
  AUTH_PROVIDER_CONFIG_INCOMPLETE: m.error_providerConfigIncomplete,
  AUTH_PROVIDER_IS_SYSTEM: m.error_providerIsSystem,
  AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE: m.error_providerIdentityNamespaceInUse,
  AUTH_BINDING_UNSUPPORTED: m.error_bindingUnsupported,
  AUTH_BINDING_AUDIENCE_EXCLUDED: m.error_bindingAudienceExcluded,
  AUTH_BINDING_CREDENTIAL_INVALID: m.error_bindingCredentialInvalid,
  AUTH_BINDING_USER_FIELD_MISSING: {
    message: m.error_bindingUserFieldMissing,
    values: (data) => ({ field: data.field }),
  },
  AUTH_CHALLENGE_INVALID: m.error_challengeInvalid,
  AUTH_PASSWORD_INCORRECT: m.error_passwordIncorrect,
  AUTH_EMAIL_UNVERIFIED: m.error_emailUnverified,
  AUTH_EMAIL_MISSING: m.error_emailMissing,
  AUTH_PASSWORD_UNAVAILABLE: m.error_passwordUnavailable,
  AUTH_SESSION_NOT_FOUND: m.error_sessionNotFound,
  AUTH_MAIL_NOT_SENT: m.error_mailNotSent,
  AUTH_LAST_WAY_IN: m.error_lastWayIn,
  AUTH_DEMO_ACCOUNT_LOCKED: m.error_demoAccountLocked,
  AUTH_BINDING_NOT_FOUND: m.error_bindingNotFound,
  AUTH_REAUTHENTICATION_REQUIRED: m.error_reauthenticationRequired,
  AUTH_REAUTHENTICATION_CODE_INVALID: m.error_reauthenticationCodeInvalid,
  AUTH_REAUTHENTICATION_METHOD_UNAVAILABLE: m.error_reauthenticationMethodUnavailable,
}).registry
