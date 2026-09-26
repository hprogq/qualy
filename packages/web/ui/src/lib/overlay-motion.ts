import type { MantineTransition } from '@mantine/core'

// How a panel anchored to a trigger arrives and leaves: a select's list, a
// menu, a popover, a hover card, a calendar.
//
// It fades while travelling a few pixels out of its trigger, and it is never
// scaled. The widget's own `pop` did both things this product avoids: it grew
// the panel from ninety percent, which WebKit draws soft until the last frame,
// and it rose from below - so a list opening under its trigger came up from
// further down the page, away from what was pressed.
//
// The direction is not decided here. Placement can flip a panel to the other
// side of its trigger once it has been measured, and the widget writes the
// side it landed on as `data-position`; the stylesheet turns that into the
// offset read below (theme.css), so a flipped panel still leaves its trigger.
// A reader who asked for less motion gets none: the theme's
// respectReducedMotion takes the durations to zero.

// the offset a panel travels in from, toward its trigger; theme.css states
// the same distance for each side a panel can land on
const DROP_DISTANCE = 4

const drop: MantineTransition = {
  in: { opacity: 1, transform: 'none' },
  out: {
    opacity: 0,
    transform: `translate(var(--q-drop-x, 0px), var(--q-drop-y, -${DROP_DISTANCE}px))`,
  },
  transitionProperty: 'opacity, transform',
}

/**
 * The transition every anchored panel hands the widget. Short on the way in,
 * shorter on the way out, on the curve the dialogs enter on.
 */
export const dropIn = {
  transition: drop,
  duration: 120,
  exitDuration: 80,
  timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const
