import { describe, expect, it, vi } from 'vitest'
import { apiRouteFor } from '@qualy/browser-observability/api-routes'
import plugin, { localUploadDriver } from '../src/client/upload.ts'
import { fetched, installImmediateRequests } from './support/requests.tsx'

// When the local upload's route reaches reporting, relative to the upload.
//
// The upload is the one api call in the browser no typed client makes, so it
// declares its own route - and reporting refuses an address no route claims.
// Declared too late, the first upload goes out unnamed; declared as the page
// starts, every page downloads the contract whether or not anybody uploads.
// So it is declared on the first upload, before the request is sent, once.
//
// The cases run in order and share one page on purpose. The declaration is
// remembered for the life of a page, a browser suite gives each FILE a fresh
// page, and module resets do not reach across that - so each case below
// states the page it inherits from the one before.

// counted where the declaration hands the routes to reporting. `built` says
// whether this page loaded the counting stand-in at all: CI once saw reporting
// learn the route while the count stayed at zero, and the two ways that can
// happen (the page got the real module, or the upload holds another copy of
// the stand-in) fail at different assertions below.
const declared = vi.hoisted(() => ({ built: false, count: 0 }))
vi.mock('@qualy/browser-observability/api-routes', async (actual) => {
  const real = (await actual()) as typeof import('@qualy/browser-observability/api-routes')
  declared.built = true
  return {
    ...real,
    registerApiRoutes: (routes: Parameters<typeof real.registerApiRoutes>[0]) => {
      declared.count += 1
      real.registerApiRoutes(routes)
    },
  }
})

const opened = installImmediateRequests(apiRouteFor)
const CONTRACT = '/storage-local/src/urls.ts'
const address = '/api-probe/storage/local/uploads/0199f03e-1111-7abc-8def-000000000001'
const grant = (url: string) =>
  ({ driver: 'local', payload: { url } }) as unknown as Parameters<
    typeof localUploadDriver.upload
  >[0]

describe('the local upload route, as reporting learns it', () => {
  it('costs a page that never uploads nothing', async () => {
    expect(declared.built, 'this page loaded the real route registry, not the stand-in').toBe(true)
    const dispose = plugin.setup?.({ release: {} } as never)
    // no start hook is left to fetch the contract in the background
    expect(plugin.start).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetched(CONTRACT)).toBe(0)
    expect(declared.count).toBe(0)
    if (typeof dispose === 'function') dispose()
  })

  it('does not send an upload cancelled while the route was being declared', async () => {
    const controller = new AbortController()
    const going = localUploadDriver.upload(grant(address), new Blob(['x']), {
      signal: controller.signal,
    })
    // the declaration has only just started: nothing is loaded yet
    controller.abort()
    await expect(going).rejects.toThrow('upload cancelled')
    expect(opened).toHaveLength(0)
  })

  it('is known to reporting before the upload is sent', async () => {
    const { localUploadUrl } = await import('../src/urls.ts')
    const url = localUploadUrl('0199f03e-1111-7abc-8def-000000000001')
    await localUploadDriver.upload(grant(url), new Blob(['x']), {})
    expect(opened).toHaveLength(1)
    // what reporting would have filed the request under, at the moment it opened
    expect(opened[0]!.claimed).toMatch(/:reservationId$/)
    expect(fetched(CONTRACT)).toBe(1)
    // reporting knows the route, so the upload declared it: through the
    // stand-in this file counts with, or through some other copy
    expect(declared.count, 'the upload declared the route past the stand-in').toBe(1)
  })

  // Measured from where the page stands rather than from zero, so a retry of
  // this case asks the same question instead of counting the first try's.
  it('is declared once, however many uploads follow', async () => {
    const before = { opened: opened.length, declared: declared.count }
    await Promise.all([
      localUploadDriver.upload(grant(address), new Blob(['a']), {}),
      localUploadDriver.upload(grant(address), new Blob(['b']), {}),
    ])
    await localUploadDriver.upload(grant(address), new Blob(['c']), {})
    expect(opened.length - before.opened).toBe(3)
    expect(declared.count - before.declared).toBe(0)
  })
})
