'use client'

import * as React from 'react'
import { Drawer as PrimeDrawer } from '@primereact/ui/drawer'
import { Slot } from 'radix-ui'
import { XIcon } from 'lucide-react'

import { cn } from '../lib/utils.ts'
import { useNamesClosestPopup } from '../lib/overlay-aria.ts'
import { Button } from './button.tsx'

// The product sheet over Prime's drawer. The Radix-shaped surface stays,
// and the photo-viewer interop moves to the controlled boundary: when the
// viewer stands over the sheet, a close request born inside it - escape,
// or a click that lands in the viewer's portal - is not the sheet's to
// answer, so the adapter swallows it before the caller's onOpenChange.

/** whether a photo viewer is standing over everything right now */
const photoViewerOpen = () => document.querySelector('.PhotoView-Portal') !== null

function viewerOwnsClose(event: { originalEvent?: Event }): boolean {
  if (!photoViewerOpen()) return false
  const original = event.originalEvent
  if (original instanceof KeyboardEvent) return true
  const at = original?.target
  return at instanceof Element && at.closest('.PhotoView-Portal') !== null
}

// The side lives on SheetContent in the public surface, but Prime slides
// and sizes the drawer from a position on the root - so the root reads its
// content's side from the element tree it was handed.
function sideOf(children: React.ReactNode): 'top' | 'right' | 'bottom' | 'left' {
  let found: 'top' | 'right' | 'bottom' | 'left' | undefined
  const walk = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (found !== undefined || !React.isValidElement(child)) return
      const props = child.props as { side?: typeof found; children?: React.ReactNode }
      if (child.type === SheetContent) {
        found = props.side ?? 'right'
        return
      }
      if (props.children !== undefined) walk(props.children)
    })
  }
  walk(children)
  return found ?? 'right'
}

function Sheet({
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
  return (
    <PrimeDrawer.Root
      modal
      position={sideOf(children)}
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined
        ? {}
        : {
            onOpenChange: (event: { value?: boolean; originalEvent?: Event }) => {
              if (event.value === false && viewerOwnsClose(event)) return
              onOpenChange(Boolean(event.value))
            },
          })}
    >
      {children}
    </PrimeDrawer.Root>
  )
}

function SheetTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeDrawer.Trigger
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="sheet-trigger"
      {...props}
    />
  )
}

function SheetClose({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeDrawer.Close {...(asChild ? { as: Slot.Root } : {})} data-slot="sheet-close" {...props} />
  )
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  return <PrimeDrawer.Portal>{children}</PrimeDrawer.Portal>
}

function SheetOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  // no classes of its own: Prime's overlay mask carries the tint and fade
  return (
    <PrimeDrawer.Backdrop
      data-slot="sheet-overlay"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side: _side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <PrimeDrawer.Popup
        role="dialog"
        tabIndex={-1}
        // position, size and motion are Prime's; the root read the side off
        // this element already
        className={cn('flex flex-col text-sm', className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClose asChild>
            <Button variant="ghost" className="absolute top-4 right-4" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetClose>
        )}
      </PrimeDrawer.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-6', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-6', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLHeadingElement>(null)
  useNamesClosestPopup(ref, id, 'aria-labelledby')
  return (
    <h2
      ref={ref}
      id={id}
      data-slot="sheet-title"
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLParagraphElement>(null)
  useNamesClosestPopup(ref, id, 'aria-describedby')
  return (
    <p
      ref={ref}
      id={id}
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
