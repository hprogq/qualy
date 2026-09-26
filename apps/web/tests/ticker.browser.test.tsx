import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Ticker } from '@qualy/ui/ticker'
import '../src/app.css'

// A figure that turns over when it changes, and only then. Asserted on what
// the glyphs are drawn as - their opacity and blur a frame after the value
// moved - and on whether a leaving glyph is on screen at all.

const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

const withMotion = async (body: () => Promise<void>) => {
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    await body()
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
}

/** every glyph in the ticker, and whether each is drawn settled */
const glyphs = () =>
  [...document.querySelectorAll('[data-testid="figure"] > span > span > span > span')].map(
    (glyph) => {
      const style = getComputedStyle(glyph)
      return {
        text: glyph.textContent,
        leaving: glyph.getAttribute('aria-hidden') === 'true',
        settled:
          Number(style.opacity) === 1 && (style.filter === 'none' || style.filter === 'blur(0px)'),
      }
    },
  )

function Figure({ value }: { value: string }) {
  return (
    <UiProvider scheme="light">
      <span data-testid="figure">
        <Ticker value={value} />
      </span>
    </UiProvider>
  )
}

describe('a ticker', () => {
  it('draws its first value as it is, and turns over a digit that changes', async () => {
    await withMotion(async () => {
      const screen = await render(<Figure value="26.00" />)
      await frame()
      // arriving on screen is not a change
      expect(glyphs().map((glyph) => glyph.text)).toEqual(['2', '6', '.', '0', '0'])
      expect(glyphs().every((glyph) => glyph.settled)).toBe(true)

      await screen.rerender(<Figure value="27.00" />)
      await frame()
      // the digit that moved is on its way in, with the one it replaced on its way out
      expect(glyphs().some((glyph) => glyph.leaving)).toBe(true)
      expect(glyphs().some((glyph) => !glyph.leaving && !glyph.settled)).toBe(true)
    })
  })

  it('swaps a changed digit outright for a reader who asked for less motion', async () => {
    const screen = await render(<Figure value="26.00" />)
    await frame()
    await screen.rerender(<Figure value="27.00" />)
    await frame()
    expect(glyphs().some((glyph) => glyph.leaving)).toBe(false)
    expect(glyphs().every((glyph) => glyph.settled)).toBe(true)
    expect(glyphs().map((glyph) => glyph.text)).toEqual(['2', '7', '.', '0', '0'])
  })
})
