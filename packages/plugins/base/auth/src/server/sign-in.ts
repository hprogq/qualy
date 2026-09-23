import { Context, Duration, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { bindSessionId, currentRequestContext } from '@qualy/api-kit/request'
import { boundedCounter } from '@qualy/telemetry/metrics'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db, lockTenant } from './db.ts'
import { sql } from 'kysely'
import {
  LoginDrivers,
  LoginSessions,
  type LoginContext,
  type LoginMethod as ContractLoginMethod,
  type LoginProminence,
  type LoginPresentation,
  type LoginSessionsShape,
  ProviderSecretMissing,
  AuthBindingRejected,
  type BindingRejection,
  type ConsumedFlow,
  type SessionGrantInput,
  type ResolvedProvider,
  type SignInFailureReason,
  type SignedInUser,
} from '@qualy/auth-contract/login'
import { createSessionToken, hashSessionToken } from '../session.ts'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { AuthConfig } from './auth-config.ts'
import { configOf, entranceSecrets, makeReadiness } from './readiness.ts'
import { makeFlows } from './flows.ts'
import { HARD_LIMITS, makeLimiter, type HardLimitRule } from './limiter.ts'
import { actorOf } from './audit-actor.ts'
import { BindingWritten } from '../actions.ts'
import { Audit } from '@qualy/audit-contract/effect'
import { AnonymousTenantResolver } from './tenancy.ts'
import { PublicOriginResolver } from './public-origin.ts'

export { AuthConfig }
import { sessionCookieName, TooManyAttempts } from '@qualy/auth-contract/session'
import { clearSessionCookie, setSessionCookie } from './session-cookie.ts'
import { sameOriginPath } from './same-origin.ts'
import { iconOf } from './login-icons.ts'

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

/**
 * The enabled providers of one tenant, in the order a screen shows them:
 * the doors listed in full first, each group in its own order.
 */
const loginProviders = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select([
        'id',
        'tenantId',
        'code',
        'type',
        'name',
        'config',
        'prominence',
        'recommended',
        'icon',
      ])
      .where('tenantId', '=', tenantId)
      .where('enabled', '=', true)
      .orderBy(sql`prominence = 'primary'`, 'desc')
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
      .select(['id', 'tenantId', 'type', 'code', 'version', 'config'])
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

/**
 * The binding was just used, and - when the driver learned it - what the
 * account is called over there now: a renamed GitHub account shows its new
 * name the next time its owner signs in, never a stale one forever.
 */
const touchBinding = (bindingId: string, displayLabel: string | undefined) =>
  db.query((k) =>
    k
      .updateTable('UserAuthBinding')
      .set({
        lastUsedAt: sql<Date>`now()`,
        ...(displayLabel === undefined ? {} : { displayLabel: displayLabel.slice(0, 255) }),
      })
      .where('id', '=', bindingId)
      .execute(),
  )

/** the grant's sealed identity: its session, its entrance, its kind, its format */
const grantRef = (tenantId: string, sessionId: string, providerId: string, kind: string) => ({
  tenantId,
  ownerKind: 'session-grant',
  ownerId: sessionId,
  key: `${providerId}:${kind}:v1`,
})

const insertGrant = (input: {
  tenantId: string
  sessionId: string
  providerId: string
  kind: string
  sealed: string
  expiresAt: Date | undefined
}) =>
  db.query((k) =>
    k
      .insertInto('SessionAuthGrant')
      .values({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        authProviderId: input.providerId,
        kind: input.kind,
        stateSealed: input.sealed,
        expiresAt: input.expiresAt ?? null,
      })
      .execute(),
  )

/** the bind flow this entrance just took up, for exactly this person */
const consumedBindFlow = (input: {
  tenantId: string
  flowId: string
  providerId: string
  userId: string
  sessionId: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('AuthFlow')
        .select('id')
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.flowId)
        .where('authProviderId', '=', input.providerId)
        .where('purpose', '=', 'bind')
        .where('userId', '=', input.userId)
        .where('sessionId', '=', input.sessionId)
        .where('consumedAt', 'is not', null)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** the entrance, if it still serves */
const servingDoor = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .where('enabled', '=', true)
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
  )

/**
 * The person a bind is for, whether they may still use this entrance, and
 * whether they already have an account bound at it.
 */
const bindablePerson = (tenantId: string, userId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .select((eb) => [
        'u.id',
        'u.displayName',
        'u.primaryOrgNodeId',
        eb.and([eb('u.enabled', '=', true), eb('t.enabled', '=', true)]).as('usable'),
        eb
          .or([
            eb.exists(
              eb
                .selectFrom('AuthProvider as p')
                .select('p.id')
                .whereRef('p.tenantId', '=', 'u.tenantId')
                .where('p.id', '=', providerId)
                .where('p.audienceMode', '=', 'unrestricted'),
            ),
            eb.exists(
              eb
                .selectFrom('AuthProviderUserType as a')
                .select('a.id')
                .whereRef('a.tenantId', '=', 'u.tenantId')
                .where('a.authProviderId', '=', providerId)
                .whereRef('a.userTypeId', '=', 't.id'),
            ),
          ])
          .as('admits'),
        eb
          .exists(
            eb
              .selectFrom('UserAuthBinding as b')
              .select('b.id')
              .whereRef('b.tenantId', '=', 'u.tenantId')
              .whereRef('b.userId', '=', 'u.id')
              .where('b.authProviderId', '=', providerId)
              .where('b.revokedAt', 'is', null),
          )
          .as('bound'),
      ])
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .where('u.deletedAt', 'is', null)
      .executeTakeFirst(),
  )

/** whoever holds this account at this entrance now */
const subjectHeld = (tenantId: string, providerId: string, subject: string) =>
  db
    .query((k) =>
      k
        .selectFrom('UserAuthBinding')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('authProviderId', '=', providerId)
        .where('subject', '=', subject)
        .where('revokedAt', 'is', null)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

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

/** a provider row paired with how its driver asks to be presented */
export type LoginMethod = ContractLoginMethod

/** the standing itself: every ancestor of the node, root first, node last */
export const lineageOf = (tenantId: string, path: string) =>
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

  /**
   * The ways into one tenant: enabled rows whose driver is loaded and whose
   * entrance is ready. A row whose driver is absent is skipped rather than
   * offered - it would render a sign-in form nothing can answer.
   */
  const methodsOf = Effect.fn('Auth.signIn.methodsOf')(function* (tenantId: string) {
    const providers = yield* loginProviders(tenantId).pipe(Effect.orDie)
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
        prominence: provider.prominence as LoginProminence,
        recommended: provider.recommended,
        icon: iconOf(provider.icon, found.driver.icon),
        ...presentation,
      })
    }
    return methods as readonly LoginMethod[]
  })
  // who an anonymous caller is, and where the outside world reaches us: both
  // are resolvers, so the day a host decides either, only they change
  const tenants = yield* AnonymousTenantResolver
  const publicOrigin = yield* PublicOriginResolver
  const secrets = yield* Secrets
  const flows = yield* makeFlows()
  const limiter = yield* makeLimiter
  const audit = yield* Audit

  /** one more attempt from where this request came from, at this entrance */
  const fromHere = Effect.fn('Auth.signIn.fromHere')(function* (
    provider: ResolvedProvider,
    rule: HardLimitRule,
  ) {
    const context = Option.getOrUndefined(yield* currentRequestContext)
    const answer = yield* limiter.consumeHard(
      provider.tenantId,
      rule,
      `${provider.providerId}\0${context?.clientIp ?? 'unknown'}`,
    )
    if (!answer.allowed) {
      return yield* new TooManyAttempts({ retryAfterSeconds: answer.retryAfterSeconds })
    }
  })

  // The database is closed over rather than required, because what this builds
  // is a shape whose requirements the login contract fixes: a driver calls
  // `completeLogin` with nothing but the request in scope.
  const withDb = yield* withDatabase

  /** the same effect, with this layer's database supplied */
  const bound =
    <Args extends unknown[], A, E, R>(fn: (...args: Args) => Effect.Effect<A, E, R>) =>
    (...args: Args): Effect.Effect<A, E, Exclude<R, Orm>> =>
      withDb(fn(...args))

  /** the tenant an anonymous caller belongs to, or nothing to sign in to */
  const defaultTenant = Effect.fn('Auth.signIn.tenant')(function* () {
    return yield* tenants.resolve.pipe(
      Effect.catchTag('TenantUnavailable', () => Effect.succeed(undefined)),
    )
  })

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
    // the attempt's context, which is all a record needs of an entrance
    provider: { readonly tenantId: string; readonly providerId: string },
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

  /** a provider row as a driver receives it, secrets included by reference */
  const resolved = (
    tenant: { id: string; slug: string },
    provider: { id: string; type: string; code: string; version: number; config: unknown },
  ): ResolvedProvider => ({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    providerId: provider.id,
    type: provider.type,
    code: provider.code,
    version: provider.version,
    config: configOf(provider.config),
    secret: (key) =>
      secrets.get({ ...entranceSecrets(tenant.id, provider.id), key }).pipe(
        // a stored value that does not open is not something a sign-in can
        // answer: the master key changed, or the row was edited
        Effect.orDie,
        Effect.flatMap((found) =>
          Option.isNone(found)
            ? Effect.fail(new ProviderSecretMissing({ key }))
            : Effect.succeed(found.value),
        ),
      ),
  })

  const sessions: LoginSessionsShape = {
    /**
     * Where this entrance expects to be called back: the deployment's public
     * address, and the path its driver declares for its own route.
     */
    callbackUrl: (provider: ResolvedProvider) =>
      Effect.gen(function* () {
        const base = yield* publicOrigin.resolve({ id: provider.tenantId, slug: provider.tenantSlug })
        const found = yield* drivers.forType(provider.type)
        const declared = found?.driver.callback
        if (declared === undefined) {
          return yield* Effect.die(
            new Error(`login driver ${provider.type} declares no callback path`),
          )
        }
        const path = sameOriginPath(declared({ code: provider.code }))
        if (path === undefined) {
          return yield* Effect.die(
            new Error(`login driver ${provider.type} returned a non-relative callback path`),
          )
        }
        return new URL(path, base)
      }),

    // a redirect costs a row, so where it is started from is counted first
    startFlow: (input) =>
      withDb(fromHere(input.provider, HARD_LIMITS.flowStartByAddress)).pipe(
        Effect.andThen(flows.startFlow(input)),
      ),
    consumeFlow: flows.consumeFlow,

    admitAttempt: bound(
      Effect.fn('Auth.signIn.admitAttempt')(function* (input: {
        provider: ResolvedProvider
        identifier?: string
      }) {
        const context = Option.getOrUndefined(yield* currentRequestContext)
        const provider = input.provider.providerId
        // weighed whether or not anybody answers to the identifier: the
        // refusal must not be the thing that tells an address that exists
        // from one that does not
        const answer = yield* limiter.consumeAllHard(input.provider.tenantId, [
          [HARD_LIMITS.signInByAddress, `${provider}\0${context?.clientIp ?? 'unknown'}`],
          ...(input.identifier === undefined
            ? []
            : [[HARD_LIMITS.signInByIdentifier, `${provider}\0${input.identifier}`] as const]),
        ])
        if (!answer.allowed) {
          return yield* new TooManyAttempts({ retryAfterSeconds: answer.retryAfterSeconds })
        }
      }),
    ),

    bindSubject: bound(
      Effect.fn('Auth.signIn.bindSubject')(function* (input: {
        provider: ResolvedProvider
        flow: ConsumedFlow
        subject: string
        displayLabel?: string
      }) {
        const { provider, flow } = input
        const refuse = (reason: BindingRejection) => new AuthBindingRejected({ reason })
        if (flow.purpose !== 'bind' || flow.userId === undefined || flow.sessionId === undefined) {
          return yield* refuse('not-a-bind')
        }
        const userId = flow.userId
        const sessionId = flow.sessionId
        return yield* transaction(
          Effect.gen(function* () {
            yield* lockTenant(provider.tenantId)
            // the person comes from a bind flow this entrance just took up,
            // never from anything that arrived with the callback
            const taken = yield* consumedBindFlow({
              tenantId: provider.tenantId,
              flowId: flow.flowId,
              providerId: provider.providerId,
              userId,
              sessionId,
            })
            if (!taken) return yield* refuse('not-a-bind')
            if (!(yield* servingDoor(provider.tenantId, provider.providerId))) {
              return yield* refuse('provider-unavailable')
            }
            const person = yield* bindablePerson(provider.tenantId, userId, provider.providerId)
            if (!person || !person.usable) return yield* refuse('user-unavailable')
            if (!person.admits) return yield* refuse('audience-excluded')
            if (person.bound) return yield* refuse('already-bound')
            if (yield* subjectHeld(provider.tenantId, provider.providerId, input.subject)) {
              return yield* refuse('subject-taken')
            }
            const binding = yield* db.query((k) =>
              k
                .insertInto('UserAuthBinding')
                .values({
                  tenantId: provider.tenantId,
                  userId,
                  authProviderId: provider.providerId,
                  subject: input.subject,
                  displayLabel: input.displayLabel?.slice(0, 255) ?? null,
                  credentialHash: null,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
            )
            yield* audit.record(BindingWritten, {
              tenantId: provider.tenantId,
              actor: yield* actorOf(provider.tenantId, {
                tenantId: provider.tenantId,
                userId,
                sessionId,
              }),
              target: { id: userId, label: person.displayName },
              ...(person.primaryOrgNodeId === null
                ? {}
                : { organizationId: person.primaryOrgNodeId }),
              details: {
                providerId: provider.providerId,
                bindingId: binding.id,
                replaced: false,
                endedSessions: 0,
              },
            })
            return { bindingId: binding.id }
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      }),
    ),

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
        return resolved(tenant, provider)
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
        bindingDisplayLabel?: string
        grants?: readonly SessionGrantInput[]
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
        // one transaction: the session, the binding's last-used stamp, what
        // the session keeps from the other side and the sign-in event exist
        // together or not at all
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
              yield* touchBinding(input.bindingId, input.bindingDisplayLabel).pipe(Effect.orDie)
            }
            // what the session keeps from the other side, sealed under the
            // session it belongs to so it cannot be lifted onto another
            for (const grant of input.grants ?? []) {
              const sealed = yield* secrets.seal(
                grantRef(input.tenantId, session.id, input.providerId, grant.kind),
                grant.state,
              )
              yield* insertGrant({
                tenantId: input.tenantId,
                sessionId: session.id,
                providerId: input.providerId,
                kind: grant.kind,
                sealed,
                expiresAt: grant.expiresAt,
              }).pipe(Effect.orDie)
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
        return yield* methodsOf(tenant.id)
      }),
    ),

    /**
     * What the sign-in page is told: the workspace it is for, by name, and
     * its ways in. Nothing else about the tenant leaves for a visitor who
     * has not signed in.
     */
    loginContext: bound(
      Effect.fn('Auth.signIn.loginContext')(function* () {
        const tenant = yield* defaultTenant()
        if (!tenant) return { tenant: null, methods: [], passwordRule: null } as LoginContext
        const methods = yield* methodsOf(tenant.id)
        let passwordRule: LoginContext['passwordRule'] = null
        for (const method of methods) {
          const binding = (yield* drivers.forType(method.type))?.driver.binding
          if (binding?.mode === 'managed') {
            passwordRule = { minLength: binding.secret.minLength, maxLength: binding.secret.maxLength }
            break
          }
        }
        return { tenant: { name: tenant.name }, methods, passwordRule } as LoginContext
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
  | Orm
  | AuthConfig
  | LoginDrivers
  | Secrets
  | Audit
  | AnonymousTenantResolver
  | PublicOriginResolver
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
