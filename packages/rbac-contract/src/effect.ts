import { Context, Effect, Layer, Schema, Scope } from 'effect'
import type {
  AccessProfile,
  ActivePermission,
  AuthorizationScope,
  PermissionDefinition,
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
 * Where a plugin puts the permissions it defines, while its layer is built.
 *
 * This is the cordis `definePermissions` back, and what makes it expressible
 * in a static graph is the host's assembled barrier: contributors build on
 * top of rbac - they need its services - so rbac cannot read a complete set
 * during its own construction. It reads at the barrier instead, after every
 * layer has been built and before the port binds, so no request can observe
 * the window in which the catalog is still filling.
 *
 * Provided by rbac, like `Ui` is provided by the registry that reads it: the
 * reader owns the registry, and an assembly without authorization has neither
 * the service nor anyone asking for it.
 */
export class Permissions extends Context.Service<
  Permissions,
  {
    /**
     * Claims these codes for as long as the declaring layer lives.
     *
     * The same code declared twice has no owner - authorization would answer
     * with whichever definition arrived last - so a duplicate refuses the
     * build and names both plugins.
     */
    readonly declare: (
      owner: string,
      permissions: readonly PermissionDefinition[],
    ) => Effect.Effect<void, never, Scope.Scope>
    /** everything declared so far; complete only at the assembled barrier */
    readonly declared: Effect.Effect<readonly ActivePermission[]>
  }
>()('@qualy/rbac-contract/Permissions') {}

/**
 * One plugin's catalog, as a layer for its composition root.
 *
 * The owner is the plugin's short name - the value a stored permission row
 * records - and the seed derives the same name from the package id, so the
 * two writers of that column cannot disagree.
 */
export const declarePermissions = (
  owner: string,
  permissions: readonly PermissionDefinition[],
): Layer.Layer<never, never, Permissions> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* Permissions
      yield* registry.declare(owner, permissions)
    }),
  )

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

export class Rbac extends Context.Service<Rbac, RbacShape>()('@qualy/rbac-contract/Rbac') {}
