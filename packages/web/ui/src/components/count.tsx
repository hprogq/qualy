'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'

import { seatOf } from '../lib/xstyle.ts'

// A number riding on a label: how many are waiting behind this tab, how many
// this chip would show.
//
// It takes its ground from whatever it sits in rather than from a fixed pair
// of tokens, the way the Kbd chip does. The same count sits on an unselected
// segment (a muted ground), on the selected one (a pale ground), and on a
// chosen chip (the product's near-black) - a pinned muted-on-muted chip is
// invisible on the first, and a pinned pale one on the last. A wash of the
// current ink is one rule that holds on all three.
//
// It reserves one digit of room from the first paint. A number appearing
// into no room widens whatever holds it, and a filter row shuffles under the
// reader's eye the moment the server's counts land.

const styles = stylex.create({
  count: {
    // a min-width is ignored on an inline box, which is why the reservation
    // this replaces never actually reserved anything
    display: 'inline-block',
    marginInlineStart: 4,
    // one digit plus the padding, because the box is border-box: a bare
    // `1ch` is swallowed by the padding and reserves nothing
    minWidth: 'calc(1ch + 8px)',
    borderRadius: 4,
    paddingInline: 4,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.5,
    textAlign: 'center',
    color: 'currentColor',
    backgroundColor: 'color-mix(in oklab, currentColor 10%, transparent)',
  },
})

function Count({
  className,
  style,
  xstyle,
  children,
}: {
  children: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span data-slot="count" {...seatOf(stylex.props(styles.count, xstyle), className, style)}>
      {children}
    </span>
  )
}

export { Count }
