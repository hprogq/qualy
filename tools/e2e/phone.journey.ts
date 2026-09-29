import { describe, expect, it } from 'vitest'
import { PHONE, browsing, signIn } from './support.ts'

// A round's structure on a phone, in Safari's engine, scrolled to its end:
// the last question sits above the bar at the foot, not under it. It sat
// under it until the batch section's columns grew with their content on a
// phone (BatchScreen); a component test holds the layout, this holds it on
// the real release with a real round's length.

const BATCH = '01a0eecf-3203-7965-bb14-2ac8fcace35f'

describe('a round on a phone', () => {
  const session = browsing({ engine: 'webkit', device: PHONE })

  it('scrolls its last question clear of the bar at the foot', async () => {
    const page = session.page()
    await signIn(page, 'student')
    await page.goto(`/assessment/batches/${BATCH}/my-entries`)
    const rail = page.getByTestId('structure-rail')
    await rail.locator('li').last().waitFor()

    const at = await page.evaluate(async () => {
      const bar = document.querySelector('[data-testid="bottom-bar"]')!
      const rows = document.querySelectorAll('[data-testid="structure-rail"] li')
      const last = rows[rows.length - 1]!
      // as far down as the reader can scroll, whichever box it is that scrolls
      for (let node: Element | null = last; node !== null; node = node.parentElement) {
        node.scrollTop = node.scrollHeight
      }
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return {
        lastBottom: last.getBoundingClientRect().bottom,
        barTop: bar.getBoundingClientRect().top,
      }
    })
    expect(at.lastBottom).toBeLessThanOrEqual(at.barTop + 1)
  })
})
