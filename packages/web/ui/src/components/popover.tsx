'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Popover as MPopover, type PopoverProps as MPopoverProps } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// The Qualy popover keeps its compound shape over the widget library's own
// Target/Dropdown model, which is close enough that the adapter is mostly
// renaming. Two deliberate mechanisms, both from the library's documented
// vocabulary:
//
// - `trapFocus`: focus moves into the dropdown while it is open, so Escape
//   fires from inside it.
// - `data-mantine-stop-propagation`: worn by the dropdown always and by the
//   trigger while open. A modal underneath listens for Escape on window and
//   ignores events from marked elements - this is what makes Escape peel
//   one layer at a time instead of closing everything at once.

const styles = stylex.create({
  // structure only; the surface is the widget's own under the theme
  content: {
    display: 'flex',
    width: '18rem',
    flexDirection: 'column',
    gap: 16,
    padding: 16,
    // size and leading travel together, as the utility this replaces did
    fontSize: 14,
    lineHeight: '1.25rem',
    outlineStyle: 'none',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 14,
  },
  title: {
    fontSize: 16,
    lineHeight: '1.5rem',
    fontWeight: 500,
  },
  description: {
    color: tokens.mutedForeground,
  },
})

interface PopoverState {
  opened: boolean
  /** with a controlled root the library's target does not toggle on click;
      the trigger wires it through here instead */
  controlled: boolean
  toggle: () => void
}
const PopoverCtx = React.createContext<PopoverState>({
  opened: false,
  controlled: false,
  toggle: () => {},
})

const positionOf = (side: string, align: string) =>
  (align === 'center' ? side : `${side}-${align}`) as NonNullable<MPopoverProps['position']>

interface ContentDecl {
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

function Popover({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  // uncontrolled state stays the library's; the adapter mirrors it so the
  // trigger knows when to wear the stop-propagation mark
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const opened = open ?? inner
  const observe = (next: boolean) => {
    setInner(next)
    onOpenChange?.(next)
  }
  // position lives on the Content in the established API but on the root
  // here; read the direct declaration before rendering
  let decl: ContentDecl = {}
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === PopoverContent) {
      decl = child.props as ContentDecl
    }
  })
  const side = decl.side ?? 'bottom'
  const align = decl.align ?? 'center'
  const controlled = open !== undefined
  return (
    <MPopover
      withinPortal
      trapFocus
      returnFocus
      // parity with the previous substrate: the dropdown stays visible even
      // if the trigger leaves the viewport (hideDetached would blank it)
      hideDetached={false}
      // withRoles would overwrite the trigger's own id, severing any
      // label-for association a form built; the adapter wears the aria
      // state itself instead
      withRoles={false}
      position={positionOf(side, align)}
      offset={decl.sideOffset ?? 4}
      // an anchored surface pops: opacity with a whisper of scale, which
      // reads the same whichever side the placement flipped to
      transitionProps={{ transition: 'pop', duration: 130 }}
      {...(defaultOpen === undefined ? {} : { defaultOpened: defaultOpen })}
      {...(controlled ? { opened: open } : {})}
      onChange={observe}
    >
      <PopoverCtx value={{ opened, controlled, toggle: () => observe(!opened) }}>
        {children}
      </PopoverCtx>
    </MPopover>
  )
}

function PopoverTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { opened, controlled, toggle } = React.use(PopoverCtx)
  const child = asChild ? (
    (React.Children.only(children) as React.ReactElement<Record<string, unknown>>)
  ) : (
    <button type="button" data-slot="popover-trigger" {...props}>
      {children}
    </button>
  )
  const childOnClick = child.props.onClick as React.MouseEventHandler | undefined
  const extra: Record<string, unknown> = {
    'data-state': opened ? 'open' : 'closed',
    'aria-haspopup': 'dialog',
    'aria-expanded': opened,
    // while open, Escape may fire from the trigger (focus returns there
    // when the dropdown closes); the mark keeps a modal underneath out
    ...(opened ? { 'data-mantine-stop-propagation': 'true' } : {}),
    // the library's target only toggles on click for uncontrolled roots;
    // a controlled one gets the same behavior wired here
    ...(controlled
      ? {
          onClick: (event: React.MouseEvent) => {
            childOnClick?.(event)
            toggle()
          },
        }
      : {}),
  }
  return <MPopover.Target>{React.cloneElement(child, extra)}</MPopover.Target>
}

function PopoverContent({ className, children }: ContentDecl & { children?: React.ReactNode }) {
  return (
    <MPopover.Dropdown
      data-slot="popover-content"
      data-mantine-stop-propagation="true"
      // presses inside this layer belong to it: a menu or popover BENEATH
      // listens for outside presses on mousedown, and a portal makes this
      // list "outside" - without the stop, holding the mouse on an option
      // unmounted everything under the cursor before the click could land
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      // withRoles={false} on the root also dropped these two; the trap
      // needs a focusable dropdown for Escape to fire from inside it
      role="dialog"
      tabIndex={-1}
      {...seatOf(stylex.props(styles.content), className)}
    >
      {children}
    </MPopover.Dropdown>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      {...props}
      {...seatOf(stylex.props(styles.header), className)}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <div data-slot="popover-title" {...props} {...seatOf(stylex.props(styles.title), className)} />
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      {...props}
      {...seatOf(stylex.props(styles.description), className)}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
