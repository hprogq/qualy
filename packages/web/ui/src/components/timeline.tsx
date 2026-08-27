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
  markerUpright: { insetBlockStart: 0, insetInlineStart: -24, transform: 'translateX(-50%)' },
  markerAcross: { insetBlockStart: -24, insetInlineStart: 0, transform: 'translateY(-50%)' },
  rail: {
    display: 'var(--q-timeline-rail, block)',
    position: 'absolute',
    alignSelf: 'flex-start',
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 10%, transparent)`,
  },
  railDone: { backgroundColor: tokens.primary },
  railUpright: {
    height: 'calc(100% - 1rem - 0.25rem)',
    width: 2,
    insetInlineStart: -24,
    transform: 'translate(-50%, 18px)',
  },
  railAcross: {
    insetBlockStart: -24,
    height: 2,
    width: 'calc(100% - 1rem - 0.25rem)',
    transform: 'translate(18px, -50%)',
  },
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
  className,
  xstyle,
  children,
  ...props
}: React.ComponentProps<'div'> &
  Seat & {
    /** the step the reader has got to; everything up to it draws as done */
    value?: number
    orientation?: 'horizontal' | 'vertical'
  }) {
  const upright = orientation === 'vertical'
  const held = React.useMemo(() => ({ activeStep: value, upright }), [value, upright])
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
  const { upright } = useTimeline()
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
          xstyle,
        ),
        className,
      )}
    />
  )
}

function TimelineSeparator({ className, xstyle, ...props }: React.ComponentProps<'div'> & Seat) {
  const { upright } = useTimeline()
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
