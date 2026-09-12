import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { markPaths } from './geometry.ts'
import { loopStyles, type Polarity } from './keyframes.ts'
import { seatOf } from './seat.ts'
import { SegmentedQ } from './segments.tsx'

// Work in progress, drawn as the mark with its light going round.
//
// Needs nothing: a bare SVG, compiled keyframes and the ink of whatever
// names it, because the first places it renders stand outside every
// provider. Nothing moves: the eight parts each change only their opacity
// as the head passes, and the tail leans a little towards the gap as it
// arrives. Two polarities of the same motion: light, where the ring is
// faint and a head of ink goes round it, for the small inline indicator;
// dark, where the ring is solid and a head of shadow goes round it, for
// anything larger. A reader who has asked for reduced motion sees the
// still mark with the tail breathing slowly, decided in CSS.

const paths = markPaths(16)

const styles = stylex.create({
  canvas: {
    flexShrink: 0,
  },
})

export interface LoaderProps extends Omit<
  React.ComponentProps<'svg'>,
  'className' | 'style' | 'children' | 'title'
> {
  /** edge of the square canvas in CSS pixels; the ring spans three quarters of it */
  size?: number
  /** light at 24px and below, dark above, unless told otherwise */
  polarity?: Polarity
  /** the accessible name; without one, or a label or role from the caller, the drawing is hidden */
  title?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

export function Loader({
  size = 16,
  polarity = size <= 24 ? 'light' : 'dark',
  title,
  xstyle,
  className,
  style,
  ...rest
}: LoaderProps) {
  const exposed =
    title !== undefined ||
    rest.role !== undefined ||
    rest['aria-label'] !== undefined ||
    rest['aria-labelledby'] !== undefined
  const loop = loopStyles[polarity]
  return (
    <svg
      viewBox={paths.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      data-polarity={polarity}
      {...(exposed ? {} : { 'aria-hidden': true })}
      {...(title === undefined ? {} : { role: 'img' })}
      {...rest}
      {...seatOf(stylex.props(styles.canvas, xstyle), className, style)}
    >
      {title === undefined ? null : <title>{title}</title>}
      <SegmentedQ paths={paths.segments} propsFor={(k) => stylex.props(loop[k])} />
    </svg>
  )
}
