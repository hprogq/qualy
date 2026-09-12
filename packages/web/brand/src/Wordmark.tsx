import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { fixed, wordmarkLayout } from './geometry.ts'
import { delayed, loopStyles } from './keyframes.ts'
import { seatOf } from './seat.ts'
import { SegmentedQ, WholeQ } from './segments.tsx'

// The wordmark: the mark standing as the Q, then u a l y built from the
// same round bands and straight stems. A drawing, not text - no font is
// involved - in the ink of whatever surrounds it. `height` is the cap
// height in CSS pixels, the number a bar reasons about; the drawing itself
// is a little taller, because the ring overshoots the cap line and the y
// descends. `live` swaps the Q's one-piece ring for its eight parts and
// sets the dark loop going on them after 400ms, the letters standing
// still; the swap is the same shape in the same ink, so nothing shows.

const layout = wordmarkLayout(16)
const [, , boxWidth = 0, boxHeight = 0] = layout.viewBox.split(' ').map(Number)

const styles = stylex.create({
  wordmark: {
    flexShrink: 0,
  },
})

export interface WordmarkProps
  extends Omit<React.ComponentProps<'svg'>, 'className' | 'style' | 'children' | 'title'> {
  /** cap height in CSS pixels */
  height?: number
  /** the Q's parts carry the loading loop, from 400ms in */
  live?: boolean
  /** the accessible name; without one the wordmark is hidden from assistive technology */
  title?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

export function Wordmark({
  height = 16,
  live = false,
  title,
  xstyle,
  className,
  style,
  ...rest
}: WordmarkProps) {
  const scale = height / layout.cap
  return (
    <svg
      viewBox={layout.viewBox}
      width={fixed(boxWidth * scale)}
      height={fixed(boxHeight * scale)}
      fill="currentColor"
      data-live={live ? '' : undefined}
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      {...rest}
      {...seatOf(stylex.props(styles.wordmark, xstyle), className, style)}
    >
      {title === undefined ? null : <title>{title}</title>}
      {live ? (
        <SegmentedQ
          paths={layout.segments}
          propsFor={(k) => stylex.props(loopStyles.dark[k], delayed)}
        />
      ) : (
        <WholeQ band={layout.band} tail={layout.segments[0]!} />
      )}
      {layout.letters.map((letter) => (
        <path key={letter.char} data-letter={letter.char} d={letter.d} />
      ))}
    </svg>
  )
}
