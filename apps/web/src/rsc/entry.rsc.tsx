import { createTemporaryReferenceSet, renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { unstable_matchRSCServerRequest as matchRSCServerRequest } from 'react-router'
import { Api } from '@qualy/api-kit/local'
import { appApiGroup } from '@qualy/app-contract'
import { localeOfRequest } from '@qualy/api-kit/locale'
import { primaryNavigation } from '@qualy/ui-contract'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { withDocumentLocale } from '@qualy/web-rsc/document-locale'
import { readApi, withRenderRequest, type RenderRequest } from '@qualy/web-rsc/request'
import { serverRoutes } from '@qualy/web-rsc/routes'
import * as surfaces from 'virtual:qualy/surfaces'
import { webRelease } from 'virtual:qualy/release'
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

const renderServer = async (request: Request) => {
  const manifest = await readApi(appApi, (client) => client.app.getManifest())
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
      return new Response(renderToReadableStream(match.payload, options), {
        status: match.statusCode,
        headers: match.headers,
      })
    },
  })
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const scope = renderRequestOf(request)
  let served: Response
  try {
    served = await withDocumentLocale(scope.locale, () =>
      withRenderRequest(scope, () => renderServer(request)),
    )
  } catch (error) {
    // the reader went away while the render was asking: its reads were
    // cancelled with it, which is the render ending, not failing
    if (request.signal.aborted) return new Response(null, { status: 499 })
    throw error
  }
  const ssr = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr.tsx')>('ssr', 'index')
  return ssr.renderDocument(request, served, scope.locale)
}
