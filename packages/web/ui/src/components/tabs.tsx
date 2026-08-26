'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Tabs as MTabs } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A row of exclusive views under an underline. The behavior - roving
// focus, arrow keys, Home/End, the WAI-ARIA tablist contract - is the
// widget's, mounted with `variant="none"` so it brings no look of its own.
// The whole look is stated here: hover, focus and disabled as conditions
// on the style itself, and the selected view as an ordinary React
// comparison - the group knows which value is current, so no rule has to
// go looking for an attribute the widget stamped.
//
// View SWITCHERS - a segmented choice riding in a filter row - are not
// tabs; they are the `Segmented` control in @qualy/ui/screen.

/** the value the group holds, so a trigger can tell whether it is the one */
const TabsCtx = React.createContext<string | undefined>(undefined)

const styles = stylex.create({
  list: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  trigger: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    paddingBlock: 4,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: {
      default: `color-mix(in oklab, ${tokens.foreground} 60%, transparent)`,
      ':hover': tokens.foreground,
    },
    outline: {
      default: null,
      ':focus-visible': 'none',
    },
    boxShadow: {
      default: null,
      ':focus-visible': `0 0 0 3px color-mix(in oklab, ${tokens.focusRing} 50%, transparent)`,
    },
    opacity: {
      default: null,
      ':disabled': 0.5,
    },
    pointerEvents: {
      default: null,
      ':disabled': 'none',
    },
    transitionProperty: 'color, box-shadow',
    transitionDuration: '150ms',
  },
  triggerReading: {
    color: tokens.foreground,
  },
  // The underline is an element of its own, drawn only under the view being
  // read. The adapter already knows which one that is, so nothing has to go
  // looking for an attribute the widget stamped.
  underline: {
    position: 'absolute',
    insetInline: 0,
    bottom: -5,
    height: 2,
    borderRadius: 2,
    backgroundColor: tokens.foreground,
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
      <TabsCtx value={value ?? defaultValue}>{children}</TabsCtx>
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
  const reading = React.use(TabsCtx) === value
  return (
    <MTabs.Tab
      data-slot="tabs-trigger"
      value={value}
      disabled={disabled}
      {...rest}
      {...seatOf(
        stylex.props(styles.trigger, reading && styles.triggerReading, xstyle),
        className,
        style,
      )}
    >
      {children}
      {reading && <span aria-hidden {...stylex.props(styles.underline)} />}
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
