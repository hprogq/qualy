import { Effect, identity, Result } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/unstable/http'
import { HttpApiClient, type HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi'
import { apiRouteTemplates } from '@qualy/api-kit/local'
import { registerApiRoutes } from '@qualy/browser-observability/api-routes'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
  isClientUnsupportedReason,
  type ClientUnsupportedReason,
} from '@qualy/release-contract'

// A client is derived from an api DEFINITION, and every plugin holds its own:
// the global aggregate this module used to wrap was the last generated
// artifact in the repository, and the only consumer that genuinely needs
// "every endpoint at once" is nobody. A plugin builds a client over exactly
// the groups it calls - its own, plus any neighbour contract it imports -
// and the group identifier keys stay globally unique, so query caches from
// different plugin clients can never collide.

/**
 * The browser does not announce a trace it will never tell.
 *
 * Effect's client tracing creates an `http.client` span per request and, with
 * `TracerPropagationEnabled` at its default, writes it into `traceparent` and
 * `b3` headers. Browser telemetry is deliberately not installed (no RUM, no
 * exporter), so that span is never reported anywhere - and a server that
 * honors the header then records every browser request as the child of a
 * parent no backend will ever receive: Tempo renders `<root span not yet
 * received>`, and an APM sees orphan traces. Creating a span, propagating it
 * and exporting it come as a set; with export absent, propagation is switched
 * off HERE, on the browser client only. The server keeps honoring inbound
 * `traceparent` from callers that do export (a proxy, a worker, a future
 * browser RUM - re-enable this then, and the client span becomes a legitimate
 * remote parent).
 */
const withoutTracePropagation = HttpClient.transformResponse(
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
)

/** who the browser says it is: the release it runs and the protocol generation it speaks */
export interface ClientIdentity {
  readonly releaseId: string
  readonly clientProtocol: number
}

export interface TransportOptions {
  /** named on every request, here and nowhere else; a harness may leave it out */
  readonly identity?: ClientIdentity
  /** the server has refused this page's protocol: the release coordinator's to hear */
  readonly onClientUnsupported?: (reason: ClientUnsupportedReason) => void
}

/**
 * The browser's identity on every request, and the server's verdict on it.
 *
 * Put on the transport rather than by any page: every typed client goes
 * through here, so no plugin names the headers, and a refusal - 409 with
 * the header the contract names - is read off the raw response before the
 * typed decoding sees it. The request itself goes on to fail the way it
 * would have; the refusal is an infrastructure signal, not a domain error
 * for every plugin's union to carry.
 */
const withIdentity = (options: TransportOptions) => {
  const named =
    options.identity === undefined
      ? identity
      : HttpClient.mapRequest(
          HttpClientRequest.setHeaders({
            [QUALY_CLIENT_RELEASE_HEADER]: options.identity.releaseId,
            [QUALY_CLIENT_PROTOCOL_HEADER]: String(options.identity.clientProtocol),
          }),
        )
  const heard = options.onClientUnsupported
  const judged =
    heard === undefined
      ? identity
      : HttpClient.tap((response) =>
          Effect.sync(() => {
            if (response.status !== 409) return
            const said = response.headers[QUALY_CLIENT_UNSUPPORTED_HEADER]
            if (said === undefined) return
            // The header's PRESENCE is the fact: this server will not talk to
            // this page. Its value says which of three it was, and a value
            // this page does not know is a server newer than the page - still
            // a refusal, reported under the oldest of the names rather than
            // ignored, since ignoring it leaves the reader with api errors
            // and no way to understand them.
            heard(isClientUnsupportedReason(said) ? said : 'protocol')
          }),
        )
  return <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    judged(named(withoutTracePropagation(client)))
}

/**
 * A client for one api definition.
 *
 * `baseUrl` is an ORIGIN, not a mount point. The mount lives in the
 * definition already - `Api.local` applies the prefix - so every declared
 * path is the full path. Omitting it entirely is the browser case: the paths
 * are absolute and same-origin, so fetch resolves them against the page.
 */
/**
 * The refusals no endpoint declares, given back their own names.
 *
 * Two answers under `/api` are the pipeline's rather than a handler's: a
 * request that did not come from this application, and a route this build no
 * longer has. They carry the same tagged shape as every other error here,
 * but no endpoint lists them - so the typed client has no decoder for their
 * status and falls through to its own transport error. The reader was then
 * told "something went wrong" for the two answers whose whole point is to
 * say what to do next, and the sentences written for them could never be
 * reached.
 *
 * Decided by status rather than by body, because the body is gone: the
 * decoder that failed has already read it, and a response here has no second
 * copy. The status is enough precisely because this code only runs when the
 * decoder fell through - which means this endpoint declared nothing for that
 * status, and under this mount the only thing left that answers it is the
 * pipeline.
 */
const PIPELINE_REFUSALS: Record<number, string> = {
  403: 'REQUEST_ORIGIN_REFUSED',
  404: 'API_ROUTE_NOT_FOUND',
}

type FellThrough = {
  readonly _tag: 'HttpClientError'
  readonly reason: { readonly _tag: string; readonly response: HttpClientResponse.HttpClientResponse }
}

const fellThrough = (error: unknown): error is FellThrough =>
  (error as { _tag?: unknown } | null)?._tag === 'HttpClientError' &&
  (error as { reason?: { _tag?: unknown } }).reason?._tag === 'DecodeError'

const pipelineRefusals = (
  effect: Effect.Effect<unknown, unknown, unknown>,
): Effect.Effect<unknown, unknown, unknown> =>
  Effect.catch(effect, (error) => {
    if (!fellThrough(error)) return Effect.fail(error)
    const code = PIPELINE_REFUSALS[error.reason.response.status]
    // the english a server sends for clients that do not localize is the
    // last thing between an untranslated code and "something went wrong",
    // and there is none to carry here - the code is the whole message, and
    // every locale has a sentence for it
    return code === undefined ? Effect.fail(error) : Effect.fail({ _tag: code })
  })

export const clientFor = <ApiId extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  baseUrl?: string,
  options: TransportOptions = {},
) => {
  // What the reporting platform will be allowed to call this traffic.
  //
  // Here because this is the one place every typed client is built, and
  // because the answer has to exist before the first request rather than be
  // guessed from its address afterwards. A path carries the row; only the
  // declaration knows which segment that is. The port on the other side takes
  // strings and has never heard of Effect.
  //
  // The leaf subpath, not the package: the port's other exports read `window`
  // and `location`, and this module is also compiled by the node program that
  // drives the api contract tests. The registry itself is pure string work,
  // which is why it can be reached that way at all.
  registerApiRoutes(apiRouteTemplates(api))
  return HttpApiClient.make(api, {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    transformClient: withIdentity(options),
    transformResponse: pipelineRefusals,
  }).pipe(Effect.provide(FetchHttpClient.layer))
}

/** the typed client an api definition derives to */
export type ClientOf<Api extends HttpApi.Constraint> = HttpApiClient.ForApi<Api>

/**
 * What one endpoint answers with.
 *
 * A screen that renders a row should be typed from the api that produced it,
 * not from a hand-written copy: `RoleEditor` took the oRPC DTO and kept
 * compiling after the api's own shape moved, because the two happened to
 * agree.
 */
export type ApiResult<
  Api extends HttpApi.Constraint,
  Group extends keyof ClientOf<Api>,
  Endpoint extends keyof ClientOf<Api>[Group],
> = ClientOf<Api>[Group][Endpoint] extends (...args: never[]) => Effect.Effect<infer A, unknown>
  ? A
  : never
