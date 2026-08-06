import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { manifestPath } from './manifest.ts'

// Everything the assembly needs from its environment, in one place.
//
// Paths are anchored at this package rather than at the working directory, so
// the process behaves the same wherever it was started from. That was already
// true of the cordis entry point and is worth keeping.

export { manifestPath }

export class ServerConfig extends Context.Service<ServerConfig, { readonly port: number }>()(
  '@qualy/app/ServerConfig',
) {
  static readonly layer = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      return ServerConfig.of({
        port: yield* Config.port('PORT').pipe(Config.withDefault(3000)),
      })
    }),
  )
}

/**
 * Whether this instance serves its own API reference.
 *
 * `auto` serves it outside production, `public` serves it unconditionally (a
 * deliberate choice for something like a sandbox), `off` never does. The same
 * three-way setting the cordis plugin has always taken, and it belongs to the
 * host rather than to a plugin: it is a setup declaration, not a resource, and
 * nothing else needs to depend on the answer.
 *
 * The Effect port had been serving both the reference and the raw document
 * unconditionally, which exposes them in production.
 */
export const apiReferenceEnabled = Effect.gen(function* () {
  const exposure = yield* Config.literals(['auto', 'off', 'public'], 'QUALY_API_DOCS').pipe(
    Config.withDefault('auto' as const),
  )
  if (exposure === 'off') return false
  if (exposure === 'public') return true
  return (yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'))) !== 'production'
})
