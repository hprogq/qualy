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
  /**
   * The local api a plugin implements its group against.
   *
   * It exists so a plugin builds handlers without importing the aggregate
   * that will contain them, and it carries the aggregate's identity - the
   * api id, which brands the handler layer, and the prefix, which places the
   * routes. Both are the aggregate's business: a plugin that spelled them
   * would be repeating somebody else's decision, and a typo would surface as
   * a handler layer the aggregate cannot accept or a route the document does
   * not describe.
   */
  local: <const A extends readonly [HttpApiGroup.Constraint, ...HttpApiGroup.Constraint[]]>(
    ...groups: A
  ) =>
    HttpApi.make(QUALY_API_ID)
      .add(...groups)
      .prefix(QUALY_API_PREFIX),

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
    readonly documentation?: Effect.Effect<ApiDocumentation, unknown>
  }): PluginFeature =>
    Plugin.provideExtension(ApiGroups, {
      compile: (contributions) => {
        // A group identifier claimed twice would resolve to whichever handler
        // layer merged last; upstream's aggregate has no reason to know two
        // plugins were involved, so the refusal happens here, naming both.
        const owners = new Map<string, string>()
        for (const contribution of contributions) {
          const identifier = contribution.value.group.identifier
          const previous = owners.get(identifier)
          if (previous) {
            throw new Error(
              `api group ${identifier} is declared by both ${previous} and ${contribution.pluginId}`,
            )
          }
          owners.set(identifier, contribution.pluginId)
        }
        let api = HttpApi.make(QUALY_API_ID) as unknown as HttpApiType.HttpApi<
          string,
          HttpApiGroup.Constraint
        >
        for (const contribution of contributions) {
          api = api.add(contribution.value.group)
        }
        const runtime = api.prefix(QUALY_API_PREFIX)
        const handlers = Layer.mergeAll(
          Layer.empty,
          ...contributions.map((entry) => entry.value.handlers),
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
    compile: (contributions) =>
      Layer.mergeAll(Layer.empty, ...contributions.map((entry) => entry.value)),
  }),
}
