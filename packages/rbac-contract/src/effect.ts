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
// It is not on the package root because the root reaches the browser through
// the oRPC contract chain while both runtimes coexist, and `effect` has no
// business in that bundle.

/**
 * Every permission this assembly serves, assembled before rbac is built.
 *
 * Plugins used to push their catalogs into rbac from their own constructors,
 * which a static graph cannot express: rbac would need to be built after every
 * contributor to be complete, and before them to answer their authorization
 * calls. The host resolves the catalog from the manifest instead, so rbac is
 * handed a finished one and is downstream of nobody.
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
 * packages/effect-spike/tests/ambient-transaction.test.ts.
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
}

export class Rbac extends Context.Service<Rbac, RbacShape>()('@qualy/rbac-contract/Rbac') {}
