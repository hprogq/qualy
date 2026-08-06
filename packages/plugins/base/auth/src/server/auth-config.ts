import { Config, Context, Effect, Layer, Schema } from 'effect'

// What this plugin knows about its own deployment, and how it works it out.
//
// Its own module because both the session middleware and the sign-in service
// need the service, and the middleware must not import the service to get it.
//
// The host used to build this: it read three environment variables on the
// plugin's behalf, which is why the composition root had to name this plugin
// at all. Now the assembly hands over this plugin's own manifest block and the
// plugin decides what it means - the host learns nothing about sessions.

/** what this plugin was told about its own deployment */
export class AuthConfig extends Context.Service<
  AuthConfig,
  {
    /** the tenant an anonymous visitor is offered a way into */
    readonly defaultTenantSlug: string
    readonly sessionTtlSeconds: number
    readonly secureCookies: boolean
  }
>()('@qualy/plugin-auth/AuthConfig') {}

/**
 * What this plugin accepts in `qualy.yml`.
 *
 * Nothing, so far: every setting here is a deployment fact rather than an
 * assembly one, and a deployment fact belongs in the environment where a
 * container can set it without editing a committed file. The schema exists
 * anyway, because it is what refuses a manifest block that says something this
 * plugin cannot read - silently ignoring one is how a setting comes to look
 * applied while nothing consumes it.
 */
export const AuthManifestConfig = Schema.Struct({})
export type AuthManifestConfig = typeof AuthManifestConfig.Type

/**
 * The configuration layer the generated runtime module builds.
 *
 * Takes the manifest block by value rather than reading the manifest: the
 * assembly already parsed it, and a plugin that went looking for the file
 * would have to be told where it is.
 */
export const config = (
  manifest: AuthManifestConfig,
  _context: { readonly manifestDir: string },
): Layer.Layer<AuthConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    AuthConfig,
    Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(AuthManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      return AuthConfig.of({
        defaultTenantSlug: yield* Config.string('QUALY_DEFAULT_TENANT').pipe(
          Config.withDefault('default'),
        ),
        sessionTtlSeconds: yield* Config.number('QUALY_SESSION_TTL_SECONDS').pipe(
          Config.withDefault(604_800),
        ),
        // secure whenever the process is not a development one, which is the
        // rule the cordis config expressed as an 'auto' setting
        secureCookies:
          (yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'))) ===
          'production',
      })
    }),
  )
