import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { renderToReadableStream } from 'react-dom/server.edge'
import {
  unstable_routeRSCServerRequest as routeRSCServerRequest,
  unstable_RSCStaticRouter as RSCStaticRouter,
} from 'react-router'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { withDocumentLocale } from '@qualy/web-rsc/document-locale'

// The html half (docs/adr/0012-rsc-data-mode.md): the server components'
// answer, drawn once as html with the client components in it, for a reader
// to see before any script runs. Entered in the document's language on its
// own, since this is a module graph of its own.

export const renderDocument = (
  request: Request,
  serverResponse: Response,
  locale: SupportedLocale,
): Promise<Response> =>
  withDocumentLocale(locale, () =>
    routeRSCServerRequest({
      request,
      serverResponse,
      createFromReadableStream,
      async renderHTML(getPayload, options) {
        const bootstrapScriptContent = await import.meta.viteRsc.loadBootstrapScriptContent('index')
        return withDocumentLocale(locale, () =>
          renderToReadableStream(<RSCStaticRouter getPayload={getPayload} />, {
            ...options,
            bootstrapScriptContent,
            signal: request.signal,
            onError(error: unknown) {
              // a reader who went away is the render ending, not failing
              if (request.signal.aborted) return
              console.error('[qualy] html render failed', error)
            },
          }),
        )
      },
    }),
  )
