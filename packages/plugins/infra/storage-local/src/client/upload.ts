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

registerUploadDriver(localUploadDriver)
