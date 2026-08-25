'use client'

import * as React from 'react'
import { Dialog as PrimeDialog } from '@primereact/ui/dialog'
import { Slot } from 'radix-ui'
import { XIcon } from 'lucide-react'

import { cn } from '../lib/utils.ts'
import { useNamesClosestPopup } from '../lib/overlay-aria.ts'
import { Button } from './button.tsx'

// The product dialog over Prime's compound dialog. The Radix-shaped surface
// stays: controlled open, asChild trigger/close, Title and Description that
// name the dialog for a screen reader and a test. The look is Prime's own -
// the parts wear Prime's dialog classes so the theme styles them, and the
// adapters add layout only where the product structure differs (a header
// that stacks its description under the title).

function Dialog({
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
    <PrimeDialog.Root
      modal
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (event: { value?: boolean }) => onOpenChange(Boolean(event.value)) })}
    >
      {children}
    </PrimeDialog.Root>
  )
}

function DialogTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeDialog.Trigger
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="dialog-trigger"
      {...props}
    />
  )
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <PrimeDialog.Portal>{children}</PrimeDialog.Portal>
}

function DialogClose({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeDialog.Close
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="dialog-close"
      {...props}
    />
  )
}

function DialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  // no classes of its own: Prime's overlay mask carries the tint and the
  // fade, and a painted-over mask snaps instead of fading
  return (
    <PrimeDialog.Backdrop
      data-slot="dialog-overlay"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

// Focus resting on the dialog itself instead of its first control: the
// caller says so by cancelling the open-autofocus event, exactly as it did
// with Radix. The marker finds its own popup, which carries tabIndex=-1.
function OpenAutoFocus({ handler }: { handler: (event: Event) => void }) {
  const marker = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const probe = new Event('openautofocus', { cancelable: true })
    handler(probe)
    if (!probe.defaultPrevented) return
    const popup = marker.current?.closest<HTMLElement>('[data-part="popup"]')
    popup?.focus()
  }, [handler])
  return <span ref={marker} hidden />
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
  onOpenAutoFocus?: (event: Event) => void
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <PrimeDialog.Positioner>
        <PrimeDialog.Popup
          data-slot="dialog-content"
          tabIndex={-1}
          className={cn('flex w-full max-w-[calc(100%-2rem)] flex-col sm:max-w-md', className)}
          {...props}
        >
          {onOpenAutoFocus !== undefined && <OpenAutoFocus handler={onOpenAutoFocus} />}
          {children}
          {showCloseButton && (
            <DialogClose asChild>
              <Button variant="ghost" className="absolute top-4 right-4" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          )}
        </PrimeDialog.Popup>
      </PrimeDialog.Positioner>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  // Prime's header class brings the theme's padding; the product header
  // stacks a description under the title, so the row becomes a column
  return (
    <div
      data-slot="dialog-header"
      className={cn('p-dialog-header flex-col items-stretch gap-2', className)}
      {...props}
    />
  )
}

/**
 * The scrollable middle of a dialog. It continues DialogContent's own gap-6
 * rhythm one level down (the scroll wrapper takes its children out of the
 * content grid), and trades a margin for padding at net zero so a focus
 * ring at the scroll edge has room instead of being clipped.
 *
 * The height cap belongs here rather than on DialogContent: the content box
 * is centred with a -50% translate, so once it outgrows the viewport its top
 * edge leaves the screen and cannot be scrolled back into reach. Capping the
 * body instead leaves the header and footer outside the scroll region, and a
 * body shorter than the cap is laid out exactly as if the cap were absent.
 */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('p-dialog-content flex min-h-0 flex-1 flex-col gap-6', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('p-dialog-footer flex-col-reverse sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose asChild>
          <Button variant="outline">Close</Button>
        </DialogClose>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLHeadingElement>(null)
  useNamesClosestPopup(ref, id, 'aria-labelledby')
  return (
    <h2
      ref={ref}
      id={id}
      data-slot="dialog-title"
      className={cn('p-dialog-title', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLParagraphElement>(null)
  useNamesClosestPopup(ref, id, 'aria-describedby')
  return (
    <p
      ref={ref}
      id={id}
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
