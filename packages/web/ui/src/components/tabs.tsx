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

/**
 * Two looks, one meaning.
 *
 * `line` is a row of views with the read one underlined: quiet, and right
 * when a tablist is the only thing on its line. `segmented` puts the same
 * views inside one bounded run with the read one raised out of the ground -
 * which is what a compact switcher needs, and the only thing that works when
 * two independent switchers sit side by side. Two underlined rows next to
 * each other read as ONE tablist with two things selected at once.
 *
 * Both are tabs: a tablist, tabs, aria-selected, arrow keys. The choice is
 * about the room the control sits in, never about what it means - a control
 * that picks a VALUE rather than a VIEW is a different component.
 */
export type TabsVariant = 'line' | 'segmented'

/** the value the group holds and the look it wears, read by every part */
const TabsCtx = React.createContext<{ value?: string; variant: TabsVariant }>({
  variant: 'line',
})

const styles = stylex.create({
  list: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  // one bounded run: the ground holds the options together, which is what
  // tells a reader that two switchers on the same row are two questions
  listSegmented: {
    gap: 2,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    padding: 3,
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
  triggerSegmented: {
    borderRadius: `calc(${tokens.radiusMd} - 1px)`,
    paddingInline: 10,
    paddingBlock: 3,
    transitionProperty: 'color, background-color, box-shadow',
  },
  // raised out of the ground rather than underlined
  triggerSegmentedReading: {
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.08)',
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
  variant = 'line',
  children,
}: Seat & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  /** which room this tablist sits in; see TabsVariant */
  variant?: TabsVariant
  children: React.ReactNode
}) {
  const held = React.useMemo(
    () => ({ value: value ?? defaultValue, variant }),
    [value, defaultValue, variant],
  )
  return (
    <MTabs
      data-slot="tabs"
      data-look={variant}
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
      <TabsCtx value={held}>{children}</TabsCtx>
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
  const { variant } = React.use(TabsCtx)
  return (
    <MTabs.List
      data-slot="tabs-list"
      {...rest}
      {...seatOf(
        stylex.props(styles.list, variant === 'segmented' && styles.listSegmented, xstyle),
        className,
        style,
      )}
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
  const { value: held, variant } = React.use(TabsCtx)
  const reading = held === value
  const segmented = variant === 'segmented'
  return (
    <MTabs.Tab
      data-slot="tabs-trigger"
      value={value}
      disabled={disabled}
      {...rest}
      {...seatOf(
        stylex.props(
          styles.trigger,
          reading && styles.triggerReading,
          segmented && styles.triggerSegmented,
          segmented && reading && styles.triggerSegmentedReading,
          xstyle,
        ),
        className,
        style,
      )}
    >
      {children}
      {reading && !segmented && <span aria-hidden {...stylex.props(styles.underline)} />}
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
