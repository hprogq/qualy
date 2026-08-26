'use client'

import * as React from 'react'
import { Tooltip as MTooltip } from '@mantine/core'

import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'

// The Qualy tooltip keeps its compound shape (Provider/Root/Trigger/Content)
// over the widget library's single-component model: the root collects the
// trigger element and the content label from its children and hands both to
// the library, which owns positioning, portal, delays and the describedby
// wiring. Opens on keyboard focus as well as hover - a hint only pointer
// users can read is not a hint.

const surfaceStyles = stylex.create({
  tip: {
    maxWidth: 320,
    fontSize: 12,
  },
})
const DelayContext = React.createContext(0)

function TooltipProvider({
  delayDuration = 0,
  children,
}: {
  delayDuration?: number
  children?: React.ReactNode
}) {
  return <DelayContext value={delayDuration}>{children}</DelayContext>
}

interface TriggerProps {
  asChild?: boolean
  children?: React.ReactNode
}

interface ContentProps {
  className?: string
  sideOffset?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  children?: React.ReactNode
}

function Tooltip({
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
  const delay = React.use(DelayContext)
  let trigger: TriggerProps | null = null
  let content: ContentProps | null = null
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === TooltipTrigger) trigger = child.props as TriggerProps
    if (child.type === TooltipContent) content = child.props as ContentProps
  })
  if (trigger === null || content === null) return null
  const { asChild = false, children: triggerChildren } = trigger as TriggerProps
  const { className, side = 'top', sideOffset = 4, children: label } = content as ContentProps

  // the library needs one element that takes a ref; a text trigger gets the
  // same native button the previous substrate rendered
  const target = asChild ? (
    (React.Children.only(triggerChildren) as React.ReactElement)
  ) : (
    <button type="button" data-slot="tooltip-trigger">
      {triggerChildren}
    </button>
  )

  return (
    <MTooltip
      // the one surface that appears without being asked for; it fades, and
      // quickly - a tooltip that pops on every hover makes the page restless
      transitionProps={{ transition: 'fade', duration: 90 }}
      label={label}
      position={side}
      offset={sideOffset}
      openDelay={delay}
      withinPortal
      withArrow
      arrowSize={8}
      events={{ hover: true, focus: true, touch: false }}
      {...(defaultOpen === undefined ? {} : { defaultOpened: defaultOpen })}
      {...(open === undefined ? {} : { opened: open })}
      {...(onOpenChange === undefined ? {} : { onDismiss: () => onOpenChange(false) })}
      // structure only; the surface is the widget's own under the theme
      classNames={{ tooltip: clsx(stylex.props(surfaceStyles.tip).className, className) }}
    >
      {target}
    </MTooltip>
  )
}

// Both are declarations read by the Tooltip root, never rendered directly.
function TooltipTrigger(_props: TriggerProps & React.ComponentProps<'button'>) {
  return null
}

function TooltipContent(_props: ContentProps) {
  return null
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
