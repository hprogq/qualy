'use client'

import * as React from 'react'
import { Modal as MModal } from '@mantine/core'

import { cn } from '../lib/utils.ts'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'

// An interruption that demands an answer: same modal substrate as the
// dialog, but with alertdialog semantics, no dismissal by clicking outside,
// and initial focus resting on the cancelling button - the safe answer is
// the one a stray Enter lands on.

interface AlertState {
  open: boolean
  setOpen: (next: boolean) => void
  descriptionId: string
  hasDescription: boolean
  setHasDescription: (present: boolean) => void
}
const AlertCtx = React.createContext<AlertState | null>(null)

function useAlert(): AlertState {
  const ctx = React.use(AlertCtx)
  if (ctx === null) throw new Error('AlertDialog components must sit inside <AlertDialog>')
  return ctx
}

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
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const [hasDescription, setHasDescription] = React.useState(false)
  const descriptionId = React.useId()
  const value = React.useMemo<AlertState>(
    () => ({
      open: open ?? inner,
      setOpen: (next) => {
        setInner(next)
        onOpenChange?.(next)
      },
      descriptionId,
      hasDescription,
      setHasDescription,
    }),
    [open, inner, onOpenChange, descriptionId, hasDescription],
  )
  return <AlertCtx value={value}>{children}</AlertCtx>
}

function AlertDialogTrigger({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useAlert()
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler
    }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event)
        setOpen(true)
      },
    })
  }
  return (
    <button
      type="button"
      data-slot="alert-dialog-trigger"
      onClick={(event) => {
        onClick?.(event)
        setOpen(true)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

function AlertDialogContent({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<'div'> & {
  size?: 'default' | 'sm'
}) {
  const { open, setOpen, descriptionId, hasDescription } = useAlert()
  // Compensation, not preference: the library hard-codes role="dialog" and
  // aria-describedby after spreading props, so the alertdialog role and the
  // description association are written on the element. Candidate upstream
  // issue.
  //
  // The mechanics matter twice over. The ref callback must keep a STABLE
  // identity (the focus trap re-runs its focus routine whenever the ref
  // identity changes, which stole focus on every re-render), and the write
  // must happen both on attach (the content mounts through the library's
  // own transition state, outside this component's renders) and when the
  // description arrives later (effect).
  const a11y = React.useRef({ hasDescription, descriptionId })
  a11y.current = { hasDescription, descriptionId }
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const applyA11y = React.useCallback((el?: HTMLDivElement | null) => {
    const node = el === undefined ? contentRef.current : el
    if (el !== undefined) contentRef.current = el
    if (node === null || node === undefined) return
    node.setAttribute('role', 'alertdialog')
    if (a11y.current.hasDescription)
      node.setAttribute('aria-describedby', a11y.current.descriptionId)
    else node.removeAttribute('aria-describedby')
  }, [])
  React.useEffect(() => applyA11y())
  // the page behind a modal leaves the conversation entirely
  React.useEffect(() => {
    if (!open) return
    return retainInertBackground(() => contentRef.current)
  }, [open])
  return (
    <MModal.Root
      opened={open}
      onClose={() => setOpen(false)}
      centered
      trapFocus
      returnFocus
      lockScroll
      closeOnEscape
      // an alert is answered, not dismissed by a stray click on the page
      closeOnClickOutside={false}
      transitionProps={{ duration: 100 }}
    >
      <MModal.Overlay data-slot="alert-dialog-overlay" blur={2} />
      <MModal.Content
        data-slot="alert-dialog-content"
        data-size={size}
        ref={applyA11y}
        // structure only; the surface is the widget's own under the theme.
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element
        classNames={{
          content: cn(
            'group/alert-dialog-content grid gap-6 p-6 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md',
            className,
          ),
        }}
        {...props}
      >
        {children}
      </MModal.Content>
    </MModal.Root>
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
  return (
    <MModal.Title
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
  const { descriptionId, setHasDescription } = useAlert()
  React.useEffect(() => {
    setHasDescription(true)
    return () => setHasDescription(false)
  }, [setHasDescription])
  return (
    <p
      id={descriptionId}
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
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpen } = useAlert()
  return (
    <Button
      data-slot="alert-dialog-action"
      variant={variant}
      size={size}
      className={className}
      // answering closes: the caller's handler records the decision, the
      // dialog's own close then flows through onOpenChange as always
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = 'outline',
  size = 'default',
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpen } = useAlert()
  return (
    <Button
      data-slot="alert-dialog-cancel"
      // the safe answer is where a stray Enter lands: the focus trap's
      // documented mark sends initial focus here
      data-autofocus
      variant={variant}
      size={size}
      className={className}
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      {...props}
    />
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
  AlertDialogTitle,
  AlertDialogTrigger,
}
