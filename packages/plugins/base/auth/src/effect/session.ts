import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/unstable/httpapi'
import { Database } from '@qualy/plugin-database/effect'
import type { Principal } from '@qualy/rbac-contract'
import { deleteSessionQuery, sessionByTokenQuery, touchSessionQuery } from '../iam/queries.ts'
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

/** who the request is, resolved once */
export class CurrentUser extends Context.Service<CurrentUser, Principal>()(
  '@qualy/plugin-auth/CurrentUser',
) {}

export class AuthRequired extends Schema.TaggedErrorClass<AuthRequired>()(
  'AUTH_REQUIRED',
  {},
  { httpApiStatus: 401 },
) {}

/**
 * A session that was presented and has since expired.
 *
 * Distinct from being unauthenticated on purpose: the client can tell the
 * difference between "sign in" and "you were signed out", and only this case
 * clears the cookie. An unknown token gets the same answer as no token, so a
 * caller cannot learn that a token once existed.
 */
export class SessionExpired extends Schema.TaggedErrorClass<SessionExpired>()(
  'SESSION_EXPIRED',
  {},
  { httpApiStatus: 401 },
) {}

export const sessionCookieName = 'qualy_session'

export const sessionSecurity = HttpApiSecurity.apiKey({
  in: 'cookie',
  key: sessionCookieName,
})

export class Authenticated extends HttpApiMiddleware.Service<Authenticated, {
  provides: CurrentUser
}>()('@qualy/plugin-auth/Authenticated', {
  security: { session: sessionSecurity },
  // an array rather than a union: each member keeps its own status
  // annotation, and a union collapses them into one schema whose per-member
  // statuses are never read, which is a silent 500 for every declared failure
  error: [AuthRequired, SessionExpired],
}) {}

interface SessionRow extends Record<string, unknown> {
  id: string
  tenant_id: string
  user_id: string
  last_used_at: Date | string | null
  expired: boolean
  usable: boolean
}

/** how long a session may go unused before its last-used stamp is rewritten */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

const staleness = (lastUsedAt: Date | string | null) => {
  if (lastUsedAt === null) return Number.POSITIVE_INFINITY
  const at = lastUsedAt instanceof Date ? lastUsedAt : new Date(lastUsedAt)
  return Date.now() - at.getTime()
}

export const layer = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const database = yield* Database

    return Authenticated.of({
      // the handler wraps the rest of the request rather than returning a
      // value: it decides whether to continue at all, and provides the
      // principal into whatever runs next
      session: Effect.fn('Authenticated.session')(function* (httpEffect, { credential }) {
        const rows = (yield* database
          .execute(sessionByTokenQuery(hashSessionToken(Redacted.value(credential))))
          .pipe(Effect.orDie)) as unknown as { rows: SessionRow[] }
        const session = rows.rows[0]
        // an unknown token and no token are the same answer
        if (!session) return yield* new AuthRequired()
        if (session.expired) {
          yield* database.execute(deleteSessionQuery(session.id)).pipe(Effect.orDie)
          return yield* new SessionExpired()
        }
        // a disabled user, a disabled type or a lapsed tenant is not a
        // distinguishable state either: it is simply not a session
        if (!session.usable) return yield* new AuthRequired()

        if (staleness(session.last_used_at) > TOUCH_INTERVAL_MS) {
          yield* database.execute(touchSessionQuery(session.id)).pipe(Effect.orDie)
        }

        return yield* Effect.provideService(httpEffect, CurrentUser, {
          tenantId: session.tenant_id,
          userId: session.user_id,
          sessionId: session.id,
        })
      }),
    })
  }),
)
