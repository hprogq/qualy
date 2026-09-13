'use client'

import * as React from 'react'
import clsx from 'clsx'
import * as stylex from '@stylexjs/stylex'
import { Modal as MModal } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { breakpoints } from '../theme/breakpoints.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'
import { veil } from '../lib/veil.ts'
import { retainInertBackground } from '../lib/inert-background.ts'
import { Button } from './button.tsx'

// An interruption that demands an answer: same modal substrate as the
// dialog, but with alertdialog semantics, no dismissal by clicking outside,
// and initial focus resting on the cancelling button - the safe answer is
// the one a stray Enter lands on.

// the entrance is a CSS insertion animation for the same reason the dialog's
// is; see that file
const REDUCE = '@media (prefers-reduced-motion: reduce)'

/** how long the exit plays; the closing styles below match it */
const EXIT_MS = 120

/**
 * The panel's presence, owning the exit, as the dialog's; see that file.
 *
 * The library's transition machine never runs here: entrances are CSS
 * insertion animations, so they also play for a dialog that mounts already
 * open, and the library's duration is zero. Handed an exit duration it
 * would remount both layers to play it - a fresh panel replaying its
 * entrance while the veil faded out, which is what a close looked like.
 * So the adapter holds the dialog mounted for one exit beat after `open`
 * turns false - however the close arrived - and marks the panel closing
 * for the style below to fade and lower it; the veil stands until both go.
 */
function useExit(open: boolean): { shown: boolean; closing: boolean } {
  const [shown, setShown] = React.useState(open)
  const [closing, setClosing] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setClosing(false)
      setShown(true)
      return
    }
    if (!shown) return
    // a reader who asked for less motion gets the instant close
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => {
      setClosing(false)
      setShown(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return { shown, closing }
}

const styles = stylex.create({
  // the same veil (lib/veil.ts) and the same material as the dialog's; see
  // that file
  entrance: {
    animationName: { default: 'q-dialog-in', [REDUCE]: 'none' },
    animationDuration: { default: '170ms', [REDUCE]: '0s' },
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  // the way out: the panel fades and settles a little lower - a little
  // faster and a little less far than it came - while the veil stands as
  // it is until both are gone. The veil carries the blur, and a blur
  // under an animating opacity is re-run by WebKit on every frame; the
  // page coming back into focus the instant the panel has gone reads as
  // the page being given back, not as a cut
  panelClosing: {
    opacity: 0,
    transform: 'translateY(4px)',
    transitionProperty: { default: 'opacity, transform', [REDUCE]: 'none' },
    transitionDuration: { default: '120ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease',
    pointerEvents: 'none',
  },
  content: {
    display: 'grid',
    gap: 24,
    padding: 24,
    backgroundColor: `color-mix(in oklch, ${tokens.surface} 96%, transparent)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
    boxShadow: `${tokens.elevation3}, inset 0 1px 0 color-mix(in oklch, ${tokens.surface} 35%, transparent)`,
    outlineStyle: 'none',
  },
  // The measure is the widget's `size` prop, because it sizes the panel with
  // flex-basis and a max-width can only narrow that. What stays here is the
  // narrow-screen cap, which the prop cannot express: a phone gets the small
  // alert's measure whichever size was asked for.
  narrowCap: { maxWidth: { default: 'none', [breakpoints.phone]: '20rem' } },
  header: {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    placeItems: 'center',
    gap: 6,
    textAlign: 'center',
  },
  headerRoomy: {
    placeItems: { default: 'start', [breakpoints.phone]: 'center' },
    textAlign: { default: 'left', [breakpoints.phone]: 'center' },
  },
  headerWithMedia: {
    gridTemplateRows: 'auto auto 1fr',
    columnGap: 24,
  },
  headerRoomyWithMedia: {
    gridTemplateRows: { default: 'auto 1fr', [breakpoints.phone]: 'auto auto 1fr' },
  },
  footer: {
    display: 'flex',
    flexDirection: { default: 'row', [breakpoints.phone]: 'column-reverse' },
    justifyContent: {
      default: null,
      [breakpoints.tablet]: 'flex-end',
      [breakpoints.desktop]: 'flex-end',
    },
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
  mediaRoomy: {
    gridRow: { default: null, [breakpoints.tablet]: 'span 2', [breakpoints.desktop]: 'span 2' },
  },
  title: {
    // size and leading travel together, as the utility this replaces did
    fontSize: 18,
    lineHeight: '1.75rem',
    fontWeight: 500,
  },
  // the title steps aside for the media column once there is room for both
  titleBeside: {
    gridColumnStart: { default: null, [breakpoints.tablet]: 2, [breakpoints.desktop]: 2 },
  },
  description: {
    fontSize: 14,
    lineHeight: '1.25rem',
    textWrap: { default: 'pretty', [breakpoints.phone]: 'balance' },
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
  const { shown, closing } = useExit(open)
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
  // the page behind a modal leaves the conversation entirely, for as long
  // as the modal is on the page - which is one beat longer than it is open
  React.useEffect(() => {
    if (!shown) return
    return retainInertBackground(() => contentRef.current)
  }, [shown])
  return (
    <MModal.Root
      opened={shown}
      onClose={() => setOpen(false)}
      centered
      trapFocus
      returnFocus
      lockScroll
      closeOnEscape={!closing}
      // an alert is answered, not dismissed by a stray click on the page
      closeOnClickOutside={false}
      transitionProps={{ duration: 0 }}
      size={size === 'default' ? '28rem' : '20rem'}
    >
      <MModal.Overlay data-slot="alert-dialog-overlay" {...stylex.props(veil.blur)}>
        <div
          aria-hidden
          {...stylex.props(veil.tint, closing && veil.tintClosing, closing && veil.tintExit(EXIT_MS))}
        />
      </MModal.Overlay>
      <MModal.Content
        data-slot="alert-dialog-content"
        data-size={size}
        ref={applyA11y}
        // classNames.content, not className: the widget duplicates className
        // onto its positioning inner element. The slot takes a string, which
        // these compiled styles are - they carry no dynamic value.
        {...(closing ? { 'data-closing': '' } : {})}
        classNames={{
          content: clsx(
            stylex.props(
              styles.content,
              styles.entrance,
              size === 'default' && styles.narrowCap,
              closing && styles.panelClosing,
            ).className,
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
