import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Card, StickyFill } from '@qualy/ui/screen'
import '../src/app.css'

// A tree beside a long list lives inside the shell's scrollport. Both the
// top bars and a shorter panel change its viewport coordinates; CSS sticky
// uses coordinates relative to that scrollport instead.
describe('a column that fills its visible scrollport', () => {
  it.each([
    [0, 0],
    [112, 0],
    [112, 80],
  ])('stays within a scrollport below %i px and above %i px', async (offset, foot) => {
    await page.viewport(1280, 900)
    try {
      await render(
        <UiProvider scheme="light">
          <div
            style={{ height: `calc(100vh - ${foot}px)`, display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ height: offset, flexShrink: 0 }} />
            <div data-testid="fill-scrollport" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ height: 64 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
                <div>
                  <StickyFill>
                    <Card>
                      <div style={{ height: 40 }}>Organizations</div>
                    </Card>
                  </StickyFill>
                </div>
                <div style={{ height: 1800 }} />
              </div>
            </div>
          </div>
        </UiProvider>,
      )
      const fill = page.getByTestId('sticky-fill').element()
      const port = page.getByTestId('fill-scrollport').element()
      const bottom = () => fill.getBoundingClientRect().bottom
      await expect.poll(bottom).toBeCloseTo(900 - foot - 16, 0)
      port.scrollTop = 200
      await expect.poll(() => fill.getBoundingClientRect().top).toBeCloseTo(offset + 12, 0)
      await expect.poll(bottom).toBeCloseTo(900 - foot - 16, 0)
      // A resize changes the room available without changing the scroll.
      await page.viewport(1280, 760)
      await expect.poll(bottom).toBeCloseTo(760 - foot - 16, 0)
    } finally {
      await page.viewport(1280, 800)
    }
  })
})
