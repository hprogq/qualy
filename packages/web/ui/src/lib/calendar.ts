import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'

/**
 * The class a calendar day is drawn with; its rules are in ./calendar.css,
 * which the package stylesheet pulls in.
 *
 * They are plain CSS because they hang off state the WIDGET owns:
 * `data-in-range` is not only the value that has been committed - while a
 * start is chosen and the pointer is looking for an end, the library
 * recomputes the whole span on every hover and says so through these same
 * attributes. Restating that machine in React to satisfy a compiled style
 * would mean keeping a second copy of one that already works.
 */
export const CALENDAR_DAY = 'q-calendar-day'

const styles = stylex.create({
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
 * There is one calendar here, shown by two controls: a span picker and a
 * single instant. They were drifting apart - one drew circles on a
 * continuous track, the other kept the library's rounded squares and its red
 * weekends - which reads as two products in one form.
 */
export const calendarLook = {
  // no gap between the cells: the seam is what broke a continuous span into
  // a row of separate boxes
  withCellSpacing: false,
  // stated rather than inherited: the widget hides them only when it shows
  // two months, and the phone would otherwise get a different grid
  hideOutsideDates: true,
  classNames: {
    day: CALENDAR_DAY,
    calendarHeaderLevel: stylex.props(styles.monthLabel).className,
    weekday: stylex.props(styles.weekday).className,
  },
} as const
