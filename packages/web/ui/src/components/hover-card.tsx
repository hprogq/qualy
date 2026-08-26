import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A card that opens on hover. The behavior - open/close delays, the portal,
// pointer grace area - is the primitive's; the look is the product's. The
// edge is a real 1px border, the same recipe the widget-backed popover family
// draws under the theme. The entrance rides the shared insertion keyframe in
// theme.css under [data-slot='hover-card-content'], at the popover family's
// 100ms; the exit is the primitive's immediate unmount, like the dialogs.

const styles = stylex.create({
  content: {
    zIndex: 50,
    width: 288,
    transformOrigin: 'var(--radix-hover-card-content-transform-origin)',
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.foreground} 5%, transparent)`,
    backgroundColor: tokens.surfaceElevated,
    padding: 16,
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.foreground,
    boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
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

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  style,
  xstyle,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & Seat) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        {...props}
        {...seatOf(stylex.props(styles.content, xstyle), className, style)}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
