import { Config, Context, Effect, Layer, Option, Schema } from 'effect'
import { sessionCookieNameFor } from './session-cookie.ts'
import { allowlistEntryValid, type OutboundPolicy } from './outbound.ts'
import { decodePluginConfig } from '@qualy/plugin-kit/config'
import { DEMO_ACCOUNTS_MALFORMED, parseDemoAccounts, type DemoAccount } from './demo-accounts.ts'

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
    /** the one cookie name this process reads and writes; `__Host-` prefixed when secure */
    readonly sessionCookieName: string
    /**
     * A failed boot check refuses to start instead of warning. On in
     * production; absent means a warning, which is what development and a
     * test stack want.
     */
    readonly strictBoot?: boolean
    /**
     * The address the outside world reaches this deployment at, as an origin
     * with nothing after it. Undefined where none is configured, which is
     * legal until an entrance needs to be redirected back to.
     */
    readonly publicUrl?: string
    /**
     * What a login entrance's upstream may be. Absent means what the
     * deployment's kind implies: https and public addresses only in
     * production; plain http and the machine's own services too in
     * development, where a local identity server is how an entrance is tried.
     */
    readonly outbound?: OutboundPolicy
    /**
     * Accounts a demonstration deployment hands out: offered on the sign-in
     * page, and their credentials frozen. Empty everywhere else.
     */
    readonly demoAccounts?: readonly DemoAccount[]
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
export const PRIVATE_ALLOWLIST_MALFORMED =
  'QUALY_AUTH_PRIVATE_PROVIDER_ALLOWLIST must be a comma-separated list of hostnames, addresses or CIDR blocks'

export const PUBLIC_URL_MALFORMED =
  'QUALY_PUBLIC_URL must be an absolute http(s) origin with no path, such as https://qualy.example.edu'

export const PUBLIC_URL_INSECURE =
  'QUALY_PUBLIC_URL must be https in production: a sign-in redirected back over http is one anybody on the path can take'

/** where a development machine is reached, which is where the browser is served */
export const DEVELOPMENT_PUBLIC_URL = 'http://localhost:5173'

/**
 * An origin and nothing else: no path, no query, no fragment, no credentials.
 *
 * Everything built from it is built by appending, so a trailing path would
 * quietly move every callback; a query or a credential in it would be carried
 * into addresses handed to somebody else's server.
 */
export const publicOriginFrom = (raw: string): string | undefined => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (url.search !== '' || url.hash !== '') return undefined
  if (url.pathname !== '/' && url.pathname !== '') return undefined
  return url.origin
}

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
  // the block as the manifest parses it: unknown until the schema says
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<AuthConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    AuthConfig,
    Effect.gen(function* () {
      yield* decodePluginConfig(AuthManifestConfig, manifest)
      // secure whenever the process is a production one, which is the rule
      // the cordis config expressed as an 'auto' setting; the same fact
      // makes a failed boot check fatal
      const secureCookies =
        (yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'))) === 'production'
      const declaredUrl = yield* Config.option(Config.String('QUALY_PUBLIC_URL'))
      const askedFor = Option.map(declaredUrl, (value) => value.trim()).pipe(
        Option.filter((value) => value !== ''),
      )
      // a development machine is reached at the vite server, which is where
      // the browser is served from; production says so or goes without
      const publicUrl = Option.isNone(askedFor)
        ? secureCookies
          ? undefined
          : DEVELOPMENT_PUBLIC_URL
        : publicOriginFrom(askedFor.value)
      if (Option.isSome(askedFor) && publicUrl === undefined) {
        return yield* Effect.die(new Error(PUBLIC_URL_MALFORMED))
      }
      if (secureCookies && publicUrl !== undefined && !publicUrl.startsWith('https:')) {
        return yield* Effect.die(new Error(PUBLIC_URL_INSECURE))
      }
      // the private networks an entrance's upstream may live on, which is the
      // deployment's decision and never a tenant's
      const allowlisted = (yield* Config.String('QUALY_AUTH_PRIVATE_PROVIDER_ALLOWLIST').pipe(
        Config.withDefault(''),
      ))
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (!allowlisted.every(allowlistEntryValid)) {
        return yield* Effect.die(new Error(PRIVATE_ALLOWLIST_MALFORMED))
      }
      const demoAccounts = parseDemoAccounts(
        yield* Config.String('QUALY_DEMO_ACCOUNTS').pipe(Config.withDefault('')),
      )
      if (demoAccounts === undefined) return yield* Effect.die(new Error(DEMO_ACCOUNTS_MALFORMED))
      return AuthConfig.of({
        demoAccounts,
        outbound: {
          requireHttps: secureCookies,
          allowLoopback: !secureCookies,
          privateAllowlist: allowlisted,
        },
        defaultTenantSlug: yield* Config.String('QUALY_DEFAULT_TENANT').pipe(
          Config.withDefault('default'),
        ),
        ...(publicUrl === undefined ? {} : { publicUrl }),
        sessionTtlSeconds: yield* Config.Number('QUALY_SESSION_TTL_SECONDS').pipe(
          Config.withDefault(604_800),
        ),
        secureCookies,
        sessionCookieName: sessionCookieNameFor(secureCookies),
        strictBoot: secureCookies,
      })
    }),
  )
