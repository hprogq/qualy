/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ComponentType } from 'react'
import { Effect, type Exit, type Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientError } from 'effect/http'
import { HttpApiClient, type HttpApi, type HttpApiGroup } from 'effect/http-api'
import { QUALY_IDENTITY_HEADER, QUALY_LOCALE_HEADER } from '@qualy/api-kit'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { QUALY_CLIENT_PROTOCOL_HEADER, QUALY_CLIENT_RELEASE_HEADER } from '@qualy/release-contract'
import type { BrowserSurface } from '@qualy/ui-contract'

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

/** a loader for one surface's module, as the server's table holds it */
export type SurfaceLoader = () => Promise<{ readonly default: ComponentType<any> }>

/** the four tables the build collected, keyed the way the manifest names surfaces */
export interface SurfaceTables {
  readonly pageComponents: Readonly<Record<string, SurfaceLoader>>
  readonly layoutComponents: Readonly<Record<string, SurfaceLoader>>
  readonly layoutSlots: Readonly<Record<string, readonly string[]>>
  readonly slotComponents: Readonly<Record<string, Readonly<Record<string, SurfaceLoader>>>>
  readonly loginComponents: Readonly<Record<string, SurfaceLoader>>
}

export interface RenderRequest {
  /** the document's language, fixed for its whole life */
  readonly locale: SupportedLocale
  /** the build this document is rendered by, named to the api as the page's would be */
  readonly release: { readonly releaseId: string; readonly clientProtocol: number }
  /** where the api answers */
  readonly apiOrigin: string
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
  /** ends when the reader goes away: every read below is cancelled with it */
  readonly signal: AbortSignal
  readonly surfaces: SurfaceTables
}

const store = new AsyncLocalStorage<RenderRequest>()

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
  if (heard === undefined) return globalThis.fetch
  return async (input, init) => {
    const response = await globalThis.fetch(input, init)
    const lines = response.headers.getSetCookie()
    if (lines.length > 0) heard(lines)
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
): Promise<Exit.Exit<A, E | HttpClientError.HttpClientError | Schema.SchemaError>> => {
  const request = renderRequest()
  return Effect.runPromiseExit(reading(api, read, request), { signal: request.signal }) as Promise<
    Exit.Exit<A, E | HttpClientError.HttpClientError | Schema.SchemaError>
  >
}

/**
 * The implementation of one surface, as the browser will be handed it: a
 * reference to its client module, or nothing when this build carries none.
 */
export const loadSurface = async (
  surface: BrowserSurface,
): Promise<ComponentType<any> | undefined> => {
  const tables = renderRequest().surfaces
  const load =
    surface.kind === 'page'
      ? tables.pageComponents[surface.id]
      : surface.kind === 'layout'
        ? tables.layoutComponents[surface.id]
        : surface.kind === 'login'
          ? tables.loginComponents[surface.id]
          : tables.slotComponents[surface.slot]?.[surface.id]
  return load === undefined ? undefined : (await load()).default
}
