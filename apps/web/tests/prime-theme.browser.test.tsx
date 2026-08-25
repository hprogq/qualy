import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { PrimeReactProvider } from '@primereact/core/config'
import { PrimeButtonProbe } from '@qualy/ui/prime-probe'
import { qualyPrimeTheme } from '@qualy/ui/theme/prime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import '../src/app.css'

// The theme bridge under test: one --q-* palette read by three systems.
// PrimeReact receives it through the Qualy preset, StyleX through the
// defineVars group, Tailwind through the shadcn aliases (covered by
// theme.browser.test.tsx). The strongest assertion is equality - a StyleX
// swatch painted with tokens.primary and a Prime button painted by the
// preset must compute to the same color, in both schemes - because it
// holds no matter how the browser serializes the color value.
const styles = stylex.create({
  swatch: {
    backgroundColor: tokens.primary,
    height: '24px',
    width: '24px',
  },
})

function Swatch() {
  return <div data-testid="token-swatch" aria-hidden {...stylex.props(styles.swatch)} />
}

const paint = (locator: { element: () => Element }) =>
  getComputedStyle(locator.element()).backgroundColor

describe('the Prime theme and the StyleX tokens read one palette', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('a Prime button and a token swatch agree in light and dark', async () => {
    await import('virtual:stylex:runtime')
    render(
      <PrimeReactProvider theme={qualyPrimeTheme} license={import.meta.env.VITE_PRIMEUI_LICENSE}>
        <PrimeButtonProbe>probe</PrimeButtonProbe>
        <Swatch />
      </PrimeReactProvider>,
    )
    const button = page.getByRole('button', { name: 'probe' })
    const swatch = page.getByTestId('token-swatch')
    await expect.element(button).toBeVisible()

    // styled at all: not sitting on the browser default. Agreement is
    // polled, not snapshotted - the button animates its background, and a
    // sample taken mid-transition serializes as an interpolated color
    await expect.poll(() => paint(button), { timeout: 5000 }).not.toBe('rgba(0, 0, 0, 0)')
    await expect.poll(() => paint(swatch) === paint(button), { timeout: 5000 }).toBe(true)
    const light = paint(swatch)

    // .dark on the document root - toggled by ThemeProvider in the app -
    // must flip both systems to the same new value
    document.documentElement.classList.add('dark')
    await expect.poll(() => paint(swatch), { timeout: 5000 }).not.toBe(light)
    await expect.poll(() => paint(swatch) === paint(button), { timeout: 5000 }).toBe(true)
  })
})
