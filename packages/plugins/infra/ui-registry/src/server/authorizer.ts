import { Context, Effect, Layer } from 'effect'
import type { Principal } from '@qualy/rbac-contract'

// The one cross-plugin registration that genuinely inverts.
//
// Pages, routes and permission codes are descriptors: the assembly reads them
// without running anything, so under Effect they stop being registrations at
// all. The authorizer is not one of those. It is a live function rbac supplies
// and the manifest calls once per request, so somebody has to depend on
// somebody.
//
// It is a required service rather than a defaulted one, and that is the whole
// decision. A Context.Reference would be erased from the requirements channel,
// which means a wiring mistake could never be caught: an assembly that serves
// a manifest with no provider would build, boot, and quietly show every
// signed-in viewer nothing but public pages. Requiring it makes that a compile
// error instead, because the requirement survives all the way to the entry
// point.
//
// Deliberate absence keeps its old meaning, but has to be asked for.

export class UiAuthorizer extends Context.Service<
  UiAuthorizer,
  {
    /** which permission codes this viewer holds, anywhere in their tenant */
    readonly permissionsFor: (principal: Principal) => Effect.Effect<ReadonlySet<string>>
  }
>()('@qualy/plugin-ui-registry/UiAuthorizer') {}

/**
 * An assembly that deliberately serves no permission-gated surfaces.
 *
 * The same outcome the missing slot used to produce, except an operator has
 * to write it down. Every permission-gated page stays invisible; public and
 * authenticated ones are unaffected.
 */
export const denyAll: Layer.Layer<UiAuthorizer> = Layer.succeed(UiAuthorizer, {
  permissionsFor: () => Effect.succeed(new Set<string>()),
})
