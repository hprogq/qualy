import { Context, Effect, Schema } from 'effect'
import type {
  AccessProfile,
  ActivePermission,
  AuthorizationScope,
  PermissionTarget,
  Principal,
} from './index.ts'

// The Effect side of this contract, deliberately behind its own subpath.
//
// A service tag is a value, not an ambient type, so whoever calls rbac has to
// import one. Importing it from @qualy/plugin-rbac would be a real cycle:
// rbac value-imports org's and auth's schema for foreign keys, and they would
// then value-import rbac. Declaring the tag here, in a package with no plugin
// dependencies, keeps the implementation below its consumers.
//
// It is not on the package root because the root reaches the browser, and
// `effect` has no business in that bundle.

/**
 * Every permission this assembly serves, complete before any layer builds.
 *
 * A prepare-phase value: the assembler compiles every plugin's declaration
 * before it builds a single service, so rbac - and everything above it - is
 * handed a finished catalog and is downstream of nobody. This replaced a
 * boot-time registry which replaced an earlier value; what settled it is the
 * descriptor model making the declarations collectable without running
 * anything, which the registry existed to work around.
 */
export class PermissionCatalog extends Context.Service<
  PermissionCatalog,
  readonly ActivePermission[]
>()('@qualy/rbac-contract/PermissionCatalog') {}

/** the principal is not allowed to do this, wherever the check was made */
export class AccessDenied extends Schema.TaggedErrorClass<AccessDenied>()(
  // the wire code is upper snake like every other domain error; the readable
  // name is the schema identifier, which is what the document shows
  'ACCESS_DENIED',
  { reason: Schema.String },
  { httpApiStatus: 403, identifier: 'AccessDenied' },
) {}

/**
 * The invariant that spans identity and access.
 *
 * Declared here because either side can violate it: disabling a user is an
 * auth operation, revoking their administrator role is an rbac one, and both
 * can leave a tenant unable to administer itself. A tenant must never learn
 * about that difference, so there is one code and one translation.
 */
export class LastAdministrator extends Schema.TaggedErrorClass<LastAdministrator>()(
  'LAST_ADMINISTRATOR',
  {},
  { httpApiStatus: 409, identifier: 'LastAdministrator' },
) {}

/**
 * What an authorization call can fail with, from a caller's point of view.
 *
 * Deliberately narrow. A database that is unreachable is a defect rather than
 * something a handler chooses between, so it is not here: a caller decides
 * what to do about being denied, not about the pool being down.
 */
export type RbacFailure = AccessDenied

/**
 * What rbac answers, as the rest of the assembly sees it.
 *
 * No handle parameter anywhere. Under cordis each of these took the caller's
 * transaction so the check would land on the locked connection; the connection
 * now travels in the fiber, so a call made inside a transaction joins it by
 * construction rather than by remembering to pass an argument. Verified in
 * packages/plugins/base/auth/tests/effect-placement.test.ts, where a peer's
 * refusal rolls back the caller's uncommitted write.
 *
 * No definePermissions either: the catalog is resolved from the manifest and
 * handed to rbac rather than pushed into it by whoever happens to load.
 *
 * And no grant or revoke. A port carries what peers need, not everything the
 * plugin does: neither auth nor org administers grants, so those stay rbac's
 * own API and never become a surface anyone else can reach through a tag.
 */
export interface RbacShape {
  /** the active catalog: a code outside this set authorizes nothing */
  readonly listPermissions: (filter?: {
    target?: PermissionTarget
    plugin?: string
  }) => Effect.Effect<readonly ActivePermission[]>
  readonly getPermission: (code: string) => Effect.Effect<ActivePermission | undefined>

  readonly hasPermission: (principal: Principal, code: string) => Effect.Effect<boolean>
  readonly require: (principal: Principal, code: string) => Effect.Effect<void, AccessDenied>
  readonly canAt: (
    principal: Principal,
    code: string,
    targetOrgNodeId: string,
  ) => Effect.Effect<boolean>
  readonly requireAt: (
    principal: Principal,
    code: string,
    targetOrgNodeId: string,
  ) => Effect.Effect<void, AccessDenied>
  readonly getProfile: (principal: Principal) => Effect.Effect<AccessProfile>

  /** how far one org-target permission reaches; consumers project it themselves */
  readonly listAuthorizedScope: (
    principal: Principal,
    code: string,
  ) => Effect.Effect<AuthorizationScope>

  /**
   * Who holds these capabilities anywhere inside these organizational nodes,
   * and by which grant.
   *
   * For consumers that need to know not only whether somebody may act, but
   * who may act and where the authority comes from - so that they can watch
   * that source rather than re-deciding for themselves. The grant id is the
   * handle: while it exists and its role is active, the authority stands;
   * revoke it and everything derived from it falls with it.
   */
  readonly listApplicableAssignments: (input: {
    tenantId: string
    codes: readonly string[]
    nodeIds: readonly string[]
    /** also include authority confined to exactly this object */
    resource?: ResourceRef
  }) => Effect.Effect<readonly ApplicableAssignment[]>

  /**
   * What one person has been given, said the way a reader asks it: which
   * duties, and where.
   *
   * A plain reading with no judgement in it - the caller has already decided
   * whether this person is theirs to look at. Withdrawn and expired grants
   * are left out, because a list of what somebody may do must not include
   * what they no longer may.
   */
  readonly listUserRoles: (
    tenantId: string,
    userId: string,
  ) => Effect.Effect<readonly UserRoleHolding[]>

  /**
   * Which roles this caller could actually give this person at this place.
   *
   * Every candidate goes through the checks the write performs, so a consumer
   * offering this list cannot promise something the grant then refuses. A
   * user or node that is not there comes back as an empty list: the write is
   * still the thing that decides, and a port is no place for the difference
   * between "nothing on offer" and "no such person".
   */
  readonly listGrantableRoles: (input: {
    tenantId: string
    actor: Principal
    userId: string
    orgNodeId: string
    coverage?: 'self' | 'subtree'
  }) => Effect.Effect<readonly RoleCandidate[]>

  /** what a role carries right now, which is what an acceptance is measured against */
  readonly getRolePermissions: (
    tenantId: string,
    roleId: string,
  ) => Effect.Effect<readonly string[]>

  /**
   * Authority over one object, for somebody who has none in general.
   *
   * The plugin that owns the object names it; this one stores three opaque
   * strings and confines the grant to them. Scope is immutable by
   * construction: changing who, what or where means revoking and granting
   * again, so nothing widens under a consumer that has already accepted it.
   */
  readonly createScopedAssignment: (input: {
    tenantId: string
    subjectId: string
    roleId: string
    orgNodeId: string
    includeDescendants: boolean
    resource: ResourceRef
    validUntil?: number
    /**
     * Who is handing this out. The full grant path runs against them - may
     * they administer grants there, is the office theirs to appoint, does
     * the role's authority exceed their own, is the subject themselves - so
     * a resource cannot be a doorway around the rules the org side keeps.
     */
    actor: Principal
  }) => Effect.Effect<string, AccessDenied>

  readonly revokeAssignment: (input: {
    tenantId: string
    assignmentId: string
    actorId: string | null
  }) => Effect.Effect<boolean>

  /**
   * After the caller's own writes, the tenant must still have an administrator
   * who can sign in.
   *
   * Reads the final state rather than a prediction, so it belongs inside the
   * caller's transaction. That used to be expressed by a required handle; it
   * is now a property of where the call is made.
   */
  readonly assertTenantKeepsAdministrator: (
    tenantId: string,
  ) => Effect.Effect<void, LastAdministrator>

  /** role codes of org-kind grants at the node whose role forbids the given org type */
  readonly grantsBlockingOrgType: (
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
  ) => Effect.Effect<readonly string[]>

  /**
   * How many roles would be left assignable to nobody if this user type went.
   *
   * Eligibility rows cascade with the type, which would silently empty a
   * role's allowed set. Asked of every kind of role, because a tenant role
   * declares who may hold it too: looking only at org roles once left a live
   * tenant role behind with nobody eligible for it.
   *
   * Here rather than in auth because it is a question about roles. auth used
   * to read these tables directly, which is a thing its entity closure now
   * refuses to express.
   */
  readonly rolesStrandedByUserType: (tenantId: string, userTypeId: string) => Effect.Effect<number>

  /**
   * How many of a person's grants the new user type would not be eligible for.
   *
   * The canonical administrator is exempt, since its authority does not come
   * from eligibility.
   */
  readonly grantsBlockingUserType: (
    tenantId: string,
    userId: string,
    userTypeId: string,
  ) => Effect.Effect<number>
}

/** an object some authority is confined to, as three opaque strings */
export interface ResourceRef {
  readonly namespace: string
  readonly type: string
  readonly id: string
}

/** one assignment's authority over one part of the tree */
/**
 * A role considered for one person at one place, and why it cannot be given
 * if it cannot.
 *
 * Refused candidates come back rather than vanishing: a screen that says
 * "this role needs a different kind of user" tells somebody what to change,
 * where a shorter list only says no with no subject.
 */
export interface RoleCandidate {
  readonly id: string
  readonly code: string
  readonly name: string
  /** null when this caller could give it here and now */
  readonly refusal: 'user-type' | 'authority' | 'unavailable' | null
}

/** one duty somebody holds, and the place it applies */
export interface UserRoleHolding {
  readonly grantId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly kind: 'tenant' | 'org'
  /** null for a tenant-wide grant, which reaches the whole tree */
  readonly orgNodeId: string | null
  readonly orgNodeName: string | null
  readonly coverage: 'self' | 'subtree' | null
  /** confined to one object rather than held in general */
  readonly scoped: boolean
}

export interface ApplicableAssignment {
  /** revoking this revokes everything derived from it */
  readonly assignmentId: string
  readonly userId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  /** null for a tenant-wide assignment, which reaches the whole tree */
  readonly orgNodeId: string | null
  readonly coverage: 'self' | 'subtree' | null
  /** set when the assignment is confined to the object that was asked about */
  readonly resourceId: string | null
  /** which of the requested codes it carries */
  readonly codes: readonly string[]
}

export class Rbac extends Context.Service<Rbac, RbacShape>()('@qualy/rbac-contract/Rbac') {}
