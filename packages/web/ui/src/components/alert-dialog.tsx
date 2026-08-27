'use client'

import * as React from 'react'
import clsx from 'clsx'
import * as stylex from '@stylexjs/stylex'
import { Modal as MModal } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'

// An interruption that demands an answer: same modal substrate as the
// dialog, but with alertdialog semantics, no dismissal by clicking outside,
// and initial focus resting on the cancelling button - the safe answer is
// the one a stray Enter lands on.

const WIDE = '@media (min-width: 640px)'

// the entrance is a CSS insertion animation for the same reason the dialog's
// is; see that file
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
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
  // structure only; the surface is the widget's own under the theme
  content: {
    display: 'grid',
    gap: 24,
    padding: 24,
    outlineStyle: 'none',
    maxWidth: '20rem',
  },
  contentWide: { maxWidth: { default: '20rem', [WIDE]: '28rem' } },
  header: {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    placeItems: 'center',
    gap: 6,
    textAlign: 'center',
  },
  headerRoomy: {
    placeItems: { default: 'center', [WIDE]: 'start' },
    textAlign: { default: 'center', [WIDE]: 'left' },
  },
  headerWithMedia: {
    gridTemplateRows: 'auto auto 1fr',
    columnGap: 24,
  },
  headerRoomyWithMedia: {
    gridTemplateRows: { default: 'auto auto 1fr', [WIDE]: 'auto 1fr' },
  },
  footer: {
    display: 'flex',
    flexDirection: { default: 'column-reverse', [WIDE]: 'row' },
    justifyContent: { default: null, [WIDE]: 'flex-end' },
    gap: 8,
  },
  footerPaired: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  media: {
    marginBottom: 8,
    display: 'inline-flex',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
  },
  mediaRoomy: { gridRow: { default: null, [WIDE]: 'span 2' } },
  title: {
    // size and leading travel together, as the utility this replaces did
    fontSize: 18,
    lineHeight: '1.75rem',
    fontWeight: 500,
  },
  // the title steps aside for the media column once there is room for both
  titleBeside: { gridColumnStart: { default: null, [WIDE]: 2 } },
  description: {
    fontSize: 14,
    lineHeight: '1.25rem',
    textWrap: { default: 'balance', '@media (min-width: 768px)': 'pretty' },
    color: tokens.mutedForeground,
  },
})

/**
 * What the parts of an alert need to know about the whole.
 *
 * The header, the footer, the media and the title all change shape with the
 * dialog's size and with whether a media ornament is present - facts that
 * live on an ANCESTOR and in a SIBLING, which a compiled style cannot read.
 * They are passed down instead, and the media announces itself the way the
 * description announces itself to the root.
 */
interface AlertLayout {
  roomy: boolean
  hasMedia: boolean
  setHasMedia: (present: boolean) => void
}
const LayoutCtx = React.createContext<AlertLayout>({
  roomy: true,
  hasMedia: false,
  setHasMedia: () => {},
})
const useLayout = () => React.use(LayoutCtx)

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
  const [hasMedia, setHasMedia] = React.useState(false)
  const layout = React.useMemo<AlertLayout>(
    () => ({ roomy: size === 'default', hasMedia, setHasMedia }),
    [size, hasMedia],
  )
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
      <MModal.Overlay data-slot="alert-dialog-overlay" blur={2} {...stylex.props(styles.overlay)} />
      <MModal.Content
        data-slot="alert-dialog-content"
        data-size={size}
        ref={applyA11y}
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element. The slot takes a string, which
        // these compiled styles are - they carry no dynamic value.
        classNames={{
          content: clsx(
            stylex.props(styles.content, styles.entrance, size === 'default' && styles.contentWide)
              .className,
            className,
          ),
        }}
        {...props}
      >
        <LayoutCtx value={layout}>{children}</LayoutCtx>
      </MModal.Content>
    </MModal.Root>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const { roomy, hasMedia } = useLayout()
  return (
    <div
      data-slot="alert-dialog-header"
      {...props}
      {...seatOf(
        stylex.props(
          styles.header,
          roomy && styles.headerRoomy,
          hasMedia && styles.headerWithMedia,
          hasMedia && roomy && styles.headerRoomyWithMedia,
        ),
        className,
      )}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  const { roomy } = useLayout()
  return (
    <div
      data-slot="alert-dialog-footer"
      {...props}
      {...seatOf(stylex.props(styles.footer, !roomy && styles.footerPaired), className)}
    />
  )
}

function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  const { roomy, setHasMedia } = useLayout()
  // the header and the title lay themselves out around this, so its presence
  // is announced rather than looked for
  React.useEffect(() => {
    setHasMedia(true)
    return () => setHasMedia(false)
  }, [setHasMedia])
  return (
    <div
      data-slot="alert-dialog-media"
      {...props}
      {...seatOf(stylex.props(styles.media, roomy && styles.mediaRoomy), className)}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const { roomy, hasMedia } = useLayout()
  return (
    <MModal.Title
      data-slot="alert-dialog-title"
      {...props}
      {...seatOf(stylex.props(styles.title, roomy && hasMedia && styles.titleBeside), className)}
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
      {...props}
      {...seatOf(stylex.props(styles.description), className)}
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
