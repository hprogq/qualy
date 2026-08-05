import { Context, Duration, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Database } from '@qualy/plugin-database/server'
import {
  LoginDrivers,
  LoginSessions,
  type LoginPresentation,
  type LoginSessionsShape,
  type SignedInUser,
} from '@qualy/auth-contract/login'
import {
  activeTenantBySlugQuery,
  identityByIdentifierQuery,
  insertSessionQuery,
  loginProvidersQuery,
  providerByCodeQuery,
  revokeSessionByTokenQuery,
  signedInUserQuery,
  touchIdentityQuery,
} from '../iam/queries.ts'
import { createSessionToken, hashSessionToken } from '../session.ts'
import { AuthConfig } from './auth-config.ts'

export { AuthConfig }
import { sessionCookieName, sessionSecurity } from './session.ts'

// Signing in, and signing out.
//
// The core owns the session; a driver owns the proof. Which drivers exist is a
// fact about the assembly, handed in as a catalog, so the core never becomes
// downstream of the plugins that depend on it.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

/**
 * A driver's redirect target, kept same-origin.
 *
 * An absolute url is dropped rather than followed: the sign-in screen sends a
 * visitor there, and a driver that names another origin would be redirecting
 * them off the application under the application's own name.
 */
const sameOriginPath = (href: string): string | undefined => {
  if (!href.startsWith('/')) return undefined
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(href, sentinel)
  } catch {
    return undefined
  }
  if (target.origin !== sentinel) return undefined
  return `${target.pathname}${target.search}${target.hash}`
}

/** a provider row paired with how its driver asks to be presented */
export type LoginMethod = {
  readonly code: string
  readonly type: string
  readonly name: string
} & LoginPresentation

interface UserRow extends Record<string, unknown> {
  id: string
  display_name: string
  business_no: string | null
  user_type_id: string
  user_type_code: string
  user_type_name: string
  org_node_id: string
  org_node_code: string | null
  org_node_name: string
  tenant_id: string
  tenant_slug: string
  tenant_name: string
}

const toSignedInUser = (row: UserRow): SignedInUser => ({
  id: row.id,
  displayName: row.display_name,
  businessNo: row.business_no,
  userType: { id: row.user_type_id, code: row.user_type_code, name: row.user_type_name },
  primaryOrgNode: { id: row.org_node_id, code: row.org_node_code, name: row.org_node_name },
  tenant: { id: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name },
})

export const make = Effect.fn('Auth.signIn.make')(function* () {
  const database = yield* Database
  const config = yield* AuthConfig
  const drivers = yield* LoginDrivers
  const byType = new Map(drivers.map((driver) => [driver.type, driver]))

  const defaultTenant = Effect.fn('Auth.signIn.tenant')(function* () {
    return rows<{ id: string }>(
      yield* database
        .execute(activeTenantBySlugQuery(config.defaultTenantSlug))
        .pipe(Effect.orDie),
    )[0]
  })

  const loadUser = Effect.fn('Auth.signIn.loadUser')(function* (
    tenantId: string,
    userId: string,
  ) {
    const row = rows<UserRow>(
      yield* database.execute(signedInUserQuery(tenantId, userId)).pipe(Effect.orDie),
    )[0]
    return row ? toSignedInUser(row) : undefined
  })

  // maxAge is a Duration, not seconds: a bare number is read as MILLISECONDS,
  // so 604800 serialized as `Max-Age=604` and every session died after ten
  // minutes while its row still held a seven-day expiry. Verified against the
  // installed package.
  const setCookie = (value: string, maxAgeSeconds: number) =>
    HttpApiBuilder.securitySetCookie(sessionSecurity, value, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.secureCookies,
      maxAge: Duration.seconds(maxAgeSeconds),
    })

  const sessions: LoginSessionsShape = {
    resolveProvider: Effect.fn('Auth.signIn.resolveProvider')(function* (input) {
      const tenant = yield* defaultTenant()
      if (!tenant) return undefined
      // a driver nobody loaded proves nothing, so its rows are not routes
      if (!byType.has(input.expectedType)) return undefined
      const provider = rows<{ id: string }>(
        yield* database
          .execute(providerByCodeQuery(tenant.id, input.providerCode, input.expectedType))
          .pipe(Effect.orDie),
      )[0]
      return provider ? { tenantId: tenant.id, providerId: provider.id } : undefined
    }),

    findIdentity: Effect.fn('Auth.signIn.findIdentity')(function* (input) {
      const row = rows<{
        id: string
        user_id: string
        credential_hash: string | null
        allow_local_login: boolean
      }>(
        yield* database
          .execute(
            identityByIdentifierQuery(input.tenantId, input.providerId, input.identifier),
          )
          .pipe(Effect.orDie),
      )[0]
      return row
        ? {
            id: row.id,
            userId: row.user_id,
            credentialHash: row.credential_hash,
            allowsLocalLogin: row.allow_local_login,
          }
        : undefined
    }),

    completeLogin: Effect.fn('Auth.signIn.completeLogin')(function* (input) {
      // the account state is re-read here rather than trusted from the proof:
      // a driver knows who somebody is, not whether they may still come in
      const user = yield* loadUser(input.tenantId, input.userId)
      if (!user) return undefined
      const request = yield* HttpServerRequest.HttpServerRequest
      const { token, tokenHash } = createSessionToken()
      yield* database
        .execute(
          insertSessionQuery({
            tenantId: input.tenantId,
            userId: input.userId,
            tokenHash,
            ttlSeconds: config.sessionTtlSeconds,
            loginIp: Option.getOrUndefined(request.remoteAddress),
            userAgent: request.headers['user-agent'],
          }),
        )
        .pipe(Effect.orDie)
      if (input.identityId) {
        yield* database.execute(touchIdentityQuery(input.identityId)).pipe(Effect.orDie)
      }
      yield* setCookie(token, config.sessionTtlSeconds)
      return user
    }),
  }

  return {
    sessions,

    /**
     * The ways in this deployment offers.
     *
     * Enabled provider rows of the anonymous tenant whose driver is currently
     * loaded. A row whose driver is absent is skipped rather than offered: it
     * would render a sign-in form nothing can answer.
     */
    loginMethods: Effect.fn('Auth.signIn.loginMethods')(function* () {
      const tenant = yield* defaultTenant()
      if (!tenant) return [] as readonly LoginMethod[]
      const providers = rows<{ code: string; type: string; name: string }>(
        yield* database.execute(loginProvidersQuery(tenant.id)).pipe(Effect.orDie),
      )
      const methods: LoginMethod[] = []
      for (const provider of providers) {
        const driver = byType.get(provider.type)
        if (!driver) continue
        let presentation: LoginPresentation = driver.describe({ code: provider.code })
        if (presentation.mode === 'redirect') {
          const path = sameOriginPath(presentation.href)
          if (!path) {
            yield* Effect.logWarning(
              `login method ${provider.code} dropped: driver ${provider.type} returned a non-relative href`,
            )
            continue
          }
          presentation = { mode: 'redirect', href: path }
        }
        methods.push({
          code: provider.code,
          type: provider.type,
          name: provider.name,
          ...presentation,
        })
      }
      return methods as readonly LoginMethod[]
    }),

    loadUser,

    /**
     * Signing out, which succeeds whether or not there was a session.
     *
     * No middleware, because refusing an already-signed-out caller would make
     * the client handle a failure that means the thing it asked for is already
     * true. That is also why the row is found by the presented token rather
     * than through a principal: there is no principal on this endpoint, and
     * asking for one optionally would silently revoke nothing, which is what
     * the first version of this did.
     */
    endSession: Effect.fn('Auth.signIn.endSession')(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const token = request.cookies[sessionCookieName]
      if (token) {
        yield* database
          .execute(revokeSessionByTokenQuery(hashSessionToken(token)))
          .pipe(Effect.orDie)
      }
      yield* setCookie('', 0)
    }),
  }
})

export class SignIn extends Context.Service<
  SignIn,
  Effect.Success<ReturnType<typeof make>>
>()('@qualy/plugin-auth/SignIn') {}

export const layer: Layer.Layer<
  SignIn | LoginSessions,
  never,
  Database | AuthConfig | LoginDrivers
> = Layer.effectContext(
  Effect.gen(function* () {
    const signIn = yield* make()
    return Context.empty().pipe(
      Context.add(SignIn, signIn),
      // the driver-facing surface is the same construction, published under
      // the tag a driver can reach without importing this plugin
      Context.add(LoginSessions, signIn.sessions),
    )
  }),
)
