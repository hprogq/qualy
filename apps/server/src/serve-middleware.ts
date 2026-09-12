import type { Effect } from 'effect'
import type { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { requestOriginGuard } from '@qualy/api-kit/origin'
import {
  httpMetrics,
  requestContext,
  routeSpanNames,
  type RequestContext,
} from '@qualy/api-kit/request'
import { accessLog } from './access-log.ts'
import type { LoggingSettings } from './logging.ts'
import { responseHeaders } from './response-headers.ts'

// The chain every request passes through before the router, in one place
// so a test can serve a router of its own behind exactly what production
// serves behind.
//
// Outermost is the request context, which has to sit inside the platform's
// tracer (every serve middleware does) and outside whatever reads it. Then
// the access log, so it can name the request id, and the RED histogram,
// both of which read the route template that routeSpanNames writes onto
// the span from innermost - which is why that one sits last but one. The
// response headers sit just outside the origin guard, so a refusal carries
// them like any other api answer. The origin guard is the innermost of all:
// a refusal is still a request line in the log and a 403 in the histogram,
// and it needs no route to decide.

export const serveMiddleware = (options: {
  readonly trustedProxies: readonly string[]
  readonly access: LoggingSettings['access']
}) => {
  const withRequestContext = requestContext({ trustedProxies: options.trustedProxies })
  const withAccessLog = accessLog(options.access)
  const guard = requestOriginGuard({ trustedProxies: options.trustedProxies })
  return <E, R>(
    httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    Exclude<R, RequestContext> | HttpServerRequest.HttpServerRequest
  > =>
    withRequestContext(withAccessLog(httpMetrics(routeSpanNames(responseHeaders(guard(httpApp))))))
}
