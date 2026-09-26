'use client'

import type { ComponentProps, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'

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

export type LiveState = 'live' | 'reconnecting'

/**
 * What a screen that follows a stream knows of its line, in the shape the
 * web runtime's `useApiStream` answers with.
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
}

/**
 * The state to show for a screen's line.
 *
 * Every rule is the stream's, since only it knows when it dialled, how long
 * a connection lived and whether anything ever arrived: a connection that
 * failed or ended before it proved steady, or a dial left unanswered past
 * its allowance, is lost; the planned re-dial after one that lasted is not;
 * and a line that has never carried a word is not reconnecting, it was
 * never live. `null` in, nothing out: the screen does not follow, or its
 * subject no longer moves.
 */
export function liveStateOf(line: LiveLine | null): LiveState | null {
  if (line === null || !line.heard) return null
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
  children,
  ...props
}: Omit<ComponentProps<'span'>, 'className' | 'style' | 'children'> & {
  state: LiveState
  /** what the state is called */
  children: ReactNode
}) {
  return (
    // a status, so a reader who cannot see it hears the line come and go
    <span
      role="status"
      data-state={state}
      {...props}
      {...stylex.props(styles.mark, state === 'reconnecting' && styles.lost)}
    >
      <span aria-hidden {...stylex.props(styles.dot, state === 'reconnecting' && styles.dotLost)} />
      {children}
    </span>
  )
}
