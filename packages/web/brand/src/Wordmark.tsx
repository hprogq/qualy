import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { fixed, markGeometry } from './geometry.ts'
import { seatOf } from './seat.ts'
import { wordmark } from './wordmark-paths.ts'

// The wordmark: the mark standing as the Q, then u a l y as frozen outlines.
// A drawing, not text - no font is loaded and nothing is laid out - in the
// ink of whatever surrounds it. `height` is the cap height in CSS pixels,
// the number a bar reasons about; the drawing itself is a little taller,
// because the ring overshoots the cap line and the l rises above it.

const [, , boxWidth = 0, boxHeight = 0] = wordmark.viewBox.split(' ').map(Number)

const ring = markGeometry({ s: wordmark.s, center: wordmark.ringCenter })

const styles = stylex.create({
  wordmark: {
    flexShrink: 0,
  },
})

export interface WordmarkProps {
  /** cap height in CSS pixels */
  height?: number
  /** the accessible name; without one the wordmark is hidden from assistive technology */
  title?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

export function Wordmark({ height = 16, title, xstyle, className, style }: WordmarkProps) {
  const scale = height / wordmark.capHeight
  return (
    <svg
      viewBox={wordmark.viewBox}
      width={fixed(boxWidth * scale)}
      height={fixed(boxHeight * scale)}
      fill="currentColor"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      {...seatOf(stylex.props(styles.wordmark, xstyle), className, style)}
    >
      {title === undefined ? null : <title>{title}</title>}
      <path d={ring.ring} />
      <path d={ring.piece} />
      {wordmark.letters.map((letter) => (
        <path key={letter.char} d={letter.d} />
      ))}
    </svg>
  )
}
