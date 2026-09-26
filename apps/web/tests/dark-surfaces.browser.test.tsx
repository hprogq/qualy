import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from '@qualy/ui/button'
import { Chip, ChipGroup } from '@qualy/ui/chip'
import { DatePicker } from '@qualy/ui/date-picker'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { UiProvider } from '@qualy/ui/provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Textarea } from '@qualy/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@qualy/ui/tooltip'
import '../src/app.css'

// The widgets in the dark scheme, against the product's own surfaces.
//
// The widget library grounds its fields, lists, menus and calendars on a
// neutral grey of its own ramp (#2e2e2e), a step lighter than every warm dark
// surface around them, and answers a keyboard highlight, a current time box
// or a tip with colours of its own too - two of them white on the product's
// near-white primary. Every colour here is compared with a probe painted
// from the token it should be, never with a literal.

const NEUTRAL_GREY = 'rgb(46, 46, 46)'

const setScheme = (mode: 'light' | 'dark') => {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.setAttribute('data-mode', mode)
}

beforeEach(() => setScheme('dark'))
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

const ground = (element: Element) => getComputedStyle(element).backgroundColor
const ink = (element: Element) => getComputedStyle(element).color

const dark = (ui: React.ReactNode) => render(<UiProvider scheme="dark">{ui}</UiProvider>)

describe('the field family in the dark', () => {
  it('stands on the raised surface, not the widget’s own grey', async () => {
    await dark(
      <>
        <Input aria-label="name" />
        <Textarea aria-label="note" />
        <NativeSelect aria-label="kind" defaultValue="a">
          <option value="a">a</option>
        </NativeSelect>
        <Select value="a">
          <SelectTrigger aria-label="state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">all</SelectItem>
          </SelectContent>
        </Select>
      </>,
    )
    const raised = probe('var(--q-surface-elevated)')
    const fields = [
      page.getByRole('textbox', { name: 'name' }),
      page.getByRole('textbox', { name: 'note' }),
      page.getByRole('combobox', { name: 'kind' }),
      page.getByRole('combobox', { name: 'state' }),
    ].map((field) => field.element())
    await expect.poll(() => fields.map(ground)).toEqual(fields.map(() => raised))
    expect(fields.map(ground)).not.toContain(NEUTRAL_GREY)
    // both selects point down in the secondary text grey, not the widget's own
    const chevrons = [...document.querySelectorAll('[data-combobox-chevron]')]
    expect(chevrons).toHaveLength(2)
    const muted = probe('var(--q-muted-foreground)', 'color')
    expect(chevrons.map(ink)).toEqual([muted, muted])
  })
})

describe('an open select in the dark', () => {
  it('opens on the panel material and marks the keyboard’s option in ink', async () => {
    await dark(
      <Select value="newest">
        <SelectTrigger aria-label="order">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">latest first</SelectItem>
          <SelectItem value="oldest">earliest first</SelectItem>
        </SelectContent>
      </Select>,
    )
    await page.getByRole('combobox', { name: 'order' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
    const list = document.querySelector('[data-slot="select-content"]')!
    expect(ground(list)).toBe(probe('var(--q-surface-elevated)'))

    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(() => document.querySelector('[data-combobox-selected]')).not.toBeNull()
    const highlighted = document.querySelector('[data-combobox-selected]')!
    expect(ground(highlighted)).toBe(probe('var(--q-hover-surface)'))
    expect(ground(highlighted)).not.toBe(probe('var(--q-primary)'))
    expect(ink(highlighted)).toBe(probe('var(--q-foreground)', 'color'))
    await userEvent.keyboard('{Escape}')
  })
})

describe('an open menu in the dark', () => {
  it('opens on the panel material and grounds the row under the pointer', async () => {
    await dark(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">more</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>adjust</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await page.getByRole('button', { name: 'more' }).click()
    const adjust = page.getByRole('menuitem', { name: 'adjust' })
    await expect.element(adjust).toBeVisible()
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]')!
    expect(ground(menu)).toBe(probe('var(--q-surface-elevated)'))

    await userEvent.hover(adjust)
    await expect.poll(() => ground(adjust.element())).toBe(probe('var(--q-hover-surface)'))
    // a row that removes something answers in its own tint
    const remove = page.getByRole('menuitem', { name: 'remove' })
    await userEvent.hover(remove)
    await expect.poll(() => ground(remove.element())).toBe(probe('var(--q-danger-surface)'))
    await userEvent.keyboard('{Escape}')
  })
})

describe('a tip in the dark', () => {
  it('is the product’s inverse: paper with ink on it', async () => {
    await dark(
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline">why</Button>
        </TooltipTrigger>
        <TooltipContent>closed for now</TooltipContent>
      </Tooltip>,
    )
    const tip = page.getByRole('tooltip')
    await expect.element(tip).toBeVisible()
    expect(ground(tip.element())).toBe(probe('var(--q-primary)'))
    expect(ink(tip.element())).toBe(probe('var(--q-primary-foreground)', 'color'))
  })
})

describe('a calendar in the dark', () => {
  it('opens on the panel material', async () => {
    await dark(<DatePicker value="2026-09-26" onChange={() => {}} localeTag="zh-CN" />)
    await userEvent.click(document.querySelector('[data-slot="date-picker"]')!)
    await expect.poll(() => document.querySelector('table')).not.toBeNull()
    const panel = document.querySelector('table')!.closest('[data-position]')!
    expect(ground(panel)).toBe(probe('var(--q-surface-elevated)'))
    expect(ground(panel)).not.toBe(NEUTRAL_GREY)
  })

  it('keeps the hour being typed readable', async () => {
    await dark(
      <DateTimePicker
        value="2026-09-26T06:30:00.000Z"
        onChange={() => {}}
        placeholder="when"
        hourLabel="hour"
        minuteLabel="minute"
        secondLabel="second"
        clearLabel="clear"
        localeTag="zh-CN"
      />,
    )
    await userEvent.click(document.querySelector('[data-slot="date-time-picker"]')!)
    const hour = page.getByRole('spinbutton', { name: 'hour' })
    await hour.click()
    await expect.poll(() => document.activeElement).toBe(hour.element())
    // the box keeps the widget's filled look, with the ink that belongs on it
    expect(ground(hour.element())).toBe(probe('var(--q-primary)'))
    expect(ink(hour.element())).toBe(probe('var(--q-primary-foreground)', 'color'))
    expect(ink(hour.element())).not.toBe(ground(hour.element()))
    await userEvent.keyboard('{Escape}')
  })
})

describe('a chosen chip in the dark', () => {
  // the widget drew its tick in a hard-coded white, on a chip the product
  // fills with its primary - which is paper in the dark
  it('draws its tick in the ink that belongs on the primary', async () => {
    await dark(
      <ChipGroup value="late" onChange={() => {}}>
        <Chip value="missing">missing</Chip>
        <Chip value="late">late</Chip>
      </ChipGroup>,
    )
    const chosen = document.querySelector('[data-slot="chip"][data-state="on"]')!
    const tick = chosen.querySelector('svg')!
    expect(tick).not.toBeNull()
    expect(ink(tick)).toBe(probe('var(--q-primary-foreground)', 'color'))
    expect(ink(tick)).not.toBe(ground(chosen.querySelector('label')!))
  })
})
