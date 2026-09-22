import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, XIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Dialog, DialogContent } from '@qualy/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { Spinner } from '@qualy/ui/spinner'
import { Steps } from '@qualy/ui/steps'
import { useIsBelow } from '@qualy/ui/use-mobile'

// The frame a multi-step errand is run in, at both widths.
//
// One shape, two rooms. Under a pointer it is a panel of a fixed size - the
// head names the errand, a strip says where in it you are, the middle
// scrolls and the foot holds the way on; the five steps ask for very
// different amounts of room, and a panel that resized under each of them
// moved its own buttons out from under the hand on every press.
//
// Under a thumb there is no room for a panel with a margin on four sides, so
// the same four bands take the whole screen: a 48-high head with the way
// back and "3 / 5", a hairline progress bar instead of the named strip, the
// middle, and a foot whose last press is full width, because that is where a
// thumb rests.

const PHONE = 768

const styles = stylex.create({
  // the panel draws its own bands edge to edge, so the dialog's own padding
  // and the air it puts between children are stated away here
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
    overflow: 'hidden',
    height: 'min(40rem, calc(100dvh - 4rem))',
  },
  sheet: {
    height: '100dvh',
    maxHeight: '100dvh',
    borderStartStartRadius: 0,
    borderStartEndRadius: 0,
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    paddingInline: 24,
    paddingBlock: 16,
    // the panel's own close button sits in this corner
    paddingRight: 56,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  title: { margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' },
  subtitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  strip: {
    flexShrink: 0,
    paddingInline: 24,
    paddingBlock: 12,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  body: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingBlock: { default: 20, [breakpoints.phone]: 14 },
  },
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    paddingInline: 24,
    paddingBlock: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  note: { minWidth: 0, fontSize: 12, lineHeight: 1.5, color: tokens.mutedForeground },
  spring: { flexGrow: 1 },

  // ---- the same four bands, under a thumb -------------------------------
  phoneHead: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    paddingInline: 12,
    paddingTop: 4,
  },
  phoneHeadRow: { display: 'flex', alignItems: 'center', gap: 8, height: 48 },
  phoneTitle: { margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' },
  phoneTitleAlone: { paddingLeft: 4 },
  phoneCount: {
    flexShrink: 0,
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  bar: { display: 'flex', gap: 4, paddingBottom: 10 },
  barSeat: {
    height: 3,
    flexGrow: 1,
    flexBasis: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
  },
  barFilled: { backgroundColor: tokens.primary },
  phoneFoot: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 10,
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.surface,
  },
  phoneRow: { display: 'flex', gap: 10 },
  phoneShare: { flexGrow: 1, flexBasis: 0, height: 46 },
  phoneLead: { height: 46, fontSize: 15 },
})

/** one press in the foot; the frame decides where it lands at each width */
export interface FlowAction {
  key: string
  label: ReactNode
  onClick: () => void
  variant?: 'default' | 'outline'
  disabled?: boolean
  pending?: boolean
  /**
   * Narrow, a row of its own at the very bottom.
   *
   * The way on from this step, under the thumb that is already there. The
   * rest share the line above it.
   */
  lead?: boolean
}

function press(action: FlowAction, phone: boolean, xstyle: stylex.StyleXStyles) {
  return (
    <Button
      key={action.key}
      variant={action.variant ?? 'default'}
      disabled={action.disabled === true || action.pending === true}
      onClick={action.onClick}
      {...(phone ? { className: stylex.props(xstyle).className } : {})}
    >
      {action.pending === true && <Spinner />}
      {action.label}
    </Button>
  )
}

/**
 * A multi-step errand, framed.
 *
 * `steps` names them for a pointer and counts them for a thumb; `note` is the
 * one grey line the foot echoes this step's context on; `pinned` is a phone's
 * own band above the buttons, for a summary that has to stay in sight while
 * the middle scrolls.
 */
export function FlowFrame({
  open,
  onClose,
  title,
  subtitle,
  steps,
  step,
  onStep,
  onBack,
  backLabel,
  headActions,
  foot,
  note,
  pinned,
  cancelLabel,
  closeLabel,
  actions,
  testId,
  children,
}: {
  open: boolean
  /** absent once the errand has written something: there is only the way on */
  onClose?: (() => void) | undefined
  title: string
  /** what is being worked on, said quietly beside the name; a pointer's only */
  subtitle?: string | undefined
  steps?: readonly string[] | undefined
  step?: number | undefined
  /** given, a finished step is a way back to it */
  onStep?: ((index: number) => void) | undefined
  onBack?: (() => void) | undefined
  /** the word on the way back, which a pointer reads and a thumb does not */
  backLabel?: string
  /** at the far end of the head: what can be started from here */
  headActions?: ReactNode
  /**
   * The whole foot, in place of the cancel-and-actions row.
   *
   * For a panel whose foot counts rather than decides - a list walked by
   * page. The frame still draws the band and its rule.
   */
  foot?: ReactNode
  note?: ReactNode
  /** narrow only: a band of its own between the middle and the buttons */
  pinned?: ReactNode
  cancelLabel: string
  closeLabel: string
  actions: readonly FlowAction[]
  testId?: string
  children: ReactNode
}) {
  const phone = useIsBelow(PHONE)

  if (phone) {
    const lead = actions.filter((action) => action.lead === true)
    const rest = actions.filter((action) => action.lead !== true)
    const way = onBack ?? onClose
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose?.()}>
        <SheetContent side="bottom" showCloseButton={false} xstyle={styles.sheet} data-testid={testId}>
          <div {...stylex.props(styles.phoneHead)}>
            <div {...stylex.props(styles.phoneHeadRow)}>
              {way !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={onBack === undefined ? closeLabel : cancelLabel}
                  onClick={way}
                >
                  {onBack === undefined ? <XIcon aria-hidden /> : <ArrowLeftIcon aria-hidden />}
                </Button>
              )}
              <SheetTitle
                {...stylex.props(styles.phoneTitle, way === undefined && styles.phoneTitleAlone)}
              >
                {title}
              </SheetTitle>
              <span {...stylex.props(styles.spring)} />
              {headActions}
              {steps !== undefined && step !== undefined && (
                <span {...stylex.props(styles.phoneCount)}>
                  {step + 1} / {steps.length}
                </span>
              )}
            </div>
            {steps !== undefined && step !== undefined && (
              <div aria-hidden {...stylex.props(styles.bar)}>
                {steps.map((name, index) => (
                  <span
                    key={name}
                    {...stylex.props(styles.barSeat, index <= step && styles.barFilled)}
                  />
                ))}
              </div>
            )}
          </div>
          <div {...stylex.props(styles.body)}>{children}</div>
          <div {...stylex.props(styles.phoneFoot)}>
            {foot}
            {pinned}
            {note !== undefined && note !== null && <span {...stylex.props(styles.note)}>{note}</span>}
            {foot === undefined && rest.length > 0 && (
              <div {...stylex.props(styles.phoneRow)}>
                {rest.map((action) => press(action, true, styles.phoneShare))}
              </div>
            )}
            {foot === undefined && lead.map((action) => press(action, true, styles.phoneLead))}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      {/* The first control in this panel is a step of the strip, and the
          focus ring landing on it reads as "this one is chosen" when the
          reader has chosen nothing. */}
      <DialogContent
        restfulFocus
        size="55rem"
        showCloseButton={onClose !== undefined}
        xstyle={styles.panel}
        data-testid={testId}
      >
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.words)}>
            <h2 {...stylex.props(styles.title)}>{title}</h2>
            {subtitle !== undefined && subtitle !== '' && (
              <span {...stylex.props(styles.subtitle)}>{subtitle}</span>
            )}
          </div>
          <span {...stylex.props(styles.spring)} />
          {headActions}
        </div>
        {steps !== undefined && step !== undefined && (
          <div {...stylex.props(styles.strip)}>
            <Steps steps={steps} current={step} {...(onStep ? { onSelect: onStep } : {})} />
          </div>
        )}
        <div {...stylex.props(styles.body)}>{children}</div>
        <div {...stylex.props(styles.foot)}>
          {foot}
          {onBack !== undefined && backLabel !== undefined && (
            <Button variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
          )}
          {note !== undefined && note !== null && <span {...stylex.props(styles.note)}>{note}</span>}
          <span {...stylex.props(styles.spring)} />
          {foot === undefined && onClose !== undefined && (
            <Button variant="outline" onClick={onClose}>
              {cancelLabel}
            </Button>
          )}
          {foot === undefined && actions.map((action) => press(action, false, styles.phoneLead))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
