/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ComponentType } from 'react'
import { Effect, type Exit, type Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientError } from 'effect/http'
import {
  HttpApiClient,
  type HttpApi,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from 'effect/http-api'
import { QUALY_IDENTITY_HEADER, QUALY_LOCALE_HEADER } from '@qualy/api-kit'
import type { appApiGroup } from '@qualy/app-contract'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { QUALY_CLIENT_PROTOCOL_HEADER, QUALY_CLIENT_RELEASE_HEADER } from '@qualy/release-contract'
import type { RenderCorrelation } from '@qualy/release-contract/render-diagnostics'
import type { BrowserSurface, SlotSurface } from '@qualy/ui-contract'
import { hashKey, type DehydratedState, type QueryKey } from '@tanstack/query-core'

type Manifest = HttpApiEndpoint.Success<typeof appApiGroup.endpoints.getManifest>['Type']

// One document request, as everything rendering it sees it
// (docs/adr/0012-rsc-data-mode.md).
//
// Entered once where the request is taken and read by whatever renders
// inside it - the route tree, a plugin's server page - so nobody below has
// to be handed the request, and nobody below builds a client or a runtime of
// its own. This is the one place a server render runs an Effect: a page
// says which of its own api's reads it wants, and the read goes out over the
// same typed contract and the same network transport the browser uses, as
// the viewer who asked for the document.

/**
 * What a page reads first for the address asked, before the document is
 * drawn: its server entry's `prefetch`, answering with the cache it filled
 * (@qualy/web-rsc/queries) for the whole document to be drawn from, or
 * nothing to hand over.
 */
export interface PrefetchedSurface {
  readonly hydration?: DehydratedState
  readonly workspaceCapabilities?: readonly string[]
  readonly slotReferences?: readonly SlotSurface[]
}

export type SurfacePrefetch = (route: {
  /** the route's params, as the address named them */
  readonly params: Readonly<Record<string, string | undefined>>
  /** the address asked for, query and all */
  readonly url: URL
  readonly manifest: Manifest
}) => Promise<PrefetchedSurface | undefined>

/** a loader for one surface's module, as the server's table holds it */
export type SurfaceLoader = () => Promise<{
  readonly default: ComponentType<any>
  /** a page's server entry: what it reads first, on the page's behalf */
  readonly prefetch?: SurfacePrefetch
}>

/** the four tables the build collected, keyed the way the manifest names surfaces */
export interface SurfaceTables {
  readonly pageComponents: Readonly<Record<string, SurfaceLoader>>
  readonly layoutComponents: Readonly<Record<string, SurfaceLoader>>
  readonly layoutSlots: Readonly<Record<string, readonly string[]>>
  readonly slotComponents: Readonly<Record<string, Readonly<Record<string, SurfaceLoader>>>>
  readonly loginComponents: Readonly<Record<string, SurfaceLoader>>
}

export interface RenderRequest {
  /** the address asked for, query and all: what a page's server entry reads first for */
  readonly url: URL
  /**
   * The moment the document is drawn: what its clock reads say in the html
   * and in the browser's first frame (@qualy/web-runtime/document-now).
   */
  readonly renderedAt: number
  /** the document's language, fixed for its whole life */
  readonly locale: SupportedLocale
  /** the build this document is rendered by, named to the api as the page's would be */
  readonly release: { readonly releaseId: string; readonly clientProtocol: number }
  /** where the api answers */
  readonly apiOrigin: string
  /** The production host can dispatch the same request without a socket. */
  readonly dispatchApi?: ((request: Request) => Promise<Response>) | undefined
  readonly correlation?: RenderCorrelation
  /** the viewer's own credentials, exactly as they arrived */
  readonly cookie: string | undefined
  /**
   * whose the document is, said to the api on every read
   * (docs/adr/0013-document-identity.md): the identity an open page declared,
   * or, for a new document, the one its manifest named. Unset only while the
   * manifest itself - which asks who is signed in - is being read.
   */
  readonly identity?: string
  /**
   * Told the `Set-Cookie` lines of each read's response, one by one as the
   * api wrote them. Set only around the reads the host answers for before
   * the document goes out; any other read's cookies are nobody's to pass on.
   */
  readonly onSetCookie?: (lines: readonly string[]) => void
  /**
   * The nonce the host's content security policy lets this document's inline
   * scripts run by, made fresh for each document; none where no policy asks.
   */
  readonly nonce?: string | undefined
  /** The title of the authorized page matched by the router for this render. */
  readonly routeTitle?: string | undefined
  /**
   * The reads this request has made under a query key, each made once
   * however many parts of the document ask: the bar over a batch's pages and
   * the page under it read the same batch.
   */
  readonly reads?: Map<string, Promise<Exit.Exit<unknown, unknown>>>
  /** ends when the reader goes away: every read below is cancelled with it */
  readonly signal: AbortSignal
  readonly surfaces: SurfaceTables
}

const store = new AsyncLocalStorage<RenderRequest>()

export const renderCorrelation = (): RenderCorrelation | undefined => store.getStore()?.correlation

/** runs `render` for `request`, including everything it starts */
export const withRenderRequest = <A>(request: RenderRequest, render: () => A): A =>
  store.run(request, render)

/** the request being rendered; a render outside one is a bug in the host */
export const renderRequest = (): RenderRequest => {
  const request = store.getStore()
  if (request === undefined) throw new Error('rendered outside a document request')
  return request
}

/**
 * The transport a render reads through: the viewer's cookie, the document's
 * language and the build's identity, and nothing else. In particular not the
 * activity mark: a render is not the reader pressing anything, and counted as
 * use it would keep a shared device's session alive for whoever comes next.
 */
const asTheViewer = (request: RenderRequest) =>
  HttpClient.mapRequest(
    HttpClientRequest.setHeaders({
      ...(request.cookie === undefined ? {} : { cookie: request.cookie }),
      ...(request.identity === undefined ? {} : { [QUALY_IDENTITY_HEADER]: request.identity }),
      [QUALY_LOCALE_HEADER]: request.locale,
      [QUALY_CLIENT_RELEASE_HEADER]: request.release.releaseId,
      [QUALY_CLIENT_PROTOCOL_HEADER]: String(request.release.clientProtocol),
    }),
  )

/** the network, telling the request's listener what cookies each response set */
const listened = (request: RenderRequest): typeof globalThis.fetch => {
  const heard = request.onSetCookie
  const dispatch = request.dispatchApi
  if (heard === undefined && dispatch === undefined) return globalThis.fetch
  return async (input, init) => {
    const response = await (dispatch === undefined
      ? globalThis.fetch(input, init)
      : dispatch(new Request(input, init)))
    if (heard !== undefined) {
      const lines = response.headers.getSetCookie()
      if (lines.length > 0) heard(lines)
    }
    return response
  }
}

const reading = <ApiId extends string, Groups extends HttpApiGroup.Constraint, A, E>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  read: (client: HttpApiClient.Client<Groups>) => Effect.Effect<A, E>,
  request: RenderRequest,
) =>
  HttpApiClient.make(api, {
    baseUrl: request.apiOrigin,
    transformClient: asTheViewer(request),
  }).pipe(
    Effect.flatMap(read),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, listened(request)),
  ) as Effect.Effect<A, E>

/**
 * Reads through an api contract as the viewer of the document being
 * rendered. Rejects with the read's own failure, as its tagged value.
 */
export const readApi = <ApiId extends string, Groups extends HttpApiGroup.Constraint, A, E>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  read: (client: HttpApiClient.Client<Groups>) => Effect.Effect<A, E>,
): Promise<A> => {
  const request = renderRequest()
  return Effect.runPromise(reading(api, read, request), { signal: request.signal })
}

/**
 * The same read, ended as what it was: its answer; a failure the contract
 * names or the network gave; a defect; or cancelled with the reader. For a
 * render that answers each differently, rather than take whatever the
 * squashed rejection of `readApi` happens to hold for one of them.
 */
export const readApiExit = <ApiId extends string, Groups extends HttpApiGroup.Constraint, A, E>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  read: (client: HttpApiClient.Client<Groups>) => Effect.Effect<A, E>,
  options: {
    /**
     * The key the page reads this under (@qualy/web-runtime/query-key):
     * named, the read is made once for the whole request, and every part of
     * the document that asks with the same key is handed the same answer.
     */
    readonly key?: QueryKey
  } = {},
): Promise<Exit.Exit<A, E | HttpClientError.HttpClientError | Schema.SchemaError>> => {
  type Read = Promise<Exit.Exit<A, E | HttpClientError.HttpClientError | Schema.SchemaError>>
  const request = renderRequest()
  const run = () =>
    Effect.runPromiseExit(reading(api, read, request), { signal: request.signal }) as Read
  if (options.key === undefined || request.reads === undefined) return run()
  const hash = hashKey(options.key)
  const made = request.reads.get(hash)
  if (made !== undefined) return made as Read
  const making = run()
  request.reads.set(hash, making)
  return making
}

const loaderOf = (surface: BrowserSurface): SurfaceLoader | undefined => {
  const tables = renderRequest().surfaces
  return surface.kind === 'page'
    ? tables.pageComponents[surface.id]
    : surface.kind === 'layout'
      ? tables.layoutComponents[surface.id]
      : surface.kind === 'login'
        ? tables.loginComponents[surface.id]
        : tables.slotComponents[surface.slot]?.[surface.id]
}

/**
 * The implementation of one surface, as the browser will be handed it: a
 * reference to its client module, or nothing when this build carries none.
 */
export const loadSurface = async (
  surface: BrowserSurface,
): Promise<ComponentType<any> | undefined> => {
  const load = loaderOf(surface)
  return load === undefined ? undefined : (await load()).default
}

/** what a surface reads before its first paint, when its server entry says */
export const loadPrefetch = async (
  surface: BrowserSurface,
): Promise<SurfacePrefetch | undefined> => {
  const load = loaderOf(surface)
  return load === undefined ? undefined : (await load()).prefetch
}
