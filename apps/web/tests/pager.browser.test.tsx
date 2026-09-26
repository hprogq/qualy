import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { CursorPager } from '@qualy/ui/pager'
import '../src/app.css'

// A list read forwards offers the way back, the page being read and the way
// on. The page being read is where the reader is, not somewhere to go: it is
// said, not offered as a control that does nothing when pressed.

describe('a pager over a list read forwards', () => {
  it('says the page being read without offering it as a button', async () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    await render(
      <UiProvider scheme="light">
        <CursorPager
          testId="pager"
          label="pages"
          previousLabel="back"
          nextLabel="on"
          page={3}
          hasNext
          onPrevious={onPrevious}
          onNext={onNext}
        />
      </UiProvider>,
    )
    const pager = page.getByTestId('pager')
    await expect.element(pager).toHaveAttribute('data-page', '3')
    expect(pager.getByRole('button', { name: '3', exact: true }).elements()).toHaveLength(0)
    const here = pager.element().querySelector('[aria-current="page"]')
    expect(here?.textContent).toBe('3')
    expect(here?.tagName).not.toBe('BUTTON')

    await pager.getByRole('button', { name: 'back' }).click()
    await pager.getByRole('button', { name: 'on' }).click()
    expect(onPrevious).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
