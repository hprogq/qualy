import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'

/**
 * How a calendar day is drawn.
 *
 * WHO OWNS WHAT. The widget owns the range itself - which days are selected,
 * which are inside the span, which end it, and the preview it keeps while a
 * second end is being hunted for - and says so through the day's own data
 * attributes. This file owns how that reads: geometry, colour and motion.
 * The compiled styles below are conditioned on those attributes directly, so
 * nothing here recomputes a range or reaches for a `.mantine-*` selector.
 *
 * WHERE A TRACK CLOSES is not asked of the DOM. A control that draws a span
 * hands each day `data-track-cap-start` / `data-track-cap-end`, meaning only
 * "the run stops at this edge" - never why. The reasons (the span's own end,
 * a row that wraps, a panel that ends) stay in the control, and this file
 * never has to know a week from a month.
 */

// Monday. Stated rather than inherited, because a control that marks where a
// row breaks and the grid that breaks it have to agree on where a row starts.
export const FIRST_DAY_OF_WEEK = 1

const mix = (percent: number) => `color-mix(in oklab, ${tokens.primary} ${percent}%, transparent)`
const trackLine = mix(45)

const styles = stylex.create({
  day: {
    position: 'relative',
    isolation: 'isolate',
    backgroundColor: 'transparent',
    borderRadius: 9999,
    // The widget dims an outside day with opacity on the element, which
    // takes the track and the circle down with it - a span crossing into the
    // next month turned grey halfway. Not this month is a fact about the
    // number, so only the number says it.
    opacity: { default: 1, '[data-disabled]': 0.5 },
    // The ink, in cases that cannot both be true at once. Conditions of equal
    // weight are decided by the order the sheet ends up in, and that order is
    // not the order written here: two conditions that ask for the SAME value
    // are emitted as one rule, which moves them both. Measured, not assumed -
    // an outside day that was also the chosen end kept the muted ink.
    // The plain default is enough to answer the widget's red weekend: the
    // compiled styles sit in a layer above it, so specificity never enters.
    color: {
      default: tokens.foreground,
      '[data-outside]:not([data-selected]):not([data-preview-end])': tokens.mutedForeground,
      // the widget drops selected and in-range from a day that cannot be
      // chosen, so this cannot collide with either
      '[data-disabled]': tokens.mutedForeground,
      '[data-selected]': tokens.primaryForeground,
      '[data-in-range][data-preview-end]': tokens.primaryForeground,
    },
    transitionProperty: 'color',
    // the ink turns faster than the ground under it, or the two pass through
    // each other's grey and the number is unreadable halfway
    transitionDuration: { default: '90ms', '@media (prefers-reduced-motion: reduce)': '0s' },
    transitionTimingFunction: 'ease-out',

    // The track. It exists only inside a span, runs the whole cell by
    // default, and pulls in to the circle's edge wherever the run stops.
    '::before': {
      content: '',
      position: 'absolute',
      display: {
        default: 'none',
        '[data-in-range]': 'block',
        // a span of one day is a day: the circle says all of it
        '[data-first-in-range][data-last-in-range]': 'none',
      },
      insetBlock: 3,
      insetInlineStart: { default: 0, '[data-track-cap-start]': 3 },
      insetInlineEnd: { default: 0, '[data-track-cap-end]': 3 },
      zIndex: -1,
      backgroundColor: mix(9),
      // stated as longhands, colour included: written as the `borderBlock`
      // shorthand the colour never arrived and the rule fell back to
      // currentColor, so the track turned grey under an outside day's muted
      // number - measured on a span crossing into the next month
      borderBlockStyle: 'solid',
      borderBlockWidth: 1,
      borderBlockColor: trackLine,
      borderInlineStyle: 'solid',
      borderInlineColor: trackLine,
      // a side is absent, not transparent: a see-through border still mitres,
      // and the rule along the top ran into the corner as a diagonal
      borderInlineStartWidth: { default: 0, '[data-track-cap-start]': 1 },
      borderInlineEndWidth: { default: 0, '[data-track-cap-end]': 1 },
      borderStartStartRadius: { default: 0, '[data-track-cap-start]': 9999 },
      borderEndStartRadius: { default: 0, '[data-track-cap-start]': 9999 },
      borderStartEndRadius: { default: 0, '[data-track-cap-end]': 9999 },
      borderEndEndRadius: { default: 0, '[data-track-cap-end]': 9999 },
      // no transition: following the pointer is the track's whole job, and a
      // span that eased its way longer would lag behind the hand
    },

    // The circle. Its own element at a fixed size, so a day is a circle at
    // every moment and at every state; it is shorter than the cell, which is
    // what leaves the air between two rows while the cell stays the whole
    // hit target. The states are mutually exclusive rather than a stack that
    // has to out-specify itself.
    '::after': {
      content: '',
      position: 'absolute',
      insetBlockStart: '50%',
      insetInlineStart: '50%',
      height: 'calc(100% - 6px)',
      aspectRatio: 1,
      translate: '-50% -50%',
      zIndex: -1,
      borderRadius: 9999,
      backgroundColor: {
        default: 'transparent',
        ':not([data-disabled]):not([data-selected]):not([data-in-range]):hover': mix(10),
        '[data-in-range]:not([data-selected]):not([data-preview-end]):hover': mix(18),
        '[data-in-range][data-preview-end]': tokens.primary,
        '[data-selected]': tokens.primary,
      },
      transitionProperty: 'background-color',
      transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0s' },
      transitionTimingFunction: 'ease-out',
    },
  },
  // the month a panel is showing is a caption, not a headline
  monthLabel: {
    fontWeight: 500,
    fontSize: 14,
  },
  weekday: {
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
})

/**
 * What makes a calendar in this product look like the other calendars in it.
 *
 * Look only: which days a panel renders is a layout decision each control
 * makes for itself, and a control that draws spans has to make the same
 * decision twice - once for the widget and once for its own marks.
 */
export const calendarLook = {
  // no gap between the cells: the seam is what broke a continuous span into
  // a row of separate boxes
  withCellSpacing: false,
  classNames: {
    day: stylex.props(styles.day).className,
    calendarHeaderLevel: stylex.props(styles.monthLabel).className,
    weekday: stylex.props(styles.weekday).className,
  },
} as const
