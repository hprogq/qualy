import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { DeclaredMailBackends } from '../plugin.ts'
import type { MailBackend } from './backend.ts'
import { MailConfig } from './config.ts'

// Which backend delivers, registered by the backends themselves while their
// layers build - they depend on this plugin, so the registry exists by then -
// and checked at the barrier: a backend declared and never registered, or a
// default nobody installed, fails the boot rather than the first reset mail.

export class MailBackends extends Context.Service<
  MailBackends,
  {
    /** a backend offering itself, once, during its own layer's build */
    readonly register: (backend: MailBackend) => Effect.Effect<void>
    /** the deployment's choice; absent only in a boot the barrier refuses */
    readonly forSend: Effect.Effect<MailBackend | undefined>
    readonly installed: Effect.Effect<readonly string[]>
    /** the code of the backend this deployment sends through */
    readonly selected: string
  }
>()('@qualy/plugin-mail/MailBackends') {}

/** a backend's settings as the deployment gave them, or why they cannot send */
export type BackendSettings<S> = { readonly settings: S } | { readonly refusal: string }

/**
 * Offers a backend to the registry under the one rule every backend keeps:
 * its own settings must be complete only while it is the one that sends.
 *
 * Several backends may be enabled at once and the deployment picks one, so
 * a backend nobody picked has no reason to stop the product for a relay or
 * a key it will never use. The one picked still refuses to start without
 * them, with the backend's own words. The unpicked one registers all the
 * same - the barrier holds every declared backend to registering - as a
 * backend that cannot be reached for sending.
 */
export const offerBackend = <S, R>(
  code: string,
  configured: BackendSettings<S>,
  make: (settings: S) => Effect.Effect<MailBackend, never, R>,
): Effect.Effect<void, never, MailBackends | R> =>
  Effect.gen(function* () {
    const registry = yield* MailBackends
    if ('settings' in configured) return yield* registry.register(yield* make(configured.settings))
    if (registry.selected === code) return yield* Effect.die(new Error(configured.refusal))
    yield* registry.register({
      code,
      // forSend only ever hands out the selected backend
      send: () => Effect.die(new Error(configured.refusal)),
    })
    yield* Effect.logDebug(`mail backend "${code}" is not the one that sends, and is not set up`)
  })

export const registryLayer: Layer.Layer<MailBackends, never, MailConfig> = Layer.effect(
  MailBackends,
  Effect.gen(function* () {
    const config = yield* MailConfig
    const backends = new Map<string, MailBackend>()
    return MailBackends.of({
      register: (backend) =>
        Effect.suspend(() => {
          if (backends.has(backend.code)) {
            return Effect.die(new Error(`two mail backends registered as "${backend.code}"`))
          }
          backends.set(backend.code, backend)
          return Effect.logDebug(`mail backend "${backend.code}" registered`)
        }),
      forSend: Effect.sync(() => backends.get(config.defaultBackend)),
      installed: Effect.sync(() => [...backends.keys()]),
      selected: config.defaultBackend,
    })
  }),
)

export const barrierLayer: Layer.Layer<
  never,
  never,
  MailBackends | MailConfig | DeclaredMailBackends | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const registry = yield* MailBackends
    const declared = yield* DeclaredMailBackends
    const config = yield* MailConfig
    yield* assembled.register({
      name: 'mail/backends',
      run: Effect.gen(function* () {
        const installed = yield* registry.installed
        const missing = declared
          .filter((declaration) => !installed.includes(declaration.code))
          .map((declaration) => `${declaration.code} (${declaration.pluginId})`)
        if (missing.length > 0) {
          return yield* Effect.die(
            new Error(`mail backends declared but never registered: ${missing.join(', ')}`),
          )
        }
        if (!installed.includes(config.defaultBackend)) {
          return yield* Effect.die(
            new Error(
              `the default mail backend "${config.defaultBackend}" is not installed; selected: ${
                installed.join(', ') || 'none'
              }`,
            ),
          )
        }
      }),
    })
  }),
)
