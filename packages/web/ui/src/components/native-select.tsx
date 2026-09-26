'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Combobox, NativeSelect as MNativeSelect } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// The platform's own select, for the short closed list where the operating
// system's picker is better than anything drawn in the page - on a phone
// most of all. Its chevron is the drawn select's, in the secondary text grey
// rather than the widget's bluish one.

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
}

function NativeSelect({ className, style, size = 'default', xstyle, ...props }: NativeSelectProps) {
  const widgetSize = size === 'sm' ? 'xs' : 'sm'
  return (
    <MNativeSelect
      data-slot="native-select"
      data-size={size}
      size={widgetSize}
      rightSection={<Combobox.Chevron size={widgetSize} color="var(--q-muted-foreground)" />}
      {...props}
      {...seatOf(stylex.props(xstyle), className, style)}
    />
  )
}

export { NativeSelect }
