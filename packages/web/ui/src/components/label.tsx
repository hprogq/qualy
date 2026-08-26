'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { InputLabel } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// The name of a control, tied to it by `htmlFor`.

const styles = stylex.create({
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 500,
    userSelect: 'none',
  },
})

interface LabelProps {
  children: React.ReactNode
  htmlFor?: string
  id?: string
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function Label({ className, style, xstyle, children, ...rest }: LabelProps) {
  return (
    <InputLabel
      data-slot="label"
      {...rest}
      {...seatOf(stylex.props(styles.label, xstyle), className, style)}
    >
      {children}
    </InputLabel>
  )
}

export { Label }
