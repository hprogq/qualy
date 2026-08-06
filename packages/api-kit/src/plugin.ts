import { Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import type { HttpApi as HttpApiType, HttpApiGroup } from 'effect/unstable/httpapi'
import { ExtensionPoint, Plugin, type AnyLayer, type PluginFeature } from '@qualy/plugin-kit'
import { QUALY_API_ID, QUALY_API_PREFIX } from './index.ts'

// The http api's face in the descriptor model.
//
// A group's handler layer is a value, and a value defers: nothing builds
// until the assembler composes it, so a plugin hands over the layer it
// already knows how to type - upstream inference intact - and the phase does
// the rest. `afterServices` is not a preference but what upstream types
// demand: a group's middleware is implemented by other plugins, and that is
// a real requirement of the group layer, so handlers can only close above
// the complete service graph.

export interface ApiGroupContribution {
  readonly group: HttpApiGroup.Constraint
  /** the group's handlers, exactly as HttpApiBuilder.group typed them */
  readonly handlers: AnyLayer
}

/** every plugin's api group with its handler layer, in plugin order */
export const ApiGroups = ExtensionPoint.make<ApiGroupContribution>('@qualy/api-kit/groups', {
  phase: 'afterServices',
})

/**
 * Routes that are not api endpoints and cannot be: the browser shell is a raw
 * handler on the router's wildcard. Same phase as the handlers, for the same
 * reason - a route serves with whatever services exist.
 */
export const RawRoutes = ExtensionPoint.make<AnyLayer>('@qualy/api-kit/routes', {
  phase: 'afterServices',
})

/** what the host decides to expose about the api's own description */
export interface ApiDocumentation {
  /** where the openapi document is served, if anywhere */
  readonly spec?: `/${string}`
  /** where the reference ui is served, if anywhere */
  readonly reference?: `/${string}`
}

export const Api = {
  /** declares one group and the handlers behind it */
  group: (group: HttpApiGroup.Constraint, handlers: AnyLayer): PluginFeature =>
    Plugin.contribute(ApiGroups, { group, handlers }),

  /** declares raw routes, registered beside the api on the same router */
  routes: (routes: AnyLayer): PluginFeature => Plugin.contribute(RawRoutes, routes),

  /**
   * The owner's interpretation: the runtime aggregate.
   *
   * The one type erasure of the model lives in this loop - `add` demands the
   * literal group type, which a runtime list cannot carry. It is contained
   * here: every plugin's group, handlers and client keep their own inference,
   * and what the erased aggregate serves is checked by the boot smoke rather
   * than the compiler. The openapi document and the reference ui come from
   * the same value, where the host's exposure decision says so.
   */
  provider: (options?: {
    readonly documentation?: Effect.Effect<ApiDocumentation>
  }): PluginFeature =>
    Plugin.provideExtension(ApiGroups, {
      compile: (contributions) => {
        let api = HttpApi.make(QUALY_API_ID) as unknown as HttpApiType.HttpApi<
          string,
          HttpApiGroup.Constraint
        >
        for (const contribution of contributions) {
          api = api.add(contribution.group)
        }
        const runtime = api.prefix(QUALY_API_PREFIX)
        const handlers = Layer.mergeAll(
          Layer.empty,
          ...contributions.map((entry) => entry.handlers),
        )
        return Layer.unwrap(
          Effect.map(options?.documentation ?? Effect.succeed<ApiDocumentation>({}), (docs) =>
            Layer.mergeAll(
              HttpApiBuilder.layer(runtime, docs.spec ? { openapiPath: docs.spec } : {}).pipe(
                Layer.provide(handlers),
              ),
              docs.reference ? HttpApiScalar.layer(runtime, { path: docs.reference }) : Layer.empty,
            ),
          ),
        )
      },
    }),

  /** the raw-routes interpretation: registration order carries no meaning */
  routesProvider: Plugin.provideExtension(RawRoutes, {
    compile: (contributions) => Layer.mergeAll(Layer.empty, ...contributions),
  }),
}
