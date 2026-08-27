'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { HoverCard as MHoverCard, type HoverCardProps as MHoverCardProps } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A card that opens on hover. The behaviour - open and close delays, the
// portal, the grace area between the target and the card - is the widget
// library's; the look is the product's, and it is the popover family's
// surface drawn a size larger.
//
// The compound shape is kept over the library's Target/Dropdown model, the
// same rename the popover does. Its entrance is the family's pop, and a
// reader who asked for less motion is answered by the theme's
// respectReducedMotion rather than by a rule in the stylesheet.

// the card's own measure, 288px, is stated on the root as `width` rather
// than here: the widget writes the dropdown's width as an inline style, and
// an inline style outranks every class on the element. Said here it was
// silently dropped and the card shrank to its own text.
const styles = stylex.create({
  content: {
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
    outlineStyle: 'none',
  },
})

const positionOf = (side: string, align: string) =>
  (align === 'center' ? side : `${side}-${align}`) as NonNullable<MHoverCardProps['position']>

interface ContentDecl {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

function HoverCard({
  openDelay,
  closeDelay,
  disabled,
  onOpenChange,
  children,
}: {
  openDelay?: number
  closeDelay?: number
  /**
   * Stand down: the card does not open, and closes if it is open. For the
   * screen that put the same person's full record in front of the reader -
   * a preview has nothing left to add, and a pointer resting on the trigger
   * would otherwise hold it there, over the top of what was opened.
   */
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  // placement lives on the Content in the established API but on the root
  // here, the same read-ahead the popover does
  let decl: ContentDecl = {}
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === HoverCardContent) {
      decl = child.props as ContentDecl
    }
  })
  return (
    <MHoverCard
      withinPortal
      // parity with the previous substrate: the card stays put once open
      // rather than blanking when the target scrolls out of view
      hideDetached={false}
      width={288}
      position={positionOf(decl.side ?? 'bottom', decl.align ?? 'center')}
      offset={decl.sideOffset ?? 4}
      transitionProps={{ transition: 'pop', duration: 100 }}
      {...(disabled === undefined ? {} : { disabled })}
      {...(openDelay === undefined ? {} : { openDelay })}
      {...(closeDelay === undefined ? {} : { closeDelay })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpen: () => onOpenChange(true), onClose: () => onOpenChange(false) })}
    >
      {children}
    </MHoverCard>
  )
}

function HoverCardTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const child = asChild ? (
    (React.Children.only(children) as React.ReactElement<Record<string, unknown>>)
  ) : (
    <button type="button" {...props}>
      {children}
    </button>
  )
  return (
    <MHoverCard.Target>
      {React.cloneElement(child, { 'data-slot': 'hover-card-trigger' })}
    </MHoverCard.Target>
  )
}

function HoverCardContent({
  className,
  xstyle,
  children,
}: ContentDecl & { children?: React.ReactNode }) {
  return (
    <MHoverCard.Dropdown
      data-slot="hover-card-content"
      {...seatOf(stylex.props(styles.content, xstyle), className)}
    >
      {children}
    </MHoverCard.Dropdown>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
