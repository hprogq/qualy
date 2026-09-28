import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { DeclaredRumProvider } from '../plugin.ts'
import { RUM_REPORTING_VARIABLE, RumReporting } from './config.ts'

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
// an incident that was never recorded. With reporting switched off
// (config.ts) the provider stays idle and registers nothing, and that is the
// one way a declared provider may go unregistered.

export class RumProviders extends Context.Service<
  RumProviders,
  {
    /** whether this deployment reports; a provider registers only while it does */
    readonly reporting: boolean
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

export const registryLayer: Layer.Layer<RumProviders, never, RumReporting> = Layer.effect(
  RumProviders,
  Effect.gen(function* () {
    const { on } = yield* RumReporting
    let registered: {
      readonly code: string
      readonly publicConfig: Record<string, unknown>
    } | null = null
    return RumProviders.of({
      reporting: on,
      register: (entry) =>
        Effect.suspend(() => {
          if (!on) {
            return Effect.die(
              new Error(
                `browser reporting is off (${RUM_REPORTING_VARIABLE}); "${entry.code}" cannot register`,
              ),
            )
          }
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
        if (!registry.reporting) {
          yield* Effect.logDebug(
            declared === null
              ? `browser reporting is off (${RUM_REPORTING_VARIABLE})`
              : `browser reporting is off (${RUM_REPORTING_VARIABLE}); ${declared.pluginId} stays idle`,
          )
          return
        }
        if (declared === null) {
          return yield* Effect.die(
            new Error(
              `${RUM_REPORTING_VARIABLE}=on but this release enables no browser reporting provider; enable one in the manifest or switch reporting off`,
            ),
          )
        }
        if (selected === null) {
          return yield* Effect.die(
            new Error(
              `${declared.pluginId} declares the browser reporting provider "${declared.code}" but never registered it`,
            ),
          )
        }
        yield* Effect.logDebug(`browser reporting through "${selected.code}"`)
      }),
    })
  }),
)
