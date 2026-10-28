import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { EasedHeight } from '@qualy/ui/eased-height'

// A region that eases to its content's height: through the heights between
// rather than straight to the new one, clipping only while it grows, and
// with no easing at all for a reader who asked for less motion.

function Growing() {
  const [tall, setTall] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setTall((was) => !was)}>
        change
      </button>
      <EasedHeight testId="region">
        <div style={{ height: tall ? 200 : 100 }} />
      </EasedHeight>
      <p data-testid="after">after</p>
    </>
  )
}

const frames = async (ms: number, read: () => number) => {
  const seen: number[] = []
  for (const until = performance.now() + ms; performance.now() < until;) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    seen.push(read())
  }
  return seen
}

describe('a region that eases to its content', () => {
  afterEach(async () => {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  })

  it('passes through the heights between, clipped while it grows and not after', async () => {
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    await render(<Growing />)
    const region = page.getByTestId('region').element() as HTMLElement
    await expect.poll(() => region.getBoundingClientRect().height).toBe(100)
    await page.getByRole('button', { name: 'change' }).click()
    expect(region.style.overflow).toBe('clip')
    const growing = await frames(500, () => region.getBoundingClientRect().height)
    expect(growing.some((height) => height > 101 && height < 199)).toBe(true)
    expect(growing.at(-1)).toBe(200)
    expect(region.style.overflow).toBe('')
    // what follows the region moves with it, and ends right under it
    const after = page.getByTestId('after').element().getBoundingClientRect()
    expect(after.top).toBeGreaterThanOrEqual(region.getBoundingClientRect().bottom)

    // shrinking clips nothing: the content is already inside the region
    await page.getByRole('button', { name: 'change' }).click()
    expect(region.style.overflow).toBe('')
    const shrinking = await frames(500, () => region.getBoundingClientRect().height)
    expect(shrinking.some((height) => height > 101 && height < 199)).toBe(true)
    expect(shrinking.at(-1)).toBe(100)
  })

  it('takes the new height at once for a reader who asked for less motion', async () => {
    await render(<Growing />)
    const region = page.getByTestId('region').element() as HTMLElement
    await expect.poll(() => region.getBoundingClientRect().height).toBe(100)
    await page.getByRole('button', { name: 'change' }).click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(region.getBoundingClientRect().height).toBe(200)
    expect(region.style.overflow).toBe('')
  })
})
