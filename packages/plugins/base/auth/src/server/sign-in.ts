import { Context, Duration, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { bindSessionId, currentRequestContext } from '@qualy/api-kit/request'
import { boundedCounter } from '@qualy/telemetry/metrics'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db } from './db.ts'
import { sql } from 'kysely'
import {
  LoginDrivers,
  LoginSessions,
  type LoginPresentation,
  type LoginSessionsShape,
  type ResolvedProvider,
  type SignInFailureReason,
  type SignedInUser,
} from '@qualy/auth-contract/login'
import { createSessionToken, hashSessionToken } from '../session.ts'
import type { Secrets } from '@qualy/plugin-secrets/plugin'
import { AuthConfig } from './auth-config.ts'
import { makeReadiness } from './readiness.ts'

export { AuthConfig }
import { sessionCookieName } from '@qualy/auth-contract/session'
import { clearSessionCookie, setSessionCookie } from './session-cookie.ts'

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
      .select(['id', 'tenantId', 'code', 'type', 'name', 'config'])
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
      .select(['id', 'tenantId', 'type', 'config'])
      .where('tenantId', '=', tenantId)
      .where('code', '=', providerCode)
      .where('type', '=', expectedType)
      .where('enabled', '=', true)
      .executeTakeFirst(),
  )

/**
 * The living person whose own field holds this value, when the door admits
 * their kind.
 *
 * Deleted people are nobody. Disabled ones are returned: whether an account
 * may still come in is decided by `completeLogin`, which records why not.
 * Whether this kind of person may use this door is the door's own audience,
 * decided here so every driver gets the same answer: a person outside it
 * does not exist as far as the caller can tell.
 */
const userByField = (
  tenantId: string,
  providerId: string,
  field: 'email' | 'businessNo',
  value: string,
) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .innerJoin('AuthProvider as p', (join) =>
        join.onRef('p.tenantId', '=', 'u.tenantId').on('p.id', '=', providerId),
      )
      .where('u.tenantId', '=', tenantId)
      .where(field === 'email' ? 'u.email' : 'u.businessNo', '=', value)
      .where('u.deletedAt', 'is', null)
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
      .select('u.id as userId')
      .executeTakeFirst(),
  )

/** one person's live binding to one door */
const bindingForUser = (tenantId: string, providerId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserAuthBinding')
      .select(['id', 'userId', 'credentialHash'])
      .where('tenantId', '=', tenantId)
      .where('authProviderId', '=', providerId)
      .where('userId', '=', userId)
      // a withdrawn binding is history, not a way in
      .where('revokedAt', 'is', null)
      .executeTakeFirst(),
  )

/**
 * The live binding holding an external subject, for a living person the
 * door admits. The subject is the external account's durable id and nothing
 * else: a name or an address the provider reports is never looked up here.
 */
const bindingBySubject = (tenantId: string, providerId: string, subject: string) =>
  db.query((k) =>
    k
      .selectFrom('UserAuthBinding as b')
      .innerJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'b.tenantId').onRef('u.id', '=', 'b.userId'),
      )
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .innerJoin('AuthProvider as p', (join) =>
        join.onRef('p.tenantId', '=', 'b.tenantId').onRef('p.id', '=', 'b.authProviderId'),
      )
      .where('b.tenantId', '=', tenantId)
      .where('b.authProviderId', '=', providerId)
      .where('b.subject', '=', subject)
      .where('b.revokedAt', 'is', null)
      .where('u.deletedAt', 'is', null)
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
      .select(['b.id', 'b.userId', 'b.credentialHash'])
      .executeTakeFirst(),
  )

const touchBinding = (bindingId: string) =>
  db.query((k) =>
    k
      .updateTable('UserAuthBinding')
      .set({ lastUsedAt: sql<Date>`now()` })
      .where('id', '=', bindingId)
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
  authProviderId: string
  authBindingId: string | undefined
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
        authProviderId: input.authProviderId,
        authBindingId: input.authBindingId ?? null,
        tokenHash: input.tokenHash,
        expiresAt: sql<Date>`now() + make_interval(secs => ${input.ttlSeconds})`,
        loginIp: input.loginIp ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow(),
  )

/** sign-in attempts by outcome and door type; unknown types clamp to 'other' */
const signInCount = boundedCounter('qualy.auth.sign_in', {
  outcome: ['success', 'failure'],
  provider_type: ['local', 'oauth', 'cas'],
})

/** how the door was addressed when the attempt happened, for the record's snapshot */
const providerSnapshot = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['type', 'code'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .executeTakeFirst(),
  )

/**
 * Why a proven user still may not come in, spelled out for the record.
 *
 * The sign-in predicate deliberately answers one merged "no"; this reads the
 * pieces back apart, on the rare refused path only, because the event's whole
 * value is precision the wire answer must not have.
 */
const classifyUnusable = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User as u')
        .leftJoin('UserType as t', (join) =>
          join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
        )
        .innerJoin('Tenant as e', 'e.id', 'u.tenantId')
        .select((eb) => [
          'u.enabled as userEnabled',
          'u.deletedAt',
          't.enabled as typeEnabled',
          sql<boolean>`
            ${eb.ref('e.enabled')}
            and (${eb.ref('e.expiresAt')} is null or ${eb.ref('e.expiresAt')} > now())
          `.as('tenantUsable'),
        ])
        .where('u.tenantId', '=', tenantId)
        .where('u.id', '=', userId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row): SignInFailureReason => {
        if (!row) return 'user-not-found'
        if (row.deletedAt !== null) return 'user-deleted'
        if (!row.userEnabled) return 'user-disabled'
        if (row.typeEnabled === false) return 'user-type-disabled'
        if (!row.tenantUsable) return 'tenant-disabled'
        // every piece looks fine in isolation; the merged predicate saw
        // something this one did not, and an inexact record beats a defect
        return 'user-not-found'
      }),
    )

const insertSignInEvent = (input: {
  tenantId: string
  providerId: string
  providerType: string
  providerCode: string
  userId?: string
  bindingId?: string
  outcome: 'success' | 'failure'
  reasonCode?: string
  sessionId?: string
  requestId?: string
  traceId?: string
  clientIp?: string
  userAgent?: string
}) =>
  db.query((k) =>
    k
      .insertInto('SignInEvent')
      .values({
        tenantId: input.tenantId,
        providerId: input.providerId,
        providerType: input.providerType,
        providerCode: input.providerCode,
        userId: input.userId ?? null,
        bindingId: input.bindingId ?? null,
        outcome: input.outcome,
        reasonCode: input.reasonCode ?? null,
        sessionId: input.sessionId ?? null,
        requestId: input.requestId ?? null,
        traceId: input.traceId ?? null,
        clientIp: input.clientIp ?? null,
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
  // the one judgment of whether a door can let anybody in; a door in service
  // always passes it, unless its driver changed what it needs under it
  const readiness = yield* makeReadiness

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
    return yield* activeTenantBySlug(config.defaultTenantSlug)
  }, Effect.orDie)

  const loadUser = Effect.fn('Auth.signIn.loadUser')(function* (tenantId: string, userId: string) {
    const row = yield* signedInUser(tenantId, userId)
    if (!row) return undefined
    const lineage = yield* lineageOf(tenantId, row.orgNodePath)
    return toSignedInUser(row, lineage)
  }, Effect.orDie)

  // maxAge is a Duration, not seconds: a bare number is read as MILLISECONDS,
  // so 604800 serialized as `Max-Age=604` and every session died after ten
  // minutes while its row still held a seven-day expiry. Verified against the
  // installed package.
  const setCookie = (value: string, maxAgeSeconds: number) =>
    setSessionCookie(config.sessionCookieName, value, {
      secure: config.secureCookies,
      maxAge: Duration.seconds(maxAgeSeconds),
    })

  /**
   * One writer for both outcomes, so every event carries the same shape: the
   * door's snapshot, how far the attempt got, and the request it rode in on.
   * The correlation comes from the request context, never from the caller.
   */
  const record = Effect.fn('Auth.signIn.record')(function* (
    provider: ResolvedProvider,
    input: {
      outcome: 'success' | 'failure'
      reason?: SignInFailureReason
      userId?: string
      bindingId?: string
      sessionId?: string
    },
  ) {
    const snapshot = yield* providerSnapshot(provider.tenantId, provider.providerId).pipe(
      Effect.orDie,
    )
    const context = Option.getOrUndefined(yield* currentRequestContext)
    // the metric beside the record: same single point, both outcomes, and
    // the bounded constructor keeps codes and identifiers out of the labels
    yield* signInCount({
      outcome: input.outcome,
      provider_type: snapshot?.type ?? 'other',
    })
    yield* insertSignInEvent({
      tenantId: provider.tenantId,
      providerId: provider.providerId,
      providerType: snapshot?.type ?? 'unknown',
      providerCode: snapshot?.code ?? 'unknown',
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
      outcome: input.outcome,
      ...(input.reason === undefined ? {} : { reasonCode: input.reason }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(context?.requestId === undefined ? {} : { requestId: context.requestId }),
      ...(context?.traceId === undefined ? {} : { traceId: context.traceId }),
      ...(context?.clientIp === undefined ? {} : { clientIp: context.clientIp }),
      ...(context?.userAgent === undefined ? {} : { userAgent: context.userAgent }),
    }).pipe(Effect.orDie)
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
        if (!provider || !(yield* readiness(provider)).ready) return undefined
        return { tenantId: tenant.id, providerId: provider.id }
      }),
    ),

    findUserByField: bound(
      Effect.fn('Auth.signIn.findUserByField')(function* (input: {
        tenantId: string
        providerId: string
        field: 'email' | 'businessNo'
        value: string
      }) {
        const row = yield* userByField(
          input.tenantId,
          input.providerId,
          input.field,
          input.value,
        ).pipe(Effect.orDie)
        return row === undefined ? undefined : { userId: row.userId }
      }),
    ),

    findBindingForUser: bound(
      Effect.fn('Auth.signIn.findBindingForUser')(function* (input: {
        tenantId: string
        providerId: string
        userId: string
      }) {
        return yield* bindingForUser(input.tenantId, input.providerId, input.userId).pipe(
          Effect.orDie,
        )
      }),
    ),

    findBindingBySubject: bound(
      Effect.fn('Auth.signIn.findBindingBySubject')(function* (input: {
        tenantId: string
        providerId: string
        subject: string
      }) {
        return yield* bindingBySubject(input.tenantId, input.providerId, input.subject).pipe(
          Effect.orDie,
        )
      }),
    ),

    failAttempt: bound(
      Effect.fn('Auth.signIn.failAttempt')(function* (
        provider: ResolvedProvider,
        input: { reason: SignInFailureReason; userId?: string; bindingId?: string },
      ) {
        yield* record(provider, { outcome: 'failure', ...input })
      }),
    ),

    completeLogin: bound(
      Effect.fn('Auth.signIn.completeLogin')(function* (input: {
        tenantId: string
        providerId: string
        userId: string
        bindingId?: string
      }) {
        const provider = { tenantId: input.tenantId, providerId: input.providerId }
        // the account state is re-read here rather than trusted from the proof:
        // a driver knows who somebody is, not whether they may still come in
        const user = yield* loadUser(input.tenantId, input.userId)
        if (!user) {
          // the driver's proof was good; what refused them is the account,
          // and the record says which part - precision the wire answer
          // deliberately does not have
          const reason = yield* classifyUnusable(input.tenantId, input.userId).pipe(Effect.orDie)
          yield* record(provider, {
            outcome: 'failure',
            reason,
            userId: input.userId,
            ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
          })
          return undefined
        }
        // the request context already resolved the client address through
        // the trusted-proxy policy; the raw socket peer would record the
        // proxy itself on any proxied deployment
        const context = Option.getOrUndefined(yield* currentRequestContext)
        const { token, tokenHash } = createSessionToken()
        // one transaction: the session, the binding's last-used stamp and
        // the sign-in event exist together or not at all
        const sessionId = yield* transaction(
          Effect.gen(function* () {
            const session = yield* insertSession({
              tenantId: input.tenantId,
              userId: input.userId,
              authProviderId: input.providerId,
              authBindingId: input.bindingId,
              tokenHash,
              ttlSeconds: config.sessionTtlSeconds,
              loginIp: context?.clientIp,
              userAgent: context?.userAgent,
            }).pipe(Effect.orDie)
            if (input.bindingId) {
              yield* touchBinding(input.bindingId).pipe(Effect.orDie)
            }
            yield* record(provider, {
              outcome: 'success',
              userId: input.userId,
              ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
              sessionId: session.id,
            })
            return session.id
          }),
        )
        // this request now has a session, before anything else records it
        yield* bindSessionId(sessionId)
        yield* setCookie(token, config.sessionTtlSeconds)
        // a secure deployment reads only the prefixed name; the bare one a
        // browser may still carry from before the rename is dropped here,
        // once, so it does not ride along for the rest of its lifetime
        if (config.sessionCookieName !== sessionCookieName) {
          yield* clearSessionCookie(sessionCookieName, config.secureCookies)
        }
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
          if (!found || !(yield* readiness(provider)).ready) continue
          const declared = found.driver.presentation
          // the declaration names a module and the wire does not: a renderer
          // is found by the driver's type, which the method already carries
          let presentation: LoginPresentation =
            declared.mode === 'component'
              ? { mode: 'component' }
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
        const token = request.cookies[config.sessionCookieName]
        if (token) {
          yield* revokeSessionByToken(hashSessionToken(token)).pipe(Effect.orDie)
        }
        yield* clearSessionCookie(config.sessionCookieName, config.secureCookies)
      }),
    ),
  }
})

export class SignIn extends Context.Service<SignIn, Effect.Success<ReturnType<typeof make>>>()(
  '@qualy/plugin-auth/SignIn',
) {}

export const layer: Layer.Layer<
  SignIn | LoginSessions,
  never,
  Orm | AuthConfig | LoginDrivers | Secrets
> =
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
