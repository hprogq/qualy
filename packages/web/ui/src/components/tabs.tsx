'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Tabs as MTabs } from '@mantine/core'

import { seatOf } from '../lib/xstyle.ts'

// A row of exclusive views under an underline. The behavior - roving
// focus, arrow keys, Home/End, the WAI-ARIA tablist contract - is the
// widget's, mounted with `variant="none"` so it brings no look of its own.
// The look is the product's: geometry here in StyleX, and every property
// the selection state touches (ink, the underline, focus, disabled) in
// theme.css under [data-slot='tabs-*'] - state rules must sit in the same
// layer as their resting values, or the resting value wins forever.
// View SWITCHERS - a segmented choice riding in a filter row - are not
// tabs; they are the `Segmented` control in @qualy/ui/screen.

const styles = stylex.create({
  list: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  // geometry only: everything the active state repaints lives in theme.css
  trigger: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    paddingInline: 8,
    paddingBlock: 4,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  content: {
    minWidth: 0,
    fontSize: 14,
    outline: 'none',
  },
})

type Seat = {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function Tabs({
  className,
  style,
  xstyle,
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  children,
}: Seat & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  children: React.ReactNode
}) {
  return (
    <MTabs
      data-slot="tabs"
      variant="none"
      orientation={orientation}
      value={value}
      defaultValue={defaultValue}
      // deactivation is off, so the widget's null never fires in practice;
      // the product contract stays "a tab is always selected"
      onChange={(next) => {
        if (next !== null) onValueChange?.(next)
      }}
      {...seatOf(stylex.props(xstyle), className, style)}
    >
      {children}
    </MTabs>
  )
}

function TabsList({
  className,
  style,
  xstyle,
  children,
  ...rest
}: Seat & {
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    <MTabs.List
      data-slot="tabs-list"
      {...rest}
      {...seatOf(stylex.props(styles.list, xstyle), className, style)}
    >
      {children}
    </MTabs.List>
  )
}

function TabsTrigger({
  className,
  style,
  xstyle,
  value,
  disabled,
  children,
  ...rest
}: Seat & {
  value: string
  disabled?: boolean
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    <MTabs.Tab
      data-slot="tabs-trigger"
      value={value}
      disabled={disabled}
      {...rest}
      {...seatOf(stylex.props(styles.trigger, xstyle), className, style)}
    >
      {children}
    </MTabs.Tab>
  )
}

function TabsContent({
  className,
  style,
  xstyle,
  value,
  children,
}: Seat & { value: string; children: React.ReactNode }) {
  return (
    <MTabs.Panel
      data-slot="tabs-content"
      value={value}
      {...seatOf(stylex.props(styles.content, xstyle), className, style)}
    >
      {children}
    </MTabs.Panel>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
