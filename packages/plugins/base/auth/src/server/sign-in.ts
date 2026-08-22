import { componentKey } from '@qualy/ui-contract'
import { Context, Duration, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { kyselyOf, query, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db } from './db.ts'
import { sql } from 'kysely'
import {
  LoginDrivers,
  LoginSessions,
  type LoginPresentation,
  type LoginSessionsShape,
  type SignedInUser,
} from '@qualy/auth-contract/login'
import { createSessionToken, hashSessionToken } from '../session.ts'
import { AuthConfig } from './auth-config.ts'

export { AuthConfig }
import { sessionCookieName, sessionSecurity } from './session.ts'

// Signing in, and signing out.
//
// The core owns the session; a driver owns the proof. Which drivers exist is a
// fact about the assembly, handed in as a catalog, so the core never becomes
// downstream of the plugins that depend on it.

/**
 * The anonymous tenant a sign-in screen belongs to.
 *
 * A lapsed tenant is not a tenant one may sign in to, so the liveness test
 * travels with the lookup rather than being a second thing to remember.
 */
const activeTenantBySlug = (slug: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select('id')
      .where('slug', '=', slug)
      .where('enabled', '=', true)
      .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', sql<Date>`now()`)]))
      .executeTakeFirst(),
  )

/** the enabled providers of one tenant, in the order a screen shows them */
const loginProviders = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['code', 'type', 'name'])
      .where('tenantId', '=', tenantId)
      .where('enabled', '=', true)
      .orderBy('sortOrder')
      .orderBy('code')
      .execute(),
  )

/**
 * One public provider code, of the type the route belongs to.
 *
 * The type is part of the predicate so a row belonging to one driver cannot be
 * driven through another driver's route.
 */
const providerByCode = (tenantId: string, providerCode: string, expectedType: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('code', '=', providerCode)
      .where('type', '=', expectedType)
      .where('enabled', '=', true)
      .executeTakeFirst(),
  )

/** an identity with what the core needs to decide whether it may be used */
const identityByIdentifier = (tenantId: string, providerId: string, identifier: string) =>
  db.query((k) =>
    k
      .selectFrom('UserIdentity as i')
      .innerJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'i.tenantId').onRef('u.id', '=', 'i.userId'),
      )
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .innerJoin('AuthProvider as p', (join) =>
        join.onRef('p.tenantId', '=', 'i.tenantId').onRef('p.id', '=', 'i.authProviderId'),
      )
      .where('i.tenantId', '=', tenantId)
      .where('i.authProviderId', '=', providerId)
      .where('i.identifier', '=', identifier)
      // whether this kind of person may use this door is the door's own
      // audience, decided here so every driver gets the same refusal: an
      // identity outside it does not exist as far as the caller can tell
      .where((eb) =>
        eb.or([
          eb('p.audienceMode', '=', 'unrestricted'),
          eb.exists(
            eb
              .selectFrom('AuthProviderUserType as a')
              .select('a.id')
              .whereRef('a.tenantId', '=', 'p.tenantId')
              .whereRef('a.authProviderId', '=', 'p.id')
              .whereRef('a.userTypeId', '=', 't.id'),
          ),
        ]),
      )
      .select(['i.id', 'i.userId', 'i.credentialHash'])
      .executeTakeFirst(),
  )

const touchIdentity = (identityId: string) =>
  db.query((k) =>
    k
      .updateTable('UserIdentity')
      .set({ lastUsedAt: sql<Date>`now()` })
      .where('id', '=', identityId)
      .execute(),
  )

/**
 * The person behind a session, with everything a shell renders.
 *
 * The liveness of the user, their type and their tenant is part of the
 * predicate: a row that survives disabling would let a session outlive the
 * account it belongs to.
 */
const signedInUser = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .innerJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'u.tenantId').onRef('n.id', '=', 'u.primaryOrgNodeId'),
      )
      .innerJoin('OrgType as ot', (join) =>
        join.onRef('ot.tenantId', '=', 'n.tenantId').onRef('ot.id', '=', 'n.orgTypeId'),
      )
      .innerJoin('Tenant as e', 'e.id', 'u.tenantId')
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .where('u.enabled', '=', true)
      .where('t.enabled', '=', true)
      .where('e.enabled', '=', true)
      .where((eb) =>
        eb.or([eb('e.expiresAt', 'is', null), eb('e.expiresAt', '>', sql<Date>`now()`)]),
      )
      .select([
        'u.id',
        'u.displayName',
        'u.businessNo',
        't.id as userTypeId',
        't.code as userTypeCode',
        't.name as userTypeName',
        'n.id as orgNodeId',
        'n.name as orgNodeName',
        sql<string>`n.path`.as('orgNodePath'),
        'ot.id as orgTypeId',
        'ot.name as orgTypeName',
        'e.id as tenantId',
        'e.slug as tenantSlug',
        'e.name as tenantName',
      ])
      .executeTakeFirst(),
  )

const insertSession = (input: {
  tenantId: string
  userId: string
  tokenHash: string
  ttlSeconds: number
  loginIp?: string
  userAgent?: string
}) =>
  db.query((k) =>
    k
      .insertInto('Session')
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: sql<Date>`now() + make_interval(secs => ${input.ttlSeconds})`,
        loginIp: input.loginIp ?? null,
        userAgent: input.userAgent ?? null,
      })
      .execute(),
  )

/**
 * Signing out, by the token the caller presented.
 *
 * The token is the scope: it identifies exactly one session, so there is
 * nothing wider to accidentally delete. Signing out is the one thing a caller
 * can do without a resolved principal, which is why it cannot go through the
 * principal to find its row.
 */
const revokeSessionByToken = (tokenHash: string) =>
  db.query((k) => k.deleteFrom('Session').where('tokenHash', '=', tokenHash).execute())

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

/** the standing itself: every ancestor of the node, root first, node last */
const lineageOf = (tenantId: string, path: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgNode as n')
      .innerJoin('OrgType as t', (join) =>
        join.onRef('t.tenantId', '=', 'n.tenantId').onRef('t.id', '=', 'n.orgTypeId'),
      )
      .select(['n.id', 'n.name', 't.name as typeName'])
      .where('n.tenantId', '=', tenantId)
      .where(sql<boolean>`n.path @> ${path}::ltree`)
      .orderBy('n.depth')
      .execute(),
  )

type SignedInRow = NonNullable<Effect.Success<ReturnType<typeof signedInUser>>>

const toSignedInUser = (
  row: SignedInRow,
  lineage: readonly { id: string; name: string; typeName: string }[],
): SignedInUser => ({
  id: row.id,
  displayName: row.displayName,
  businessNo: row.businessNo,
  userType: { id: row.userTypeId, code: row.userTypeCode, name: row.userTypeName },
  primaryOrgNode: {
    id: row.orgNodeId,
    name: row.orgNodeName,
    orgType: { id: row.orgTypeId, name: row.orgTypeName },
    lineage,
  },
  tenant: { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName },
})

export const make = Effect.fn('Auth.signIn.make')(function* () {
  const config = yield* AuthConfig
  // the registry handle, not its contents: a driver registers while its own
  // layer is built, and this one is built before some of them
  const drivers = yield* LoginDrivers

  // The database is closed over rather than required, because what this builds
  // is a shape whose requirements the login contract fixes: a driver calls
  // `completeLogin` with nothing but the request in scope.
  const withDb = yield* withDatabase

  /** the same effect, with this layer's database supplied */
  const bound =
    <Args extends unknown[], A, E, R>(fn: (...args: Args) => Effect.Effect<A, E, R>) =>
    (...args: Args): Effect.Effect<A, E, Exclude<R, Orm>> =>
      withDb(fn(...args))

  const defaultTenant = Effect.fn('Auth.signIn.tenant')(function* () {
    return yield* activeTenantBySlug(config.defaultTenantSlug).pipe(Effect.orDie)
  })

  const loadUser = Effect.fn('Auth.signIn.loadUser')(function* (tenantId: string, userId: string) {
    const row = yield* signedInUser(tenantId, userId).pipe(Effect.orDie)
    if (!row) return undefined
    const lineage = yield* lineageOf(tenantId, row.orgNodePath).pipe(Effect.orDie)
    return toSignedInUser(row, lineage)
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
    resolveProvider: bound(
      Effect.fn('Auth.signIn.resolveProvider')(function* (input: {
        providerCode: string
        expectedType: string
      }) {
        const tenant = yield* defaultTenant()
        if (!tenant) return undefined
        // a driver nobody loaded proves nothing, so its rows are not routes
        if (!(yield* drivers.forType(input.expectedType))) return undefined
        const provider = yield* providerByCode(
          tenant.id,
          input.providerCode,
          input.expectedType,
        ).pipe(Effect.orDie)
        return provider ? { tenantId: tenant.id, providerId: provider.id } : undefined
      }),
    ),

    findIdentity: bound(
      Effect.fn('Auth.signIn.findIdentity')(function* (input: {
        tenantId: string
        providerId: string
        identifier: string
      }) {
        const row = yield* identityByIdentifier(
          input.tenantId,
          input.providerId,
          input.identifier,
        ).pipe(Effect.orDie)
        return row
          ? {
              id: row.id,
              userId: row.userId,
              credentialHash: row.credentialHash,
            }
          : undefined
      }),
    ),

    completeLogin: bound(
      Effect.fn('Auth.signIn.completeLogin')(function* (input: {
        tenantId: string
        userId: string
        identityId?: string
      }) {
        // the account state is re-read here rather than trusted from the proof:
        // a driver knows who somebody is, not whether they may still come in
        const user = yield* loadUser(input.tenantId, input.userId)
        if (!user) return undefined
        const request = yield* HttpServerRequest.HttpServerRequest
        const { token, tokenHash } = createSessionToken()
        yield* insertSession({
          tenantId: input.tenantId,
          userId: input.userId,
          tokenHash,
          ttlSeconds: config.sessionTtlSeconds,
          loginIp: Option.getOrUndefined(request.remoteAddress),
          userAgent: request.headers['user-agent'],
        }).pipe(Effect.orDie)
        if (input.identityId) {
          yield* touchIdentity(input.identityId).pipe(Effect.orDie)
        }
        yield* setCookie(token, config.sessionTtlSeconds)
        return user
      }),
    ),
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
    loginMethods: bound(
      Effect.fn('Auth.signIn.loginMethods')(function* () {
        const tenant = yield* defaultTenant()
        if (!tenant) return [] as readonly LoginMethod[]
        const providers = yield* loginProviders(tenant.id).pipe(Effect.orDie)
        const methods: LoginMethod[] = []
        for (const provider of providers) {
          const found = yield* drivers.forType(provider.type)
          if (!found) continue
          const declared = found.driver.presentation
          // the declaration names a module; the wire carries the derived
          // registry key, the same one the browser registry is built under
          let presentation: LoginPresentation =
            declared.mode === 'component'
              ? { mode: 'component', component: componentKey(found.owner, declared.component) }
              : { mode: 'redirect', href: declared.href({ code: provider.code }) }
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
    ),

    loadUser: bound(loadUser),

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
    endSession: bound(
      Effect.fn('Auth.signIn.endSession')(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = request.cookies[sessionCookieName]
        if (token) {
          yield* revokeSessionByToken(hashSessionToken(token)).pipe(Effect.orDie)
        }
        yield* setCookie('', 0)
      }),
    ),
  }
})

export class SignIn extends Context.Service<SignIn, Effect.Success<ReturnType<typeof make>>>()(
  '@qualy/plugin-auth/SignIn',
) {}

export const layer: Layer.Layer<SignIn | LoginSessions, never, Orm | AuthConfig | LoginDrivers> =
  Layer.effectContext(
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
