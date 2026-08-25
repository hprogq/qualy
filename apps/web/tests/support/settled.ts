import { beforeEach } from 'vitest'
import { cleanup } from 'vitest-browser-react'

// Every test opens on a quiet stage. The library unmounts the previous
// test's tree in its own beforeEach - which runs after this one, so the
// stage is cleared here first (cleanup is idempotent), then watched until
// the previous overlays and their scroll lock have actually left. A click
// dispatched into a dying layer lands on nothing and the new screen never
// hears it - the roaming timeout. The wait is bounded and loud: a stage
// that will not clear is a leak to fix, not to step around.
beforeEach(async () => {
  await cleanup()
  const deadline = Date.now() + 4000
  for (;;) {
    const lock = document.body.hasAttribute('data-scroll-locked')
    const overlay = document.querySelector(
      '[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="alert-dialog-content"]',
    )
    if (!lock && overlay === null) return
    if (Date.now() > deadline) {
      throw new Error(
        `the previous test left the stage occupied: ` +
          `scroll-locked=${lock}, overlay=${overlay?.getAttribute('data-slot') ?? 'none'}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
})
