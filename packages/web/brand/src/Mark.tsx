import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { markGeometry } from './geometry.ts'
import { seatOf } from './seat.ts'

// The static mark: the ring and its tail in one colour, the ink of whatever
// surrounds it. Decorative unless it is given a name.

const geometry = markGeometry()

const styles = stylex.create({
  mark: {
    flexShrink: 0,
  },
})

export interface MarkProps {
  /** edge of the square canvas in CSS pixels; the ring spans three quarters of it */
  size?: number
  /** the accessible name; without one the mark is hidden from assistive technology */
  title?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

export function Mark({ size = 24, title, xstyle, className, style }: MarkProps) {
  return (
    <svg
      viewBox={geometry.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      {...seatOf(stylex.props(styles.mark, xstyle), className, style)}
    >
      {title === undefined ? null : <title>{title}</title>}
      <path d={geometry.ring} />
      <path d={geometry.piece} />
    </svg>
  )
}
