import { Schema } from 'effect'

// The identity failures.
//
// These classes are the only declaration of them: the code, the status and the
// fields all live here, and the client's translation table is typed from this
// module, so a code it cannot raise cannot be translated. There used to be a
// second table saying the same things in another schema language, for the contract layer this
// replaced, and it had drifted by the time it was deleted.

export class UserTypeNotFound extends Schema.TaggedError<UserTypeNotFound>()(
  'USER_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserTypeNotFound' },
) {}

export class UserTypeIsSystem extends Schema.TaggedError<UserTypeIsSystem>()(
  'USER_TYPE_IS_SYSTEM',
  {},
  { httpApiStatus: 409, identifier: 'UserTypeIsSystem' },
) {}

/** the count says how many people must be moved before the type can go */
export class UserTypeInUse extends Schema.TaggedError<UserTypeInUse>()(
  'USER_TYPE_IN_USE',
  { userCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypeInUse' },
) {}

/**
 * The type changed since the caller read it.
 *
 * Carrying the current version lets a client re-read and retry rather than
 * guess, which is why every set replacement takes an expected version.
 */
export class UserTypeVersionConflict extends Schema.TaggedError<UserTypeVersionConflict>()(
  'USER_TYPE_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypeVersionConflict' },
) {}

/**
 * The tenant's recovery account keeps its own way in.
 *
 * The system account always signs in through the platform's password door,
 * with its email and a password; a change to that door (taking it out of
 * service, narrowing who it admits) that would leave the account unable to
 * come in is refused. rbac's "an administrator remains" cannot stand in for
 * this: it counts holders, not whether any door lets them through.
 */
export class RecoveryChannelRequired extends Schema.TaggedError<RecoveryChannelRequired>()(
  'RECOVERY_CHANNEL_REQUIRED',
  {},
  { httpApiStatus: 409, identifier: 'RecoveryChannelRequired' },
) {}

export class ProviderNotFound extends Schema.TaggedError<ProviderNotFound>()(
  'AUTH_PROVIDER_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AuthProviderNotFound' },
) {}

export class ProviderVersionConflict extends Schema.TaggedError<ProviderVersionConflict>()(
  'AUTH_PROVIDER_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'AuthProviderVersionConflict' },
) {}

export class UserTypeConflict extends Schema.TaggedError<UserTypeConflict>()(
  'USER_TYPE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'UserTypeConflict' },
) {}

/** what a user-type write can be refused by once the statement reaches the database */
export const userTypeConstraints: Record<string, () => UserTypeConflict> = {
  uq_user_types_tenant_code: () => new UserTypeConflict(),
  uq_user_types_tenant_name: () => new UserTypeConflict(),
}

/** deleting this type would leave these roles admitting nobody */
export class UserTypeLastForRole extends Schema.TaggedError<UserTypeLastForRole>()(
  'USER_TYPE_LAST_FOR_ROLE',
  { roleCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypeLastForRole' },
) {}

export class UserTypeOrgTypeNotFound extends Schema.TaggedError<UserTypeOrgTypeNotFound>()(
  'USER_TYPE_ORG_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserTypeOrgTypeNotFound' },
) {}

/** the policy as written would leave these people standing illegally */
export class UserTypePlacementInUse extends Schema.TaggedError<UserTypePlacementInUse>()(
  'USER_TYPE_PLACEMENT_IN_USE',
  { userCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypePlacementInUse' },
) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  'USER_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserNotFound' },
) {}

export class UserTypeDisabled extends Schema.TaggedError<UserTypeDisabled>()(
  'USER_TYPE_DISABLED',
  {},
  { httpApiStatus: 409, identifier: 'UserTypeDisabled' },
) {}

export class UserPlacementNotFound extends Schema.TaggedError<UserPlacementNotFound>()(
  'USER_PLACEMENT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserPlacementNotFound' },
) {}

export class PlacementNotAllowed extends Schema.TaggedError<PlacementNotAllowed>()(
  'USER_TYPE_PLACEMENT_NOT_ALLOWED',
  {},
  { httpApiStatus: 409, identifier: 'UserTypePlacementNotAllowed' },
) {}

/**
 * The recovery account is frozen against the ordinary identity api.
 *
 * Protecting only the type it holds stopped an ordinary person being promoted
 * into it, but not the reverse: retyping the recovery account out of its own
 * type would have been allowed.
 */
export class SystemAccountProtected extends Schema.TaggedError<SystemAccountProtected>()(
  'SYSTEM_ACCOUNT_PROTECTED',
  {},
  { httpApiStatus: 409, identifier: 'SystemAccountProtected' },
) {}

/** the row moved since it was read; the caller re-reads and decides again */
export class UserVersionConflict extends Schema.TaggedError<UserVersionConflict>()(
  'USER_VERSION_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'UserVersionConflict' },
) {}

/** grants the person holds that their new type would not be eligible for */
export class GrantIncompatible extends Schema.TaggedError<GrantIncompatible>()(
  'GRANT_INCOMPATIBLE',
  { grantCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'GrantIncompatible' },
) {}

/**
 * A business number already used in this tenant.
 *
 * Reached through the unique index: no service guard checks it and the insert
 * has no ON CONFLICT, so without the translation a duplicate answered 500.
 * `fk_users_user_type` is deliberately absent - requireType pre-checks inside
 * the transaction, so it cannot be reached.
 */
export class UserConflict extends Schema.TaggedError<UserConflict>()(
  'USER_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'UserConflict' },
) {}

export const userConstraints: Record<string, () => UserPlacementNotFound> = {
  fk_users_primary_org_node: () => new UserPlacementNotFound(),
}

/**
 * The extra index only the two statements that write a business number can hit.
 *
 * Kept apart from the shared wrapper's map so a placement or status change does
 * not have to declare a conflict it cannot produce.
 */
export const businessNoConstraints: Record<string, () => UserConflict> = {
  uq_users_tenant_business_no: () => new UserConflict(),
}

/**
 * An email address another living person in this tenant already has.
 *
 * Its own code rather than `USER_CONFLICT`, because the screen has to say
 * which field to change; whose address it is stays unsaid.
 */
export class UserEmailConflict extends Schema.TaggedError<UserEmailConflict>()(
  'USER_EMAIL_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'UserEmailConflict' },
) {}

/** the index only the statements that write an email can reach */
export const emailConstraints: Record<string, () => UserEmailConflict> = {
  uq_users_tenant_email_live: () => new UserEmailConflict(),
}

/**
 * This kind of door takes nothing written on a person's behalf.
 *
 * Either only the person can bind it (through the door's own flow), or it
 * goes by a fact the person already has and keeps nothing. The screen offers
 * the control only where the server said it may, so this is what a stale
 * screen hears.
 */
export class AuthBindingUnsupported extends Schema.TaggedError<AuthBindingUnsupported>()(
  'AUTH_BINDING_UNSUPPORTED',
  {},
  { httpApiStatus: 409, identifier: 'AuthBindingUnsupported' },
) {}

/** the door does not admit this person's user type, so a binding could never be used */
export class AuthBindingAudienceExcluded extends Schema.TaggedError<AuthBindingAudienceExcluded>()(
  'AUTH_BINDING_AUDIENCE_EXCLUDED',
  {},
  { httpApiStatus: 409, identifier: 'AuthBindingAudienceExcluded' },
) {}

/** what was typed cannot be a credential of this kind */
export class AuthBindingCredentialInvalid extends Schema.TaggedError<AuthBindingCredentialInvalid>()(
  'AUTH_BINDING_CREDENTIAL_INVALID',
  {},
  { httpApiStatus: 422, identifier: 'AuthBindingCredentialInvalid' },
) {}

/**
 * The door finds people by a field this person has not got yet.
 *
 * A password door signs in by the person's email: a password set for
 * somebody without one could never be used, so it is refused and the screen
 * says which field to fill first.
 */
export class AuthBindingUserFieldMissing extends Schema.TaggedError<AuthBindingUserFieldMissing>()(
  'AUTH_BINDING_USER_FIELD_MISSING',
  { field: Schema.Literals(['email', 'businessNo']) },
  { httpApiStatus: 409, identifier: 'AuthBindingUserFieldMissing' },
) {}

/** there is no live binding of this person to that door to withdraw */
export class AuthBindingNotFound extends Schema.TaggedError<AuthBindingNotFound>()(
  'AUTH_BINDING_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AuthBindingNotFound' },
) {}

/** an address another entrance of this tenant already answers at */
export class ProviderConflict extends Schema.TaggedError<ProviderConflict>()(
  'AUTH_PROVIDER_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'AuthProviderConflict' },
) {}

/** no installed driver makes entrances of this kind, or it does not let them be added */
export class ProviderKindUnavailable extends Schema.TaggedError<ProviderKindUnavailable>()(
  'AUTH_PROVIDER_KIND_UNAVAILABLE',
  {},
  { httpApiStatus: 422, identifier: 'AuthProviderKindUnavailable' },
) {}

/** what was typed for this kind of entrance cannot be one; `field` says which box */
export class ProviderConfigInvalid extends Schema.TaggedError<ProviderConfigInvalid>()(
  'AUTH_PROVIDER_CONFIG_INVALID',
  { field: Schema.String },
  { httpApiStatus: 422, identifier: 'AuthProviderConfigInvalid' },
) {}

/** what an entrance still lacks before it can be put in service */
export const readinessGapSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('driver') }),
  Schema.Struct({ kind: Schema.Literal('field'), key: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('public-origin') }),
])

/**
 * The entrance cannot be in service as it would stand.
 *
 * Raised by putting an unfinished entrance in service, and by a save or a
 * cleared secret that would leave one in service unfinished. `missing` names
 * what is lacking so the screen can point at the boxes.
 */
export class ProviderConfigIncomplete extends Schema.TaggedError<ProviderConfigIncomplete>()(
  'AUTH_PROVIDER_CONFIG_INCOMPLETE',
  { missing: Schema.Array(readinessGapSchema) },
  { httpApiStatus: 409, identifier: 'AuthProviderConfigIncomplete' },
) {}

/** the platform's own entrance is administered, never deleted */
export class ProviderIsSystem extends Schema.TaggedError<ProviderIsSystem>()(
  'AUTH_PROVIDER_IS_SYSTEM',
  {},
  { httpApiStatus: 409, identifier: 'AuthProviderIsSystem' },
) {}

/**
 * The setting that says whose accounts the entrance speaks for, once accounts
 * have been bound through it.
 *
 * Changing it would leave every stored subject naming an account at another
 * provider. A binding since withdrawn counts: its subject is still in the
 * history, and a sign-in record points at it.
 */
export class ProviderIdentityNamespaceInUse extends Schema.TaggedError<ProviderIdentityNamespaceInUse>()(
  'AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE',
  { field: Schema.String },
  { httpApiStatus: 409, identifier: 'AuthProviderIdentityNamespaceInUse' },
) {}

export const providerConstraints: Record<string, () => ProviderConflict> = {
  uq_auth_providers_tenant_code: () => new ProviderConflict(),
}
