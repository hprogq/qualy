import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { Spinner, PageLoading } from '@qualy/ui/spinner'
import '../src/app.css'

describe('local loading indicators', () => {
  it('shows an inline spinner immediately without a widget provider', async () => {
    await render(<Spinner aria-label="working" />)
    await expect.element(page.getByRole('status', { name: 'working' })).toBeVisible()
    expect(document.querySelector('#qualy-boot')).toBeNull()
  })

  it('fills its page seat and delays only the indicator, without a global overlay', async () => {
    await render(
      <div data-testid="seat" style={{ display: 'flex', height: 400, width: 600 }}>
        <PageLoading />
      </div>,
    )
    const seat = page.getByTestId('seat').element().getBoundingClientRect()
    const status = page.getByRole('status').element()
    expect(status.getBoundingClientRect().height).toBe(seat.height)
    const indicator = status.querySelector('svg')!
    expect(getComputedStyle(indicator).animationDelay).toBe('0.3s')
    expect(document.querySelector('[data-cold-start-phase]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-cold-start-flight')).toBe(false)
  })
})
