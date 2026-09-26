import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
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

/** options each wider than a narrow field, in both scripts */
const LONG_OPTIONS = [
  'short',
  'School of Computer Science and Engineering',
  '计算机科学与技术学院 2023 级本科生第一党支部',
  '数据科学与大数据技术专业 2022 级 3 班',
]

/** where the open list lies, read fresh each time it is asked */
const listBox = () => () =>
  document.querySelector('[data-slot="select-content"]')!.getBoundingClientRect()

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

  // A list wider than its field starts where the field starts. Centred under
  // it, the list stuck out on both sides: over the field to its left, and in
  // a dialog past the panel's edge onto the veil.
  it('lines up with the start of a field narrower than it', async () => {
    await render(
      <UiProvider scheme="light">
        <div style={{ position: 'fixed', top: 40, left: 200 }}>
          <Select value="short">
            <SelectTrigger aria-label="unit" style={{ width: 170 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LONG_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </UiProvider>,
    )
    const trigger = page.getByRole('combobox', { name: 'unit' })
    await trigger.click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const list = listBox()
    const field = trigger.element().getBoundingClientRect()
    await expect.poll(() => Math.abs(list().left - field.left)).toBeLessThanOrEqual(1)
    expect(list().width).toBeGreaterThan(field.width)
    expect(list().right).toBeLessThanOrEqual(window.innerWidth - 8 + 1)
  })

  it('slides back inside the window beside its right edge', async () => {
    await render(
      <UiProvider scheme="light">
        <div style={{ position: 'fixed', top: 40, right: 16 }}>
          <Select value="short">
            <SelectTrigger aria-label="unit" style={{ width: 120 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LONG_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </UiProvider>,
    )
    const trigger = page.getByRole('combobox', { name: 'unit' })
    await trigger.click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const list = listBox()
    await expect.poll(() => list().right).toBeLessThanOrEqual(window.innerWidth - 8 + 1)
    expect(list().left).toBeGreaterThanOrEqual(0)
    // still under its field: it overlaps the field it was opened from
    const field = trigger.element().getBoundingClientRect()
    expect(list().left).toBeLessThan(field.left)
    expect(list().right).toBeGreaterThan(field.left)
  })

  // A key at the end of a toolbar asks for its end edge instead.
  it('lines up with the end of its trigger when it asks to', async () => {
    await render(
      <UiProvider scheme="light">
        <div style={{ position: 'fixed', top: 40, left: 600 }}>
          <Select value="short">
            <SelectTrigger aria-label="order" style={{ width: 120 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {LONG_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </UiProvider>,
    )
    const trigger = page.getByRole('combobox', { name: 'order' })
    await trigger.click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const field = trigger.element().getBoundingClientRect()
    await expect.poll(() => Math.abs(listBox()().right - field.right)).toBeLessThanOrEqual(1)
  })

  // Inside a dialog the list keeps to the panel, on a desk and on a phone:
  // a field at the start of the panel opens its list from its own start,
  // and one at the far side slides back rather than spilling onto the veil.
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    it(`keeps inside the dialog it was opened from at ${width} wide`, async () => {
      await page.viewport(width, height)
      await render(
        <UiProvider scheme="light">
          <Dialog open>
            <DialogContent size="32rem">
              <DialogHeader>
                <DialogTitle>columns</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {['near', 'far'].map((side) => (
                    <Select key={side} value="short">
                      <SelectTrigger aria-label={side}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LONG_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
              </DialogBody>
            </DialogContent>
          </Dialog>
        </UiProvider>,
      )
      const panel = () =>
        document.querySelector('[data-slot="dialog-content"]')!.getBoundingClientRect()
      const list = listBox()
      for (const side of ['near', 'far']) {
        const trigger = page.getByRole('combobox', { name: side })
        await trigger.click()
        await expect.element(page.getByRole('listbox')).toBeVisible()
        await expect.poll(() => list().left).toBeGreaterThanOrEqual(panel().left + 8 - 1)
        expect(list().right).toBeLessThanOrEqual(panel().right - 8 + 1)
        // where the room allows, the near one starts where its field starts;
        // on a phone the panel is narrower than the list's measure, and the
        // list slides back the few pixels it lacks
        if (side === 'near' && width > 390) {
          const field = trigger.element().getBoundingClientRect()
          expect(Math.abs(list().left - field.left)).toBeLessThanOrEqual(1)
        }
        await userEvent.keyboard('{Escape}')
        await expect.poll(() => document.querySelector('[data-slot="select-content"]')).toBeNull()
      }
    })
  }

  it('says which option is the one in force', async () => {
    await render(<EdgeSelect value="newest" />)
    await page.getByRole('combobox', { name: 'order' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const options = page.getByRole('option').elements()
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  })
})
