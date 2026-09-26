'use client'

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
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

/** how long a line may be down before the mark says so */
const GRACE_MS = 5_000

/**
 * The state to show for a connection flag that may flap.
 *
 * `null` in, nothing out: the screen does not follow, or no longer needs
 * to. Until the line has carried anything there is nothing to say either -
 * a mark that starts on "reconnecting" has never been live. After that,
 * "reconnecting" only once the line has been down past a grace longer than
 * a planned redial and its handshake take: a stream a proxy recycles every
 * minute comes straight back, and saying so each time would be noise.
 */
export function useLiveState(live: boolean | null): LiveState | null {
  const [heard, setHeard] = useState(false)
  const [lost, setLost] = useState(false)
  if (live === true && !heard) setHeard(true)
  if (live === true && lost) setLost(false)
  useEffect(() => {
    if (live !== false || !heard) return
    const timer = setTimeout(() => setLost(true), GRACE_MS)
    return () => clearTimeout(timer)
  }, [live, heard])
  if (live === null || !heard) return null
  return live || !lost ? 'live' : 'reconnecting'
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
