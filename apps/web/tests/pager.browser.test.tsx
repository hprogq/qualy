import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { CursorPager, Pager } from '@qualy/ui/pager'
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

// The page being read wears the tint the product gives a chosen option, in
// its own ink; the other numbers are quiet keys. The widget's own current
// page was the primary behind a hard-coded white - in the dark, where the
// primary is paper, the number could not be read at all.
describe('the page being read, in the dark', () => {
  const setScheme = (mode: 'light' | 'dark') => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.setAttribute('data-mode', mode)
  }
  afterEach(() => setScheme('light'))

  /** what an element painted from `value` computes to, in the scheme in force */
  const probe = (value: string, property: 'backgroundColor' | 'color' = 'backgroundColor') => {
    const element = document.createElement('div')
    element.style[property] = value
    document.body.append(element)
    const computed = getComputedStyle(element)[property]
    element.remove()
    return computed
  }

  it('is drawn in ink on the chosen tint, on both strips', async () => {
    setScheme('dark')
    await render(
      <UiProvider scheme="dark">
        <Pager
          testId="numbered"
          label="pages"
          page={3}
          pageSize={10}
          total={120}
          onPage={() => {}}
        />
        <CursorPager
          testId="forward"
          label="pages"
          previousLabel="back"
          nextLabel="on"
          page={2}
          hasNext
          onPrevious={() => {}}
          onNext={() => {}}
        />
      </UiProvider>,
    )
    await expect.element(page.getByTestId('numbered')).toBeVisible()
    const inkColour = probe('var(--q-foreground)', 'color')
    const tint = probe('var(--q-selected-surface)')
    for (const strip of ['numbered', 'forward']) {
      const here = page.getByTestId(strip).element().querySelector('[aria-current="page"]')!
      const style = getComputedStyle(here)
      expect(style.color, strip).toBe(inkColour)
      expect(style.backgroundColor, strip).toBe(tint)
      expect(style.backgroundColor, strip).not.toBe(probe('var(--q-primary)'))
    }
    // the other numbers stand on nothing of their own
    const another = page.getByTestId('numbered').getByRole('button', { name: '4', exact: true })
    expect(getComputedStyle(another.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  // A number under the pointer answers in its ink and nothing more: with a
  // ground of its own, a step away from the tint, it read as a second page
  // being read.
  for (const mode of ['light', 'dark'] as const) {
    it(`keeps the pointer’s number off the ground in the ${mode}`, async () => {
      setScheme(mode)
      await render(
        <UiProvider scheme={mode}>
          <Pager
            testId="numbered"
            label="pages"
            page={3}
            pageSize={10}
            total={120}
            onPage={() => {}}
          />
        </UiProvider>,
      )
      const strip = page.getByTestId('numbered')
      const hovered = strip.getByRole('button', { name: '4', exact: true })
      await hovered.hover()
      await expect
        .poll(() => getComputedStyle(hovered.element()).color)
        .toBe(probe('var(--q-foreground)', 'color'))
      expect(getComputedStyle(hovered.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      const here = strip.element().querySelector('[aria-current="page"]')!
      expect(getComputedStyle(here).backgroundColor).toBe(probe('var(--q-selected-surface)'))
    })
  }
})
