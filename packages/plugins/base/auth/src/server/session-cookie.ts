import { Duration, Effect } from 'effect'
import { HttpEffect, HttpServerResponse, type HttpServerRequest } from 'effect/unstable/http'
import { sessionCookieName } from './session-contract.ts'

// The session cookie's name and attributes, decided in one place on the
// server side.
//
// A secure deployment names it with the `__Host-` prefix, which a browser
// only accepts with Secure, Path=/ and no Domain - and which no other host,
// sibling subdomains included, can create for this one. Without the prefix
// a page on `rec.example` could plant a `qualy_session` for `.example` and
// have this application read it. Development runs over plain http, where a
// browser drops a prefixed cookie outright, so it keeps the bare name. A
// process reads exactly one of the two: the one its configuration names.

const HOST_PREFIX = '__Host-'

/** the name a deployment reads and writes, from whether its cookies are secure */
export const sessionCookieNameFor = (secure: boolean): string =>
  secure ? `${HOST_PREFIX}${sessionCookieName}` : sessionCookieName

/** appends the session cookie to the response this request will send */
export const setSessionCookie = (
  name: string,
  value: string,
  options: { readonly secure: boolean; readonly maxAge: Duration.Duration },
): Effect.Effect<void, never, HttpServerRequest.HttpServerRequest> =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.orDie(
      HttpServerResponse.setCookie(response, name, value, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: options.secure,
        maxAge: options.maxAge,
      }),
    ),
  )

/**
 * Drops a session cookie by name.
 *
 * Every dead-session branch and the sign-out clear the name in use; a
 * secure sign-in also clears the bare name once, the hygiene of the rename
 * for a browser that still carries the old cookie. A cookie a sibling host
 * planted for the parent domain cannot be cleared from here, and does not
 * need to be: it is never read.
 */
export const clearSessionCookie = (
  name: string,
  secure: boolean,
): Effect.Effect<void, never, HttpServerRequest.HttpServerRequest> =>
  setSessionCookie(name, '', { secure, maxAge: Duration.zero })
