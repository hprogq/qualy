'use client'

import * as React from 'react'
import { FocusTrap, Modal as MModal } from '@mantine/core'

import { cn } from '../lib/utils.ts'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'
import { XIcon } from 'lucide-react'

// The Qualy dialog keeps its compound shape over the widget library's modal.
// The library owns the portal, the focus trap, the scroll lock, the Escape
// policy (window listener that ignores marked elements - what lets an inner
// popover or select answer first) and the exit transition; the adapter owns
// the product's prop shape and the title/description accessibility wiring.

interface DialogState {
  open: boolean
  setOpen: (next: boolean) => void
  descriptionId: string
  hasDescription: boolean
  setHasDescription: (present: boolean) => void
}
const DialogCtx = React.createContext<DialogState | null>(null)

function Dialog({
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
  const value = React.useMemo<DialogState>(
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
  return <DialogCtx value={value}>{children}</DialogCtx>
}

function useDialog(): DialogState {
  const ctx = React.use(DialogCtx)
  if (ctx === null) throw new Error('Dialog components must sit inside <Dialog>')
  return ctx
}

function DialogTrigger({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useDialog()
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
      data-slot="dialog-trigger"
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

function DialogClose({
  asChild = false,
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useDialog()
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler
    }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event)
        setOpen(false)
      },
    })
  }
  return (
    <button
      type="button"
      data-slot="dialog-close"
      onClick={(event) => {
        onClick?.(event)
        setOpen(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size,
  /**
   * Open with focus resting on the dialog itself rather than its first
   * control - for a dialog whose first control is a choice made by key,
   * where the default focus ring reads as "this one is chosen".
   */
  restfulFocus = false,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
  /** the modal's width, any CSS size; the widget's own default otherwise */
  size?: string | number
  restfulFocus?: boolean
}) {
  const { open, setOpen, descriptionId, hasDescription } = useDialog()
  // Compensation, not preference: the library hard-codes aria-describedby
  // after spreading props (undefined without its own Body element), so the
  // association with the product's description paragraph is written on the
  // element. Candidate upstream issue.
  //
  // The mechanics matter twice over. The ref callback must keep a STABLE
  // identity (the focus trap re-runs its focus-the-first-control routine
  // whenever the ref identity changes, which stole focus on every
  // re-render), and the write must happen both on attach (the content
  // mounts through the library's own transition state, outside this
  // component's renders) and when the description arrives later (effect).
  const a11y = React.useRef({ hasDescription, descriptionId })
  a11y.current = { hasDescription, descriptionId }
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const applyA11y = React.useCallback((el?: HTMLDivElement | null) => {
    const node = el === undefined ? contentRef.current : el
    if (el !== undefined) contentRef.current = el
    if (node === null || node === undefined) return
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
      closeOnClickOutside
      transitionProps={{ duration: 100 }}
      {...(size === undefined ? {} : { size })}
    >
      <MModal.Overlay data-slot="dialog-overlay" blur={2} />
      <MModal.Content
        data-slot="dialog-content"
        ref={applyA11y}
        // structure only - the rows a dialog is made of; the surface (color,
        // radius, shadow) is the widget's own under the product theme.
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element, where layout classes wreak havoc
        // `relative`, so the corner button stays anchored to the panel: the
        // entrance animation's transform makes the panel a containing block
        // only while it plays, and an unpositioned panel hands its absolute
        // children to the viewport the moment it ends
        classNames={{ content: cn('relative grid gap-6 p-6 text-sm outline-none', className) }}
        {...props}
      >
        {/* the trap's own documented resting place: focus settles on this
            hidden point instead of the first control */}
        {restfulFocus && <FocusTrap.InitialFocus />}
        {children}
        {showCloseButton && (
          <Button
            data-slot="dialog-close"
            variant="ghost"
            className="absolute top-4 right-4"
            size="icon-sm"
            onClick={() => setOpen(false)}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        )}
      </MModal.Content>
    </MModal.Root>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  )
}

/**
 * The scrollable middle of a dialog. It continues DialogContent's own gap-6
 * rhythm one level down, and trades a margin for padding at net zero so a
 * focus ring at the scroll edge has room instead of being clipped. The
 * height cap belongs to the caller (FormDialog caps the whole content).
 */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('-m-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-1', className)}
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
  const { setOpen } = useDialog()
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Button variant="outline" onClick={() => setOpen(false)}>
          Close
        </Button>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <MModal.Title
      data-slot="dialog-title"
      className={cn('font-heading text-base leading-none font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId, setHasDescription } = useDialog()
  // announce presence so the content only points aria-describedby at a
  // paragraph that exists
  React.useEffect(() => {
    setHasDescription(true)
    return () => setHasDescription(false)
  }, [setHasDescription])
  return (
    <p
      id={descriptionId}
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
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
  DialogTitle,
  DialogTrigger,
}
