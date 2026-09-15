import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { DeclaredRumProvider } from '../plugin.ts'

// What the browser will be told, offered by the provider while its own layer
// builds.
//
// A registry for one entry, which looks like overkill until you ask where
// else the settings could come from. They are read from the environment by
// the provider's plugin, because only that plugin knows what a reporting id
// is - and they have to reach a handler that must not know. A slot the
// provider fills on its way up is how those two facts live together.
//
// The barrier turns "declared but never registered" into a boot failure. A
// deployment that installed a reporting provider and came up quietly
// reporting nowhere is the failure nobody notices until they go looking for
// an incident that was never recorded.

export class RumProviders extends Context.Service<
  RumProviders,
  {
    /** the provider offering its public settings, once, during its own layer's build */
    readonly register: (entry: {
      readonly code: string
      /** what the browser receives verbatim; nothing secret has any business here */
      readonly publicConfig: Record<string, unknown>
    }) => Effect.Effect<void>
    /** what to serve, or nothing when this deployment reports nowhere */
    readonly selected: Effect.Effect<{
      readonly code: string
      readonly publicConfig: Record<string, unknown>
    } | null>
  }
>()('@qualy/plugin-rum/RumProviders') {}

export const registryLayer: Layer.Layer<RumProviders> = Layer.effect(
  RumProviders,
  Effect.sync(() => {
    let registered: {
      readonly code: string
      readonly publicConfig: Record<string, unknown>
    } | null = null
    return RumProviders.of({
      register: (entry) =>
        Effect.suspend(() => {
          if (registered !== null) {
            // the assembly already refused two declarations, so reaching here
            // means a provider registered twice from one layer
            return Effect.die(
              new Error(
                `browser reporting already has a provider ("${registered.code}"); "${entry.code}" cannot also register`,
              ),
            )
          }
          registered = entry
          return Effect.logDebug(`browser reporting provider "${entry.code}" registered`)
        }),
      selected: Effect.sync(() => registered),
    })
  }),
)

export const barrierLayer: Layer.Layer<
  never,
  never,
  RumProviders | DeclaredRumProvider | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const registry = yield* RumProviders
    const declared = yield* DeclaredRumProvider
    yield* assembled.register({
      name: 'rum/provider',
      run: Effect.gen(function* () {
        const selected = yield* registry.selected
        if (declared !== null && selected === null) {
          return yield* Effect.die(
            new Error(
              `${declared.pluginId} declares the browser reporting provider "${declared.code}" but never registered it`,
            ),
          )
        }
        yield* Effect.logDebug(
          selected === null
            ? 'browser reporting: no provider selected'
            : `browser reporting through "${selected.code}"`,
        )
      }),
    })
  }),
)
