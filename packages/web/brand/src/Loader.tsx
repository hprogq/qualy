import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { markGeometry } from './geometry.ts'
import { seatOf } from './seat.ts'

// Work in progress, drawn as the mark's own part going round its track.
//
// Needs nothing: a bare SVG, a compiled keyframe and the ink of whatever
// names it, because the first places it renders stand outside every
// provider. The track is the full ring at 18% of that ink; the moving part
// is the segment the static mark shows slid out, here at home in the gap
// and carried round the centre once every 1.2s. The canvas is the 8s square
// around that centre, which is what makes 50% 50% the right origin.
//
// A reader who has asked for reduced motion gets the static mark in its
// place, and the track and the moving part are not drawn at all - decided
// in CSS, so nothing moves before a script could have stopped it.

const geometry = markGeometry()

const orbit = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
})

const styles = stylex.create({
  canvas: {
    flexShrink: 0,
  },
  moving: {
    display: {
      default: 'inline',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  track: {
    fill: 'color-mix(in oklab, currentColor 18%, transparent)',
  },
  orbit: {
    transformBox: 'view-box',
    transformOrigin: '50% 50%',
    animationName: orbit,
    animationDuration: '1.2s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  still: {
    display: {
      default: 'none',
      '@media (prefers-reduced-motion: reduce)': 'inline',
    },
  },
})

export interface LoaderProps extends Omit<
  React.ComponentProps<'svg'>,
  'className' | 'style' | 'children' | 'title'
> {
  /** edge of the square canvas in CSS pixels; the ring spans three quarters of it */
  size?: number
  /** the accessible name; without one, or a label or role from the caller, the drawing is hidden */
  title?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

export function Loader({ size = 16, title, xstyle, className, style, ...rest }: LoaderProps) {
  const exposed =
    title !== undefined ||
    rest.role !== undefined ||
    rest['aria-label'] !== undefined ||
    rest['aria-labelledby'] !== undefined
  return (
    <svg
      viewBox={geometry.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      {...(exposed ? {} : { 'aria-hidden': true })}
      {...(title === undefined ? {} : { role: 'img' })}
      {...rest}
      {...seatOf(stylex.props(styles.canvas, xstyle), className, style)}
    >
      {title === undefined ? null : <title>{title}</title>}
      <g {...stylex.props(styles.moving)}>
        <path d={geometry.track} {...stylex.props(styles.track)} />
        <g {...stylex.props(styles.orbit)}>
          <path d={geometry.pieceHome} />
        </g>
      </g>
      <g {...stylex.props(styles.still)}>
        <path d={geometry.ring} />
        <path d={geometry.piece} />
      </g>
    </svg>
  )
}
