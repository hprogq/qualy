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
  }
>()('@qualy/plugin-mail/MailBackends') {}

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
