'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// Events in the order they happen: a rail, a marker per event, and whatever
// each event has to say.
//
// The shape is reui's timeline (reui.io/r/timeline), with its render-prop
// polymorphism left out - nothing here needs to become another element.
//
// Which events are behind the reader is stated rather than counted: the
// caller sets `value` to the step it has reached, and every item at or below
// it draws as done. That is the whole of the state; a timeline knows nothing
// about what its events are.
//
// Which way it runs is passed down rather than read back up. Every part of
// this changes shape with the orientation, and the orientation lives on the
// root - so the root tells its parts, and none of them has to ask the DOM
// what they are inside of.

interface TimelineContextValue {
  activeStep: number
  upright: boolean
  markOffset: number
}

const TimelineContext = React.createContext<TimelineContextValue | undefined>(undefined)

const useTimeline = () => {
  const context = React.use(TimelineContext)
  if (!context) throw new Error('useTimeline must be used within a Timeline')
  return context
}

const styles = stylex.create({
  root: { display: 'flex' },
  rootUpright: { flexDirection: 'column' },
  rootAcross: { width: '100%', flexDirection: 'row' },
  item: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
    // the rail runs from one event to the next, so the last one has none: an
    // item says whether it is the last, and the rail inside it reads that
    '--q-timeline-rail': { default: 'block', ':last-child': 'none' },
  },
  itemUpright: {
    marginInlineStart: 32,
    paddingBottom: { default: 24, ':last-child': 0 },
  },
  itemAcross: {
    marginTop: 32,
    paddingInlineEnd: { default: 32, ':last-child': 0 },
  },
  date: {
    marginBottom: 4,
    display: 'block',
    fontSize: 12,
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // a date that wraps in a narrow upright rail still leaves its item the same
  // height as its neighbours
  dateUpright: { height: { default: null, '@media (max-width: 639.98px)': 16 } },
  title: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  content: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  marker: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 9999,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.primary} 20%, transparent)`,
  },
  markerDone: { borderColor: tokens.primary },
  // Where the mark sits ACROSS the rail is this component's own business, and
  // it is stated with `translate` rather than `transform` on purpose: a
  // caller nudging the mark writes `transform`, and the two properties
  // compose instead of one silently replacing the other. A percentage keeps
  // it centred at whatever size the caller gives it. How far ALONG the rail
  // it sits is `markOffset`, below.
  markerUpright: { insetInlineStart: -24 },
  markerAcross: { insetBlockStart: -24 },
  rail: {
    display: 'var(--q-timeline-rail, block)',
    position: 'absolute',
    alignSelf: 'flex-start',
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 10%, transparent)`,
  },
  railDone: { backgroundColor: tokens.primary },
  // The rail's thickness is the cross axis, which is a different property in
  // each direction - so a caller drawing a hairline has to say which rail it
  // is drawing.
  //
  // Its length is the gap between two marks less the mark itself: whatever
  // `markOffset` is, the rail leaves the same 2px above it as below, because
  // both ends are measured from the mark rather than from the item.
  railUpright: { height: 'calc(100% - 1rem - 0.25rem)', width: 2, insetInlineStart: -24 },
  railAcross: {
    insetBlockStart: -24,
    height: 2,
    width: 'calc(100% - 1rem - 0.25rem)',
  },
})

// How far along the rail a mark sits, and where the rail therefore starts.
//
// A mark is centred on the item's first line by default. A caller whose first
// line is taller says so once, on the timeline, and the rail moves with the
// mark - the two used to be told separately, and a mark nudged two pixels
// left the rail four pixels closer to the event above than to the one below.
const along = stylex.create({
  markUpright: (offset: number) => ({ insetBlockStart: offset, translate: '-50% -50%' }),
  markAcross: (offset: number) => ({ insetInlineStart: offset, translate: '-50% -50%' }),
  railUpright: (offset: number) => ({ translate: `-50% ${String(offset + 10)}px` }),
  railAcross: (offset: number) => ({ translate: `${String(offset + 10)}px -50%` }),
})

/** what an item tells the parts inside it */
const ItemContext = React.createContext({ done: false, nextDone: false })

interface Seat {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  className?: string
}

function Timeline({
  value = 1,
  orientation = 'vertical',
  markOffset = 8,
  className,
  xstyle,
  children,
  ...props
}: React.ComponentProps<'div'> &
  Seat & {
    /** the step the reader has got to; everything up to it draws as done */
    value?: number
    orientation?: 'horizontal' | 'vertical'
    /**
     * how far from the leading edge of an item its mark's centre sits; the
     * default centres it on a single line of text. The rail follows.
     */
    markOffset?: number
  }) {
  const upright = orientation === 'vertical'
  const held = React.useMemo(
    () => ({ activeStep: value, upright, markOffset }),
    [value, upright, markOffset],
  )
  return (
    <TimelineContext value={held}>
      <div
        data-slot="timeline"
        data-orientation={orientation}
        {...props}
        {...seatOf(
          stylex.props(styles.root, upright ? styles.rootUpright : styles.rootAcross, xstyle),
          className,
        )}
      >
        {children}
      </div>
    </TimelineContext>
  )
}

function TimelineItem({
  step,
  className,
  xstyle,
  children,
  ...props
}: React.ComponentProps<'div'> & Seat & { step: number }) {
  const { activeStep, upright } = useTimeline()
  const done = step <= activeStep
  const place = React.useMemo(
    () => ({ done, nextDone: step + 1 <= activeStep }),
    [done, step, activeStep],
  )
  return (
    <div
      data-slot="timeline-item"
      data-completed={done || undefined}
      {...props}
      {...seatOf(
        stylex.props(styles.item, upright ? styles.itemUpright : styles.itemAcross, xstyle),
        className,
      )}
    >
      <ItemContext value={place}>{children}</ItemContext>
    </div>
  )
}

function TimelineHeader({ className, xstyle, ...props }: React.ComponentProps<'div'> & Seat) {
  return <div data-slot="timeline-header" {...props} {...seatOf(stylex.props(xstyle), className)} />
}

function TimelineDate({ className, xstyle, ...props }: React.ComponentProps<'time'> & Seat) {
  const { upright } = useTimeline()
  return (
    <time
      data-slot="timeline-date"
      {...props}
      {...seatOf(stylex.props(styles.date, upright && styles.dateUpright, xstyle), className)}
    />
  )
}

function TimelineTitle({ className, xstyle, ...props }: React.ComponentProps<'h3'> & Seat) {
  return (
    <h3
      data-slot="timeline-title"
      {...props}
      {...seatOf(stylex.props(styles.title, xstyle), className)}
    />
  )
}

function TimelineContent({ className, xstyle, ...props }: React.ComponentProps<'div'> & Seat) {
  return (
    <div
      data-slot="timeline-content"
      {...props}
      {...seatOf(stylex.props(styles.content, xstyle), className)}
    />
  )
}

function TimelineIndicator({ className, xstyle, ...props }: React.ComponentProps<'div'> & Seat) {
  const { upright, markOffset } = useTimeline()
  const { done } = React.use(ItemContext)
  return (
    <div
      aria-hidden
      data-slot="timeline-indicator"
      {...props}
      {...seatOf(
        stylex.props(
          styles.marker,
          done && styles.markerDone,
          upright ? styles.markerUpright : styles.markerAcross,
          upright ? along.markUpright(markOffset) : along.markAcross(markOffset),
          xstyle,
        ),
        className,
      )}
    />
  )
}

function TimelineSeparator({ className, xstyle, ...props }: React.ComponentProps<'div'> & Seat) {
  const { upright, markOffset } = useTimeline()
  // the rail to the next event is drawn as reached once that event is
  const { nextDone } = React.use(ItemContext)
  return (
    <div
      aria-hidden
      data-slot="timeline-separator"
      {...props}
      {...seatOf(
        stylex.props(
          styles.rail,
          nextDone && styles.railDone,
          upright ? styles.railUpright : styles.railAcross,
          upright ? along.railUpright(markOffset) : along.railAcross(markOffset),
          xstyle,
        ),
        className,
      )}
    />
  )
}

export {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
}
