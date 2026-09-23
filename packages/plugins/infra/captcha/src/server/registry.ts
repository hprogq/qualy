import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { DeclaredCaptchaProvider } from '../plugin.ts'
import type { CaptchaProvider } from './provider.ts'

// The provider, offered while its own layer builds.
//
// A slot for one, filled by the provider's plugin because only it knows what
// its challenges are made of - keys, a vendor's secret, a table of spent
// proofs - and read by the guard, which must not know.
//
// The barrier turns "declared but never registered" into a boot failure: a
// deployment that installed a provider and came up quietly letting every
// challenged request through is the failure nobody notices. Having no
// provider at all is allowed, and said once at start: the protection it
// would have given is missing, and that must be visible.

export class CaptchaProviders extends Context.Service<
  CaptchaProviders,
  {
    /** the provider offering itself, once, during its own layer's build */
    readonly register: (provider: CaptchaProvider) => Effect.Effect<void>
    /** the provider challenges come from, or nothing in a deployment without one */
    readonly selected: Effect.Effect<CaptchaProvider | null>
  }
>()('@qualy/plugin-captcha/CaptchaProviders') {}

export const registryLayer: Layer.Layer<CaptchaProviders> = Layer.effect(
  CaptchaProviders,
  Effect.sync(() => {
    let registered: CaptchaProvider | null = null
    return CaptchaProviders.of({
      register: (provider) =>
        Effect.suspend(() => {
          if (registered !== null) {
            // the assembly already refused two declarations, so reaching here
            // means a provider registered twice from one layer
            return Effect.die(
              new Error(
                `challenges already come from "${registered.code}"; "${provider.code}" cannot also register`,
              ),
            )
          }
          registered = provider
          return Effect.logDebug(`captcha provider "${provider.code}" registered`)
        }),
      selected: Effect.sync(() => registered),
    })
  }),
)

export const barrierLayer: Layer.Layer<
  never,
  never,
  CaptchaProviders | DeclaredCaptchaProvider | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const registry = yield* CaptchaProviders
    const declared = yield* DeclaredCaptchaProvider
    yield* assembled.register({
      name: 'captcha/provider',
      run: Effect.gen(function* () {
        const selected = yield* registry.selected
        if (declared !== null && selected === null) {
          return yield* Effect.die(
            new Error(
              `${declared.pluginId} declares the captcha provider "${declared.code}" but never registered it`,
            ),
          )
        }
        if (selected === null) {
          yield* Effect.logWarning(
            'captcha: no provider selected; challenged requests will bypass CAPTCHA',
          )
          return
        }
        yield* Effect.logDebug(`captcha: challenges come from "${selected.code}"`)
      }),
    })
  }),
)
