import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import * as stylex from '@stylexjs/stylex'
import { UiProvider } from '@qualy/ui/provider'
import {
  Timeline,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@qualy/ui/timeline'
import '../src/app.css'

// A rail with marks on it, measured rather than looked at.
//
// Every part of this component places itself against a rail it cannot see,
// and a caller dresses those parts from outside - so the two ways it can go
// wrong are both invisible to any assertion about roles or text. Both have
// happened: a caller's own `transform` took the mark's centring away and left
// the rail running eight pixels to one side, and a hairline stated as a width
// became the LENGTH of the sideways rail, which then measured one pixel
// across and disappeared. Neither made a single existing case red.

const caller = stylex.create({
  // what a page says when it wants a hairline instead of the stock bar
  railUpright: { width: 1 },
  railAcross: { height: 1 },
  // a sideways stage is a card of its own width, not a share of the row
  card: { width: 224, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
})

function centreX(el: Element) {
  const r = el.getBoundingClientRect()
  return r.x + r.width / 2
}
function centreY(el: Element) {
  const r = el.getBoundingClientRect()
  return r.y + r.height / 2
}

function Rail({
  orientation,
  markOffset,
}: {
  orientation: 'vertical' | 'horizontal'
  /** a first line taller than one line of text, as a page with room says */
  markOffset?: number
}) {
  const upright = orientation === 'vertical'
  return (
    <UiProvider scheme="light">
      <div style={{ width: 400 }}>
        <Timeline
          orientation={orientation}
          value={2}
          {...(markOffset === undefined ? {} : { markOffset })}
        >
          {[1, 2, 3].map((n) => (
            <TimelineItem key={n} step={n} xstyle={upright ? undefined : caller.card}>
              <TimelineIndicator />
              <TimelineSeparator xstyle={upright ? caller.railUpright : caller.railAcross} />
              <TimelineTitle>stage {n}</TimelineTitle>
            </TimelineItem>
          ))}
        </Timeline>
      </div>
    </UiProvider>
  )
}

const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

describe('a timeline running down the page', () => {
  it('sits every mark on the rail it belongs to', async () => {
    render(<Rail orientation="vertical" />)
    await settle()
    const marks = document.querySelectorAll('[data-slot="timeline-indicator"]')
    const rails = document.querySelectorAll('[data-slot="timeline-separator"]')
    expect(marks).toHaveLength(3)
    for (const rail of [rails[0]!, rails[1]!]) {
      expect(centreX(rail)).toBeCloseTo(centreX(marks[0]!), 1)
    }
  })

  // The rail is as far from the event above it as from the one below. It is
  // worth measuring at an offset the caller chose, because that is where it
  // went wrong: the mark moved and the rail's two ends did not move with it.
  it.each([undefined, 10, 24])('leaves equal room at both ends (offset %s)', async (offset) => {
    render(
      <Rail orientation="vertical" {...(offset === undefined ? {} : { markOffset: offset })} />,
    )
    await settle()
    const marks = document.querySelectorAll('[data-slot="timeline-indicator"]')
    const rail = document.querySelector('[data-slot="timeline-separator"]')!
    const box = rail.getBoundingClientRect()
    const above = box.y - marks[0]!.getBoundingClientRect().bottom
    const below = marks[1]!.getBoundingClientRect().y - box.bottom
    expect(above).toBeCloseTo(below, 1)
    expect(above).toBeGreaterThan(0)
  })

  it('moves the mark and its rail together', async () => {
    render(<Rail orientation="vertical" markOffset={24} />)
    await settle()
    const mark = document.querySelector('[data-slot="timeline-indicator"]')!
    const rail = document.querySelector('[data-slot="timeline-separator"]')!
    expect(centreX(mark)).toBeCloseTo(centreX(rail), 1)
    expect(centreY(mark)).toBeCloseTo(mark.parentElement!.getBoundingClientRect().y + 24, 1)
    expect(rail.getBoundingClientRect().y).toBeGreaterThan(mark.getBoundingClientRect().bottom)
  })

  it('draws no rail past the last event', async () => {
    render(<Rail orientation="vertical" />)
    await settle()
    const rails = document.querySelectorAll('[data-slot="timeline-separator"]')
    expect(getComputedStyle(rails[0]!).display).not.toBe('none')
    expect(getComputedStyle(rails[2]!).display).toBe('none')
  })
})

describe('the same timeline on its side', () => {
  it('runs the rail from one mark to the next', async () => {
    render(<Rail orientation="horizontal" />)
    await settle()
    const marks = document.querySelectorAll('[data-slot="timeline-indicator"]')
    const rail = document.querySelector('[data-slot="timeline-separator"]')!
    const box = rail.getBoundingClientRect()
    // long enough to read as a rail, and thin enough to read as a hairline
    expect(box.width).toBeGreaterThan(150)
    expect(box.height).toBeLessThanOrEqual(2)
    // it starts inside the first mark and stops before the second
    expect(box.x).toBeGreaterThan(marks[0]!.getBoundingClientRect().x)
    expect(box.right).toBeLessThanOrEqual(marks[1]!.getBoundingClientRect().x + 1)
    expect(centreY(rail)).toBeCloseTo(centreY(marks[0]!), 1)
  })
})
