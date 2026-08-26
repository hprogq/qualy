'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { NativeSelect as MNativeSelect } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// The platform's own select, for the short closed list where the operating
// system's picker is better than anything drawn in the page - on a phone
// most of all.

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
}

function NativeSelect({ className, style, size = 'default', xstyle, ...props }: NativeSelectProps) {
  return (
    <MNativeSelect
      data-slot="native-select"
      data-size={size}
      size={size === 'sm' ? 'xs' : 'sm'}
      {...props}
      {...seatOf(stylex.props(xstyle), className, style)}
    />
  )
}

export { NativeSelect }
