import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import {
  BadRequest,
  boundedInt,
  changed,
  boundedText,
  expectedVersion,
  kebabCode,
  pageOf,
  pageQuery,
  trimmedName,
} from '@qualy/api-kit/schema'

import { Authenticated, AuthRequired } from './effect/session.ts'
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
  UserConflict,
} from './effect/errors.ts'

// The identity api this plugin serves, as definitions only.
//
// Paths are frozen (scripts/tests/api-surface.test.ts). State is replaced
// through an idempotent subresource rather than an action segment, which is
// why enabling a type is a PUT on /status and not a POST to /enable.

const id = Schema.String.check(Schema.isUUID())

const resourceStatus = Schema.Literals(['active', 'disabled'])

/**
 * What a reader is told, which for a system identity is not what the row stores.
 *
 * `tenant-root` is readable and not writable: it is the rule enforced for a
 * system type, which ignores the stored mode entirely, and it is a platform
 * fact rather than a configuration.
 */
const placementPolicyView = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    orgTypeIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({ mode: Schema.Literal('tenant-root') }),
])

const userType = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  allowLocalLogin: Schema.Boolean,
  allowSsoLogin: Schema.Boolean,
  status: resourceStatus,
  // a system type is provisioned by the platform and never handed out
  isSystem: Schema.Boolean,
  sortOrder: Schema.Number,
  version: Schema.Number,
  userCount: Schema.Number,
  // Where this kind of person may stand. A user type confers no authority
  // (that is what roles are for), so this is the whole of what it decides.
  placementPolicy: placementPolicyView,
})

/** every set replacement carries the version it expected, so a concurrent edit is refused */
const versioned = { version: expectedVersion }
const sortOrder = boundedInt(0, 32767)

/**
 * Where a kind of person may stand.
 *
 * The mode is stated rather than inferred from an empty list: reading "no
 * rows" as "anywhere" makes unchecking the last box widen the rule instead of
 * narrowing it.
 */
const placementPolicy = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    orgTypeIds: Schema.Array(id).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  }),
])

const user = Schema.Struct({
  id: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  displayName: Schema.String,
  status: Schema.Literals(['active', 'disabled']),
  userType: Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
  primaryOrgNode: Schema.Struct({ id: Schema.String, name: Schema.String }),
  // how many sign-in identities exist, not which: one identity out of possibly
  // several, with no provider context, told a reader nothing and exposed a
  // login name to anyone holding org-scope read
  identityCount: Schema.Number,
  // whether this caller may change this particular user
  manageable: Schema.Boolean,
})

export const identityApiGroup = HttpApiGroup.make('identity')
  .add(
    HttpApiEndpoint.get('listUserTypes', '/iam/user-types', {
      success: Schema.Struct({
        userTypes: Schema.Array(userType),
        // read and manage are separate grants, so a read-only administrator
        // gets a screen without buttons rather than buttons that answer 403
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createUserType', '/iam/user-types', {
      payload: Schema.Struct({
        code: kebabCode,
        name: trimmedName(100),
        description: Schema.optional(boundedText(500)),
        allowLocalLogin: Schema.optional(Schema.Boolean),
        allowSsoLogin: Schema.optional(Schema.Boolean),
        sortOrder: Schema.optional(sortOrder),
        // required: a type created without one constrains nothing, and "not
        // configured yet" is indistinguishable from "deliberately open"
        placementPolicy,
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [UserTypeConflict, UserTypeOrgTypeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUserTypeOptions', '/iam/user-type-options', {
      success: Schema.Struct({
        orgTypes: Schema.Array(
          Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
        ),
      }),
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
      payload: changed(
        {
          ...versioned,
          name: Schema.optional(trimmedName(100)),
          description: Schema.optional(Schema.NullOr(boundedText(500))),
          allowLocalLogin: Schema.optional(Schema.Boolean),
          allowSsoLogin: Schema.optional(Schema.Boolean),
          sortOrder: Schema.optional(sortOrder),
        },
        ['name', 'description', 'allowLocalLogin', 'allowSsoLogin', 'sortOrder'],
      ),
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
        // nested as the contract declares it, and 'tenant-root' is readable
        // and not writable: it is the rule the database enforces for a system
        // identity, which ignores the stored mode entirely
        policy: placementPolicyView,
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
      // the same constrained union createUserType takes: an empty allow-list
      // commits a type nobody may stand anywhere with, which the contract
      // refuses and this accepted
      payload: Schema.Struct({ version: expectedVersion, policy: placementPolicy }),
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
    // The nodes this caller may administer users at, and the types they may
    // hand out; one call, so the screen needs no permission but its own. The
    // nodes are the ones inside the caller's coverage rather than the anchors
    // their grants sit on: a subtree grant at a college means every department
    // under it is a place a user may stand.
    HttpApiEndpoint.get('getUserOptions', '/iam/user-options', {
      query: Schema.Struct({
        search: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
        limit: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({
        // says when the tree was cut short instead of presenting a partial
        // list as the whole of it
        truncated: Schema.Boolean,
        nodes: Schema.Array(
          Schema.Struct({
            orgNodeId: Schema.String,
            name: Schema.String,
            depth: Schema.Number,
            orgTypeId: Schema.String,
            manageable: Schema.Boolean,
          }),
        ),
        // each type carries the org types it admits, so the screen can pair a
        // person with a place without a second round trip
        userTypes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            code: Schema.String,
            name: Schema.String,
            placementPolicy: Schema.Union([
              Schema.Struct({ mode: Schema.Literal('unrestricted') }),
              Schema.Struct({
                mode: Schema.Literal('allow-list'),
                orgTypeIds: Schema.Array(Schema.String),
              }),
            ]),
          }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listUsers', '/iam/users', {
      query: Schema.Struct({
        orgNodeId: id,
        // an enum says what it means; `subtree=false` never did
        scope: Schema.optional(Schema.Literals(['self', 'subtree'])),
        search: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
        ...pageQuery,
      }),
      success: pageOf(user),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUser', '/iam/users/:userId', {
      params: Schema.Struct({ userId: id }),
      success: Schema.Struct({ user }),
      error: [UserNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createUser', '/iam/users', {
      payload: Schema.Struct({
        displayName: trimmedName(100),
        userTypeId: id,
        primaryOrgNodeId: id,
        businessNo: Schema.optional(trimmedName(64)),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        UserConflict,
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
      payload: changed(
        {
          displayName: Schema.optional(trimmedName(100)),
          userTypeId: Schema.optional(id),
          businessNo: Schema.optional(trimmedName(64)),
        },
        ['displayName', 'userTypeId', 'businessNo'],
      ),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserConflict,
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

// The session is a resource, not a pair of verbs: reading it says who is
// signed in, deleting it signs them out. /auth/me and /auth/logout modelled
// the same thing two different ways and left no room for the per-device
// listing this will grow.

/** the public descriptor of one way in; never config, never internal ids */
const loginMethod = Schema.Union([
  Schema.Struct({
    code: Schema.String,
    type: Schema.String,
    name: Schema.String,
    mode: Schema.Literal('component'),
    component: Schema.String,
  }),
  Schema.Struct({
    code: Schema.String,
    type: Schema.String,
    name: Schema.String,
    mode: Schema.Literal('redirect'),
    href: Schema.String,
  }),
])

const signedInUser = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  userType: Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
  primaryOrgNode: Schema.Struct({
    id: Schema.String,
    code: Schema.NullOr(Schema.String),
    name: Schema.String,
  }),
  tenant: Schema.Struct({ id: Schema.String, slug: Schema.String, name: Schema.String }),
})

export const sessionApiGroup = HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('listLoginMethods', '/auth/login-methods', {
      success: Schema.Struct({ methods: Schema.Array(loginMethod) }),
    }),
  )
  .add(
    HttpApiEndpoint.get('getSession', '/auth/session', {
      success: Schema.Struct({ user: signedInUser }),
      // the middleware already declares AUTH_REQUIRED and SESSION_EXPIRED, and
      // it is what tells them apart: a session that was presented and has
      // since lapsed is not the same as never having had one
      error: [AuthRequired],
    }).middleware(Authenticated),
  )
  .add(
    // no middleware: refusing an already-signed-out caller would make the
    // client handle a failure that means the thing it asked for is already true
    HttpApiEndpoint.delete('endSession', '/auth/session', {
      success: Schema.Struct({ ok: Schema.Literal(true) }),
    }),
  )
