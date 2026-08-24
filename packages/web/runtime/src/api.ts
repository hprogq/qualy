import { Effect } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/unstable/http'
import { HttpApiClient, type HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi'

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

/**
 * A client for one api definition.
 *
 * `baseUrl` is an ORIGIN, not a mount point. The mount lives in the
 * definition already - `Api.local` applies the prefix - so every declared
 * path is the full path. Omitting it entirely is the browser case: the paths
 * are absolute and same-origin, so fetch resolves them against the page.
 */
export const clientFor = <ApiId extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  baseUrl?: string,
) =>
  HttpApiClient.make(api, {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    transformClient: withoutTracePropagation,
  }).pipe(Effect.provide(FetchHttpClient.layer))

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
