import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Badge } from '@qualy/ui/badge'
import '../src/app.css'

// The stylesheet compiles with source(none) and an explicit @source list, so
// a moved package silently drops out of the scan and every utility class its
// components use stops existing - controls shipped with no background and no
// radius before anything red happened. This asserts the compiled effect, not
// the class string; the probe is a component still styled by Tailwind (the
// button moved onto the PrimeReact theme), and it should follow the styling
// migration by pointing at whatever still reads the Tailwind pipeline.
describe('the design system actually styles', () => {
  it('a default badge has a background and rounded corners', async () => {
    render(<Badge>probe</Badge>)
    const badge = page.getByText('probe')
    await expect.element(badge).toBeVisible()
    const style = getComputedStyle(badge.element())
    expect(style.borderRadius).not.toBe('0px')
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})
