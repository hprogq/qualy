import type { ComponentProps } from 'react'
import FontStyles from './font-styles.tsx'
import { createTemporaryReferenceSet, renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { unstable_matchRSCServerRequest as matchRSCServerRequest } from 'react-router'
import { Api } from '@qualy/api-kit/local'
import { appApiGroup } from '@qualy/app-contract'
import { ANONYMOUS_IDENTITY, QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import { localeOfRequest } from '@qualy/api-kit/locale'
import { primaryNavigation, SLOT_REFERENCE_PATH } from '@qualy/ui-contract'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { withDocumentLocale } from '@qualy/web-rsc/document-locale'
import { loadSurface, readApi, withRenderRequest, type RenderRequest } from '@qualy/web-rsc/request'
import { serverRoutes } from '@qualy/web-rsc/routes'
import * as surfaces from 'virtual:qualy/surfaces'
import { webRelease } from 'virtual:qualy/release'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_RENDER_REFUSED_HEADER,
  type RenderRefusal,
} from '@qualy/release-contract'
import { identityOfManifest } from '@qualy/web-runtime/document-identity'
import type { Manifest } from '@qualy/web-runtime'
import { Document } from './Document.tsx'
import { HtmlDocument } from './html-document.tsx'
import { DocumentError, LayoutError, PageError } from './route-error.tsx'
import { sessionClearings, withCookies } from './session-clearing.ts'
import { Empty, Missing, NotFound, Surface } from './frames.tsx'

// The server component half of a document request
// (docs/adr/0012-rsc-data-mode.md): who is asking, in which language, and
// what they may see - read once, through the same api the page uses - and
// the route tree that answer makes, rendered for React Router to send on.
//
// Only reads. A render is a GET or a HEAD; nothing here decodes an action
// or loads a server function, so no request can make this run one.

const appApi = Api.local(appApiGroup)

// where the api answers when the host does not say: the development server's
// backend beside it
const defaultApiOrigin =
  process.env['QUALY_RENDER_API_ORIGIN'] ?? `http://127.0.0.1:${process.env['PORT'] ?? '3000'}`

const cookiesOf = (header: string | null): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => {
        const at = part.indexOf('=')
        return [part.slice(0, at), decodeURIComponent(part.slice(at + 1))]
      }),
  )

const renderRequestOf = (request: Request, apiOrigin: string): RenderRequest => {
  const headers = Object.fromEntries(request.headers)
  return {
    url: new URL(request.url),
    reads: new Map(),
    renderedAt: Date.now(),
    locale: localeOfRequest({ headers, cookies: cookiesOf(request.headers.get('cookie')) }),
    release: { releaseId: webRelease.releaseId, clientProtocol: webRelease.clientProtocol },
    apiOrigin,
    cookie: request.headers.get('cookie') ?? undefined,
    signal: request.signal,
    surfaces,
  }
}

/** a personalised render is the reader's alone: never kept, by anybody */
const PRIVATE = { 'cache-control': 'private, no-store' } as const

/**
 * A navigation of an open page refused before anything is rendered for it.
 * The page's own fetch reads the marker and keeps the page as it is; the
 * router never sees this response.
 */
const refused = (refusal: RenderRefusal) =>
  new Response(JSON.stringify({ refused: refusal }), {
    status: 409,
    headers: {
      ...PRIVATE,
      'content-type': 'application/json',
      [QUALY_RENDER_REFUSED_HEADER]: refusal,
    },
  })

/** what an open page says about itself on every navigation; a new document says nothing */
const declarationOf = (request: Request) => ({
  release: request.headers.get(QUALY_CLIENT_RELEASE_HEADER) ?? undefined,
  protocol: request.headers.get(QUALY_CLIENT_PROTOCOL_HEADER) ?? undefined,
  identity: request.headers.get(QUALY_IDENTITY_HEADER) ?? undefined,
})

/**
 * The page against who is signed in, as the session middlewares judge a
 * request (docs/adr/0013-document-identity.md), with the manifest as the
 * answer to who that is: the same person goes on; nobody signed in is a
 * session the page's person can come back to; anybody else is not the
 * page's; a page that said nothing is broken.
 */
const identityRefusal = (
  declared: string | undefined,
  manifest: { readonly viewer: string; readonly identity?: string | undefined },
): RenderRefusal | undefined => {
  if (declared === undefined || declared === '') return 'unasserted'
  const signedIn = identityOfManifest(manifest)
  if (declared === signedIn) return undefined
  return signedIn === ANONYMOUS_IDENTITY ? 'session' : 'identity-changed'
}

function DocumentHtml({ children, ...props }: ComponentProps<typeof HtmlDocument>) {
  return (
    <HtmlDocument {...props}>
      <FontStyles />
      {children}
    </HtmlDocument>
  )
}

const renderServer = async (request: Request, manifest: Manifest) => {
  const home = (manifest.collections[primaryNavigation.key] ?? []) as readonly {
    readonly target: { readonly kind: string; readonly path?: string }
  }[]
  const homePath = home.find((item) => item.target.kind === 'page')?.target.path
  return matchRSCServerRequest({
    createTemporaryReferenceSet,
    request,
    // The authorized manifest already describes the full route catalog.
    // Lazy discovery adds route-context updates during deferred hydration.
    routeDiscovery: { mode: 'initial' },
    routes: serverRoutes({
      manifest,
      frames: {
        Html: DocumentHtml,
        Document,
        DocumentError,
        LayoutError,
        PageError,
        Surface,
        Missing,
        NotFound,
        Empty,
      },
      ...(homePath === undefined ? {} : { homePath }),
      signInPage: SIGN_IN_PAGE,
    }),
    onError: (error) => {
      if (request.signal.aborted) return
      console.error('[qualy] server component render failed', error)
    },
    generateResponse(match, options) {
      const headers = new Headers(match.headers)
      headers.set('cache-control', PRIVATE['cache-control'])
      return new Response(renderToReadableStream(match.payload, options), {
        status: match.statusCode,
        headers,
      })
    },
  })
}

const renderSlotReference = async (scope: RenderRequest, manifest: Manifest) => {
  const { searchParams } = scope.url
  const [slot] = searchParams.getAll('slot')
  const [id] = searchParams.getAll('id')
  if (searchParams.size !== 2 || slot === undefined || id === undefined) {
    return new Response(null, { status: 400, headers: PRIVATE })
  }
  const items = Object.hasOwn(manifest.slots, slot) ? manifest.slots[slot] : undefined
  if (items?.some((item) => item.id === id) !== true) {
    return new Response(null, { status: 404, headers: PRIVATE })
  }
  const component = await loadSurface({ kind: 'slot', slot, id })
  if (component === undefined) return new Response(null, { status: 409, headers: PRIVATE })
  // The raw reference is a field of the result. Nothing renders the
  // component here, and the request can never supply its props.
  return new Response(renderToReadableStream({ component }, { signal: scope.signal }), {
    headers: { ...PRIVATE, 'content-type': 'text/x-component' },
  })
}

/**
 * What the host serving this handler hands each request beside it: the
 * nonce its content security policy for this response names, when it sends
 * one (packages/plugins/infra/web/src/server/shell-policy.ts).
 */
export interface RenderContext {
  readonly nonce?: string | undefined
  /**
   * Where the api this render reads through answers: the host's own, as it
   * listens. Unsaid, the development backend beside a development server.
   */
  readonly apiOrigin?: string | undefined
}

export default async function handler(
  request: Request,
  context: RenderContext = {},
): Promise<Response> {
  const slotReference = new URL(request.url).pathname === SLOT_REFERENCE_PATH
  if (slotReference && request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { ...PRIVATE, allow: 'GET' } })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // An open page is judged before anything is rendered for it: a build that
  // is not this one, or a protocol it does not speak, could not use what this
  // build would send; a new document is this build's by definition.
  const declared = declarationOf(request)
  const fromPage = declared.protocol !== undefined || slotReference
  if (fromPage) {
    if (declared.protocol !== String(webRelease.clientProtocol)) return refused('protocol')
    if (declared.release !== webRelease.releaseId) return refused('release')
  }
  const asked = renderRequestOf(request, context.apiOrigin ?? defaultApiOrigin)
  // the cookies the manifest's answer set, the one read finished before
  // anything goes out: a session it found lapsed is cleared there
  const heard: string[] = []
  try {
    // who is signed in, asked first and asked as nobody in particular: the
    // manifest is the one read that answers that question
    const manifest = await withRenderRequest(
      { ...asked, onSetCookie: (lines) => heard.push(...lines) },
      () => readApi(appApi, (client) => client.app.getManifest()),
    )
    const passed = sessionClearings(heard, asked.cookie)
    const clearings = passed.forwarded
    if (passed.dropped.length > 0) {
      console.warn('[qualy] render dropped cookies the api set', passed.dropped)
    }
    if (fromPage) {
      const refusal = identityRefusal(declared.identity, manifest)
      if (refusal !== undefined) return withCookies(refused(refusal), clearings)
    }
    // every other read says whose the document is
    const scope: RenderRequest = {
      ...asked,
      nonce: context.nonce,
      identity:
        fromPage && declared.identity !== undefined
          ? declared.identity
          : identityOfManifest(manifest),
    }
    if (slotReference) {
      return withCookies(
        await withDocumentLocale(scope.locale, () =>
          withRenderRequest(scope, () => renderSlotReference(scope, manifest)),
        ),
        clearings,
      )
    }
    const served = await withDocumentLocale(scope.locale, () =>
      withRenderRequest(scope, () => renderServer(request, manifest)),
    )
    const ssr = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr.tsx')>(
      'ssr',
      'index',
    )
    return withCookies(
      await ssr.renderDocument(request, served, asked.locale, context.nonce),
      clearings,
    )
  } catch (error) {
    // A disconnected reader can interrupt the API reads or the HTML
    // renderer. Neither cancellation is a failed render.
    if (request.signal.aborted) return new Response(null, { status: 499 })
    throw error
  }
}
