'use client'

import * as React from 'react'
import clsx from 'clsx'
import * as stylex from '@stylexjs/stylex'
import { FocusTrap, Modal as MModal } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'
import { VisuallyHidden } from '../lib/visually-hidden.tsx'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'
import { XIcon } from 'lucide-react'

// The Qualy dialog keeps its compound shape over the widget library's modal.
// The library owns the portal, the focus trap, the scroll lock, the Escape
// policy (window listener that ignores marked elements - what lets an inner
// popover or select answer first) and the exit transition; the adapter owns
// the product's prop shape and the title/description accessibility wiring.

// The entrance is a CSS insertion animation rather than the widget's own
// transition: its transition machine treats a modal that mounts already open
// as already entered (a dialog a page mounts on demand appeared with no
// entrance at all), while a keyframe plays on every DOM insertion. The
// keyframes themselves stay in the stylesheet - they are a global name, and
// one of them is still shared with a component this batch did not touch.
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  // One veil for the whole overlay family. The fade is promoted to its own
  // layer: a backdrop-filter whose opacity animates on the page's layer makes
  // mobile Safari re-rasterize everything behind it on every frame, which
  // reads as the background flashing while the panel opens.
  overlay: {
    animationName: { default: 'q-overlay-in', [REDUCE]: 'none' },
    animationDuration: { default: '150ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
    isolation: 'isolate',
    willChange: 'opacity',
  },
  entrance: {
    animationName: { default: 'q-pop-in', [REDUCE]: 'none' },
    animationDuration: { default: '150ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease',
  },
  // structure only - the rows a dialog is made of; the surface (colour,
  // radius, shadow) is the widget's own under the product theme
  content: {
    position: 'relative',
    display: 'grid',
    gap: 24,
    padding: 24,
    // size and leading travel together: the utility this replaces set both,
    // and stating only the size left the panel a fraction taller
    fontSize: 14,
    lineHeight: '1.25rem',
    outlineStyle: 'none',
  },
  // the corner button is anchored to the panel, which `relative` above keeps
  // it able to be: the entrance animation's transform makes the panel a
  // containing block only while it plays, and an unpositioned panel hands
  // its absolute children to the viewport the moment it ends
  close: {
    position: 'absolute',
    insetBlockStart: 16,
    insetInlineEnd: 16,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    minHeight: 0,
    gap: 24,
    overflowY: 'auto',
    // a margin traded for padding at net zero, so a focus ring at the scroll
    // edge has room instead of being clipped
    margin: -4,
    padding: 4,
  },
  footer: {
    display: 'flex',
    flexDirection: { default: 'column-reverse', '@media (min-width: 640px)': 'row' },
    justifyContent: { default: null, '@media (min-width: 640px)': 'flex-end' },
    gap: 8,
  },
  title: {
    fontSize: 16,
    lineHeight: 1,
    fontWeight: 500,
  },
  description: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
})

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
  size = '32rem',
  /**
   * Open with focus resting on the dialog itself rather than its first
   * control - for a dialog whose first control is a choice made by key,
   * where the default focus ring reads as "this one is chosen".
   */
  restfulFocus = false,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
  /**
   * How wide the panel is, as any CSS size. It has to be said here rather
   * than as a compiled `max-width`: the widget sizes the panel with
   * `flex-basis`, which a max-width can narrow but never widen - six dialogs
   * asking for 42 to 56rem all sat at the widget's own 440px default.
   */
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
      size={size}
    >
      <MModal.Overlay data-slot="dialog-overlay" blur={2} {...stylex.props(styles.overlay)} />
      <MModal.Content
        data-slot="dialog-content"
        ref={applyA11y}
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element, where layout rules wreak havoc.
        // The slot takes a string, which these compiled styles are - they
        // carry no dynamic value, so nothing is left in an inline style.
        classNames={{
          content: clsx(stylex.props(styles.content, styles.entrance).className, className),
        }}
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
            className={stylex.props(styles.close).className}
            size="icon-sm"
            onClick={() => setOpen(false)}
          >
            <XIcon />
            <VisuallyHidden>Close</VisuallyHidden>
          </Button>
        )}
      </MModal.Content>
    </MModal.Root>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" {...props} {...seatOf(stylex.props(styles.header), className)} />
  )
}

/**
 * The scrollable middle of a dialog. It continues the content's own rhythm
 * one level down; the height cap belongs to the caller (FormDialog caps the
 * whole content).
 */
function DialogBody({
  className,
  xstyle,
  ...props
}: React.ComponentProps<'div'> & {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
}) {
  return (
    <div
      data-slot="dialog-body"
      {...props}
      {...seatOf(stylex.props(styles.body, xstyle), className)}
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
    <div data-slot="dialog-footer" {...props} {...seatOf(stylex.props(styles.footer), className)}>
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
      {...props}
      {...seatOf(stylex.props(styles.title), className)}
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
      {...props}
      {...seatOf(stylex.props(styles.description), className)}
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
