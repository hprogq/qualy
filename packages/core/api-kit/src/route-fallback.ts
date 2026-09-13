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

/** the api owns everything under its mount, matched or not */
export const insideApi = (url: string): boolean =>
  url === QUALY_API_PREFIX ||
  url.startsWith(`${QUALY_API_PREFIX}/`) ||
  url.startsWith(`${QUALY_API_PREFIX}?`)

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
