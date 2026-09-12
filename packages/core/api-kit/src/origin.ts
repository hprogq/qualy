import { Context, Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import {
  publicHostOf,
  trustedProxies,
  type AddressedRequest,
  type TrustedProxies,
} from './request.ts'
import { RequestOriginRefused } from './schema.ts'

// Which pages may make this application do things.
//
// A browser sends the session cookie with every request to this host, and
// SameSite=Lax only distinguishes SITES: a page on a sibling subdomain of
// the same registrable domain is same-site, its requests carry the cookie,
// and nothing else in the pipeline was written to notice. So every unsafe
// request - anything but GET, HEAD and OPTIONS - has to come from this
// application's own origin. The browser says where a request came from in
// `Sec-Fetch-Site`, and `same-site` is refused along with `cross-site`:
// that value is exactly the sibling-subdomain case. A client that sends no
// Fetch Metadata is judged by its Origin against the host the request was
// addressed to; one that sends neither is not a browser carrying somebody's
// cookie - curl, a CLI, a test - and is let through, because it has no
// victim to speak for.
//
// Its own subpath, like ./request: nothing here belongs in a browser bundle.

export { publicHostOf, type AddressedRequest }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** whether an Origin header names the host a request was addressed to */
export const originMatchesHost = (
  origin: string | undefined,
  publicHost: string | undefined,
): boolean => {
  if (origin === undefined || publicHost === undefined) return false
  try {
    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === publicHost
    )
  } catch {
    return false
  }
}

export interface OriginInput {
  readonly method: string
  readonly secFetchSite: string | undefined
  readonly origin: string | undefined
  readonly publicHost: string | undefined
}

/** the rule, on the strings alone */
export const originVerdict = (input: OriginInput): 'allow' | 'refuse' => {
  if (SAFE_METHODS.has(input.method)) return 'allow'
  if (input.secFetchSite !== undefined) {
    return input.secFetchSite === 'same-origin' || input.secFetchSite === 'none'
      ? 'allow'
      : 'refuse'
  }
  if (input.origin === undefined) return 'allow'
  return originMatchesHost(input.origin, input.publicHost) ? 'allow' : 'refuse'
}

/** whether a request's Origin names the host it was addressed to; for a websocket handshake, which always carries one */
export const sameOriginRequest = (request: AddressedRequest, trusted: TrustedProxies): boolean =>
  originMatchesHost(request.headers['origin'], publicHostOf(request, trusted))

// the wire shape the api's own error encoding produces, so the browser reads
// the refusal the way it reads every other error: by its tag
const refused = HttpServerResponse.schemaJson(RequestOriginRefused)(
  new RequestOriginRefused({ message: 'the request did not come from this application' }),
  { status: 403 },
).pipe(Effect.orDie)

const pathOf = (url: string): string => {
  const at = url.search(/[?#]/)
  return at === -1 ? url : url.slice(0, at)
}

/**
 * Serve middleware that refuses unsafe requests from other origins before
 * the router sees them. Innermost of the host's chain: a refusal is logged
 * as a request and counted as a 403, and needs no route.
 */
export const requestOriginGuard = (options?: {
  readonly trustedProxies?: readonly string[] | undefined
}) => {
  const trusted = trustedProxies(options?.trustedProxies ?? [])
  return <A, E, R>(
    httpApp: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A | HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  > =>
    Effect.withFiber<A | HttpServerResponse.HttpServerResponse, E, R>((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
      const secFetchSite = request.headers['sec-fetch-site']
      const origin = request.headers['origin']
      const publicHost = publicHostOf(request, trusted)
      if (originVerdict({ method: request.method, secFetchSite, origin, publicHost }) === 'allow') {
        return httpApp
      }
      // the five facts the rule read, and nothing the request carried
      // besides them: the line exists so that a proxy that stopped
      // forwarding the host shows up as every POST refused
      return Effect.logWarning('request refused: not from this application').pipe(
        Effect.annotateLogs({
          method: request.method,
          path: pathOf(request.url),
          secFetchSite: secFetchSite ?? null,
          origin: origin ?? null,
          host: publicHost ?? null,
        }),
        Effect.andThen(refused),
      )
    })
}
