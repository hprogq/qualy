import type * as React from 'react'
import { clsx } from 'clsx'

// The seat every adapter gives a caller's StyleX.
//
// `stylex.props()` answers with BOTH a class and an inline style - a dynamic
// style (`styles.width(300)`) has nowhere else to put its value - so an
// adapter that forwards only the class silently drops half of what it
// accepted. This carries both, and keeps the legacy `className` and a
// caller's own `style` layered on top in that order.

export function seatOf(
  compiled: { className?: string; style?: React.CSSProperties },
  className?: string,
  style?: React.CSSProperties,
): { className: string; style?: React.CSSProperties } {
  const merged =
    compiled.style === undefined && style === undefined
      ? undefined
      : { ...compiled.style, ...style }
  return {
    className: clsx(compiled.className, className),
    ...(merged === undefined ? {} : { style: merged }),
  }
}
