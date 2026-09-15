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

export const localUploadDriver = {
  driver: 'local',
  upload: (grant: UploadGrant, file: Blob, options: UploadOptions) =>
    put(grant.payload as LocalUploadPayload, file, options),
}

// announced while the page sets up, and taken back when it stops: a driver
// is a seat in a registry, which is what setup is for
const plugin: BrowserPlugin = {
  setup: () => registerUploadDriver(localUploadDriver),

  // What this call will be reported as, told to reporting once the page is up.
  //
  // Every other api call in the browser is dispatched by `clientFor`, which
  // hands the contract's routes over as it builds each client. This one is an
  // XHR, for the progress events, so nobody would otherwise declare it - and
  // reporting refuses an api address no contract claims, which would make the
  // upload the one call in the product with no timing and say nothing about
  // why. The import is deferred because the contract module carries the api
  // kit with it, and this module runs on every page load whether or not
  // anybody uploads anything.
  start: async () => {
    const { localUploadRoutes } = await import('../urls.ts')
    registerApiRoutes(localUploadRoutes)
  },
}

export default plugin
