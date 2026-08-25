import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// Two contracts a person once caught broken by eye, pinned so no widget
// substrate can regress them again: an unticked checkbox must show no
// mark (one vendor rendered the glyph permanently), and the product grey
// must carry no chroma (another vendor's default surfaces were slate).
// Asserted on the computed result, not on any library's DOM shape.
const mount = (ui: React.ReactNode) => render(<UiProvider scheme="light">{ui}</UiProvider>)

// The glyph may be conditionally rendered (absent), present-but-hidden, or
// present-but-transparent, depending on the substrate; all count as "not
// showing". Each probe sits in its own wrapper so the search never leaks
// into a sibling's mark.
const glyphShowing = (name: string): boolean => {
  const svg = page.getByTestId(`wrap-${name}`).element().querySelector('svg')
  if (svg === null) return false
  const style = getComputedStyle(svg)
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01
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
    // the badge root wears the product's own data-slot hook; the text node
    // may sit in an inner element depending on the substrate
    const paint = (text: string) => {
      const badge = page.getByText(text).element().closest('[data-slot="badge"]')
      return badge === null ? 'missing' : getComputedStyle(badge).backgroundColor
    }
    await expect.poll(() => paint('plain'), { timeout: 5000 }).toBe('oklch(0.205 0 0)')
    // the exact product grey, not a slate tint
    expect(paint('quiet')).toBe('oklch(0.97 0 0)')
  })
})

// the shape every icon library ships: an svg declaring its own 24px box
const Glyph = () => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden />

describe('an icon inside a control sizes to the control', () => {
  // caught by eye on a real page: with the utility recipes gone, an icon
  // in a button or badge rendered at its own 24px default and dwarfed the
  // control around it. Pinned on the computed box, not on any class name.
  it('buttons and badges keep their icons at the product geometry', async () => {
    mount(
      <>
        <Button>
          <Glyph /> go
        </Button>
        <Button size="icon-xs" aria-label="tiny">
          <Glyph />
        </Button>
        <Badge>
          <Glyph /> running
        </Badge>
      </>,
    )
    const svgIn = (name: string) =>
      getComputedStyle(page.getByRole('button', { name }).element().querySelector('svg')!)
    await expect.poll(() => svgIn('go').width, { timeout: 5000 }).toBe('16px')
    expect(svgIn('tiny').width).toBe('12px')
    const badge = page.getByText('running').element().closest('[data-slot="badge"]')
    expect(getComputedStyle(badge!.querySelector('svg')!).width).toBe('12px')
  })
})
