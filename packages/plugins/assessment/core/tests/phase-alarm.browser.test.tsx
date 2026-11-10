import { Effect } from 'effect'
import { expect, it, vi } from 'vitest'
import { useBatchLive } from '../src/client/live.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

it('refreshes again when a server still reports the same planned phase', async () => {
  const wake = vi.fn()
  const at = new Date(Date.now() - 5_000).toISOString()
  const getTimeline = vi.fn(() =>
    Effect.succeed({ timeline: [{ entry: { kind: 'planned', at } }] }),
  )
  function Screen() {
    useBatchLive('11111111-1111-4111-8111-111111111111', wake)
    return null
  }
  renderScreen({
    client: fakeClient({ app: { getManifest: emptyManifest() }, assessment: { getTimeline } }),
    children: <Screen />,
  })
  await vi.waitFor(() => expect(wake.mock.calls.length).toBeGreaterThanOrEqual(2), {
    timeout: 8_000,
  })
  expect(getTimeline.mock.calls.length).toBeGreaterThanOrEqual(3)
})
