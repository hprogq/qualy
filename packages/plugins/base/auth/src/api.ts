import { Schema } from 'effect'
import { BUILTIN_LOGIN_ICONS } from '@qualy/auth-contract/login-icons'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import {
  BadRequest,
  boundedInt,
  changed,
  boundedText,
  expectedVersion,
  kebabCode,
  numberedPageOf,
  numberedPageQuery,
  pageOf,
  pageQuery,
  trimmedName,
  uuidInput,
} from '@qualy/api-kit/schema'

import { UiTextSchema } from '@qualy/i18n-contract'
import { EMAIL_MAX_LENGTH, normalizeEmail } from '@qualy/auth-contract/email'
import { Authenticated, AuthRequired, TooManyAttemptsResponse } from '@qualy/auth-contract/session'
import {
  GrantIncompatible,
  PlacementNotAllowed,
  ProviderArrangementInvalid,
  ProviderIconInvalid,
  LoginMethodIconUnavailable,
  ProviderNotFound,
  ProviderVersionConflict,
  RecoveryChannelRequired,
  SessionNotFound,
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
  AuthLastWayIn,
  ChallengeInvalid,
  EmailMissing,
  EmailUnverified,
  MailNotSent,
  PasswordIncorrect,
  PasswordUnavailable,
  ProviderConfigIncomplete,
  ProviderConfigInvalid,
  ProviderConflict,
  ProviderIdentityNamespaceInUse,
  ProviderIsSystem,
  ProviderKindUnavailable,
  readinessGapSchema,
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
  /**
   * When the person last came in through this door. Read from the sign-in
   * record rather than a binding, because a door that finds people by a
   * field of theirs keeps no binding to touch.
   */
  lastSignInAt: Schema.NullOr(Schema.String),
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

/** how a way in is drawn: one of the page's own icons, an uploaded image, or its initial */
const loginMethodIcon = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal('builtin'), key: Schema.Literals(BUILTIN_LOGIN_ICONS) }),
    // by the version of the image, which is also what makes a new one a new address
    Schema.Struct({ kind: Schema.Literal('image'), version: Schema.String }),
  ]),
)

const authProvider = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  type: Schema.String,
  /** what its driver calls the kind, in the reader's language; null for a kind no driver claims */
  kindLabel: Schema.NullOr(UiTextSchema),
  name: Schema.String,
  status: resourceStatus,
  // whether it has everything its kind needs to be put in service
  setup: Schema.Literals(['complete', 'incomplete']),
  isSystem: Schema.Boolean,
  sortOrder: Schema.Number,
  /** listed in full on the sign-in page, or a tile under those */
  prominence: Schema.Literals(['primary', 'secondary']),
  recommended: Schema.Boolean,
  /** how the sign-in page draws it: the administrator's choice, else its kind's own */
  icon: loginMethodIcon,
  /** whether that icon is a choice somebody made rather than its kind's own */
  iconChosen: Schema.Boolean,
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
                kind: Schema.Literals(['text', 'url', 'secret', 'choice', 'toggle', 'number']),
                required: Schema.Boolean,
                // advanced fields fold away until somebody asks for them
                section: Schema.Literals(['basic', 'advanced']),
                // shown only while another field holds this value, as its box carries it
                visibleWhen: Schema.NullOr(
                  Schema.Struct({ field: Schema.String, equals: Schema.String }),
                ),
                // a choice's options; empty for every other kind
                options: Schema.Array(Schema.Struct({ value: Schema.String, label: UiTextSchema })),
                defaultValue: Schema.NullOr(Schema.String),
                min: Schema.NullOr(Schema.Number),
                max: Schema.NullOr(Schema.Number),
                step: Schema.NullOr(Schema.Number),
              }),
            ),
          }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // an empty entrance, out of service: what its kind needs is told to it
    // afterwards, over as many saves as that takes
    HttpApiEndpoint.post('createAuthProvider', '/auth/providers', {
      payload: Schema.Struct({
        type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
        // the address it answers at, which is in every sign-in url and never moves
        code: kebabCode,
        name: trimmedName(100),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [ProviderKindUnavailable, ProviderConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  // One entrance as its settings screen reads it. Secrets are reported as
  // stored or not; what they are never leaves the server.
  .add(
    HttpApiEndpoint.get('getAuthProvider', '/auth/providers/:providerId', {
      params: Schema.Struct({ providerId: uuidInput }),
      success: Schema.Struct({
        provider: authProvider,
        missing: Schema.Array(readinessGapSchema),
        /** where its kind expects to be called back, for whoever configures the other end */
        callbackUrl: Schema.NullOr(Schema.String),
        config: Schema.Record(Schema.String, Schema.String),
        secrets: Schema.Array(Schema.Struct({ key: Schema.String, stored: Schema.Boolean })),
        // what deleting it would end
        usage: Schema.Struct({ bindings: Schema.Number, sessions: Schema.Number }),
      }),
      error: [ProviderNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteAuthProvider', '/auth/providers/:providerId', {
      params: Schema.Struct({ providerId: uuidInput }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        ProviderNotFound,
        ProviderVersionConflict,
        ProviderIsSystem,
        RecoveryChannelRequired,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  // a stored secret taken away, which leaving its box empty never does
  .add(
    HttpApiEndpoint.delete('deleteAuthProviderSecret', '/auth/providers/:providerId/secrets/:key', {
      params: Schema.Struct({
        providerId: uuidInput,
        key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63)),
      }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        ProviderNotFound,
        ProviderVersionConflict,
        ProviderKindUnavailable,
        ProviderConfigInvalid,
        ProviderConfigIncomplete,
        AccessDenied,
      ],
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
        ProviderConfigIncomplete,
        ProviderIdentityNamespaceInUse,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setAuthProviderStatus', '/auth/providers/:providerId/status', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: Schema.Struct({ version: expectedVersion, status: resourceStatus }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        ProviderNotFound,
        ProviderVersionConflict,
        ProviderConfigIncomplete,
        RecoveryChannelRequired,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  // How the sign-in page presents its doors is one fact about all of them,
  // replaced whole: which are listed in full, in what order, and the rest in
  // theirs. Every door is named exactly once.
  .add(
    HttpApiEndpoint.put('setAuthProviderOrder', '/auth/provider-order', {
      payload: Schema.Struct({
        primary: Schema.Array(uuidInput).check(Schema.isMaxLength(50)),
        secondary: Schema.Array(uuidInput).check(Schema.isMaxLength(50)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [ProviderNotFound, ProviderArrangementInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  // the one door the tenant recommends, or none: a tenant-wide fact
  .add(
    HttpApiEndpoint.put('setRecommendedAuthProvider', '/auth/provider-recommendation', {
      payload: Schema.Struct({ providerId: Schema.NullOr(uuidInput) }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [ProviderNotFound, ProviderArrangementInvalid, AccessDenied],
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

/** where a door stands on the page and how it is drawn, the same for either kind */
const loginMethodShown = {
  code: Schema.String,
  type: Schema.String,
  name: Schema.String,
  prominence: Schema.Literals(['primary', 'secondary']),
  recommended: Schema.Boolean,
  icon: loginMethodIcon,
}

/** the public descriptor of one way in; never config, never internal ids */
const loginMethod = Schema.Union([
  Schema.Struct({
    ...loginMethodShown,
    // the renderer is found by `type`; naming its module here told every
    // anonymous visitor which package implements this way in
    mode: Schema.Literal('component'),
  }),
  Schema.Struct({
    ...loginMethodShown,
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
    // The public login context: which workspace this is, by name only, and
    // its ways in. Null when there is no workspace to sign in to here.
    HttpApiEndpoint.get('listLoginMethods', '/auth/login-methods', {
      success: Schema.Struct({
        tenant: Schema.NullOr(Schema.Struct({ name: Schema.String })),
        methods: Schema.Array(loginMethod),
        // what a password here has to be, where a door keeps passwords
        passwordRule: Schema.NullOr(
          Schema.Struct({ minLength: Schema.Number, maxLength: Schema.Number }),
        ),
      }),
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
  .add(
    // the same answer whether or not anybody has that address
    HttpApiEndpoint.post('createPasswordReset', '/auth/password-resets', {
      payload: Schema.Struct({
        email: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(EMAIL_MAX_LENGTH)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [TooManyAttemptsResponse],
    }),
  )
  .add(
    HttpApiEndpoint.post('createPasswordResetRedemption', '/auth/password-resets/redemptions', {
      payload: Schema.Struct({
        token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        password: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [ChallengeInvalid, AuthBindingCredentialInvalid],
    }),
  )
  .add(
    HttpApiEndpoint.post(
      'createEmailVerificationRedemption',
      '/auth/email-verifications/redemptions',
      {
        payload: Schema.Struct({
          token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        }),
        success: Schema.Struct({ ok: Schema.Literal(true) }),
        error: [ChallengeInvalid],
      },
    ),
  )
  .add(
    HttpApiEndpoint.post('createEmailChangeRedemption', '/auth/email-changes/redemptions', {
      payload: Schema.Struct({
        token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [ChallengeInvalid, UserEmailConflict],
    }),
  )

/**
 * The signed-in person's own account.
 *
 * Its own group because it answers a different question from the directory
 * beside it: not "who is this person", asked with authority over them, but
 * "who am I", which being signed in is the whole of the authority for. There
 * is no user id anywhere in it - the session says who.
 */
const selfEntrance = Schema.Struct({
  providerId: Schema.String,
  name: Schema.String,
  type: Schema.String,
  resolution: userEntrance.fields.resolution,
  binding: userEntrance.fields.binding,
  lastSignInAt: userEntrance.fields.lastSignInAt,
  bound: userEntrance.fields.bound,
  /** the session this was asked from signed in through the account bound here */
  thisSession: Schema.Boolean,
  /** where to begin binding an account here; null where nothing is to be bound */
  bindHref: Schema.NullOr(Schema.String),
  /** an account they bound themselves, and not the last way they have in */
  unbindable: Schema.Boolean,
})

/** where an attempt or a session came in, as the door is named now; null for one since deleted */
const selfDoor = Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String }))

/** one attempt to sign in as the reader */
const selfSignIn = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  outcome: Schema.Literals(['success', 'failure']),
  entrance: selfDoor,
  /** the attempt that opened the session in hand */
  current: Schema.Boolean,
  clientIp: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
})

/** a stretch of time to read within: inclusive lower and exclusive upper instants */
const selfPeriod = {
  from: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
  to: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
}

/** one thing done to the reader's account, in the words given for them */
const selfAccountChange = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.String,
  name: UiTextSchema,
  /** the reader themselves, or somebody else */
  actor: Schema.Literals(['self', 'other']),
})

/** one of the reader's open sessions */
const selfSession = Schema.Struct({
  id: Schema.String,
  /** the one this request came in on */
  current: Schema.Boolean,
  entrance: selfDoor,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  clientIp: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
})

export const selfApiGroup = HttpApiGroup.make('self')
  .add(
    HttpApiEndpoint.get('getSelf', '/iam/self', {
      success: Schema.Struct({
        id: Schema.String,
        displayName: Schema.String,
        businessNo: Schema.NullOr(Schema.String),
        email: Schema.NullOr(Schema.String),
        emailVerified: Schema.Boolean,
        userType: Schema.Struct({ id: Schema.String, name: Schema.String }),
        unit: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
        /** the units above theirs and theirs, root first */
        unitLineage: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        /** a password they hold, one they could set, or no password way in for them */
        passwordStatus: Schema.Literals(['set', 'unset', 'unavailable']),
      }),
      error: [UserNotFound],
    }).middleware(Authenticated),
  )
  .add(
    // the doors in service that let them through; a door that would not is
    // not a way in and is not listed
    HttpApiEndpoint.get('listSelfEntrances', '/iam/self/entrances', {
      success: Schema.Struct({ entrances: Schema.Array(selfEntrance) }),
      error: [UserNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteSelfAuthBinding', '/iam/self/auth-bindings/:providerId', {
      params: Schema.Struct({ providerId: uuidInput }),
      // whether the session this came from was one of those ended with it
      success: Schema.Struct({ signedOut: Schema.Boolean }),
      error: [
        UserNotFound,
        AuthBindingNotFound,
        AuthBindingUnsupported,
        AuthLastWayIn,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // a link to the address on file, which following proves it theirs
    HttpApiEndpoint.post('createSelfEmailVerification', '/iam/self/email-verifications', {
      // false when the address is proven already and nothing was sent
      success: Schema.Struct({ sent: Schema.Boolean }),
      error: [UserNotFound, EmailMissing, MailNotSent, TooManyAttemptsResponse],
    }).middleware(Authenticated),
  )
  .add(
    // a link to the new address; the old one stays until it is followed
    HttpApiEndpoint.post('createSelfEmailChange', '/iam/self/email-changes', {
      payload: Schema.Struct({
        newEmail: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(EMAIL_MAX_LENGTH)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        UserEmailConflict,
        SystemAccountProtected,
        MailNotSent,
        TooManyAttemptsResponse,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // the current password is asked for whenever there is one; somebody
    // without one sets it only on a proven address
    HttpApiEndpoint.put('putSelfPassword', '/iam/self/password', {
      payload: Schema.Struct({
        currentPassword: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
        newPassword: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
      }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        UserNotFound,
        PasswordIncorrect,
        EmailUnverified,
        PasswordUnavailable,
        AuthBindingCredentialInvalid,
        TooManyAttemptsResponse,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // every attempt to come in as the reader, newest first: the ones that
    // succeeded and the ones refused once the person was known. What was
    // typed at a door that found nobody is not recorded, so not here either
    HttpApiEndpoint.get('listSelfSignIns', '/iam/self/sign-ins', {
      query: Schema.Struct({
        outcome: Schema.optional(Schema.Literals(['success', 'failure'])),
        ...selfPeriod,
        ...numberedPageQuery,
      }),
      success: numberedPageOf(selfSignIn),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // what was done to the reader's account - their password, their address,
    // their ways in, their sessions - as the trail tells it to them
    HttpApiEndpoint.get('listSelfAccountChanges', '/iam/self/account-changes', {
      query: Schema.Struct({ ...selfPeriod, ...numberedPageQuery }),
      success: numberedPageOf(selfAccountChange),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // the reader's sessions still open, the one in hand among them
    HttpApiEndpoint.get('listSelfSessions', '/iam/self/sessions', {
      query: Schema.Struct({ ...pageQuery }),
      success: pageOf(selfSession),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // one of the others; the session in hand is ended by signing out
    HttpApiEndpoint.delete('deleteSelfSession', '/iam/self/sessions/:sessionId', {
      params: Schema.Struct({ sessionId: uuidInput }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [UserNotFound, SessionNotFound],
    }).middleware(Authenticated),
  )
  .add(
    // every session but the one in hand: the collection, less the reader's
    // own seat in it
    HttpApiEndpoint.delete('deleteSelfSessions', '/iam/self/sessions', {
      success: Schema.Struct({ ended: Schema.Number }),
      error: [UserNotFound],
    }).middleware(Authenticated),
  )

/** the image kinds a door's icon may be: drawn by a browser without running anything */
export const LOGIN_ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** the most an icon may weigh; it is drawn at fifty pixels */
export const LOGIN_ICON_MAX_BYTES = 256 * 1024

// A door's uploaded icon: prepared and chosen by the tenant's administrators,
// read by anybody on the sign-in page. Apart from the other groups because it
// is the one part of this plugin that stores files.
export const loginIconApiGroup = HttpApiGroup.make('loginIcon')
  .add(
    // the image itself, for the sign-in page; `v` is only the cache's key
    HttpApiEndpoint.get('getLoginMethodIcon', '/auth/login-methods/:providerCode/icon', {
      params: Schema.Struct({ providerCode: Schema.String.check(Schema.isMaxLength(63)) }),
      query: Schema.Struct({ v: Schema.optional(Schema.String.check(Schema.isMaxLength(64))) }),
      success: HttpApiSchema.StreamUint8Array(),
      error: [LoginMethodIconUnavailable],
    }),
  )
  .add(
    // a place to put an image before choosing it: one ticket, one file
    HttpApiEndpoint.post('prepareProviderIconUpload', '/auth/providers/:providerId/icon-uploads', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: Schema.Struct({
        filename: trimmedName(255),
        declaredMime: Schema.Literals(LOGIN_ICON_TYPES),
        /** decimal bytes */
        size: Schema.String.check(Schema.isPattern(/^[1-9]\d{0,6}$/)),
      }),
      success: Schema.Struct({
        reservationId: Schema.String,
        attachmentId: Schema.String,
        grant: Schema.Struct({ driver: Schema.String, payload: Schema.Unknown }),
        expiresAt: Schema.String,
      }),
      error: [ProviderNotFound, ProviderIconInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // how the door is drawn: one of the page's own icons, the image just
    // uploaded, or its kind's own again
    HttpApiEndpoint.put('setProviderIcon', '/auth/providers/:providerId/icon', {
      params: Schema.Struct({ providerId: uuidInput }),
      payload: Schema.Struct({
        icon: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal('builtin'),
            key: Schema.Literals(BUILTIN_LOGIN_ICONS),
          }),
          Schema.Struct({ kind: Schema.Literal('upload'), reservationId: uuidInput }),
          Schema.Struct({ kind: Schema.Literal('default') }),
        ]),
      }),
      success: Schema.Struct({ icon: loginMethodIcon, iconChosen: Schema.Boolean }),
      error: [ProviderNotFound, ProviderIconInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
