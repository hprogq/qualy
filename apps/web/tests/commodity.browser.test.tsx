import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Badge } from '@qualy/ui/badge'
import { Checkbox } from '@qualy/ui/checkbox'
import '../src/app.css'

// Two contracts a person once caught broken by eye, pinned so no widget
// substrate can regress them again: an unticked checkbox must show no
// mark (one vendor rendered the glyph permanently), and the product grey
// must carry no chroma (another vendor's default surfaces were slate).
// Asserted on the computed result, not on any library's DOM shape.
const mount = (ui: React.ReactNode) => render(<>{ui}</>)

// The glyph may be conditionally rendered (absent) or present-but-hidden,
// depending on the substrate; both count as "not showing". Each probe sits
// in its own wrapper so the search never leaks into a sibling's mark.
const glyphShowing = (name: string): boolean => {
  const svg = page.getByTestId(`wrap-${name}`).element().querySelector('svg')
  if (svg === null) return false
  const style = getComputedStyle(svg)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

describe('the checkbox says its state with the glyph', () => {
  it('shows no mark unticked, a mark ticked, a mark for the mixed state', async () => {
    mount(
      <>
        <span data-testid="wrap-off">
          <Checkbox aria-label="off" checked={false} />
        </span>
        <span data-testid="wrap-on">
          <Checkbox aria-label="on" checked />
        </span>
        <span data-testid="wrap-partly">
          <Checkbox aria-label="partly" checked="indeterminate" />
        </span>
      </>,
    )
    await expect.element(page.getByRole('checkbox', { name: 'off' })).toBeVisible()
    await expect.poll(() => glyphShowing('off'), { timeout: 5000 }).toBe(false)
    expect(glyphShowing('on')).toBe(true)
    expect(glyphShowing('partly')).toBe(true)
  })
})

describe('the badge palette carries no chroma', () => {
  it('default is the primary ink and secondary is the product grey', async () => {
    mount(
      <>
        <Badge>plain</Badge>
        <Badge variant="secondary">quiet</Badge>
      </>,
    )
    const paint = (text: string) => getComputedStyle(page.getByText(text).element()).backgroundColor
    await expect.poll(() => paint('plain'), { timeout: 5000 }).toBe('oklch(0.205 0 0)')
    // the exact product grey, not a slate tint
    expect(paint('quiet')).toBe('oklch(0.97 0 0)')
  })
})
