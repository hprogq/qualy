'use client'

import * as React from 'react'
import { Collapse as MCollapse } from '@mantine/core'

// A section a reader can fold away, and the control that folds it.
//
// The fold itself is the widget library's, which measures the region and
// animates its height - and stands the animation down for a reader who asked
// for less motion, through the same theme setting the overlays read. What is
// not the library's is the pair between the two: the library folds a region
// but knows nothing of the control that folded it, so the aria wiring - what
// the button says about its own state, and which region it points at - is
// written here.

interface Disclosure {
  open: boolean
  toggle: () => void
  contentId: string
}

const CollapsibleCtx = React.createContext<Disclosure>({
  open: false,
  toggle: () => {},
  contentId: '',
})

function Collapsible({
  open,
  defaultOpen,
  onOpenChange,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** render as the single child given instead of a div of this one's own */
  asChild?: boolean
}) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const showing = open ?? inner
  const contentId = React.useId()
  const held = React.useMemo(
    () => ({
      open: showing,
      contentId,
      toggle: () => {
        setInner(!showing)
        onOpenChange?.(!showing)
      },
    }),
    [showing, contentId, onOpenChange],
  )
  const mine = {
    'data-slot': 'collapsible',
    'data-state': showing ? 'open' : 'closed',
    ...props,
  }
  const child = asChild ? (
    React.cloneElement(
      React.Children.only(children) as React.ReactElement<Record<string, unknown>>,
      mine,
    )
  ) : (
    <div {...mine}>{children}</div>
  )
  return <CollapsibleCtx value={held}>{child}</CollapsibleCtx>
}

function CollapsibleTrigger({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, toggle, contentId } = React.use(CollapsibleCtx)
  const mine = {
    'data-slot': 'collapsible-trigger',
    'data-state': open ? 'open' : 'closed',
    'aria-expanded': open,
    // a control cannot point at a region that is not there
    ...(open ? { 'aria-controls': contentId } : {}),
  }
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
    const childOnClick = child.props.onClick as React.MouseEventHandler | undefined
    return React.cloneElement(child, {
      ...mine,
      onClick: (event: React.MouseEvent) => {
        childOnClick?.(event)
        toggle()
      },
    })
  }
  return (
    <button
      type="button"
      {...mine}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        toggle()
      }}
    >
      {children}
    </button>
  )
}

function CollapsibleContent({
  className,
  style,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  const { open, contentId } = React.use(CollapsibleCtx)
  return (
    <MCollapse
      expanded={open}
      id={contentId}
      data-slot="collapsible-content"
      data-state={open ? 'open' : 'closed'}
      {...(className === undefined ? {} : { className })}
      {...(style === undefined ? {} : { style })}
    >
      {children}
    </MCollapse>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
