import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { PrimeReactProvider } from '@primereact/core/config'
import { Badge } from '@qualy/ui/badge'
import { Checkbox } from '@qualy/ui/checkbox'
import { qualyPrimeTheme } from '@qualy/ui/theme/prime'
import '../src/app.css'

// Two regressions a person caught by eye, pinned as computed style: an
// unticked checkbox wore a dark check (Prime sizes the indicator glyph but
// never hides it), and secondary chips picked up Aura's slate surfaces and
// turned faintly blue where the product grey has no chroma at all.
const mount = (ui: React.ReactNode) =>
  render(
    <PrimeReactProvider theme={qualyPrimeTheme} license={import.meta.env.VITE_PRIMEUI_LICENSE}>
      {ui}
    </PrimeReactProvider>,
  )

const glyphOf = (root: Element) => root.querySelector('svg')

describe('the checkbox says its state with the glyph', () => {
  it('shows no mark unticked, a mark ticked, a mark for the mixed state', async () => {
    mount(
      <>
        <Checkbox aria-label="off" checked={false} />
        <Checkbox aria-label="on" checked />
        <Checkbox aria-label="partly" checked="indeterminate" />
      </>,
    )
    const boxOf = (name: string) =>
      page.getByRole('checkbox', { name }).element().closest('.p-checkbox')!
    await expect.element(page.getByRole('checkbox', { name: 'off' })).toBeVisible()
    await expect
      .poll(() => getComputedStyle(glyphOf(boxOf('off'))!).display, { timeout: 5000 })
      .toBe('none')
    expect(getComputedStyle(glyphOf(boxOf('on'))!).display).not.toBe('none')
    expect(getComputedStyle(glyphOf(boxOf('partly'))!).display).not.toBe('none')
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
