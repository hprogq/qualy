import { useState } from 'react'
import { describe, expect, it } from 'vitest'
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
  await expect.poll(() => document.querySelectorAll('table').length).toBe(2)
}

const days = () =>
  Array.from(document.querySelectorAll('table td button')).filter(
    (day) => !day.hasAttribute('data-hidden'),
  ) as HTMLElement[]

const day = (text: string) => days().find((candidate) => candidate.textContent === text)!

const solid = (element: Element) =>
  getComputedStyle(element).getPropertyValue('--q-day-circle').trim().startsWith('oklch')

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

describe('a span is drawn as a track its ends sit on', () => {
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
