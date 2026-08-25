import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Alert, AlertDescription } from '@qualy/ui/alert'
import '../src/app.css'

// The stylesheet compiles with source(none) and an explicit @source list, so
// a moved package silently drops out of the scan and every utility class its
// components use stops existing - controls shipped with no background and no
// radius before anything red happened. This asserts the compiled effect, not
// the class string; the probe is a component still styled by Tailwind (the
// commodity widgets moved onto the PrimeReact theme), and it should follow
// the styling migration by pointing at whatever still reads that pipeline.
describe('the design system actually styles', () => {
  it('a default alert has a border and rounded corners', async () => {
    render(
      <Alert>
        <AlertDescription>probe</AlertDescription>
      </Alert>,
    )
    const alert = page.getByRole('alert')
    await expect.element(alert).toBeVisible()
    const style = getComputedStyle(alert.element())
    expect(style.borderRadius).not.toBe('0px')
    expect(style.borderStyle).toBe('solid')
    expect(style.paddingLeft).not.toBe('0px')
  })
})
