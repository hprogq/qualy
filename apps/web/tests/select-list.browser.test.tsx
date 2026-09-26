import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@qualy/ui/select'
import '../src/app.css'

// The open list of a select: where it lands, and what it says about the
// choice in force. Asserted on geometry and on the options' own state.

afterEach(() => page.viewport(1280, 800))

/** a select whose trigger is a glyph at the very end of a toolbar */
function EdgeSelect({ value }: { value: string }) {
  return (
    <UiProvider scheme="light">
      <div style={{ position: 'fixed', top: 40, right: 4 }}>
        <Select value={value}>
          <SelectTrigger size="sm" aria-label="order">
            <span aria-hidden>≡</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Most recently updated first</SelectItem>
            <SelectItem value="oldest">Earliest filed first</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </UiProvider>
  )
}

const inWindow = (element: Element) => {
  const box = element.getBoundingClientRect()
  return box.left >= 0 && box.right <= window.innerWidth
}

describe('a select’s open list', () => {
  it('stays inside the window under a trigger narrower than it', async () => {
    await page.viewport(390, 844)
    await render(<EdgeSelect value="oldest" />)
    await page.getByRole('combobox', { name: 'order' }).click()
    const list = page.getByRole('listbox')
    await expect.element(list).toBeVisible()
    const dropdown = list.element().closest('[data-slot="select-content"]')!
    expect(dropdown.getBoundingClientRect().width).toBeGreaterThan(
      page.getByRole('combobox', { name: 'order' }).element().getBoundingClientRect().width,
    )
    expect(inWindow(dropdown)).toBe(true)
    // the mark on the choice in force is where it can be seen
    const chosen = page.getByRole('option', { selected: true })
    await expect.element(chosen).toHaveAttribute('aria-selected', 'true')
    expect(inWindow(chosen.element().querySelector('svg')!)).toBe(true)
  })

  it('says which option is the one in force', async () => {
    await render(<EdgeSelect value="newest" />)
    await page.getByRole('combobox', { name: 'order' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const options = page.getByRole('option').elements()
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  })
})
