import { Context, Schema } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/unstable/httpapi'
import type { Principal } from '@qualy/rbac-contract'

// What an endpoint declares, with nothing behind it.
//
// Its own module because every plugin's api.ts names this middleware, and
// api.ts is what the browser imports: leaving the declaration beside the layer
// dragged the database driver into the bundle through a chain no one would
// think to look at. A declaration needs a schema and a tag; the thing that
// resolves a cookie needs a connection, and only one of those belongs in a
// browser.

/** who the request is, resolved once */
export class CurrentUser extends Context.Service<CurrentUser, Principal>()(
  '@qualy/plugin-auth/CurrentUser',
) {}

export class AuthRequired extends Schema.TaggedError<AuthRequired>()(
  'AUTH_REQUIRED',
  {},
  { httpApiStatus: 401, identifier: 'AuthRequired' },
) {}

/**
 * A session that was presented and has since expired.
 *
 * Distinct from being unauthenticated on purpose: the client can tell the
 * difference between "sign in" and "you were signed out", and only this case
 * clears the cookie. An unknown token gets the same answer as no token, so a
 * caller cannot learn that a token once existed.
 */
export class SessionExpired extends Schema.TaggedError<SessionExpired>()(
  'SESSION_EXPIRED',
  {},
  { httpApiStatus: 401, identifier: 'SessionExpired' },
) {}

export const sessionCookieName = 'qualy_session'

export const sessionSecurity = HttpApiSecurity.apiKey({
  in: 'cookie',
  key: sessionCookieName,
})

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  {
    provides: CurrentUser
  }
>()('@qualy/plugin-auth/Authenticated', {
  security: { session: sessionSecurity },
  // an array rather than a union: each member keeps its own status
  // annotation, and a union collapses them into one schema whose per-member
  // statuses are never read, which is a silent 500 for every declared failure
  error: [AuthRequired, SessionExpired],
}) {}

/**
 * Who the request is, when it is allowed not to be anyone.
 *
 * `Authenticated` refuses an endpoint to an anonymous caller, which is right
 * for almost everything. The manifest is the exception: it is served to
 * anonymous visitors on purpose, since the login page is discovered through it.
 *
 * That endpoint therefore declares no middleware and read `CurrentUser`
 * optionally, which looked equivalent and is not: nothing provides that tag
 * unless a middleware does, so a signed-in administrator was served the
 * anonymous manifest and saw no administration pages at all. The cordis
 * enricher ran on every request and had no such hole.
 */
export class CurrentViewer extends Context.Service<
  CurrentViewer,
  { readonly principal: Principal | undefined }
>()('@qualy/plugin-auth/CurrentViewer') {}

/**
 * Resolves a session if one is presented, and never refuses.
 *
 * No cookie, an unknown token and an expired one are the same answer here -
 * an anonymous viewer - because this middleware's job is to say who is asking,
 * not whether they may. What they may see is the projection's decision.
 */
export class Viewer extends HttpApiMiddleware.Service<
  Viewer,
  {
    provides: CurrentViewer
  }
>()('@qualy/plugin-auth/Viewer', {
  security: { session: sessionSecurity },
}) {}
