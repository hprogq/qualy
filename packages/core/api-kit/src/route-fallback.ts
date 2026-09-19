import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { QUALY_API_PREFIX } from './index.ts'
import { ApiRouteNotFound } from './schema.ts'

// What answers inside the api mount when no route does.
//
// The router answers an unmatched path with an empty 404, and behind a
// shell's catch-all it once answered with the html page - which is how a
// mistyped endpoint read as a working request until the page tried to parse
// the shell as json. Inside the mount the answer is a tagged error like
// every other refusal, so the browser reads it by its tag. Outside the
// mount the router's own answer stands: the shell's catch-all, or a plain
// 404 on a host with no shell.

/**
 * Whether a request is under a mount, decided on the spelling the ROUTER
 * matches on rather than on the raw url.
 *
 * The router normalizes before it matches, so a raw prefix test disagreed
 * with it: `/%61pi/x`, `/API/x` and `//api/x` all reached an api handler
 * while every wrapper keyed off this answer - the client compatibility
 * check, the access log's api mode, the response headers, the shell's own
 * not-found - believed the request was somewhere else.
 *
 * Same three steps, in the router's own order (its lookup in
 * repos/effect/packages/effect/src/unstable/http/FindMyWay/internal/router.ts:
 * duplicate slashes collapsed, then decoded, then lowercased because
 * `caseSensitive` defaults to false). Where decoding is ambiguous this
 * answers yes: treating something as belonging to a mount that the router
 * then sends elsewhere costs a header and a log line, while the reverse is
 * a request reaching a handler with none of the checks that guard it.
 */
export const underPrefix = (url: string, prefix: string): boolean => {
  const collapsed = url.replace(/\/{2,}/g, '/')
  // the router splits the path off at any of these, not only at `?`
  const path = collapsed.split(/[?;#]/)[0] ?? collapsed
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // an undecodable escape is left as it stands, as the router leaves what
    // it cannot decode
  }
  const normal = decoded.toLowerCase()
  return normal === prefix || normal.startsWith(`${prefix}/`)
}

/** the api owns everything under its mount, matched or not */
export const insideApi = (url: string): boolean => underPrefix(url, QUALY_API_PREFIX)

/** the tagged 404, encoded by the same schema the api's errors are */
export const apiRouteNotFound: Effect.Effect<HttpServerResponse.HttpServerResponse> =
  HttpServerResponse.schemaJson(ApiRouteNotFound)(
    new ApiRouteNotFound({ message: 'No API route matches this request.' }),
    { status: 404 },
  ).pipe(Effect.orDie)

/**
 * The catch-all inside the mount, as a route: the router matches by
 * specificity, so every declared endpoint wins over it, and a shell's own
 * catch-all at `/*` loses to it. A route rather than serve middleware
 * because the platform writes the router's not-found before the serve
 * middleware runs (repos/effect/packages/effect/src/unstable/http/HttpEffect.ts,
 * toHandled): by the time a middleware could catch the error, an empty 404
 * has already gone out.
 */
export const apiRouteFallback: Layer.Layer<never, never, HttpRouter.HttpRouter> = HttpRouter.use(
  (router) => router.add('*', `${QUALY_API_PREFIX}/*`, apiRouteNotFound),
)
