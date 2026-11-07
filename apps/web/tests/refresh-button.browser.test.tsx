import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { RefreshButton } from '@qualy/ui/refresh-button'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// The key that asks a screen's reads again answers the reader's press: it
// turns, rests while the reads are out, and stops at the end of the turn in
// which they came back - or, for a reader who asks for less motion, dims
// for long enough to be seen.

const icon = () => page.getByRole('button', { name: 'Refresh' }).element().querySelector('svg')!

/** a key whose reads come back when the test says */
const drawn = async () => {
  let answer!: () => void
  await render(
    <UiProvider scheme="light">
      <RefreshButton
        label="Refresh"
        onRefresh={() =>
          new Promise<void>((resolve) => {
            answer = resolve
          })
        }
      />
    </UiProvider>,
  )
  return { key: page.getByRole('button', { name: 'Refresh' }), answer: () => answer() }
}

describe('the refresh key', () => {
  describe('with motion', () => {
    beforeEach(() => commands.emulateMedia({ reducedMotion: 'no-preference' }))
    afterEach(() => commands.emulateMedia({ reducedMotion: 'reduce' }))

    it('turns on a press until its reads come back, then ends the turn', async () => {
      const { key, answer } = await drawn()
      expect(getComputedStyle(icon()).animationName).toBe('none')
      await key.click()
      await expect.poll(() => getComputedStyle(icon()).animationName).not.toBe('none')
      await expect.element(key).toBeDisabled()
      answer()
      await expect.element(key).toBeEnabled()
      // the turn the reads came back in is finished, not cut
      await expect
        .poll(() => getComputedStyle(icon()).animationName, { timeout: 3000 })
        .toBe('none')
    })
  })

  it('dims, without turning, for a reader who asks for less motion', async () => {
    const { key, answer } = await drawn()
    expect(Number(getComputedStyle(icon()).opacity)).toBe(1)
    await key.click()
    await expect.poll(() => Number(getComputedStyle(icon()).opacity)).toBeLessThan(1)
    expect(getComputedStyle(icon()).animationName).toBe('none')
    // reads that come back at once still leave the answer on screen a moment
    answer()
    await expect.element(key).toBeEnabled()
    expect(Number(getComputedStyle(icon()).opacity)).toBeLessThan(1)
    await expect.poll(() => Number(getComputedStyle(icon()).opacity)).toBe(1)
  })
})
