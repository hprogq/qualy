import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { CascadeYieldProbe, StyleXProbe } from '@qualy/ui/stylex-probe'
// the real stylesheet: the cascade contract below is about where the
// compiled utility layer sits relative to the StyleX priority layers
import '../src/app.css'

// The StyleX compiler runs at build time and its CSS is aggregated outside
// the module graph, so a broken pipeline fails silently: components keep
// their generated class names and render unstyled. This asserts the compiled
// effect on a probe from a symlinked workspace package - if the compiler
// stops transforming workspace sources, the computed style falls back to the
// browser default and this goes red. The dev runtime import stands in for
// the index.html injection the plugin does in the real app, which the vitest
// browser page does not go through.
describe('the StyleX pipeline actually styles', () => {
  it('a probe from a symlinked workspace package gets its compiled style', async () => {
    await import('virtual:stylex:runtime')
    render(<StyleXProbe />)
    const probe = page.getByTestId('stylex-probe-ui')
    await expect.element(probe).toBeInTheDocument()
    // #0b1621, the sentinel in packages/web/ui/src/components/stylex-probe.tsx
    await expect
      .poll(() => getComputedStyle(probe.element()).backgroundColor)
      .toBe('rgb(11, 22, 33)')
    expect(getComputedStyle(probe.element()).borderRadius).toBe('7px')
  })

  // The migration-window cascade contract: a caller's legacy utility class on
  // a StyleX-styled element keeps winning, as it did when tailwind-merge
  // arbitrated between two Tailwind strings. Guarded by layer order alone -
  // utilities is declared after the priority layers - so this goes red if the
  // declaration in index.html / app.css / cascade-layers.ts ever flips back.
  it('a legacy utility on the same element beats the compiled StyleX value', async () => {
    await import('virtual:stylex:runtime')
    render(<CascadeYieldProbe />)
    const probe = page.getByTestId('stylex-yield-probe')
    await expect.element(probe).toBeInTheDocument()
    // #123456 from the utility, not #0b1621 from the StyleX declaration
    await expect
      .poll(() => getComputedStyle(probe.element()).backgroundColor)
      .toBe('rgb(18, 52, 86)')
    // properties the utility does not touch still come from StyleX
    expect(getComputedStyle(probe.element()).borderRadius).toBe('7px')
  })
})
