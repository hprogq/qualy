import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { readManifest } from '@qualy/assembly'
import { DatabaseConfig } from '@qualy/plugin-database/effect'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { AuthConfig } from '@qualy/plugin-auth/effect/sign-in'
import { permissionCatalog } from '../../permissions.gen.ts'
import { loginDrivers } from '../../login-drivers.gen.ts'
import { UiCatalog } from '@qualy/plugin-ui-registry/effect'
import { WebConfig } from '@qualy/plugin-web/effect'
import { uiSurfaces } from '../../ui.gen.ts'

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

/** the manifest this process was started with, the same one main.ts verifies */
export const manifestPath = (): string =>
  process.env.QUALY_CONFIG
    ? path.resolve(process.env.QUALY_CONFIG)
    : path.join(appRoot, 'qualy.yml')

/**
 * Where the lineage lives, as the manifest declares it.
 *
 * The path is relative to the manifest rather than to the working directory,
 * which is what lets `qualy generate` and this process agree from anywhere.
 */
export const manifestMigrationsFolder = (): string => {
  const file = manifestPath()
  const declared = (readManifest(file).plugins.get('@qualy/plugin-database')?.config ?? {}) as {
    migrationsFolder?: string
  }
  const folder = declared.migrationsFolder ?? 'db/migrations'
  return path.isAbsolute(folder) ? folder : path.resolve(path.dirname(file), folder)
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

/**
 * The shell's surfaces, as this assembly resolved them.
 *
 * A page and a slot item are descriptors, so the manifest is a projection over
 * declarations rather than over whatever plugins managed to register. Which
 * screens exist is decided at resolution and checked by the generator, which
 * refuses a page id, a path or a layout contract claimed twice.
 */
export const uiCatalogLayer = Layer.succeed(UiCatalog, uiSurfaces)

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

/**
 * How the browser application is served.
 *
 * `auto` follows NODE_ENV, which is the same rule the cordis config expressed.
 * Which mode this is decides whether the process owns a Vite server or a static
 * file handler, so it is a deployment fact rather than anything a plugin can
 * work out for itself.
 */
export const webConfigLayer = Layer.effect(
  WebConfig,
  Effect.gen(function* () {
    const mode = yield* Config.literals(['auto', 'development', 'production'], 'QUALY_WEB_MODE').pipe(
      Config.withDefault('auto' as const),
    )
    const environment = yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'))
    return WebConfig.of({
      mode: mode === 'auto' ? (environment === 'production' ? 'production' : 'development') : mode,
    })
  }),
)
