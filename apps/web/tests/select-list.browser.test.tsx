import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@qualy/ui/select'
import '../src/app.css'

// A select away from a form: the quiet key it can stand as in a toolbar,
// where its open list lands, and what that list says about the choice in
// force. Asserted on geometry, computed style and the options' own state.

afterEach(() => page.viewport(1280, 800))

const caller = stylex.create({ full: { width: '100%' } })

describe('a quiet select trigger', () => {
  // For a toolbar whose neighbours are icon keys: the key's own ground and
  // height, no field box around it and no chevron beside it.
  it('stands as a key rather than a field', async () => {
    await render(
      <UiProvider scheme="light">
        {(['field', 'key'] as const).map((kind) => (
          <Select key={kind} value="newest">
            <SelectTrigger size="sm" quiet={kind === 'key'} aria-label={kind}>
              <span>Latest</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Latest first</SelectItem>
            </SelectContent>
          </Select>
        ))}
      </UiProvider>,
    )
    const trigger = (name: string) => page.getByRole('combobox', { name }).element()
    const edge = (name: string) => getComputedStyle(trigger(name)).borderTopColor
    const chevron = (name: string) =>
      trigger(name).parentElement!.querySelector('[data-position="right"]')
    await expect.element(page.getByRole('combobox', { name: 'key' })).toBeVisible()
    expect(edge('field')).not.toBe('rgba(0, 0, 0, 0)')
    expect(chevron('field')).not.toBeNull()
    expect(edge('key')).toBe('rgba(0, 0, 0, 0)')
    expect(chevron('key')).toBeNull()
    expect(trigger('key').getBoundingClientRect().height).toBe(32)
    // with no border to colour, keyboard focus is a ring of its own
    expect(getComputedStyle(trigger('key')).boxShadow).toBe('none')
    await userEvent.tab()
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger('key'))
    expect(getComputedStyle(trigger('key')).boxShadow).not.toBe('none')
  })
})

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

  // A field showing a short choice used to open a list exactly its own
  // width, folding every longer option over two or three lines. The list
  // takes its widest option's width, and a field wider than that still
  // gets a list as wide as itself.
  it('is as wide as its widest option, and never narrower than its field', async () => {
    await render(
      <UiProvider scheme="light">
        <Select value="short">
          <SelectTrigger aria-label="unit">
            <span>A</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="short">A</SelectItem>
            <SelectItem value="long">School of Computer Science and Engineering</SelectItem>
          </SelectContent>
        </Select>
        <div style={{ width: 420, marginTop: 240 }}>
          <Select value="a">
            <SelectTrigger aria-label="wide" xstyle={caller.full}>
              <span>A</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">A</SelectItem>
              <SelectItem value="b">B</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </UiProvider>,
    )
    const unit = page.getByRole('combobox', { name: 'unit' })
    await unit.click()
    const long = page.getByRole('option', { name: 'School of Computer Science and Engineering' })
    await expect.element(long).toBeVisible()
    const short = page.getByRole('option', { name: 'A', exact: true })
    // one line each: the long option stands no taller than the short one
    expect(long.element().getBoundingClientRect().height).toBe(
      short.element().getBoundingClientRect().height,
    )
    const list = () => document.querySelector('[data-slot="select-content"]')!
    expect(list().getBoundingClientRect().width).toBeGreaterThan(
      unit.element().getBoundingClientRect().width,
    )
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[data-slot="select-content"]')).toBeNull()

    const wide = page.getByRole('combobox', { name: 'wide' })
    await wide.click()
    await expect.element(page.getByRole('option', { name: 'B', exact: true })).toBeVisible()
    await expect
      .poll(() => Math.round(list().getBoundingClientRect().width))
      .toBe(Math.round(wide.element().getBoundingClientRect().width))
    await userEvent.keyboard('{Escape}')
  })

  it('says which option is the one in force', async () => {
    await render(<EdgeSelect value="newest" />)
    await page.getByRole('combobox', { name: 'order' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const options = page.getByRole('option').elements()
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  })
})
