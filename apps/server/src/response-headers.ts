import { Context, Effect, Option } from 'effect'
import { Headers, HttpEffect, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { RequestContext } from '@qualy/api-kit/request'

// The headers every api and health response carries, unless the handler
// already said otherwise.
//
// Only the Effect responses: the browser shell and the hashed assets are
// written straight to the node response by the static middleware behind
// `fromConnect`, and what comes back up to this chain for those is an empty
// 200 that nothing reads. Their headers are set where they are written
// (@qualy/plugin-web's `setHeaders`). Limiting this to the api and health
// prefixes is what keeps the two from ever meeting: a header set here on a
// response that has already gone out is at best ignored.
//
// - `Cache-Control: no-store`: an api answer is per session and per moment;
//   a shared cache or a back button must not replay it. An event stream is
//   the one exception - `no-store` on a stream makes some browsers refuse
//   to hold the connection open - so it gets `no-cache`.
// - `X-Content-Type-Options: nosniff`: a JSON body is never sniffed into
//   html; the attachment download already sends it and is left alone.
// - `Cross-Origin-Resource-Policy: same-origin`: another origin may not
//   read these bytes even where a CORS check would not run (no-cors
//   embeds); nothing here is meant to be embedded elsewhere.
// - `Referrer-Policy: strict-origin-when-cross-origin`: what a link out of
//   an api-served document tells the other side, kept to the origin.
//
// A websocket handshake is left untouched: the response there is the
// upgrade, and the upgraded socket carries no headers of ours.
//
// Two ways a response leaves, both covered. A route's response is sent
// inside the effect this middleware wraps (upstream HttpEffect.toHandled:
// the serve middleware sits around the sending, and the value that comes
// back up is already on the wire), so the headers ride a pre-response
// handler registered on the request before the app runs. A response the
// chain itself produces - the origin guard's refusal - never enters that
// path and is sent as returned, so the returned value is mapped as well.
// Both go through the same idempotent function.

const PREFIXES = [QUALY_API_PREFIX, '/health']

const under = (url: string, prefix: string): boolean =>
  url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)

const isEventStream = (response: HttpServerResponse.HttpServerResponse): boolean =>
  (
    (response.body as { contentType?: string }).contentType ??
    response.headers['content-type'] ??
    ''
  ).startsWith('text/event-stream')

/** the response with the headers it lacks, and only those */
export const withResponseHeaders = (
  response: HttpServerResponse.HttpServerResponse,
  requestId?: string,
): HttpServerResponse.HttpServerResponse => {
  const absent: Record<string, string> = {}
  const missing = (name: string, value: string) => {
    if (!Headers.has(response.headers, name)) absent[name] = value
  }
  // The id this host minted for the request, told back to the caller: the
  // one thing a reader can quote that finds the request in the logs and
  // the audit trail. On the api and the probes only - a hashed asset is
  // cached by name and a correlation header on it would name the wrong
  // request - and in a header, never in a body: it is transport metadata,
  // and every endpoint's schema stays the schema of its own answer.
  if (requestId !== undefined) missing('x-qualy-request-id', requestId)
  missing('cache-control', isEventStream(response) ? 'no-cache' : 'no-store')
  missing('x-content-type-options', 'nosniff')
  missing('cross-origin-resource-policy', 'same-origin')
  missing('referrer-policy', 'strict-origin-when-cross-origin')
  return Object.keys(absent).length === 0
    ? response
    : HttpServerResponse.setHeaders(response, absent)
}

const unlessUpgrade = (
  response: HttpServerResponse.HttpServerResponse,
  requestId?: string,
): HttpServerResponse.HttpServerResponse =>
  response.status === 101 ? response : withResponseHeaders(response, requestId)

/** serve middleware: the headers above on every api and health response */
export const responseHeaders = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.withFiber<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  >((fiber) => {
    const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
    if (!PREFIXES.some((prefix) => under(request.url, prefix))) return httpApp
    if ((request.headers['upgrade'] ?? '').toLowerCase() === 'websocket') return httpApp
    // the request context is outermost in the chain, so it is here; a chain
    // built without it (a test of these headers alone) just tells no id
    const requestId = Context.getOption(fiber.context, RequestContext).pipe(
      Option.map((context) => context.requestId),
      Option.getOrUndefined,
    )
    return HttpEffect.withPreResponseHandler(
      Effect.map(httpApp, (response) => unlessUpgrade(response, requestId)),
      (_request, response) => Effect.succeed(unlessUpgrade(response, requestId)),
    )
  })
