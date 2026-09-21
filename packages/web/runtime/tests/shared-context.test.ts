import { describe, expect, it } from 'vitest'
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
})
