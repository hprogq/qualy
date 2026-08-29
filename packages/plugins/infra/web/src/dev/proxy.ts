/**
 * The dev-server proxy table, standing alone so a test can hold it still:
 * which prefixes belong to the backend, and - since the formula language
 * bridge arrived - which of them carries websocket upgrades. Getting `ws`
 * wrong fails silently (the browser just never connects), so the shape is
 * a guarded fact rather than an inline literal.
 */

import { QUALY_API_PREFIX } from '@qualy/api-kit'

/** the paths the backend owns; everything else is the browser application */
export const proxied = [QUALY_API_PREFIX, '/health']

export interface ProxyEntry {
  readonly ws: boolean
  readonly target: string
  readonly changeOrigin: false
  readonly timeout: 0
  readonly proxyTimeout: 0
  readonly configure: (proxy: {
    on: (
      event: 'error',
      handler: (
        error: Error,
        request: unknown,
        target: { writeHead?: (...args: never[]) => void; end?: () => void },
      ) => void,
    ) => void
  }) => void
}

export const proxyTable = (origin: string): Record<string, ProxyEntry> =>
  Object.fromEntries(
    proxied.map((prefix) => [
      prefix,
      {
        // websocket upgrades ride the api prefix (the formula language
        // bridge); /health never upgrades. Vite's own HMR socket is served
        // by vite itself and does not pass here.
        ws: prefix === QUALY_API_PREFIX,
        target: origin,
        // What a request meets while the backend is being replaced.
        //
        // The default is a connection error, which reaches the page as a
        // failed fetch - indistinguishable from being offline, and the
        // browser answers it by showing the reader an error for something
        // that is about to be true again in a second. A 503 that says which
        // kind it is can be waited out; the backend answers the same way
        // while it is still building.
        configure: (proxy) => {
          proxy.on('error', (_error, _request, response) => {
            // a websocket upgrade has no writeHead: nothing to answer
            if (typeof response.writeHead !== 'function') return
            ;(response.writeHead as unknown as (status: number, headers: object) => void)(503, {
              'content-type': 'text/plain; charset=utf-8',
              'retry-after': '1',
              'x-qualy-state': 'unavailable',
            })
            response.end?.()
          })
        },
        // The browser's own Host is kept. Rewriting it is the common
        // example and it is wrong here: the backend decides cookie scope,
        // redirect targets and callback urls from the host it was asked
        // for, and a development session behind a public hostname would get
        // answers addressed to 127.0.0.1.
        changeOrigin: false,
        // long-lived responses are the point of half these routes
        timeout: 0,
        proxyTimeout: 0,
      } satisfies ProxyEntry,
    ]),
  )
