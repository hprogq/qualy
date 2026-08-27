import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DateRangePicker, type DateRange } from '@qualy/ui/date-range-picker'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// How a span is DRAWN, asserted as geometry rather than as a screenshot.
//
// Every defect this control shipped looked the same from the outside: the
// selection stopped mid-air with nothing closing it, or a day in the middle
// of a month wore an end's circle. Both are facts about two elements - the
// track behind the days and the circle on the chosen ones - so both are
// measured here.
//
// The states are the ones that broke: a span crossing rows, a span crossing
// the two month panels, an end still being hunted for, the pointer wandering
// off the days while the panel keeps its preview, and the pointer resting on
// an end that is already chosen.

function Harness({ initial }: { initial: DateRange }) {
  const [value, setValue] = useState<DateRange>(initial)
  return (
    <UiProvider scheme="light">
      <DateRangePicker value={value} onChange={setValue} placeholder="span" localeTag="zh-CN" />
    </UiProvider>
  )
}

const open = async (initial: DateRange) => {
  render(<Harness initial={initial} />)
  // named by whatever it already holds, so the field is found by its slot
  await expect
    .poll(() => document.querySelector('[data-slot="date-range-picker"]') !== null)
    .toBe(true)
  await userEvent.click(document.querySelector('[data-slot="date-range-picker"]')!)
  await expect.poll(() => document.querySelectorAll('table').length > 0).toBe(true)
}

const days = () =>
  Array.from(document.querySelectorAll('table td button')).filter(
    (day) => !day.hasAttribute('data-hidden'),
  ) as HTMLElement[]

const day = (text: string) => days().find((candidate) => candidate.textContent === text)!

const circleOf = (element: Element) =>
  getComputedStyle(element).getPropertyValue('--q-day-circle').trim()

/** a day wearing the full ink: an end, chosen or being hunted for */
const solid = (element: Element) => circleOf(element).startsWith('oklch')

/** a day the pointer is only warming: a tint, not the full ink */
const warmed = (element: Element) => circleOf(element).startsWith('color-mix')

/**
 * Where the span is left open: a day inside it whose track runs to the edge
 * of its cell with no visible day next door to carry it on. That is the U
 * with nothing closing it, whatever produced it.
 */
const openEnds = () => {
  const found: string[] = []
  for (const cell of document.querySelectorAll('table td')) {
    const inside = cell.querySelector('button')
    if (!inside || inside.hasAttribute('data-hidden') || !inside.hasAttribute('data-in-range'))
      continue
    const track = getComputedStyle(inside, '::before')
    const carries = (neighbour: Element | null) => {
      const next = neighbour?.querySelector('button')
      return (
        next instanceof HTMLElement &&
        next.hasAttribute('data-in-range') &&
        !next.hasAttribute('data-hidden')
      )
    }
    const stops = (side: 'left' | 'right') =>
      track[side] === '3px' &&
      track[side === 'left' ? 'borderLeftWidth' : 'borderRightWidth'] === '1px'
    if (!carries(cell.nextElementSibling) && !stops('right'))
      found.push(`${inside.textContent} runs off to the right`)
    if (!carries(cell.previousElementSibling) && !stops('left'))
      found.push(`${inside.textContent} runs off to the left`)
  }
  return found
}

afterEach(() => page.viewport(DESKTOP.width, DESKTOP.height))

const DESKTOP = { width: 1152, height: 700 }

describe('a span is drawn as a track its ends sit on', () => {
  it('closes on both ends inside one row', async () => {
    await open({ start: '2026-08-03', end: '2026-08-06' })
    expect(openEnds()).toEqual([])
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('6'))).toBe(true)
    expect(solid(day('4'))).toBe(false)
  })

  it('closes on both ends when it crosses rows', async () => {
    await open({ start: '2026-08-03', end: '2026-08-13' })
    expect(openEnds()).toEqual([])
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('13'))).toBe(true)
    // a day in the middle is track, not an end
    expect(solid(day('8'))).toBe(false)
  })

  it('closes when it crosses the two month panels', async () => {
    await open({ start: '2026-08-26', end: '2026-09-08' })
    expect(openEnds()).toEqual([])
    // the month's last day is a break in the view, not an end of the span
    expect(solid(day('31'))).toBe(false)
  })

  it('draws the end being hunted for, and keeps it when the pointer leaves the days', async () => {
    await open({ start: '', end: '' })
    await userEvent.click(day('3'))
    const candidate = day('12')
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(openEnds()).toEqual([])
    // the panel keeps its preview when the pointer slips into a gap between
    // rows; :hover does not survive that, so the drawing must not need it
    const blank = document.querySelector('table tbody tr td')!
    for (const kind of ['pointerover', 'mouseover', 'pointermove', 'mousemove'])
      blank.dispatchEvent(new MouseEvent(kind, { bubbles: true }))
    expect(solid(candidate)).toBe(true)
    expect(openEnds()).toEqual([])
  })

  it('keeps a chosen end solid under the pointer', async () => {
    await open({ start: '2026-08-03', end: '2026-08-13' })
    const end = day('13')
    await userEvent.hover(end)
    expect(solid(end)).toBe(true)
  })
})

describe('every shape a span can take is closed', () => {
  // 28, 29, 30 and 31: the last row of a month is where a track used to run
  // off the panel, and each length puts it in a different column
  it.each([
    ['2026-02-24', '2026-02-28'],
    ['2028-02-25', '2028-02-29'],
    ['2026-04-26', '2026-04-30'],
    ['2026-08-27', '2026-08-31'],
  ])('ends on the last day of the month (%s to %s)', async (start, end) => {
    await open({ start, end })
    expect(openEnds()).toEqual([])
    expect(solid(day(String(Number(end.slice(8)))))).toBe(true)
  })

  it('draws a single day as a day, with no track at all', async () => {
    await open({ start: '2026-08-11', end: '2026-08-11' })
    expect(openEnds()).toEqual([])
    const alone = day('11')
    expect(solid(alone)).toBe(true)
    expect(getComputedStyle(alone, '::before').display).toBe('none')
  })

  it('is hunted backwards from its start just as well', async () => {
    await open({ start: '', end: '' })
    await userEvent.click(day('17'))
    const candidate = day('5')
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(openEnds()).toEqual([])
  })

  // the row's own edges, and the edge of the panel itself, where there is no
  // neighbour to ask and the pointer is the only answer
  it.each([
    ['a row start', '10'],
    ['a row end', '9'],
    ['the last day the panel shows', '31'],
  ])('draws the end being hunted for at %s', async (_where, target) => {
    await open({ start: '', end: '' })
    await userEvent.click(day('3'))
    const candidate = day(target)
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(openEnds()).toEqual([])
  })

  it('warms a day inside a finished span without promoting it to an end', async () => {
    await open({ start: '2026-08-03', end: '2026-08-13' })
    const middle = day('8')
    await userEvent.hover(middle)
    await expect.poll(() => warmed(middle)).toBe(true)
    expect(solid(middle)).toBe(false)
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('13'))).toBe(true)
  })

  it('closes on a phone, where the panel shows one month', async () => {
    page.viewport(390, 844)
    await open({ start: '2026-08-26', end: '2026-09-08' })
    await expect.poll(() => document.querySelectorAll('table').length).toBe(1)
    expect(openEnds()).toEqual([])
    // the span leaves this panel rather than ending in it
    expect(solid(day('31'))).toBe(false)
  })

  it('keeps a guard against motion for a reader who asked for less', async () => {
    // the runner cannot be told to prefer reduced motion per test, so what is
    // pinned here is that the guard exists and still names the day
    const guards = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })
    const reduced = JSON.stringify(guards.map((rule) => rule.cssText))
    expect(reduced).toContain('prefers-reduced-motion')
    expect(reduced.includes('q-calendar-day') && reduced.includes('transition: none')).toBe(true)
  })
})
