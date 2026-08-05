import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'

import { Authenticated } from './effect/session.ts'
import {
  GrantIncompatible,
  PlacementNotAllowed,
  RecoveryChannelRequired,
  SystemAccountProtected,
  UserNotFound,
  UserPlacementNotFound,
  UserTypeDisabled,
  UserTypeConflict,
  UserTypeInUse,
  UserTypeIsSystem,
  UserTypeLastForRole,
  UserTypeNotFound,
  UserTypeOrgTypeNotFound,
  UserTypePlacementInUse,
  UserTypeVersionConflict,
} from './effect/errors.ts'

// The identity api this plugin serves, as definitions only.
//
// Paths are frozen (scripts/tests/api-surface.test.ts). State is replaced
// through an idempotent subresource rather than an action segment, which is
// why enabling a type is a PUT on /status and not a POST to /enable.

const id = Schema.String.check(Schema.isUUID())

const userType = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  allowLocalLogin: Schema.Boolean,
  allowSsoLogin: Schema.Boolean,
  enabled: Schema.Boolean,
  isSystem: Schema.Boolean,
  sortOrder: Schema.Number,
  version: Schema.Number,
  placementMode: Schema.String,
  userCount: Schema.Number,
  allowedOrgTypeIds: Schema.Array(Schema.String),
})

/** every set replacement carries the version it expected, so a concurrent edit is refused */
const versioned = { version: Schema.Number }

export const identityApiGroup = HttpApiGroup.make('identity')
  .add(
    HttpApiEndpoint.get('listUserTypes', '/iam/user-types', {
      success: Schema.Struct({ userTypes: Schema.Array(userType) }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUserType', '/iam/user-types/:userTypeId', {
      params: Schema.Struct({ userTypeId: id }),
      success: Schema.Struct({ userType }),
      error: [UserTypeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateUserType', '/iam/user-types/:userTypeId', {
      params: Schema.Struct({ userTypeId: id }),
      payload: Schema.Struct({
        ...versioned,
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.NullOr(Schema.String)),
        allowLocalLogin: Schema.optional(Schema.Boolean),
        allowSsoLogin: Schema.optional(Schema.Boolean),
        sortOrder: Schema.optional(Schema.Number),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        UserTypeNotFound,
        UserTypeVersionConflict,
        RecoveryChannelRequired,
        LastAdministrator,
        UserTypeConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setUserTypeStatus', '/iam/user-types/:userTypeId/status', {
      params: Schema.Struct({ userTypeId: id }),
      payload: Schema.Struct({ ...versioned, status: Schema.Literals(['active', 'disabled']) }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        UserTypeNotFound,
        UserTypeVersionConflict,
        UserTypeInUse,
        UserTypeConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteUserType', '/iam/user-types/:userTypeId', {
      params: Schema.Struct({ userTypeId: id }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserTypeNotFound,
        UserTypeVersionConflict,
        UserTypeIsSystem,
        UserTypeInUse,
        UserTypeLastForRole,
        UserTypeConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getPlacementPolicy', '/iam/user-types/:userTypeId/placement-policy', {
      params: Schema.Struct({ userTypeId: id }),
      success: Schema.Struct({
        mode: Schema.Literals(['unrestricted', 'allow-list']),
        orgTypeIds: Schema.Array(Schema.String),
        version: Schema.Number,
      }),
      error: [UserTypeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // replaced whole, and the mode is stated rather than inferred: an empty
    // allow-list means "nowhere", not "anywhere"
    HttpApiEndpoint.put('setPlacementPolicy', '/iam/user-types/:userTypeId/placement-policy', {
      params: Schema.Struct({ userTypeId: id }),
      payload: Schema.Struct({
        version: Schema.Number,
        mode: Schema.Literals(['unrestricted', 'allow-list']),
        orgTypeIds: Schema.Array(id),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        UserTypeNotFound,
        UserTypeIsSystem,
        UserTypeVersionConflict,
        UserTypeOrgTypeNotFound,
        UserTypePlacementInUse,
        UserTypeConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createUser', '/iam/users', {
      payload: Schema.Struct({
        displayName: Schema.String,
        userTypeId: id,
        primaryOrgNodeId: id,
        businessNo: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        UserTypeNotFound,
        UserTypeDisabled,
        UserPlacementNotFound,
        PlacementNotAllowed,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateUser', '/iam/users/:userId', {
      params: Schema.Struct({ userId: id }),
      payload: Schema.Struct({
        displayName: Schema.optional(Schema.String),
        userTypeId: Schema.optional(id),
        businessNo: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserTypeNotFound,
        UserTypeDisabled,
        SystemAccountProtected,
        UserPlacementNotFound,
        PlacementNotAllowed,
        GrantIncompatible,
        LastAdministrator,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // where someone stands, replaced rather than acted on
    HttpApiEndpoint.put('setUserPlacement', '/iam/users/:userId/placement', {
      params: Schema.Struct({ userId: id }),
      payload: Schema.Struct({ primaryOrgNodeId: id }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserTypeNotFound,
        SystemAccountProtected,
        UserPlacementNotFound,
        PlacementNotAllowed,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setUserStatus', '/iam/users/:userId/status', {
      params: Schema.Struct({ userId: id }),
      payload: Schema.Struct({ status: Schema.Literals(['active', 'disabled']) }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        SystemAccountProtected,
        UserPlacementNotFound,
        LastAdministrator,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
