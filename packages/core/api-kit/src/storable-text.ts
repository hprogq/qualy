import { Context, Effect, type Layer } from 'effect'
import { HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi'
import { insideApi } from './route-fallback.ts'
import { BadRequest, unstorableText } from './schema.ts'

// Text under the api that PostgreSQL could not keep, refused before any
// endpoint decodes it.
//
// A NUL, or half of a surrogate pair standing alone, passes every schema that
// is not built from the kit's text primitives - a login email, a search
// query, a path parameter, a free-form JSON payload stored as jsonb - and is
// refused by the database instead (22021, 22P05, 22P02), which every service
// here turns into a defect: a 500 and an error log line for a request that is
// simply malformed, anonymous visitors included. Guarding field by field
// missed exactly those, so the request is checked as a whole: the address,
// and a JSON body. Nothing the product stores can hold either character, so
// nothing legitimate is refused.
//
// Two halves, because they need different knowledge. The address, and whether
// a body names its type at all, are decided in front of the router
// (`storableTextGuard`, serve middleware). A body is read only once the router
// has said which endpoint it is for (`storableBodies`, route middleware on the
// api's own routes), and only for an endpoint whose contract declares a
// payload: that is the one body the platform decodes. A door that streams its
// body - the local upload door, a raw handler whose contract declares none -
// is never read here, whatever type the request names; reading it first
// would buffer it and hand the door an exhausted stream.
//
// Its own subpath, like ./origin: nothing here belongs in a browser bundle.

const refused = HttpServerResponse.schemaJson(BadRequest)(
  new BadRequest({ message: 'the request carries text that cannot be stored' }),
  { status: 400 },
).pipe(Effect.orDie)

const untyped = HttpServerResponse.schemaJson(BadRequest)(
  new BadRequest({ message: 'a request body has to name its content type' }),
  { status: 415 },
).pipe(Effect.orDie)

const mediaType = (header: string): string => header.split(';')[0]!.trim().toLowerCase()

/**
 * Whether a request carries a body at all: a length above zero, or one sent
 * in chunks with no length given. A POST or PUT with nothing to send says
 * `content-length: 0`, which fetch writes for it.
 */
const carriesBody = (headers: Readonly<Record<string, string | undefined>>): boolean =>
  headers['transfer-encoding'] !== undefined || Number(headers['content-length'] ?? 0) > 0

/**
 * Whether a JSON body carries a string, or a key, PostgreSQL could not keep.
 *
 * Only an escape can put either into parsed JSON: a raw NUL is not valid JSON,
 * and the body was decoded from UTF-8, which has no way to spell a lone
 * surrogate. So a body without `\u` in it is answered without parsing, which
 * is nearly every body: JSON.stringify writes that escape only for control
 * characters and lone surrogates. A body that does not parse is left to the
 * endpoint, which refuses it in its own words.
 *
 * Walked with a list rather than by recursion: a two-megabyte body can nest
 * deeper than the stack.
 */
const carriesUnstorableText = (body: string): boolean => {
  if (!body.includes('\\u')) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return false
  }
  const pending: unknown[] = [parsed]
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      if (unstorableText(value)) return true
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item)
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        if (unstorableText(key)) return true
        pending.push(item)
      }
    }
  }
  return false
}

/**
 * Serve middleware that refuses an api request whose address carries text
 * PostgreSQL could not store, with the kit's 400, and one whose body names
 * no content type, with a 415.
 *
 * It reads no body. The typeless refusal happens here, in front of the
 * router, because the two readings of such a body disagree: an endpoint
 * decodes it as JSON (the platform falls back to `application/json` when the
 * header is missing - repos/effect/packages/effect/src/unstable/httpapi/
 * HttpApiBuilder.ts, `decodePayload`), while a raw door streams it. Every
 * client of this api names the type of what it sends - the typed client
 * JSON, the upload door's `application/octet-stream` - so nothing legitimate
 * is refused. An empty header is not JSON either: an endpoint that decodes
 * refuses it itself, and a raw door streams it.
 */
export const storableTextGuard = <A, E, R>(
  httpApp: Effect.Effect<A, E, R>,
): Effect.Effect<
  A | HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.withFiber<A | HttpServerResponse.HttpServerResponse, E, R>((fiber) => {
    const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
    if (!insideApi(request.url)) return httpApp
    // the only spelling of a NUL in an address: the request line itself
    // cannot carry the byte, and a broken escape decodes to nothing at all
    if (request.url.includes('%00')) return refuse('address')
    if (!HttpMethod.hasBody(request.method)) return httpApp
    if (request.headers['content-type'] === undefined && carriesBody(request.headers)) {
      return refuseUntyped
    }
    return httpApp
  })

/** how a route is told apart from every other: its method and its declared path */
const routeKey = (method: string, path: string): string => `${method} ${path}`

/**
 * Route middleware that refuses, with the kit's 400, a JSON body carrying
 * text PostgreSQL could not store - on the routes of `api` whose endpoint
 * declares a payload, and nowhere else.
 *
 * Provided to the api's own routes, it runs once the router has matched
 * (`HttpRouter.RouteContext` names the route) and before the endpoint's
 * middleware and its payload decoding. The body it reads is cached, so the
 * endpoint decodes the same bytes afterwards (NodeHttpIncomingMessage keeps
 * one `arrayBuffer` read for every later `text` or `json`). A body that
 * cannot be read - over the ceiling, cut off - is left to the endpoint,
 * which meets the same failure and answers it as it always has.
 */
export const storableBodies = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): Layer.Layer<never> => {
  const decoded = new Set<string>()
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      if (endpoint.payload.size > 0 && HttpMethod.hasBody(endpoint.method)) {
        decoded.add(routeKey(endpoint.method, endpoint.path))
      }
    },
  })
  return HttpRouter.middleware((httpEffect) =>
    Effect.withFiber((fiber) => {
      const { route } = Context.getUnsafe(fiber.context, HttpRouter.RouteContext)
      if (!decoded.has(routeKey(route.method, route.path))) return httpEffect
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
      const type = request.headers['content-type']
      if (type === undefined || mediaType(type) !== 'application/json') return httpEffect
      return Effect.flatMap(Effect.result(request.text), (read) =>
        read._tag === 'Success' && carriesUnstorableText(read.success)
          ? refuse('body')
          : httpEffect,
      )
    }),
  ).layer
}

const refuse = (part: 'address' | 'body') =>
  Effect.logDebug('request refused: it carries text that cannot be stored').pipe(
    Effect.annotateLogs({ part }),
    Effect.andThen(refused),
  )

const refuseUntyped = Effect.logDebug('request refused: its body names no content type').pipe(
  Effect.andThen(untyped),
)
