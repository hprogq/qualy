import { describe, expect, it, vi } from 'vitest'
import { apiRouteFor } from '@qualy/browser-observability/api-routes'
import { localUploadDriver } from '../src/client/upload.ts'
import { installImmediateRequests } from './support/requests.tsx'

// An upload whose route cannot be declared.
//
// Reporting is not a dependency of an upload. The student's file goes; the
// cost is one timing record reporting refuses. And the failure is not kept:
// the next upload asks again rather than inheriting a rejection forever.
//
// Driven by reporting refusing the routes rather than by the contract chunk
// failing to load, because a mock factory that throws is reported by the
// browser runner as its own unhandled error. Both failures reach the upload
// through the same handler, so one of them is enough to hold it.
//
// Its own file, because it needs a page on which the declaration fails.

const declaring = vi.hoisted(() => ({ attempts: 0, refuse: true }))
vi.mock('@qualy/browser-observability/api-routes', async (actual) => {
  const real = (await actual()) as typeof import('@qualy/browser-observability/api-routes')
  return {
    ...real,
    registerApiRoutes: (routes: Parameters<typeof real.registerApiRoutes>[0]) => {
      declaring.attempts += 1
      if (declaring.refuse) throw new Error('reporting refused the routes')
      real.registerApiRoutes(routes)
    },
  }
})

const opened = installImmediateRequests(apiRouteFor)
const grant = (url: string) =>
  ({ driver: 'local', payload: { url } }) as unknown as Parameters<
    typeof localUploadDriver.upload
  >[0]

describe('a local upload whose route cannot be declared', () => {
  it('is sent anyway', async () => {
    await localUploadDriver.upload(grant('/upload-probe/1'), new Blob(['x']), {})
    expect(opened.map((request) => request.url)).toEqual(['/upload-probe/1'])
    expect(declaring.attempts).toBe(1)
  })

  it('asks again on the next upload rather than keeping the failure', async () => {
    declaring.refuse = false
    const { localUploadUrl } = await import('../src/urls.ts')
    const url = localUploadUrl('0199f03e-1111-7abc-8def-000000000001')
    await localUploadDriver.upload(grant(url), new Blob(['x']), {})
    expect(declaring.attempts).toBe(2)
    // and this time reporting knew the route before the request opened
    expect(opened[1]!.claimed).toMatch(/:reservationId$/)
  })
})
