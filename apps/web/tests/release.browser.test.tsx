import { expect, it } from 'vitest'
import {
  CURRENT_CLIENT_PROTOCOL,
  QUALY_RELEASE_ENDPOINT,
  isReleaseProbe,
} from '@qualy/release-contract'
import { webRelease } from 'virtual:qualy/release'

// The identity as the page sees it: the suite runs under a development
// release of the vitest server's own, the bundle carries it, and the host
// that served the page answers for the same one.

it('runs one development release and the host answers for the same one', async () => {
  expect(webRelease.mode).toBe('development')
  expect(webRelease.releaseId).toMatch(/^dev-[0-9a-f]{8}$/)
  expect(webRelease.clientProtocol).toBe(CURRENT_CLIENT_PROTOCOL)
  expect(Object.isFrozen(webRelease)).toBe(true)

  const response = await fetch(QUALY_RELEASE_ENDPOINT, { cache: 'no-store' })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const probe: unknown = await response.json()
  expect(isReleaseProbe(probe)).toBe(true)
  if (!isReleaseProbe(probe)) return
  expect(probe.releaseId).toBe(webRelease.releaseId)
  expect(probe.serverProtocol.min).toBeLessThanOrEqual(webRelease.clientProtocol)
  expect(probe.serverProtocol.max).toBeGreaterThanOrEqual(webRelease.clientProtocol)
})
