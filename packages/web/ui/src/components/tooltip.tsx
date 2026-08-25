'use client'

import * as React from 'react'
import { Tooltip as PrimeTooltip } from '@primereact/ui/tooltip'
import { Slot } from 'radix-ui'

// The product tooltip over Prime's compound tooltip. The public surface is
// the Radix-shaped quartet every call site composes; the dark bubble and
// its arrow are painted by the theme preset. Product tooltips open
// instantly, which is why the old provider forced delayDuration to zero -
// the zero now lives on every root and the provider is a plain wrapper.

function TooltipProvider({ children }: { children?: React.ReactNode; delayDuration?: number }) {
  return <>{children}</>
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
  delayDuration?: number
  children?: React.ReactNode
}) {
  return (
    <PrimeTooltip.Root
      openDelay={0}
      closeDelay={0}
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (event: { open?: boolean }) => onOpenChange(Boolean(event.open)) })}
    >
      {children}
    </PrimeTooltip.Root>
  )
}

function TooltipTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeTooltip.Trigger
      {...(asChild ? { as: Slot.Root } : {})}
      data-slot="tooltip-trigger"
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side,
  align,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}) {
  return (
    <PrimeTooltip.Portal>
      <PrimeTooltip.Positioner
        sideOffset={sideOffset}
        {...(side === undefined ? {} : { side })}
        {...(align === undefined ? {} : { align })}
      >
        <PrimeTooltip.Popup
          data-slot="tooltip-content"
          {...(className === undefined ? {} : { className })}
          {...props}
        >
          {children}
          <PrimeTooltip.Arrow />
        </PrimeTooltip.Popup>
      </PrimeTooltip.Positioner>
    </PrimeTooltip.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
