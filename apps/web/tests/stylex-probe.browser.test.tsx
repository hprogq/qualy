import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { StyleXProbe } from '@qualy/ui/stylex-probe'

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
})
