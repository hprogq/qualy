import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '@qualy/ui/button'
import '../src/app.css'

// The stylesheet compiles with source(none) and an explicit @source list, so
// a moved package silently drops out of the scan and every utility class its
// components use stops existing - buttons shipped with no background and no
// radius before anything red happened. This asserts the compiled effect, not
// the class string: if the ui package leaves the scan again, the computed
// style goes back to the browser defaults and this goes red.
describe('the design system actually styles', () => {
  it('a default button has a background and rounded corners', async () => {
    render(<Button>probe</Button>)
    const button = page.getByRole('button', { name: 'probe' })
    await expect.element(button).toBeVisible()
    const style = getComputedStyle(button.element())
    expect(style.borderRadius).not.toBe('0px')
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})
