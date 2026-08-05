import { Duration, Effect, Layer, Redacted } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Database } from '@qualy/plugin-database/effect'
import { deleteSessionQuery, sessionByTokenQuery, touchSessionQuery } from '../iam/queries.ts'
import { AuthConfig } from './auth-config.ts'
import {
  AuthRequired,
  Authenticated,
  CurrentUser,
  SessionExpired,
  sessionCookieName,
  sessionSecurity,
} from './session-contract.ts'

// re-exported so existing importers keep one name for the middleware
export {
  AuthRequired,
  Authenticated,
  CurrentUser,
  SessionExpired,
  sessionCookieName,
  sessionSecurity,
}
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

/**
 * Drops the cookie a request presented.
 *
 * Both dead-session branches clear it, as the cordis enricher did. Without
 * this the browser keeps re-presenting a token the server has already refused
 * until the cookie's own lifetime lapses, and on the not-usable branch the row
 * is not deleted either, so a user disabled and re-enabled resumes on it.
 */
export const clearSessionCookie = (secure: boolean) =>
  HttpApiBuilder.securitySetCookie(sessionSecurity, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: Duration.zero,
  })

export const layer = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const database = yield* Database
    const config = yield* AuthConfig
    const clear = () => clearSessionCookie(config.secureCookies)

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
          yield* clear()
          return yield* new SessionExpired()
        }
        // a disabled user, a disabled type or a lapsed tenant is not a
        // distinguishable state either: it is simply not a session
        if (!session.usable) {
          yield* clear()
          return yield* new AuthRequired()
        }

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
