import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DateRangePicker, type DateRange } from '@qualy/ui/date-range-picker'
import { UiProvider } from '@qualy/ui/provider'
import '../src/app.css'

// How a span is DRAWN, asserted as geometry and product colour rather than as
// a screenshot.
//
// Every defect this control shipped looked the same from the outside: the
// selection stopped mid-air with nothing closing it, or a day in the middle
// of a month wore an end's circle, or a span turned grey halfway across a
// month boundary. All of those are facts about two elements - the track
// behind the days and the circle on them - so all of them are measured.
//
// The assertions read the widget's own state attributes and the product's
// own tokens. They never read the marks this control computes, so they stay
// a check on the drawing rather than a restatement of it.

const DESKTOP = { width: 1152, height: 700 }
const PHONE = { width: 390, height: 844 }

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
/** a day named the way the calendar names it, when the number is ambiguous */
const dated = (label: string) => days().find((candidate) => candidate.ariaLabel === label)!

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const circle = (element: Element) => getComputedStyle(element, '::after').backgroundColor
const track = (element: Element) => getComputedStyle(element, '::before')

/** wearing the full ink: an end, chosen or being hunted for */
const solid = (element: Element) => circle(element) === token('--q-primary')
/** warmed by the pointer: a tint of it, and not nothing */
const warm = (element: Element) =>
  circle(element) !== token('--q-primary') && circle(element) !== 'rgba(0, 0, 0, 0)'
const bare = (element: Element) => circle(element) === 'rgba(0, 0, 0, 0)'

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
    const drawn = track(inside)
    const carries = (neighbour: Element | null) => {
      const next = neighbour?.querySelector('button')
      return (
        next instanceof HTMLElement &&
        next.hasAttribute('data-in-range') &&
        !next.hasAttribute('data-hidden')
      )
    }
    const stops = (side: 'left' | 'right') =>
      drawn[side] === '3px' &&
      drawn[side === 'left' ? 'borderLeftWidth' : 'borderRightWidth'] === '1px'
    const named = inside.ariaLabel ?? inside.textContent
    if (!carries(cell.nextElementSibling) && !stops('right'))
      found.push(`${named} runs off to the right`)
    if (!carries(cell.previousElementSibling) && !stops('left'))
      found.push(`${named} runs off to the left`)
  }
  return found
}

afterEach(() => page.viewport(DESKTOP.width, DESKTOP.height))

describe('a span is drawn as a track its ends sit on', () => {
  it('closes on both ends inside one row', async () => {
    await open({ start: '2026-08-03', end: '2026-08-06' })
    expect(openEnds()).toEqual([])
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('6'))).toBe(true)
    expect(bare(day('4'))).toBe(true)
  })

  it('closes on both ends when it crosses rows', async () => {
    await open({ start: '2026-08-03', end: '2026-08-13' })
    expect(openEnds()).toEqual([])
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('13'))).toBe(true)
    expect(bare(day('8'))).toBe(true)
  })

  it('closes when it crosses the two month panels', async () => {
    await open({ start: '2026-08-26', end: '2026-09-08' })
    expect(document.querySelectorAll('table').length).toBe(2)
    expect(openEnds()).toEqual([])
    // the month's last day is a break in the view, not an end of the span
    expect(bare(dated('2026年8月31日'))).toBe(true)
    expect(solid(dated('2026年9月8日'))).toBe(true)
  })

  it('draws the end being hunted for, and keeps it when the pointer leaves the days', async () => {
    await open({ start: '', end: '' })
    await userEvent.click(day('3'))
    const candidate = day('12')
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(openEnds()).toEqual([])
    // the panel keeps its preview when the pointer slips into a gap between
    // rows; the mark this control keeps must not be lost with :hover
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
    expect(track(alone).display).toBe('none')
  })

  it('is hunted backwards from its start just as well', async () => {
    await open({ start: '', end: '' })
    await userEvent.click(day('17'))
    const candidate = day('5')
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(solid(day('17'))).toBe(true)
    expect(openEnds()).toEqual([])
  })

  // the row's own edges, and the edge of the panel itself
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
    await expect.poll(() => warm(middle)).toBe(true)
    expect(solid(middle)).toBe(false)
    expect(solid(day('3'))).toBe(true)
    expect(solid(day('13'))).toBe(true)
  })
})

describe('one month at a time, with the neighbouring days on show', () => {
  it('runs one unbroken track across the turn of the month', async () => {
    page.viewport(PHONE.width, PHONE.height)
    await open({ start: '2026-08-28', end: '2026-09-03' })
    await expect.poll(() => document.querySelectorAll('table').length).toBe(1)
    expect(openEnds()).toEqual([])

    const last = dated('2026年8月31日')
    const first = dated('2026年9月1日')
    // the turn of the month is not a break in the view here: both days are in
    // the same row, so the track walks straight through
    expect(last.hasAttribute('data-track-cap-end')).toBe(false)
    expect(first.hasAttribute('data-track-cap-start')).toBe(false)
    expect(track(last).right).toBe('0px')
    expect(track(first).left).toBe('0px')
    // and it is the same track: same ground, same rule, same weight of ink
    expect(track(first).backgroundColor).toBe(track(last).backgroundColor)
    expect(track(first).borderTopColor).toBe(track(last).borderTopColor)
    expect(getComputedStyle(first).opacity).toBe('1')
    // only the number says the day belongs to another month
    expect(first.hasAttribute('data-outside')).toBe(true)
    expect(getComputedStyle(first).color).toBe(token('--q-muted-foreground'))
    expect(getComputedStyle(last).color).toBe(token('--q-foreground'))
  })

  it('gives an end that falls on a neighbouring day the same circle as any other', async () => {
    page.viewport(PHONE.width, PHONE.height)
    await open({ start: '2026-08-28', end: '2026-09-03' })
    const end = dated('2026年9月3日')
    expect(end.hasAttribute('data-outside')).toBe(true)
    expect(solid(end)).toBe(true)
    expect(getComputedStyle(end).opacity).toBe('1')
    expect(getComputedStyle(end).color).toBe(token('--q-primary-foreground'))
  })

  it('hunts backwards across the turn of the month', async () => {
    // an empty picker opens on the real today, and this hunt needs the turn
    // of a KNOWN month on screen - so today is pinned, dates only, for the
    // life of this test (every other case anchors its view with a value)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 15))
    page.viewport(PHONE.width, PHONE.height)
    await open({ start: '', end: '' })
    const second = dated('2026年9月2日')
    await userEvent.click(second)
    const candidate = dated('2026年8月30日')
    await userEvent.hover(candidate)
    await expect.poll(() => solid(candidate)).toBe(true)
    expect(solid(second)).toBe(true)
    expect(openEnds()).toEqual([])
    vi.useRealTimers()
  })
})

describe('the day answers its own state', () => {
  it('leaves the motion out for a reader who asked for less', async () => {
    // the runner prefers reduced motion, so this is the reduced branch: the
    // ink and the circle change without crossing
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    await open({ start: '2026-08-03', end: '2026-08-13' })
    const end = day('13')
    expect(getComputedStyle(end).transitionDuration).toBe('0s')
    expect(getComputedStyle(end, '::after').transitionDuration).toBe('0s')
    // the track never crossed in either branch
    expect(getComputedStyle(end, '::before').transitionDuration).toBe('0s')
  })

  it('draws from the palette of whichever scheme it is in', async () => {
    render(
      <UiProvider scheme="dark">
        <DateRangePicker
          value={{ start: '2026-08-03', end: '2026-08-13' }}
          onChange={() => {}}
          placeholder="span"
          localeTag="zh-CN"
        />
      </UiProvider>,
    )
    await expect
      .poll(() => document.querySelector('[data-slot="date-range-picker"]') !== null)
      .toBe(true)
    await userEvent.click(document.querySelector('[data-slot="date-range-picker"]')!)
    await expect.poll(() => document.querySelectorAll('table').length > 0).toBe(true)
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--q-primary').trim()
    expect(circle(day('3'))).toBe(dark)
    expect(getComputedStyle(day('3')).color).toBe(
      getComputedStyle(document.documentElement).getPropertyValue('--q-primary-foreground').trim(),
    )
  })
})
