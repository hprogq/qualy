'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A row of pressed-or-not choices.
//
// The behavior - single or multiple, roving focus, aria-pressed - is the
// primitive's. The look is stated here, and what the utility era expressed
// as `group-data-[spacing=0]/toggle-group:*` selectors is now plain React:
// the group hands its variant, size and spacing down through context, and
// each item composes the styles that answer them. Only what a compiled
// style cannot read on its own element - the pressed state the primitive
// stamps as data-state, and icon sizing inside caller content - stays in
// theme.css.

type Variant = 'default' | 'outline'
type Size = 'default' | 'sm' | 'lg'

interface GroupState {
  variant: Variant
  size: Size
  /** 0 joins the items into one control; anything else spaces them apart */
  spacing: number
  orientation: 'horizontal' | 'vertical'
}

const GroupCtx = React.createContext<GroupState>({
  variant: 'default',
  size: 'default',
  spacing: 2,
  orientation: 'horizontal',
})

const styles = stylex.create({
  group: {
    display: 'flex',
    width: 'fit-content',
    alignItems: 'center',
  },
  groupRow: {
    flexDirection: 'row',
  },
  groupColumn: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  gap: (px: number) => ({ gap: px }),
  joinedGroup: {
    borderRadius: 32,
  },
  item: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 32,
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: {
      default: 'transparent',
      ':hover': tokens.surfaceMuted,
    },
    color: {
      default: null,
      ':hover': tokens.foreground,
    },
    fontFamily: 'inherit',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    zIndex: {
      default: null,
      ':focus': 10,
      ':focus-visible': 10,
    },
    boxShadow: {
      default: null,
      ':focus-visible': `0 0 0 3px color-mix(in oklab, ${tokens.focusRing} 50%, transparent)`,
    },
  },
  itemOutline: {
    borderWidth: 1,
    borderColor: tokens.input,
  },
  sizeDefault: {
    height: 36,
    minWidth: 36,
    paddingInline: 12,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  sizeSm: {
    height: 32,
    minWidth: 32,
    paddingInline: 12,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  sizeLg: {
    height: 40,
    minWidth: 40,
    paddingInline: 16,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  // joined: square shoulders inside the run, round ones at both ends, and
  // one shared edge between neighbours instead of two
  joinedRow: {
    borderRadius: 0,
    boxShadow: 'none',
    borderLeftWidth: 0,
    borderStartStartRadius: {
      default: 0,
      ':first-child': 24,
    },
    borderEndStartRadius: {
      default: 0,
      ':first-child': 24,
    },
    borderStartEndRadius: {
      default: 0,
      ':last-child': 24,
    },
    borderEndEndRadius: {
      default: 0,
      ':last-child': 24,
    },
  },
  joinedRowOutline: {
    borderLeftWidth: {
      default: 0,
      ':first-child': 1,
    },
  },
  joinedColumn: {
    borderRadius: 0,
    boxShadow: 'none',
    borderTopWidth: 0,
    borderStartStartRadius: {
      default: 0,
      ':first-child': 24,
    },
    borderStartEndRadius: {
      default: 0,
      ':first-child': 24,
    },
    borderEndStartRadius: {
      default: 0,
      ':last-child': 24,
    },
    borderEndEndRadius: {
      default: 0,
      ':last-child': 24,
    },
  },
  joinedColumnOutline: {
    borderTopWidth: {
      default: 0,
      ':first-child': 1,
    },
  },
})

const sizeStyle: Record<Size, stylex.StyleXStyles> = {
  default: styles.sizeDefault,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
}

type Seat = {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function ToggleGroup({
  className,
  style,
  xstyle,
  variant = 'default',
  size = 'default',
  spacing = 2,
  orientation = 'horizontal',
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  Seat & {
    variant?: Variant
    size?: Size
    spacing?: number
    orientation?: 'horizontal' | 'vertical'
  }) {
  const joined = spacing === 0
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      {...props}
      {...seatOf(
        stylex.props(
          styles.group,
          orientation === 'vertical' ? styles.groupColumn : styles.groupRow,
          styles.gap(spacing * 4),
          joined && variant === 'outline' && styles.joinedGroup,
          xstyle,
        ),
        className,
        style,
      )}
    >
      <GroupCtx value={{ variant, size, spacing, orientation }}>{children}</GroupCtx>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  style,
  xstyle,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & Seat) {
  const group = React.use(GroupCtx)
  const joined = group.spacing === 0
  const row = group.orientation === 'horizontal'
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={group.variant}
      data-size={group.size}
      data-spacing={group.spacing}
      {...props}
      {...seatOf(
        stylex.props(
          styles.item,
          sizeStyle[group.size],
          group.variant === 'outline' && styles.itemOutline,
          joined && (row ? styles.joinedRow : styles.joinedColumn),
          joined &&
            group.variant === 'outline' &&
            (row ? styles.joinedRowOutline : styles.joinedColumnOutline),
          xstyle,
        ),
        className,
        style,
      )}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
