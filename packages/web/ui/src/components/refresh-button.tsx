'use client'

import { useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { RotateCwIcon } from 'lucide-react'

import { tokens } from '../theme/tokens.stylex.ts'
import { VisuallyHidden } from '../lib/visually-hidden.tsx'
import { Button } from './button.tsx'

// The key that asks a screen's reads again by hand.
//
// It answers the reader's own press and nothing else. A screen that keeps
// time with something refreshes in the background all the time - a wake-up,
// the catch-up after its line opens, a timer - and a key that turned for
// each of those turned as the page loaded, for nobody. That the page follows
// along is the live mark's to say.
//
// The key rests while its reads are out, as it always has. The turn they
// start is finished: the icon stops where it started, at the end of the turn
// in which the reads came back, rather than snapping back from wherever it
// had got to - and a press after they came back, while that turn is still
// ending, simply keeps it going.
//
// Where the reader asks for less motion there is no turn, and the press is
// still answered: the icon dims while the reads are out, for long enough to
// be seen even when they come back at once.
//
// Text-free like the rest of this package: the caller names it.

const turn = stylex.keyframes({ '100%': { transform: 'rotate(360deg)' } })

const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  key: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  icon: { width: 15, height: 15 },
  turning: {
    animationName: { default: turn, [REDUCE]: 'none' },
    opacity: { default: null, [REDUCE]: 0.4 },
    animationDuration: '0.8s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    animationIterationCount: 'infinite',
  },
})

/** how long a press is answered for at least, where nothing turns */
const STILL_ANSWER_MS = 600

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function RefreshButton({
  label,
  onRefresh,
  ...props
}: {
  /** what the key does, said to whoever cannot see the icon */
  label: string
  /** asks again; the turn ends with the first turn after it settles */
  onRefresh: () => Promise<unknown> | void
  'data-testid'?: string
}) {
  const [asking, setAsking] = useState(false)
  const [turning, setTurning] = useState(false)
  const settled = useRef(true)

  const press = () => {
    settled.current = false
    setAsking(true)
    setTurning(true)
    const seen = new Promise((resolve) => setTimeout(resolve, STILL_ANSWER_MS))
    void Promise.resolve()
      .then(onRefresh)
      .catch(() => undefined)
      .finally(() => {
        settled.current = true
        setAsking(false)
        // without motion there is no turn to end on; the dimmed icon is
        // answer enough once it has been seen
        if (reducedMotion()) void seen.then(() => settled.current && setTurning(false))
      })
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={asking}
      onClick={press}
      className={stylex.props(styles.key).className}
      {...props}
    >
      <RotateCwIcon
        aria-hidden
        onAnimationIteration={() => {
          if (settled.current) setTurning(false)
        }}
        {...stylex.props(styles.icon, turning && styles.turning)}
      />
      <VisuallyHidden>{label}</VisuallyHidden>
    </Button>
  )
}
