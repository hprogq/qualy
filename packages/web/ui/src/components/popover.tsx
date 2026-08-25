import * as React from 'react'
import { Popover as PrimePopover } from '@primereact/ui/popover'
import { Slot } from 'radix-ui'

import { cn } from '../lib/cn.ts'

// The product popover over Prime's compound popover. The Radix-shaped
// surface stays - controlled open, asChild trigger, align/side on the
// content; the panel look comes from the theme preset, and a caller's own
// classes (the calendar popovers strip the padding) still win from the
// utilities layer.

function Popover({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  children?: React.ReactNode
}) {
  return (
    <PrimePopover.Root
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (event: { value?: boolean }) => onOpenChange(Boolean(event.value)) })}
    >
      {children}
    </PrimePopover.Root>
  )
}

function PopoverTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimePopover.Trigger
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="popover-trigger"
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = 'center',
  side,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}) {
  return (
    <PrimePopover.Portal>
      <PrimePopover.Positioner
        align={align}
        sideOffset={sideOffset}
        {...(side === undefined ? {} : { side })}
      >
        <PrimePopover.Popup
          data-slot="popover-content"
          {...(className === undefined ? {} : { className })}
          {...props}
        >
          {children}
        </PrimePopover.Popup>
      </PrimePopover.Positioner>
    </PrimePopover.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-sm', className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <div data-slot="popover-title" className={cn('text-base font-medium', className)} {...props} />
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
