import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Alert, AlertDescription } from '@qualy/ui/alert'
import '../src/app.css'

// This asserts the compiled stylesheet effect rather than implementation
// class names: a build can succeed while its design-system CSS is absent.
describe('the design system actually styles', () => {
  it('a default alert has a border and rounded corners', async () => {
    await render(
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

  // the tone is state handed down by the alert, not a stylesheet digging by
  // variant - which is exactly what can regress silently, so it is pinned on
  // the computed colours: a destructive description leaves the muted grey
  it('a destructive alert tints its description away from the muted grey', async () => {
    await render(
      <>
        <span data-testid="plain-alert">
          <Alert>
            <AlertDescription>probe</AlertDescription>
          </Alert>
        </span>
        <span data-testid="danger-alert">
          <Alert variant="destructive">
            <AlertDescription>probe</AlertDescription>
          </Alert>
        </span>
      </>,
    )
    const colorOf = (host: string) => {
      const description = page
        .getByTestId(host)
        .element()
        .querySelector('[data-slot="alert-description"]')
      return description === null ? null : getComputedStyle(description).color
    }
    await expect.poll(() => colorOf('danger-alert')).not.toBeNull()
    expect(colorOf('danger-alert')).not.toBe(colorOf('plain-alert'))
  })
})
