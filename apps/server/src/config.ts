import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { manifestMigrationsFolder, manifestPath } from './manifest.ts'
import { DatabaseConfig } from '@qualy/plugin-database/server'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import { permissionCatalog } from '../permissions.gen.ts'

// Everything the assembly needs from its environment, in one place.
//
// Paths are anchored at this package rather than at the working directory, so
// the process behaves the same wherever it was started from. That was already
// true of the cordis entry point and is worth keeping.

export { manifestMigrationsFolder, manifestPath }

export const localFallback = 'postgres://qualy:qualy@localhost:5432/qualy'

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
 * The database's configuration, supplied by the assembly.
 *
 * The plugin declares that it needs this and does not read the environment
 * itself, so where the lineage lives is a fact about the assembly rather than
 * a guess made from the working directory.
 */
export const databaseConfigLayer = Layer.effect(
  DatabaseConfig,
  Effect.gen(function* () {
    // asking whether it was set, rather than comparing the value: the local
    // default is a real connection string somebody may well have configured
    // on purpose, and warning about their own setting is noise
    const configured = yield* Config.option(Config.string('DATABASE_URL'))
    const url = Option.getOrElse(configured, () => localFallback)
    if (Option.isNone(configured)) {
      yield* Effect.logWarning(`DATABASE_URL is not set, falling back to ${localFallback}`)
    }
    return DatabaseConfig.of({
      url: Redacted.make(url),
      // 'off' leaves the lineage to a deployment job; the layer then refuses
      // to build if the database is behind
      migrations: yield* Config.literals(['apply', 'off'], 'QUALY_MIGRATIONS').pipe(
        Config.withDefault('apply' as const),
      ),
      // Read from the manifest, not hardcoded here.
      //
      // `qualy generate` and `qualy deploy` take this folder from the database
      // plugin's config block, so a copy of the path in this file is a second
      // place the answer lives: point the manifest somewhere else and the CLI
      // writes one lineage while the process applies another. Same default as
      // the CLI's, for the same reason - a manifest need not say.
      migrationsFolder: manifestMigrationsFolder(),
    })
  }),
)

/**
 * The permission catalog this assembly serves.
 *
 * Generated from the manifest, so what a deployment can authorize is decided
 * by resolution rather than by which plugins happened to finish constructing.
 * The host supplies it the same way it supplies the database's config: the
 * plugin that consumes it does not go looking for it.
 */
export const permissionCatalogLayer = Layer.succeed(PermissionCatalog, permissionCatalog)

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
