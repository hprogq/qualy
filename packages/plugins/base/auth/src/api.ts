import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import { Authenticated } from './effect/session.ts'
import {
  RecoveryChannelRequired,
  UserTypeConflict,
  UserTypeInUse,
  UserTypeIsSystem,
  UserTypeLastForRole,
  UserTypeNotFound,
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
