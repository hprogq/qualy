import { Context, Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { QUALY_ACTIVITY_HEADER, QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import { QUALY_CLIENT_PROTOCOL_HEADER } from '@qualy/release-contract'
import {
  judgeDocumentIdentity,
  type IdentityVerdict,
  type PresentedSession,
} from '@qualy/auth-contract/identity-key'
import { bindSessionId } from '@qualy/api-kit/request'
import { liveClientOf } from '@qualy/api-kit/live-socket-server'
import { withDatabase } from '@qualy/plugin-database/server'
import { db } from './db.ts'
import { sql } from 'kysely'
import { AuthConfig, SHARED_DEVICE_IDLE_SECONDS } from './auth-config.ts'
import {
  AuthRequired,
  Authenticated,
  CurrentUser,
  CurrentViewer,
  IdentityChanged,
  IdentityProbe,
  IdentityUnasserted,
  SessionExpired,
  SessionPresence,
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
 * The session behind a token, with the questions that decide its fate.
 *
 * The aliases are worth reading slowly: `t` is the USER TYPE and `n` is the
 * TENANT. Checking `t.enabled` and forgetting `n.enabled` leaves a disabled
 * tenant's sessions working, which is what this expression got wrong once.
 *
 * `idle` is the idle limit - the deployment's, or a shared device's own for
 * a session signed in on one - measured from the last use recorded, or from
 * the start for a session never used since; the database's clock decides it,
 * as it decides the absolute expiry beside it.
 */
const sessionWhere = (
  where: { readonly tokenHash: string } | { readonly id: string },
  idleSeconds: number | undefined,
) =>
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
      .$call((query) =>
        'id' in where
          ? query.where('s.id', '=', where.id)
          : query.where('s.tokenHash', '=', where.tokenHash),
      )
      .select((eb) => [
        's.id',
        's.tenantId',
        's.userId',
        's.lastUsedAt',
        sql<boolean>`${eb.ref('s.expiresAt')} <= now()`.as('expired'),
        // a shared device's session keeps its own shorter limit, whatever the
        // deployment's is - even none
        sql<boolean>`case
          when ${eb.ref('s.device')} = 'shared'
            then coalesce(${eb.ref('s.lastUsedAt')}, ${eb.ref('s.createdAt')}) <= now() - make_interval(secs => ${SHARED_DEVICE_IDLE_SECONDS})
          else ${
            idleSeconds === undefined
              ? sql<boolean>`false`
              : sql<boolean>`coalesce(${eb.ref('s.lastUsedAt')}, ${eb.ref('s.createdAt')}) <= now() - make_interval(secs => ${idleSeconds})`
          }
        end`.as('idle'),
        sql<boolean>`
          ${eb.ref('u.enabled')} and ${eb.ref('t.enabled')} and ${eb.ref('n.enabled')}
          and (${eb.ref('n.expiresAt')} is null or ${eb.ref('n.expiresAt')} > now())
        `.as('usable'),
      ])
      .executeTakeFirst(),
  )

const sessionByToken = (tokenHash: string, idleSeconds: number | undefined) =>
  sessionWhere({ tokenHash }, idleSeconds)

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

/**
 * How long a session may go unused before its last-used stamp is rewritten.
 *
 * Also the slack in the idle limit: use within the last five minutes may not
 * have been recorded yet, so a session idle for the limit minus this may
 * already count as idle, and one idle for the limit always does.
 */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Whether the request says its reader made it just now.
 *
 * Use has to be shown, not assumed. A poll, a refetch a live wake-up caused,
 * anything from a hidden tab is served like any other request but is not use
 * - otherwise a page left open on a shared computer keeps its session alive
 * forever by itself. And a request that says nothing is not use either: a
 * link or a page on another site sends the cookie with a plain GET, and taken
 * as use it would keep an idle session alive for whoever sent it there.
 */
const readersRequest = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => request.headers[QUALY_ACTIVITY_HEADER] === '1',
)

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
  idleSeconds: number | undefined,
) {
  const session = yield* sessionByToken(hashSessionToken(token), idleSeconds).pipe(Effect.orDie)
  if (!session) return { state: 'absent' as const }
  // gone unused for longer than the deployment allows is the same end as
  // running out: the row goes, and the browser is told to drop the cookie
  if (session.expired || session.idle) {
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
  return {
    state: 'valid' as const,
    lastUsedAt: session.lastUsedAt,
    principal: {
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id,
    },
  }
})

/**
 * What a request says about the page it came from
 * (docs/adr/0013-document-identity.md): whose the page is, and whether it is
 * a page of ours at all - only the application's own page names the client
 * protocol it speaks.
 */
const pageDeclaration = Effect.map(HttpServerRequest.HttpServerRequest, (request) => {
  const upgrading = (request.headers['upgrade'] ?? '').toLowerCase() === 'websocket'
  // A browser cannot set a header on a WebSocket, so a socket says whose
  // its page is in the query, as it says its protocol; a socket that says
  // nothing is from a page that predates this, and is judged as before.
  if (upgrading) {
    const declared = liveClientOf(request).identity
    return { declared, fromPage: declared !== undefined, upgrading }
  }
  return {
    declared: request.headers[QUALY_IDENTITY_HEADER],
    fromPage: request.headers[QUALY_CLIENT_PROTOCOL_HEADER] !== undefined,
    upgrading,
  }
})

/** an endpoint that asks who is signed in, whose answer is never refused for naming somebody */
const probing = (endpoint: { readonly annotations: Context.Context<never> }) =>
  Context.getOrUndefined(endpoint.annotations as Context.Context<IdentityProbe>, IdentityProbe) ===
  true

/** the refusal a verdict calls for, or nothing for a request that may go on */
const refusalFor = (verdict: IdentityVerdict) => {
  switch (verdict) {
    case 'pass':
      return Effect.void
    case 'changed':
      return Effect.fail(new IdentityChanged())
    case 'unasserted':
      return Effect.fail(new IdentityUnasserted())
    case 'absent':
      return Effect.fail(new AuthRequired())
    case 'expired':
      return Effect.fail(new SessionExpired())
  }
}

/**
 * May the page a sign-out came from end the session it presents
 * (docs/adr/0013-document-identity.md)?
 *
 * Signing out of nothing is fine - the reader ends up without a session,
 * which is what they asked for. Signing out somebody else is not: a page left
 * open for one person must not end the session of whoever signed in after it
 * in another tab. Only reads: nothing is deleted or cleared here.
 */
export const pageMaySignOut = Effect.fn('Auth.pageMaySignOut')(function* (
  cookieName: string,
  idleSeconds: number | undefined,
) {
  const page = yield* pageDeclaration
  const token = yield* presentedToken(cookieName)
  let session: PresentedSession = { state: 'absent' }
  if (token !== '') {
    const found = yield* sessionByToken(hashSessionToken(token), idleSeconds).pipe(Effect.orDie)
    if (found && !found.expired && !found.idle && found.usable) {
      session = { state: 'valid', principal: found }
    }
  }
  const verdict = judgeDocumentIdentity({
    declared: page.declared,
    fromPage: page.fromPage,
    session,
  })
  if (verdict === 'changed') return yield* new IdentityChanged()
  if (verdict === 'unasserted') return yield* new IdentityUnasserted()
})

/**
 * Says who is asking, and refuses only a page that is not the session's.
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
    return Viewer.of((httpEffect, { endpoint }) =>
      withDb(
        Effect.gen(function* () {
          const token = yield* presentedToken(config.sessionCookieName)
          const found =
            token === ''
              ? { state: 'absent' as const }
              : yield* resolve(clear, token, config.sessionIdleSeconds)
          const page = yield* pageDeclaration
          // a live channel behind this middleware is judged by its handler
          // once the socket is open: a browser cannot read a refused
          // handshake, only a close code
          if (!page.upgrading && !probing(endpoint)) {
            yield* refusalFor(
              judgeDocumentIdentity({
                declared: page.declared,
                fromPage: page.fromPage,
                session: found,
              }),
            )
          }
          if (found.state === 'valid') {
            if (staleness(found.lastUsedAt) > TOUCH_INTERVAL_MS && (yield* readersRequest)) {
              yield* touchSession(found.principal.sessionId).pipe(Effect.orDie)
            }
            yield* bindSessionId(found.principal.sessionId)
          }
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
    return Authenticated.of((httpEffect, { endpoint }) =>
      withDb(
        Effect.gen(function* () {
          const page = yield* pageDeclaration
          const judged = !probing(endpoint)
          // a page of ours that does not say whose it is goes no further,
          // whoever holds the session (docs/adr/0013-document-identity.md)
          if (judged && page.fromPage && (page.declared === undefined || page.declared === '')) {
            return yield* new IdentityUnasserted()
          }
          const token = yield* presentedToken(config.sessionCookieName)
          // no token is the commonest way to be unauthenticated, and the one
          // that costs nothing to answer: it never reaches the database
          if (token === '') return yield* new AuthRequired()
          const session = yield* sessionByToken(
            hashSessionToken(token),
            config.sessionIdleSeconds,
          ).pipe(Effect.orDie)
          // an unknown token is the same answer
          if (!session) return yield* new AuthRequired()
          if (session.expired || session.idle) {
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

          // the page and the session must be the same person's before
          // anything is done for it - not even counted as use
          if (judged) {
            yield* refusalFor(
              judgeDocumentIdentity({
                declared: page.declared,
                fromPage: page.fromPage,
                session: { state: 'valid', principal: session },
              }),
            )
          }

          if (staleness(session.lastUsedAt) > TOUCH_INTERVAL_MS && (yield* readersRequest)) {
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

/**
 * Whether a session resolved earlier is still one, by the same rule the
 * middlewares apply. It only reads: a session found ended is left for the
 * next request that presents it to delete, and nothing here is use.
 */
export const presenceLayer = Layer.effect(
  SessionPresence,
  Effect.gen(function* () {
    const config = yield* AuthConfig
    const withDb = yield* withDatabase
    return SessionPresence.of({
      isLive: (sessionId) =>
        withDb(
          Effect.map(
            sessionWhere({ id: sessionId }, config.sessionIdleSeconds),
            (session) =>
              session !== undefined && !session.expired && !session.idle && session.usable,
          ),
        ).pipe(Effect.orDie),
    })
  }),
)
