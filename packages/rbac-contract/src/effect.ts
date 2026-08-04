import { Context } from 'effect'
import type { ActivePermission } from './index.ts'

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
