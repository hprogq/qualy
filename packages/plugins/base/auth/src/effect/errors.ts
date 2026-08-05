import { Schema } from 'effect'

// The identity failures, with the codes the client already translates.
//
// Every code and status here matches src/iam/errors.ts, which the oRPC side
// declares and the client catalog is keyed by; the parity gate checks that
// rather than trusting it.

export class UserTypeNotFound extends Schema.TaggedErrorClass<UserTypeNotFound>()(
  'USER_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserTypeNotFound' },
) {}

export class UserTypeIsSystem extends Schema.TaggedErrorClass<UserTypeIsSystem>()(
  'USER_TYPE_IS_SYSTEM',
  {},
  { httpApiStatus: 409, identifier: 'UserTypeIsSystem' },
) {}

/** the count says how many people must be moved before the type can go */
export class UserTypeInUse extends Schema.TaggedErrorClass<UserTypeInUse>()(
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
export class UserTypeVersionConflict extends Schema.TaggedErrorClass<UserTypeVersionConflict>()(
  'USER_TYPE_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypeVersionConflict' },
) {}

/**
 * The administrator type keeps password sign-in.
 *
 * It is how a tenant recovers itself, and the generic survivor invariant
 * cannot stand in for this one: that check passes on any open channel,
 * including an sso channel with no provider behind it.
 */
export class RecoveryChannelRequired extends Schema.TaggedErrorClass<RecoveryChannelRequired>()(
  'RECOVERY_CHANNEL_REQUIRED',
  {},
  { httpApiStatus: 409, identifier: 'RecoveryChannelRequired' },
) {}

export class UserTypeConflict extends Schema.TaggedErrorClass<UserTypeConflict>()(
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
export class UserTypeLastForRole extends Schema.TaggedErrorClass<UserTypeLastForRole>()(
  'USER_TYPE_LAST_FOR_ROLE',
  { roleCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypeLastForRole' },
) {}

export class UserTypeOrgTypeNotFound extends Schema.TaggedErrorClass<UserTypeOrgTypeNotFound>()(
  'USER_TYPE_ORG_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserTypeOrgTypeNotFound' },
) {}

/** the policy as written would leave these people standing illegally */
export class UserTypePlacementInUse extends Schema.TaggedErrorClass<UserTypePlacementInUse>()(
  'USER_TYPE_PLACEMENT_IN_USE',
  { userCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'UserTypePlacementInUse' },
) {}

export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
  'USER_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserNotFound' },
) {}

export class UserTypeDisabled extends Schema.TaggedErrorClass<UserTypeDisabled>()(
  'USER_TYPE_DISABLED',
  {},
  { httpApiStatus: 409, identifier: 'UserTypeDisabled' },
) {}

export class UserPlacementNotFound extends Schema.TaggedErrorClass<UserPlacementNotFound>()(
  'USER_PLACEMENT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'UserPlacementNotFound' },
) {}

export class PlacementNotAllowed extends Schema.TaggedErrorClass<PlacementNotAllowed>()(
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
export class SystemAccountProtected extends Schema.TaggedErrorClass<SystemAccountProtected>()(
  'SYSTEM_ACCOUNT_PROTECTED',
  {},
  { httpApiStatus: 409, identifier: 'SystemAccountProtected' },
) {}

/** grants the person holds that their new type would not be eligible for */
export class GrantIncompatible extends Schema.TaggedErrorClass<GrantIncompatible>()(
  'GRANT_INCOMPATIBLE',
  { grantCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'GrantIncompatible' },
) {}

export const userConstraints: Record<string, () => UserPlacementNotFound> = {
  fk_users_primary_org_node: () => new UserPlacementNotFound(),
}
