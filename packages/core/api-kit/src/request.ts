import { Context, Effect, Metric, Option, Tracer } from 'effect'
import { HttpServerError, HttpServerRequest } from 'effect/unstable/http'
import { randomUUID } from 'node:crypto'
import { BlockList, isIP } from 'node:net'

// The identity of one request, decided once at the edge.
//
// Everything that later wants to say "which request was this" - the access
// log today, audit events and sign-in records tomorrow - reads the same
// value instead of re-deriving it from headers, because the two derivations
// that matter are easy to get wrong twice: the client address must not trust
// a forwarded header the deployment's own proxy did not write, and the trace
// id must be the one the server span actually runs under.
//
// Its own subpath for the same reason ./node has one: the kit's root reaches
// the browser, and nothing here belongs in a bundle.

export interface RequestContextShape {
  /** minted per request; nothing upstream is trusted to supply it */
  readonly requestId: string
  /** resolved through the trusted-proxy policy; undefined when unknowable */
  readonly clientIp: string | undefined
  readonly userAgent: string | undefined
  /**
   * The id of the server span this request runs under.
   *
   * The platform opens that span unconditionally (HttpEffect.toHandled wraps
   * every request in HttpMiddleware.tracer) and inherits an incoming
   * `traceparent`, so this is real before any telemetry backend exists.
   * Undefined only when tracing is turned off.
   */
  readonly traceId: string | undefined
  /**
   * The session this request turned out to belong to.
   *
   * A slot rather than a field, because the context is created before any
   * cookie is resolved: whoever resolves the session binds it, and readers
   * later in the same request see it. Undefined until then, and forever on
   * anonymous requests.
   */
  readonly sessionId: string | undefined
  readonly bindSession: (sessionId: string) => Effect.Effect<void>
}

export class RequestContext extends Context.Service<RequestContext, RequestContextShape>()(
  '@qualy/api-kit/RequestContext',
) {}

/**
 * The context of the current request, if there is one.
 *
 * Deliberately optional at the read site: a handler cannot carry the service
 * in its requirements (`HttpRouter.Provided` is a closed set, so the group
 * layer would demand it at build time), and the callers that matter - an
 * audit writer, a session store - also run from jobs and the CLI, where
 * "there is no request" is an answer, not an error.
 */
export const currentRequestContext: Effect.Effect<Option.Option<RequestContextShape>> =
  Effect.serviceOption(RequestContext)

/** binds the resolved session onto the current request, if there is one */
export const bindSessionId = Effect.fn('RequestContext.bindSessionId')(function* (
  sessionId: string,
) {
  const context = yield* Effect.serviceOption(RequestContext)
  if (Option.isSome(context)) yield* context.value.bindSession(sessionId)
})

// --- client address ---

/**
 * One address out of the junk the wire delivers: ports stripped, brackets
 * unwrapped, the v4-mapped-in-v6 form Node reports for plain IPv4 sockets
 * unmapped. Undefined for anything that is not an address, because a value
 * that only looks like one poisons every equality check downstream.
 */
const normalizeIp = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined
  let value = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracketed) value = bracketed[1]!
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.indexOf(':'))
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  if (mapped) value = mapped[1]!
  return isIP(value) === 0 ? undefined : value
}

/** whether an address belongs to the deployment's own proxy tier */
export type TrustedProxies = (ip: string) => boolean

/**
 * A matcher over the configured proxy addresses.
 *
 * Entries are single addresses or CIDR blocks. An entry that parses as
 * neither throws HERE, at configuration time: a proxy list that silently
 * matches nothing downgrades every client address to the proxy's own, which
 * looks like working until someone reads the log.
 */
export const trustedProxies = (entries: readonly string[]): TrustedProxies => {
  if (entries.length === 0) return () => false
  const list = new BlockList()
  for (const entry of entries) {
    const slash = entry.indexOf('/')
    if (slash === -1) {
      const address = normalizeIp(entry)
      if (address === undefined) throw new Error(`invalid trusted proxy entry: "${entry}"`)
      list.addAddress(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
      continue
    }
    const address = normalizeIp(entry.slice(0, slash))
    const prefix = Number(entry.slice(slash + 1))
    const family = address === undefined ? 0 : isIP(address)
    const width = family === 4 ? 32 : 128
    if (address === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > width) {
      throw new Error(`invalid trusted proxy entry: "${entry}"`)
    }
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6')
  }
  return (ip) => list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}

/**
 * The address of the client, through however many trusted proxies stand
 * before it.
 *
 * The socket address is the only fact this process observed itself, so it is
 * the anchor: an untrusted socket peer IS the client and its forwarded
 * header is ignored, because that header costs an attacker one line to
 * fabricate. Only when the peer is a trusted proxy is `x-forwarded-for`
 * read, right to left, skipping further trusted hops; the first address a
 * trusted proxy vouches for wins. A chain that never leaves the trusted set
 * is internal traffic and answers with its leftmost address.
 */
export const clientAddressOf = (
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trusted: TrustedProxies,
): string | undefined => {
  const remote = normalizeIp(remoteAddress)
  if (remote === undefined || !trusted(remote)) return remote
  const chain = (forwardedFor ?? '').split(',').map((part) => part.trim())
  for (let at = chain.length - 1; at >= 0; at--) {
    if (chain[at] === '') continue
    const hop = normalizeIp(chain[at])
    // a forged or mangled entry ends the walk: what stands beyond it is
    // whatever the forger chose, and unknown beats attacker-chosen
    if (hop === undefined) return undefined
    if (!trusted(hop)) return hop
  }
  return normalizeIp(chain[0]) ?? remote
}

// --- the middleware ---

/**
 * Serve middleware that renames the request's server span to its route
 * template - `GET /iam/users/:userId` - once the router has matched.
 *
 * The platform names the span before routing (`http.server GET`), because at
 * creation time the only fact it has is the method: the raw URL would put an
 * id in every span name. The router records the matched template as the
 * `http.route` attribute (HttpRouter.ts:220-223 in the vendored source) but
 * cannot rename - `Tracer.Span` declares no rename operation. Both span
 * implementations this process can run under carry `name` as a writable
 * runtime property that is only read after the span ends (the OTLP tracer's
 * span object assigns it via Object.assign and serializes at export,
 * OtlpTracer.ts; the native span assigns a class field, Tracer.ts
 * NativeSpan), and this exit hook runs before the platform tracer's own end
 * hook, which wraps all serve middleware. The assignment below is the one
 * deviation from the declared interface; the suite pins the exported name so
 * an upgrade that changes either implementation fails a test instead of
 * silently reverting every span name to `http.server GET`.
 */
export const routeSpanNames = <A, E, R>(
  httpApp: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.withFiber((fiber) => {
    const span = Context.getOption(fiber.context, Tracer.ParentSpan)
    // the noop span cannot reach the rename: its attribute() discards, so
    // the http.route guard below never passes
    if (Option.isNone(span) || span.value._tag !== 'Span') return httpApp
    const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
    const named = span.value
    return Effect.onExit(httpApp, () =>
      Effect.sync(() => {
        const route = named.attributes.get('http.route')
        if (typeof route === 'string') {
          ;(named as { name: string }).name = `${request.method} ${route}`
        }
      }),
    )
  })

/**
 * The RED metric for HTTP: one histogram whose count is the request rate,
 * whose status label separates the errors, and whose buckets are the
 * latency distribution - the OTel semconv metric, name, unit and buckets.
 *
 * Every label is low-cardinality by where it comes from: the method is
 * normalized against the semconv known set (anything else says `_OTHER`),
 * the scheme and the route are what the platform tracer and the router
 * already wrote onto the span (`/things/:thingId`, never the raw URL) - one
 * source, so trace and metric cannot disagree. A request no route matched
 * carries no route label at all. Event streams are counted like every other
 * request, because the standard metric measures request duration and makes
 * no SSE exception; a latency dashboard excludes those routes by
 * `http.route`, not this recorder by content type.
 *
 * One deviation, by upstream constraint: semconv types
 * `http.response.status_code` as an int, but `Metric.AttributeSet` in
 * effect rc.111 is `Record<string, string>` - the digits are the same, and
 * the Prometheus path renders every label as a string regardless.
 */
const requestDuration = Metric.histogram('http.server.request.duration', {
  description: 'Duration of HTTP server requests.',
  boundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
})

const KNOWN_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
  'PATCH',
])

export const httpMetrics = <A extends { readonly status: number }, E, R>(
  httpApp: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.withFiber((fiber) => {
    const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
    const span = Option.getOrUndefined(Context.getOption(fiber.context, Tracer.ParentSpan))
    const started = performance.now()
    return Effect.onExit(httpApp, (exit) =>
      Effect.suspend(() => {
        const seconds = (performance.now() - started) / 1000
        const status =
          exit._tag === 'Success'
            ? exit.value.status
            : HttpServerError.causeResponseStripped(exit.cause)[0].status
        const spanAttribute = (key: string): string | undefined => {
          const value =
            span !== undefined && span._tag === 'Span' ? span.attributes.get(key) : undefined
          return typeof value === 'string' ? value : undefined
        }
        const route = spanAttribute('http.route')
        return Metric.update(
          Metric.withAttributes(requestDuration, {
            unit: 's',
            'http.request.method': KNOWN_METHODS.has(request.method) ? request.method : '_OTHER',
            'url.scheme': spanAttribute('url.scheme') ?? 'http',
            'http.response.status_code': String(status),
            ...(route === undefined ? {} : { 'http.route': route }),
            // a server error is the condition semconv requires error.type
            // under; the status code is its stable low-cardinality form
            ...(status >= 500 ? { 'error.type': String(status) } : {}),
          }),
          seconds,
        )
      }),
    )
  })

/**
 * Serve middleware that provides the `RequestContext` for everything
 * downstream.
 *
 * It has to sit inside the platform's tracer (which `HttpEffect.toHandled`
 * guarantees for any serve middleware) so the span it reads is the request's
 * own, and outside whatever wants to read the context - the host composes it
 * as the outermost of its own middleware.
 */
export const requestContext = (options?: {
  readonly trustedProxies?: readonly string[] | undefined
}) => {
  const trusted = trustedProxies(options?.trustedProxies ?? [])
  return <A, E, R>(
    httpApp: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, RequestContext> | HttpServerRequest.HttpServerRequest> =>
    Effect.withFiber((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
      const span = Context.getOption(fiber.context, Tracer.ParentSpan)
      let sessionId: string | undefined
      return Effect.provideService(httpApp, RequestContext, {
        requestId: randomUUID(),
        clientIp: clientAddressOf(
          Option.getOrUndefined(request.remoteAddress ?? Option.none()),
          request.headers['x-forwarded-for'],
          trusted,
        ),
        userAgent: request.headers['user-agent'],
        // 'noop' is the disabled tracer's sentinel span
        // (repos/effect/packages/effect/src/internal/effect.ts:5645-5648),
        // not an id worth recording
        traceId: Option.match(span, {
          onNone: () => undefined,
          onSome: (parent) => (parent.traceId === 'noop' ? undefined : parent.traceId),
        }),
        get sessionId() {
          return sessionId
        },
        bindSession: (id) =>
          Effect.sync(() => {
            sessionId = id
          }),
      })
    })
}
