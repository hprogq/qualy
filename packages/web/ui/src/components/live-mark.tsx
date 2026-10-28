'use client'

import type { ComponentProps, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'
import { VisuallyHidden } from '../lib/visually-hidden.tsx'

// The mark that says a screen is keeping time with something that moves
// while it is read - a round being reviewed, an account being scored - and
// that it has lost the line when it has.
//
// Only where the screen really follows along. A screen that polls, or whose
// subject no longer moves, draws no mark at all: saying "live" there, or
// "provisional" in its place, would promise changes nobody sends.
//
// Text-free like the rest of this package: the caller says the words for
// each state.

export type LiveState = 'live' | 'reconnecting' | 'waiting'

/**
 * What a screen that follows a channel knows of its line, in the shape the
 * web runtime's `useLiveChannel` answers with.
 */
export interface LiveLine {
  /** a word has arrived on the connection open now */
  readonly live: boolean
  /**
   * the line is down for real, rather than between a connection that lasted
   * and its planned re-dial
   */
  readonly lost: boolean
  /** the line has carried a word since the screen opened it */
  readonly heard: boolean
  /** every seat on the server is taken, and the line is waiting for one */
  readonly waiting: boolean
}

/**
 * The state to show for a screen's line.
 *
 * Every rule is the channel's, since only it knows when it dialled, how long
 * a connection lived and whether anything ever arrived: a connection that
 * failed or ended before it proved steady, or a dial left unanswered past
 * its allowance, is lost; the planned renewal after one that lasted is not;
 * and a line that has never carried a word is not reconnecting, it was
 * never live. A line waiting for a seat says so whether or not it was ever
 * live: the reader may be holding the others open in tabs of their own.
 * `null` in, nothing out: the screen does not follow, or its subject no
 * longer moves.
 */
export function liveStateOf(line: LiveLine | null): LiveState | null {
  if (line === null) return null
  if (line.waiting) return 'waiting'
  if (!line.heard) return null
  return line.live || !line.lost ? 'live' : 'reconnecting'
}

const breathe = stylex.keyframes({
  '0%': { opacity: 0.7, transform: 'scale(0.6)' },
  '70%, 100%': { opacity: 0, transform: 'scale(1.6)' },
})

const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  mark: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 22,
    borderRadius: 6,
    backgroundColor: `color-mix(in oklab, ${tokens.success} 12%, transparent)`,
    paddingInline: 8,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.successForeground,
  },
  lost: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
  dot: {
    position: 'relative',
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 9999,
    backgroundColor: tokens.success,
    // a slow ring that says the line is open; still where motion is not wanted
    '::after': {
      content: '""',
      position: 'absolute',
      inset: -3,
      borderRadius: 9999,
      backgroundColor: `color-mix(in oklab, ${tokens.success} 45%, transparent)`,
      opacity: 0,
      animationName: { default: breathe, [REDUCE]: 'none' },
      animationDuration: '2.4s',
      animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
      animationIterationCount: 'infinite',
    },
  },
  dotLost: {
    backgroundColor: tokens.warning,
    '::after': { animationName: 'none' },
  },
})

export function LiveMark({
  state,
  hint,
  children,
  ...props
}: Omit<ComponentProps<'span'>, 'className' | 'style' | 'children'> & {
  state: LiveState
  /** what the state is called */
  children: ReactNode
  /**
   * A line more about the state, for whoever looks closer: shown on hover
   * and focus, and read with the state. Never a step the reader must take.
   */
  hint?: ReactNode
}) {
  const down = state !== 'live'
  const mark = (
    // a status, so a reader who cannot see it hears the line come and go
    <span
      role="status"
      data-state={state}
      {...(hint === undefined ? {} : { tabIndex: 0 })}
      {...props}
      {...stylex.props(styles.mark, down && styles.lost)}
    >
      <span aria-hidden {...stylex.props(styles.dot, down && styles.dotLost)} />
      {children}
      {hint !== undefined && <VisuallyHidden>{hint}</VisuallyHidden>}
    </span>
  )
  if (hint === undefined) return mark
  return (
    <Tooltip>
      <TooltipTrigger asChild>{mark}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
