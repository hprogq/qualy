import { createTemporaryReferenceSet, renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { unstable_matchRSCServerRequest as matchRSCServerRequest } from 'react-router'
import { Api } from '@qualy/api-kit/local'
import { appApiGroup } from '@qualy/app-contract'
import { ANONYMOUS_IDENTITY, QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import { localeOfRequest } from '@qualy/api-kit/locale'
import { primaryNavigation } from '@qualy/ui-contract'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { withDocumentLocale } from '@qualy/web-rsc/document-locale'
import { readApi, withRenderRequest, type RenderRequest } from '@qualy/web-rsc/request'
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
import { Empty, Missing, NotFound, Surface } from './frames.tsx'

// The server component half of a document request
// (docs/adr/0012-rsc-data-mode.md): who is asking, in which language, and
// what they may see - read once, through the same api the page uses - and
// the route tree that answer makes, rendered for React Router to send on.
//
// Only reads. A render is a GET or a HEAD; nothing here decodes an action
// or loads a server function, so no request can make this run one.

const appApi = Api.local(appApiGroup)

const apiOrigin =
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

const renderRequestOf = (request: Request): RenderRequest => {
  const headers = Object.fromEntries(request.headers)
  return {
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

const renderServer = async (request: Request, manifest: Manifest) => {
  const home = (manifest.collections[primaryNavigation.key] ?? []) as readonly {
    readonly target: { readonly kind: string; readonly path?: string }
  }[]
  const homePath = home.find((item) => item.target.kind === 'page')?.target.path
  return matchRSCServerRequest({
    createTemporaryReferenceSet,
    request,
    routes: serverRoutes({
      manifest,
      frames: { Document, Surface, Missing, NotFound, Empty },
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // An open page is judged before anything is rendered for it: a build that
  // is not this one, or a protocol it does not speak, could not use what this
  // build would send; a new document is this build's by definition.
  const declared = declarationOf(request)
  const fromPage = declared.protocol !== undefined
  if (fromPage) {
    if (declared.protocol !== String(webRelease.clientProtocol)) return refused('protocol')
    if (declared.release !== webRelease.releaseId) return refused('release')
  }
  const asked = renderRequestOf(request)
  let served: Response
  try {
    // who is signed in, asked first and asked as nobody in particular: the
    // manifest is the one read that answers that question
    const manifest = await withRenderRequest(asked, () =>
      readApi(appApi, (client) => client.app.getManifest()),
    )
    if (fromPage) {
      const refusal = identityRefusal(declared.identity, manifest)
      if (refusal !== undefined) return refused(refusal)
    }
    // every other read says whose the document is
    const scope: RenderRequest = {
      ...asked,
      identity:
        fromPage && declared.identity !== undefined
          ? declared.identity
          : identityOfManifest(manifest),
    }
    served = await withDocumentLocale(scope.locale, () =>
      withRenderRequest(scope, () => renderServer(request, manifest)),
    )
  } catch (error) {
    // the reader went away while the render was asking: its reads were
    // cancelled with it, which is the render ending, not failing
    if (request.signal.aborted) return new Response(null, { status: 499 })
    throw error
  }
  const ssr = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr.tsx')>('ssr', 'index')
  return ssr.renderDocument(request, served, asked.locale)
}
