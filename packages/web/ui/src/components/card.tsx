'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Card as MCard } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// A bounded surface with its own edge.
//
// The seven-part header/title/action/footer family this replaced had one
// consumer between all of them: a card is a box, and what goes in it is the
// screen's own composition.

interface CardProps {
  children: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function Card({ className, style, xstyle, children }: CardProps) {
  return (
    <MCard
      data-slot="card"
      withBorder
      radius="lg"
      padding="lg"
      {...seatOf(stylex.props(xstyle), className, style)}
    >
      {children}
    </MCard>
  )
}

export { Card }
