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
  uuidInput,
} from '@qualy/api-kit/schema'

import { UiTextSchema } from '@qualy/i18n-contract'
import { EMAIL_MAX_LENGTH, normalizeEmail } from '@qualy/auth-contract/email'
import { Authenticated, AuthRequired } from '@qualy/auth-contract/session'
import {
  GrantIncompatible,
  PlacementNotAllowed,
  ProviderNotFound,
  ProviderVersionConflict,
  RecoveryChannelRequired,
  SystemAccountProtected,
  UserEmailConflict,
  UserNotFound,
  UserPlacementNotFound,
  UserVersionConflict,
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
  AuthBindingAudienceExcluded,
  AuthBindingCredentialInvalid,
  AuthBindingNotFound,
  AuthBindingUnsupported,
  AuthBindingUserFieldMissing,
  ProviderConfigInvalid,
  ProviderConflict,
  ProviderKindUnavailable,
} from './server/errors.ts'

// The identity api this plugin serves, as definitions only.
//
// Paths are frozen (scripts/tests/api-surface.test.ts). State is replaced
// through an idempotent subresource rather than an action segment, which is
// why enabling a type is a PUT on /status and not a POST to /enable.

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
    orgTypeIds: Schema.Array(uuidInput).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  }),
])

/**
 * An email address as somebody typed it: trimmed here, lower-cased where it
 * is stored. Anything the directory could not store is refused at the door.
 */
const emailInput = Schema.Trim.check(
  Schema.isMaxLength(EMAIL_MAX_LENGTH),
  Schema.makeFilter<string>(
    (value) => normalizeEmail(value) !== null || 'must be an email address',
  ),
)

const user = Schema.Struct({
  id: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  /** the person's one address: notices go to it, the password door signs in by it */
  email: Schema.NullOr(Schema.String),
  /** when the person proved they read it; null for an address nobody proved */
  emailVerifiedAt: Schema.NullOr(Schema.String),
  displayName: Schema.String,
  // deleted people are not read at all: deletion is final
  status: resourceStatus,
  /** what every lifecycle write must be written against */
  version: Schema.Number,
  userType: Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
  primaryOrgNode: Schema.Struct({ id: Schema.String, name: Schema.String }),
  // whether this caller may change this particular user
  manageable: Schema.Boolean,
})

/**
 * One person, for whoever met their name somewhere else.
 *
 * Where they stand is spelled from the top of the tree, and the duties are
 * the ones they hold now. Permission codes are deliberately absent: a reader
 * asks "what is this person to the organization", and a list of codes answers
 * a question nobody had.
 */
const userDetail = Schema.Struct({
  user,
  /** the way down to where they stand, each rung with the kind of unit it is */
  orgPath: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      orgTypeName: Schema.String,
    }),
  ),
  /**
   * Where this person's kind may stand at all.
   *
   * Sent with the person rather than inferred on the screen: the rule has a
   * branch for a system identity that the type's own policy does not carry,
   * and a screen offering a unit the write will refuse turns a rule into an
   * error message after the press. The write still decides - this only says
   * which units are worth offering.
   */
  placement: Schema.Union([
    Schema.Struct({ mode: Schema.Literal('unrestricted') }),
    Schema.Struct({ mode: Schema.Literal('tenant-root') }),
    Schema.Struct({
      mode: Schema.Literal('allow-list'),
      orgTypeIds: Schema.Array(Schema.String),
    }),
  ]),
  roles: Schema.Array(
    Schema.Struct({
      grantId: Schema.String,
      roleId: Schema.String,
      roleName: Schema.String,
      kind: Schema.Literals(['tenant', 'org']),
      orgNodeName: Schema.NullOr(Schema.String),
      coverage: Schema.NullOr(Schema.Literals(['self', 'subtree'])),
      /** held over one object rather than in general */
      scoped: Schema.Boolean,
    }),
  ),
  // When they last came in, through whichever door. Whether they CAN come
  // in is a question per entrance, answered on the ways-in page; a count of
  // bindings cannot answer it, because some doors keep none.
  lastSignInAt: Schema.NullOr(Schema.String),
})

/**
 * One door, as it stands for one person.
 *
 * `resolution` says how the door finds them - by a field of their own, which
 * the screen reads off the person, or by an account they bound - and
 * `binding` what may be written for them: a credential an administrator
 * sets, an account only the person can bind, or nothing at all. Both are
 * the driver's own words, null when this assembly has no driver for the
 * door. The screen offers a control only where one can work.
 */
const userEntrance = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  type: Schema.String,
  status: resourceStatus,
  /** whether this person's user type may come through it at all */
  admits: Schema.Boolean,
  resolution: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        mode: Schema.Literal('user-field'),
        field: Schema.Literals(['email', 'businessNo']),
      }),
      Schema.Struct({ mode: Schema.Literal('binding-subject') }),
    ]),
  ),
  binding: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        mode: Schema.Literal('managed'),
        secret: Schema.Struct({
          label: UiTextSchema,
          hint: Schema.NullOr(UiTextSchema),
          minLength: Schema.Number,
          maxLength: Schema.Number,
        }),
      }),
      Schema.Struct({ mode: Schema.Literal('self') }),
    ]),
  ),
  /** the live binding, when there is one; never the credential */
  bound: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      /** the external account's durable id; null where the door keeps none */
      subject: Schema.NullOr(Schema.String),
      /** how the external account is called, for a reader */
      displayLabel: Schema.NullOr(Schema.String),
      boundAt: Schema.String,
      lastUsedAt: Schema.NullOr(Schema.String),
      hasCredential: Schema.Boolean,
    }),
  ),
})

/** who may sign in through one door: everyone, or exactly these user types */
const audiencePolicyView = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    userTypeIds: Schema.Array(Schema.String),
  }),
])

const audiencePolicyWrite = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    userTypeIds: Schema.Array(uuidInput).check(Schema.isMaxLength(50)),
  }),
])

const authProvider = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  type: Schema.String,
  name: Schema.String,
  status: resourceStatus,
  isSystem: Schema.Boolean,
  sortOrder: Schema.Number,
  version: Schema.Number,
  audience: audiencePolicyView,
})

export const identityApiGroup = HttpApiGroup.make('identity')
  .add(
    // the tenant's ways in, with who may use each: the door's own audience,
    // not a pair of flags on the user type
    HttpApiEndpoint.get('listAuthProviders', '/auth/providers', {
      success: Schema.Struct({ providers: Schema.Array(authProvider) }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  // The kinds of entrance that can be added, each with what it needs to be
  // told. What a CAS server or an OAuth client needs is the driver's
  // knowledge; the form is built from what it declares here.
  .add(
    HttpApiEndpoint.get('listAuthProviderKinds', '/auth/provider-kinds', {
      success: Schema.Struct({
        kinds: Schema.Array(
          Schema.Struct({
            type: Schema.String,
            label: UiTextSchema,
            fields: Schema.Array(
              Schema.Struct({
                key: Schema.String,
                label: UiTextSchema,
                hint: Schema.NullOr(UiTextSchema),
                kind: Schema.Literals(['text', 'url', 'secret']),
                required: Schema.Boolean,
              }),
            ),
          }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createAuthProvider', '/auth/providers', {
      payload: Schema.Struct({
        type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
        // the address it answers at, which is in every sign-in url and never moves
        code: kebabCode,
        name: trimmedName(100),
        values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [ProviderKindUnavailable, ProviderConfigInvalid, ProviderConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateAuthProvider', '/auth/providers/:providerId', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: changed(
        {
          version: expectedVersion,
          name: Schema.optional(trimmedName(100)),
          values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        },
        ['name', 'values'],
      ),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        ProviderNotFound,
        ProviderVersionConflict,
        ProviderKindUnavailable,
        ProviderConfigInvalid,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setAuthProviderStatus', '/auth/providers/:providerId/status', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: Schema.Struct({ version: expectedVersion, status: resourceStatus }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [ProviderNotFound, ProviderVersionConflict, RecoveryChannelRequired, AccessDenied],
    }).middleware(Authenticated),
  )
  // the order of the sign-in page is one fact about all of them, replaced whole
  .add(
    HttpApiEndpoint.put('setAuthProviderOrder', '/auth/provider-order', {
      payload: Schema.Struct({
        providerIds: Schema.Array(uuidInput).check(Schema.isMaxLength(50)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [ProviderNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setAuthProviderAudience', '/auth/providers/:providerId/audience', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: Schema.Struct({ version: expectedVersion, audience: audiencePolicyWrite }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        ProviderNotFound,
        ProviderVersionConflict,
        UserTypeNotFound,
        RecoveryChannelRequired,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
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
        // optional: the code is a stable machine key, and asking a person to
        // invent one produced screens where the required field nobody
        // understood sat above the two that mattered. Absent means "derive
        // one", and it stays accepted so an import can carry its own.
        code: Schema.optional(kebabCode),
        name: trimmedName(100),
        description: Schema.optional(boundedText(500)),
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
        orgTypes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUserType', '/iam/user-types/:userTypeId', {
      params: Schema.Struct({ userTypeId: uuidInput }),
      success: Schema.Struct({ userType }),
      error: [UserTypeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateUserType', '/iam/user-types/:userTypeId', {
      params: Schema.Struct({ userTypeId: uuidInput }),
      payload: changed(
        {
          ...versioned,
          name: Schema.optional(trimmedName(100)),
          description: Schema.optional(Schema.NullOr(boundedText(500))),
          sortOrder: Schema.optional(sortOrder),
        },
        ['name', 'description', 'sortOrder'],
      ),
      success: Schema.Struct({ version: Schema.Number }),
      error: [UserTypeNotFound, UserTypeVersionConflict, UserTypeConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setUserTypeStatus', '/iam/user-types/:userTypeId/status', {
      params: Schema.Struct({ userTypeId: uuidInput }),
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
      params: Schema.Struct({ userTypeId: uuidInput }),
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
      params: Schema.Struct({ userTypeId: uuidInput }),
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
      params: Schema.Struct({ userTypeId: uuidInput }),
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
            /** null for a root, or for a node whose parent is out of reach */
            parentId: Schema.NullOr(Schema.String),
            depth: Schema.Number,
            orgTypeId: Schema.String,
            /** people standing at this node itself, not at its subtree */
            userCount: Schema.Number,
            manageable: Schema.Boolean,
          }),
        ),
        // the kinds of unit there are: a picker labels every node with its
        // kind and filters by it, which is how somebody finds "all the classes"
        orgTypes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
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
        orgNodeId: uuidInput,
        // an enum says what it means; `subtree=false` never did
        scope: Schema.optional(Schema.Literals(['self', 'subtree'])),
        /** absent = both states; the deleted are never listed */
        status: Schema.optional(resourceStatus),
        search: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
        userTypeId: Schema.optional(uuidInput),
        ...pageQuery,
        // A picker reads forwards by cursor; the roster is walked by page
        // number. Naming a page switches the answer to a counted one.
        page: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({
        items: Schema.Array(user),
        nextCursor: Schema.NullOr(Schema.String),
        /** present only when a page was asked for by number */
        total: Schema.NullOr(Schema.Number),
        page: Schema.NullOr(Schema.Number),
        pageSize: Schema.NullOr(Schema.Number),
      }),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the whole of one person, which is also what a card opened on their name
    // shows: no separate endpoint, because there is no second kind of person
    HttpApiEndpoint.get('getUser', '/iam/users/:userId', {
      params: Schema.Struct({ userId: uuidInput }),
      success: userDetail,
      error: [UserNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createUser', '/iam/users', {
      payload: Schema.Struct({
        displayName: trimmedName(100),
        userTypeId: uuidInput,
        primaryOrgNodeId: uuidInput,
        businessNo: Schema.optional(trimmedName(64)),
        email: Schema.optional(emailInput),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        UserConflict,
        UserEmailConflict,
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
      params: Schema.Struct({ userId: uuidInput }),
      payload: changed(
        {
          version: expectedVersion,
          displayName: Schema.optional(trimmedName(100)),
          userTypeId: Schema.optional(uuidInput),
          businessNo: Schema.optional(trimmedName(64)),
          // null takes the address away
          email: Schema.optional(Schema.NullOr(emailInput)),
        },
        ['displayName', 'userTypeId', 'businessNo', 'email'],
      ),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserConflict,
        UserEmailConflict,
        UserNotFound,
        UserVersionConflict,
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
      params: Schema.Struct({ userId: uuidInput }),
      payload: Schema.Struct({ primaryOrgNodeId: uuidInput, version: expectedVersion }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserVersionConflict,
        UserTypeNotFound,
        SystemAccountProtected,
        UserPlacementNotFound,
        PlacementNotAllowed,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // in service or out of it, replaced as a resource
    HttpApiEndpoint.put('setUserStatus', '/iam/users/:userId/status', {
      params: Schema.Struct({ userId: uuidInput }),
      payload: Schema.Struct({ status: resourceStatus, version: expectedVersion }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserVersionConflict,
        SystemAccountProtected,
        LastAdministrator,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // Deletion is final: the row stays as a tombstone history names by id,
    // and the person is gone from every other read. Its own permission,
    // apart from administering them.
    HttpApiEndpoint.delete('deleteUser', '/iam/users/:userId', {
      params: Schema.Struct({ userId: uuidInput }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserVersionConflict,
        SystemAccountProtected,
        LastAdministrator,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  // Every entrance in the tenant as it stands for one person: whether it
  // admits them, what is bound, and whether anything can be. A page of its
  // own question rather than more of getUser, which every banner reads.
  .add(
    HttpApiEndpoint.get('listUserEntrances', '/iam/users/:userId/entrances', {
      params: Schema.Struct({ userId: uuidInput }),
      success: Schema.Struct({
        entrances: Schema.Array(userEntrance),
        /** read and manage are separate grants; a reader gets no controls */
        manageable: Schema.Boolean,
      }),
      error: [UserNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  // The binding of one person to one door is a resource of its own: putting
  // it sets or replaces the credential, deleting it withdraws the binding.
  // What the secret is stays the driver's business - it arrives as typed and
  // is handed straight to the driver that declared it manages one.
  .add(
    HttpApiEndpoint.put('putUserAuthBinding', '/iam/users/:userId/auth-bindings/:providerId', {
      params: Schema.Struct({ userId: uuidInput, providerId: uuidInput }),
      payload: Schema.Struct({
        secret: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        UserNotFound,
        ProviderNotFound,
        SystemAccountProtected,
        AuthBindingUnsupported,
        AuthBindingUserFieldMissing,
        AuthBindingAudienceExcluded,
        AuthBindingCredentialInvalid,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteUserAuthBinding', '/iam/users/:userId/auth-bindings/:providerId', {
      params: Schema.Struct({ userId: uuidInput, providerId: uuidInput }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [UserNotFound, SystemAccountProtected, AuthBindingNotFound, AccessDenied],
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
    // the renderer is found by `type`; naming its module here told every
    // anonymous visitor which package implements this way in
    mode: Schema.Literal('component'),
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
    name: Schema.String,
    orgType: Schema.Struct({ id: Schema.String, name: Schema.String }),
    lineage: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, typeName: Schema.String }),
    ),
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
