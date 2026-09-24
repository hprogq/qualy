import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { bindSessionId } from '@qualy/api-kit/request'
import { withDatabase } from '@qualy/plugin-database/server'
import { db } from './db.ts'
import { sql } from 'kysely'
import { AuthConfig } from './auth-config.ts'
import {
  AuthRequired,
  Authenticated,
  CurrentUser,
  CurrentViewer,
  SessionExpired,
  Viewer,
} from '@qualy/auth-contract/session'
import { clearSessionCookie } from './session-cookie.ts'

// Deliberately NOT re-exported any more. The middleware, its errors and the
// principal are the contract, and they live in `@qualy/auth-contract/session`
// where anyone may depend on them; reaching them through this module made
// every plugin that needs to know who is asking an importer of this plugin's
// server implementation.
export { clearSessionCookie, sessionCookieNameFor } from './session-cookie.ts'
import { hashSessionToken } from '../session.ts'

// The session, as a middleware rather than an enricher.
//
// The cordis enricher runs before every request and sets `context.principal`
// when a cookie resolves. It never rejects, because it cannot know whether the
// endpoint being called needs a principal, so an endpoint that forgets its
// requireAuth silently observes principal as undefined and carries on. That is
// the same fail-open shape as an optional actor: forgetting looks exactly like
// being allowed.
//
// A middleware declaring `provides` cannot be forgotten. An endpoint either
// declares it, and receives a principal that is not optional, or it does not
// declare it and cannot read one at all. The check moves from something a
// handler remembers to something its signature states.

/**
 * The session behind a token, with the two questions that decide its fate.
 *
 * The aliases are worth reading slowly: `t` is the USER TYPE and `n` is the
 * TENANT. Checking `t.enabled` and forgetting `n.enabled` leaves a disabled
 * tenant's sessions working, which is what this expression got wrong once.
 */
const sessionByToken = (tokenHash: string) =>
  db.query((k) =>
    k
      .selectFrom('Session as s')
      .innerJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 's.tenantId').onRef('u.id', '=', 's.userId'),
      )
      .innerJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .innerJoin('Tenant as n', 'n.id', 's.tenantId')
      .where('s.tokenHash', '=', tokenHash)
      .select((eb) => [
        's.id',
        's.tenantId',
        's.userId',
        's.lastUsedAt',
        sql<boolean>`${eb.ref('s.expiresAt')} <= now()`.as('expired'),
        sql<boolean>`
          ${eb.ref('u.enabled')} and ${eb.ref('t.enabled')} and ${eb.ref('n.enabled')}
          and (${eb.ref('n.expiresAt')} is null or ${eb.ref('n.expiresAt')} > now())
        `.as('usable'),
      ])
      .executeTakeFirst(),
  )

const deleteSession = (id: string) =>
  db.query((k) => k.deleteFrom('Session').where('id', '=', id).execute())

/** lastUsedAt is only written when it has gone stale, to keep reads from writing */
const touchSession = (id: string) =>
  db.query((k) =>
    k
      .updateTable('Session')
      .set({ lastUsedAt: sql<Date>`now()` })
      .where('id', '=', id)
      .execute(),
  )

/** how long a session may go unused before its last-used stamp is rewritten */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

const staleness = (lastUsedAt: Date | string | null) => {
  if (lastUsedAt === null) return Number.POSITIVE_INFINITY
  const at = lastUsedAt instanceof Date ? lastUsedAt : new Date(lastUsedAt)
  return Date.now() - at.getTime()
}

/**
 * The token a request presented, under the one name this process reads.
 *
 * `request.cookies` keeps the FIRST occurrence of a name when the header
 * carries it twice (Cookies.ts:946, `Object.hasOwn`): a browser lists a
 * host cookie and a parent-domain cookie of the same name in creation
 * order once their paths tie, so which one wins is not this code's to say.
 * That can only happen to the bare development name; the prefixed name a
 * secure deployment reads cannot be created by any other host.
 */
const presentedToken = (name: string) =>
  Effect.map(HttpServerRequest.HttpServerRequest, (request) => request.cookies[name] ?? '')

/**
 * The session behind a presented token, if there is one.
 *
 * One lookup for both middlewares, so "what makes a session usable" is decided
 * in one place. What each does with the answer differs: one refuses, the other
 * reports an anonymous viewer.
 */
const resolve = Effect.fn('Auth.resolveSession')(function* (
  clear: () => Effect.Effect<void, never, HttpServerRequest.HttpServerRequest>,
  token: string,
) {
  const session = yield* sessionByToken(hashSessionToken(token)).pipe(Effect.orDie)
  if (!session) return { state: 'absent' as const }
  if (session.expired) {
    yield* deleteSession(session.id).pipe(Effect.orDie)
    yield* clear()
    return { state: 'expired' as const }
  }
  // a disabled user, a disabled type or a lapsed tenant is not a
  // distinguishable state either: it is simply not a session
  if (!session.usable) {
    yield* clear()
    return { state: 'absent' as const }
  }
  if (staleness(session.lastUsedAt) > TOUCH_INTERVAL_MS) {
    yield* touchSession(session.id).pipe(Effect.orDie)
  }
  // the request now has a session; whoever records the request - the audit
  // trail, an error report - reads it from the request context
  yield* bindSessionId(session.id)
  return {
    state: 'valid' as const,
    principal: {
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id,
    },
  }
})

/**
 * Says who is asking, and never refuses.
 *
 * Its own layer rather than a flag on the one above, because the two answer
 * different questions and only one of them has a failure to declare.
 */
export const viewerLayer = Layer.effect(
  Viewer,
  Effect.gen(function* () {
    const config = yield* AuthConfig
    const withDb = yield* withDatabase
    // both dead-session branches clear the cookie, as the cordis enricher
    // did: without this the browser keeps re-presenting a token the server
    // has already refused until the cookie's own lifetime lapses, and on the
    // not-usable branch the row is not deleted either, so a user disabled
    // and re-enabled would resume on it
    const clear = () => clearSessionCookie(config.sessionCookieName, config.secureCookies)
    return Viewer.of((httpEffect) =>
      withDb(
        Effect.gen(function* () {
          const token = yield* presentedToken(config.sessionCookieName)
          const found = token === '' ? { state: 'absent' as const } : yield* resolve(clear, token)
          return yield* Effect.provideService(httpEffect, CurrentViewer, {
            principal: found.state === 'valid' ? found.principal : undefined,
          })
        }),
      ),
    )
  }),
)

export const layer = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const config = yield* AuthConfig
    const withDb = yield* withDatabase
    const clear = () => clearSessionCookie(config.sessionCookieName, config.secureCookies)

    // the handler wraps the rest of the request rather than returning a
    // value: it decides whether to continue at all, and provides the
    // principal into whatever runs next
    return Authenticated.of((httpEffect) =>
      withDb(
        Effect.gen(function* () {
          const token = yield* presentedToken(config.sessionCookieName)
          // no token is the commonest way to be unauthenticated, and the one
          // that costs nothing to answer: it never reaches the database
          if (token === '') return yield* new AuthRequired()
          const session = yield* sessionByToken(hashSessionToken(token)).pipe(Effect.orDie)
          // an unknown token is the same answer
          if (!session) return yield* new AuthRequired()
          if (session.expired) {
            yield* deleteSession(session.id).pipe(Effect.orDie)
            yield* clear()
            return yield* new SessionExpired()
          }
          // a disabled user, a disabled type or a lapsed tenant is not a
          // distinguishable state either: it is simply not a session
          if (!session.usable) {
            yield* clear()
            return yield* new AuthRequired()
          }

          if (staleness(session.lastUsedAt) > TOUCH_INTERVAL_MS) {
            yield* touchSession(session.id).pipe(Effect.orDie)
          }

          yield* bindSessionId(session.id)
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            tenantId: session.tenantId,
            userId: session.userId,
            sessionId: session.id,
          })
        }),
      ),
    )
  }),
)
