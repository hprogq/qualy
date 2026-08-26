'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A scroll container with overlay scrollbars. The behavior - overflow
// bookkeeping, scrollbar mounting, dragging - is the primitive's, and the
// DOM shape (root > viewport > children, plus scrollbar and corner) is the
// review workbench's frozen scroll model. The scrollbar and thumb look
// lives in theme.css under [data-slot='scroll-area-*']: the primitive
// stamps data-orientation on the scrollbar, which a compiled style cannot
// read on its own element, and the components layer keeps a consumer's
// StyleX or utilities on the root winning without a fight.

const styles = stylex.create({
  root: {
    position: 'relative',
  },
  viewport: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: 'inherit',
    transitionProperty: 'color, box-shadow',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 3px color-mix(in oklab, ${tokens.focusRing} 50%, transparent)`,
    },
  },
})

type Seat = {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function ScrollArea({
  className,
  style,
  xstyle,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & Seat) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      {...props}
      {...seatOf(stylex.props(styles.root, xstyle), className, style)}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        {...stylex.props(styles.viewport)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  style,
  xstyle,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & Seat) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      {...props}
      {...seatOf(stylex.props(xstyle), className, style)}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
