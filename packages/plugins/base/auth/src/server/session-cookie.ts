import { Duration, Effect } from 'effect'
import { HttpEffect, HttpServerResponse, type HttpServerRequest } from 'effect/http'
import { sessionCookieNameFor, sessionCookieNames } from '@qualy/auth-contract/session'

// The session cookie's attributes, decided in one place on the server side;
// its name is the contract's (@qualy/auth-contract/session).
//
// A secure deployment names it with the `__Host-` prefix, which a browser
// only accepts with Secure, Path=/ and no Domain - and which no other host,
// sibling subdomains included, can create for this one. Without the prefix
// a page on `rec.example` could plant a `qualy_session` for `.example` and
// have this application read it. Development runs over plain http, where a
// browser drops a prefixed cookie outright, so it keeps the bare name. A
// process reads exactly one of the two: the one its configuration names.

export { sessionCookieNameFor, sessionCookieNames }

/** the prefix that keeps a cookie this host's alone */
const HOST_PREFIX = '__Host-'

/** appends the session cookie to the response this request will send */
export const setSessionCookie = (
  name: string,
  value: string,
  /** no age: the browser's own session keeps it, as a shared device's is kept */
  options: { readonly secure: boolean; readonly maxAge: Duration.Duration | undefined },
): Effect.Effect<void, never, HttpServerRequest.HttpServerRequest> =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.orDie(
      HttpServerResponse.setCookie(response, name, value, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: options.secure,
        ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
      }),
    ),
  )

/**
 * Drops a session cookie by name.
 *
 * A secure sign-in clears the bare name once, the hygiene of the rename
 * for a browser that still carries the old cookie. A cookie a sibling host
 * planted for the parent domain cannot be cleared from here, and does not
 * need to be: it is never read.
 */
export const clearSessionCookie = (
  name: string,
  secure: boolean,
): Effect.Effect<void, never, HttpServerRequest.HttpServerRequest> =>
  setSessionCookie(name, '', { secure, maxAge: Duration.zero })

/**
 * The cookie that ties a redirect through somebody else's server to the
 * browser that set out on it.
 *
 * It carries the flow's state, which the other server hands back in the
 * address, and the way back is taken up only where the two agree: a return
 * address somebody else started and forwarded arrives in a browser that has
 * no such cookie, or another one. Named and scoped like the session cookie,
 * for the same reason - no sibling host can plant one - and alive only as
 * long as the flow is.
 */
const FLOW_COOKIE = 'qualy_flow'

export const flowCookieNameFor = (secure: boolean): string =>
  secure ? `${HOST_PREFIX}${FLOW_COOKIE}` : FLOW_COOKIE
