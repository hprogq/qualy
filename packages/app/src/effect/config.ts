import { fileURLToPath, pathToFileURL } from 'node:url'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { DatabaseConfig } from '@qualy/plugin-database/effect'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { AuthConfig } from '@qualy/plugin-auth/effect/sign-in'
import { permissionCatalog } from '../../permissions.gen.ts'
import { loginDrivers } from '../../login-drivers.gen.ts'

// Everything the assembly needs from its environment, in one place.
//
// Paths are anchored at this package rather than at the working directory, so
// the process behaves the same wherever it was started from. That was already
// true of the cordis entry point and is worth keeping.

const appRoot = fileURLToPath(new URL('../../', import.meta.url))

export const localFallback = 'postgres://qualy:qualy@localhost:5432/qualy'

export class ServerConfig extends Context.Service<
  ServerConfig,
  { readonly port: number }
>()('@qualy/app/ServerConfig') {
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
      // relative to the app package, the same declaration qualy.yml carries,
      // so both runtimes mean one directory
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', pathToFileURL(appRoot))),
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
 * The login drivers this assembly serves.
 *
 * Generated from the manifest for the same reason the permission catalog is:
 * which ways in a deployment offers is decided by resolution, not by which
 * plugins happened to finish constructing.
 */
export const loginDriversLayer = Layer.succeed(LoginDrivers, loginDrivers)

/**
 * What auth needs to know about this deployment.
 *
 * Cookies are secure whenever the process is not a development one, which is
 * the same rule the cordis config expressed as an 'auto' setting.
 */
export const authConfigLayer = Layer.effect(
  AuthConfig,
  Effect.gen(function* () {
    return AuthConfig.of({
      defaultTenantSlug: yield* Config.string('QUALY_DEFAULT_TENANT').pipe(
        Config.withDefault('default'),
      ),
      sessionTtlSeconds: yield* Config.number('QUALY_SESSION_TTL_SECONDS').pipe(
        Config.withDefault(604_800),
      ),
      secureCookies: (yield* Config.string('NODE_ENV').pipe(Config.withDefault('development')))
        === 'production',
    })
  }),
)
