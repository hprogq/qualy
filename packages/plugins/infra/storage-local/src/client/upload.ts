import { registerApiRoutes } from '@qualy/browser-observability/api-routes'
import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
import {
  registerUploadDriver,
  type UploadGrant,
  type UploadOptions,
} from '@qualy/plugin-storage/client'
import type { LocalUploadPayload } from '../payload.ts'

// Uploading to this deployment's own machine: one PUT, no sdk.
//
// XMLHttpRequest rather than fetch, and not for compatibility - fetch cannot
// report how much of a request body has been sent, and a person watching a
// twenty megabyte file with no progress bar assumes it has hung.

const put = (payload: LocalUploadPayload, file: Blob, options: UploadOptions) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', payload.url, true)
    request.setRequestHeader('content-type', 'application/octet-stream')
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      options.onProgress?.({ loaded: event.loaded, total: event.total })
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else reject(new Error(`upload refused with status ${request.status}`))
    })
    request.addEventListener('error', () => reject(new Error('upload failed')))
    request.addEventListener('abort', () => reject(new Error('upload cancelled')))
    options.signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(file)
  })

/**
 * The route this upload will be reported as, declared the first time one runs.
 *
 * Every other api call in the browser goes through `clientFor`, which hands
 * the contract's routes to reporting as it builds each client. This one is an
 * XHR, for the progress events, so nothing else declares it - and reporting
 * refuses an api address no contract claims. So the route is declared here,
 * and it is declared BEFORE the request leaves: an upload that raced the
 * declaration would be the one call with no timing, and nothing would say so.
 *
 * On first use rather than at page setup, because the contract module carries
 * the api kit with it and most pages never upload anything; they should not
 * pay for the chunk. One promise for the page's lifetime, so every later
 * upload waits on the same declaration instead of importing again.
 *
 * Reporting is not something an upload depends on. If the chunk cannot be
 * loaded the upload goes ahead anyway - its timing record is refused, which is
 * the cost - and the failure is not kept, so the next upload tries again.
 */
let routeDeclared: Promise<void> | undefined
const declareRoute = (): Promise<void> =>
  (routeDeclared ??= import('../urls.ts')
    .then(({ localUploadRoutes }) => registerApiRoutes(localUploadRoutes))
    // one handler for both ways this can fail - the chunk not loading, and
    // reporting refusing what it was given - so neither is remembered
    .catch(() => {
      routeDeclared = undefined
    }))

export const localUploadDriver = {
  driver: 'local',
  upload: async (grant: UploadGrant, file: Blob, options: UploadOptions) => {
    await declareRoute()
    // Asked again after the wait: a signal that fired while the route was
    // being declared has already dispatched its event, and the listener `put`
    // adds would never hear it - the cancelled upload would be sent.
    if (options.signal?.aborted === true) throw new Error('upload cancelled')
    return put(grant.payload as LocalUploadPayload, file, options)
  },
}

// announced while the page sets up, and taken back when it stops: a driver
// is a seat in a registry, which is what setup is for
const plugin: BrowserPlugin = {
  setup: () => registerUploadDriver(localUploadDriver),
}

export default plugin
