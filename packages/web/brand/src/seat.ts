import type * as React from 'react'

// The seat a caller's StyleX takes on a brand component.
//
// `stylex.props()` answers with both a class and an inline style - a dynamic
// style has nowhere else to put its value - so both are carried, with a
// legacy `className` and the caller's own `style` layered on top in that
// order. The same shape @qualy/ui gives its adapters; written here rather
// than imported because @qualy/ui draws its loader from this package and
// must not be a dependency of it.

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
    className: [compiled.className, className].filter(Boolean).join(' '),
    ...(merged === undefined ? {} : { style: merged }),
  }
}
