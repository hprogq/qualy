import { useEffect, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog.tsx'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../sheet.tsx'

// The overlays, over the library primitives: the same prop shape as always
// (open/title/description/onClose/footer), so a screen never re-states how a
// modal opens, closes or animates.

const styles = stylex.create({
  panel: {
    width: { default: '100%', '@media (min-width: 640px)': null },
    maxWidth: { default: null, '@media (min-width: 640px)': '36rem' },
  },
  panelFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  // never taller than the window, and the middle row is what gives
  formShell: {
    maxHeight: 'calc(100dvh - 2rem)',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
  },
  panelBody: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    paddingInline: 16,
  },
  panelStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    paddingBottom: 16,
  },
})

// A centred modal for a short task - creating something, answering a
// question with a form. Content and buttons arrive as children/footer so the
// dialog itself stays text-free.
export function FormDialog({
  open,
  title,
  description,
  size = 'default',
  restfulFocus = false,
  onClose,
  children,
  footer,
}: {
  open: boolean
  /**
   * Takes a node so a title with something beside it - a chip saying what
   * the thing being filled in is worth - is still this title rather than a
   * second heading built to look like it.
   */
  title: ReactNode
  description?: ReactNode
  /**
   * How much room the task needs. `wide` is for a form that has something to
   * say beside it - the terms it is answering, what was already answered -
   * which at the default width would sit under the form instead of next to
   * it and stop being context.
   */
  size?: 'default' | 'wide'
  /**
   * Open with the focus resting on the dialog itself rather than on its
   * first control. For a dialog whose first control is a choice made by
   * key: opened from the keyboard, the default focus paints a ring on the
   * first option, which reads as "this one is chosen" when nothing is.
   */
  restfulFocus?: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Never taller than the window, and the middle row is what gives:
          a form long enough to outgrow a phone used to push its own footer
          off the bottom, where the button that saves it could not be
          reached. The three rows are the header, the body and the footer -
          a dialog without a footer simply leaves the last one empty. */}
      <DialogContent
        restfulFocus={restfulFocus}
        size={size === 'wide' ? '56rem' : '32rem'}
        className={stylex.props(styles.formShell).className}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

// A panel docked to the right edge for editing one thing in place while the
// list behind stays visible in spirit: inspect, change, close.
export function SidePanel({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* the whole width on a phone: three quarters of a 390px screen is a
          panel with a dead strip beside it and nothing readable inside */}
      <SheetContent side="right" xstyle={styles.panel}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div {...stylex.props(styles.panelBody)}>
          <div {...stylex.props(styles.panelStack)}>{children}</div>
        </div>
        {footer && <SheetFooter xstyle={styles.panelFooter}>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}

// A real modal instead of window.confirm: it can say how much damage the
// action does, it localizes, and a browser test can read and drive it.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  otherLabel,
  pending,
  tone = 'default',
  onConfirm,
  onOther,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  /**
   * A third way out, offered where calling it off is not the only smaller
   * answer: the lesser commitment the question implies - keep the work
   * without handing it on - so that reaching it costs one press and not a
   * dismissal followed by hunting for the other button.
   */
  otherLabel?: string
  pending?: boolean
  /** destructive colours the confirming button, for what cannot be undone */
  tone?: 'default' | 'destructive'
  onConfirm: () => void
  onOther?: () => void
  onCancel: () => void
}) {
  // The words outlive the answer.
  //
  // Whoever opens one of these keeps the subject in state - which person is
  // being removed - and clears it the moment the question is answered. The
  // dialog is still on screen for the length of its closing animation, so the
  // sentence lost its name mid-fade and asked about nobody. Holding the last
  // words it was given costs nothing and means a caller can go on clearing
  // its own state the moment it is done with it.
  const [said, setSaid] = useState({ title, description, confirmLabel, otherLabel })
  useEffect(() => {
    if (open) setSaid({ title, description, confirmLabel, otherLabel })
  }, [open, title, description, confirmLabel, otherLabel])
  const shown = open ? { title, description, confirmLabel, otherLabel } : said

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.title}</AlertDialogTitle>
          {shown.description !== undefined && (
            <AlertDialogDescription>{shown.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-dismiss" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          {shown.otherLabel !== undefined && onOther !== undefined && (
            <AlertDialogAction
              data-testid="confirm-other"
              variant="outline"
              onClick={onOther}
              disabled={pending}
            >
              {shown.otherLabel}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            data-testid="confirm-accept"
            data-tone={tone}
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {shown.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
