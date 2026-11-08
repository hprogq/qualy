import { describe, expect, it, vi } from 'vitest'
import { sharedContext } from '../src/shared-context.ts'

// What this guards is a development failure that looks like a mystery: a
// hot reload of anything the runtime imports used to re-run the runtime's
// own module, which made a second context object. The provider above went
// on writing to the first one, every consumer read the second and found
// nothing, and the application blanked with "must be used inside a
// Provider" until somebody reloaded the page.
describe('a context that outlives its module', () => {
  it('hands the same context back under the same name', () => {
    const first = sharedContext<string | null>('test/one', null)
    const again = sharedContext<string | null>('test/one', null)
    expect(again).toBe(first)
  })

  it('keeps different names apart', () => {
    expect(sharedContext<string | null>('test/two', null)).not.toBe(
      sharedContext<string | null>('test/three', null),
    )
  })

  it('does not share providers between server module graphs', async () => {
    const first = sharedContext('test/server', null)
    vi.resetModules()
    const next = await import('../src/shared-context.ts')
    expect(next.sharedContext('test/server', null)).not.toBe(first)
  })
})
