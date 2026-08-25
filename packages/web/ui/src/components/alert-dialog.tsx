'use client'

import * as React from 'react'
import { Dialog as PrimeDialog } from '@primereact/ui/dialog'
import { Slot } from 'radix-ui'

import { cn } from '../lib/utils.ts'
import { useNamesClosestPopup } from '../lib/overlay-aria.ts'
import { Button } from './button.tsx'

// The product alert dialog over Prime's dialog machinery. Prime has no
// separate alert primitive, so the adapter states the differences itself:
// role=alertdialog on the popup, no dismissal by clicking outside, and
// Action/Cancel buttons that close the dialog as they always have. The
// visual classes ride over verbatim in the utilities layer.

function AlertDialog({
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
    <PrimeDialog.Root
      modal
      dismissable={false}
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

function AlertDialogTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeDialog.Trigger
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="alert-dialog-trigger"
      {...props}
    />
  )
}

function AlertDialogPortal({ children }: { children?: React.ReactNode }) {
  return <PrimeDialog.Portal>{children}</PrimeDialog.Portal>
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  // no classes of its own: Prime's overlay mask carries the tint and fade
  return (
    <PrimeDialog.Backdrop
      data-slot="alert-dialog-overlay"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  size?: 'default' | 'sm'
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <PrimeDialog.Positioner>
        <PrimeDialog.Popup
          role="alertdialog"
          data-slot="alert-dialog-content"
          data-size={size}
          tabIndex={-1}
          className={cn(
            'group/alert-dialog-content grid w-full max-w-xs gap-6 p-6',
            size === 'default' && 'sm:max-w-md',
            className,
          )}
          {...props}
        />
      </PrimeDialog.Positioner>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-16 items-center justify-center rounded-full bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLHeadingElement>(null)
  useNamesClosestPopup(ref, id, 'aria-labelledby')
  return (
    <h2
      ref={ref}
      id={id}
      data-slot="alert-dialog-title"
      className={cn(
        'font-heading text-lg font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const id = React.useId()
  const ref = React.useRef<HTMLParagraphElement>(null)
  useNamesClosestPopup(ref, id, 'aria-describedby')
  return (
    <p
      ref={ref}
      id={id}
      data-slot="alert-dialog-description"
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<'button'> & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button variant={variant} size={size} asChild>
      <PrimeDialog.Close data-slot="alert-dialog-action" className={cn(className)} {...props} />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = 'outline',
  size = 'default',
  ...props
}: React.ComponentProps<'button'> & Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button variant={variant} size={size} asChild>
      <PrimeDialog.Close data-slot="alert-dialog-cancel" className={cn(className)} {...props} />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
