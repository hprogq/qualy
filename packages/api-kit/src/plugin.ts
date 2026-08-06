import { Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
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

export const Api = {
  /** declares one group and the handlers behind it */
  group: (group: HttpApiGroup.Constraint, handlers: AnyLayer): PluginFeature =>
    Plugin.contribute(ApiGroups, { group, handlers }),

  /**
   * The owner's interpretation: the runtime aggregate.
   *
   * The one type erasure of the model lives in this loop - `add` demands the
   * literal group type, which a runtime list cannot carry. It is contained
   * here: every plugin's group, handlers and client keep their own inference,
   * and what the erased aggregate serves is checked by the boot smoke rather
   * than the compiler. The openapi document comes from the same value.
   */
  provider: Plugin.provideExtension(ApiGroups, {
    compile: (contributions) => {
      let api = HttpApi.make(QUALY_API_ID) as unknown as HttpApiType.HttpApi<
        string,
        HttpApiGroup.Constraint
      >
      for (const contribution of contributions) {
        api = api.add(contribution.group)
      }
      const runtime = api.prefix(QUALY_API_PREFIX)
      return HttpApiBuilder.layer(runtime).pipe(
        Layer.provide(Layer.mergeAll(Layer.empty, ...contributions.map((entry) => entry.handlers))),
      )
    },
  }),
}
