'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Kbd as MKbd } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// A key, drawn where a sentence names one.
//
// The chip takes its ink from whatever it sits in rather than from a fixed
// pair of tokens. A pinned muted-on-muted chip disappeared on a solid
// button, and a pinned white one disappeared again on the disabled grey
// ground under it - each fix belonged to the button that reported it, and
// the next surface broke the same way. Following the current foreground is
// one rule that holds on plain prose, on a primary button, on a destructive
// one, on a disabled one, and inside a tooltip whose ink is inverted.

const styles = stylex.create({
  // A flat chip, not the widget's three-dimensional key: its 3px bottom
  // border under a transparent color painted as part of the wash and pushed
  // the glyph high. And the product's own face, not the widget's monospace
  // stack - ⌘ and ↵ fell into different fallback fonts at different heights.
  ink: {
    height: 20,
    minWidth: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingInline: 4,
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1,
    color: 'currentColor',
    backgroundColor: 'color-mix(in oklab, currentColor 8%, transparent)',
    borderWidth: 0,
    boxShadow: 'none',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
})

interface KeyProps {
  children: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function Kbd({ className, style, xstyle, children }: KeyProps) {
  return (
    <MKbd data-slot="kbd" {...seatOf(stylex.props(styles.ink, xstyle), className, style)}>
      {children}
    </MKbd>
  )
}

/** several keys pressed together, spaced as one phrase */
function KbdGroup({ className, style, xstyle, children }: KeyProps) {
  return (
    <span data-slot="kbd-group" {...seatOf(stylex.props(styles.group, xstyle), className, style)}>
      {children}
    </span>
  )
}

export { Kbd, KbdGroup }
