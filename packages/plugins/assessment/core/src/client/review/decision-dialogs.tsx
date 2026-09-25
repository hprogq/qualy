import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'

import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog, RequiredMark } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { DatePicker } from '@qualy/ui/date-picker'
import { Kbd, KbdGroup } from '@qualy/ui/kbd'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Textarea } from '@qualy/ui/textarea'
import { Chip, ChipGroup } from '@qualy/ui/chip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { answerOf, displayValueOf, fieldsOf } from '../entry/model.ts'
import type { EvidenceFieldSpec } from '../entry/EvidenceForm.tsx'
import { offeredOptions } from '../entry/model.ts'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import { Choice } from '../items/Choice.tsx'
import { DraftNote } from './DraftNote.tsx'
import { useLocalDraft } from './use-draft.ts'
import { SlideKey } from './touch.tsx'
import { useFinePointer } from './pointer.ts'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import {
  choiceLabel,
  declaredTitle,
  kindOf,
  parseDecimal,
  type AtomicSchema,
} from '@qualy/value-schema'
import { changedSeedKeys, recognitionProblemText } from './recognition.ts'
import { idsOf, valueOf, type ReviewDto } from './model.ts'

// The two decisions that carry a word: sending back, and escalating. Each
// dialog collects the word (and the picked reason when the batch configured
// a list), and hands one staged decision back to the workbench - the same
// undo window applies to these as to a plain approval.

/**
 * Each verdict key's resting ground, named once.
 *
 * Named because it is written twice - the solid wears it, and the lift has to
 * restate it - and two copies of a colour are two colours waiting to differ.
 */
const RESTING = {
  approve: `color-mix(in oklab, ${tokens.success} 80%, black)`,
  reject: `color-mix(in oklab, ${tokens.danger} 80%, black)`,
  escalate: `color-mix(in oklab, ${tokens.primary} 90%, transparent)`,
} as const

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } })

const styles = stylex.create({
  // the drawer's own shape, merged into the sheet's
  drawerPanel: {
    maxHeight: '85dvh',
    gap: 0,
    overflow: 'hidden',
    borderStartStartRadius: 20,
    borderStartEndRadius: 20,
    padding: 0,
  },
  drawerHead: { gap: 2, paddingInline: 16, paddingTop: 6, paddingBottom: 8 },
  drawerTitle: { fontSize: 15 },
  drawerHint: { fontSize: 12, lineHeight: '1rem' },
  // a key cap on a solid button borrows that button's own ink
  onSolid: {
    backgroundColor: 'color-mix(in oklab, currentColor 20%, transparent)',
    color: 'currentColor',
  },
  reasonWords: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  picker: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  pickerHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: 500,
  },
  quietNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  checkIcon: {
    width: 14,
    height: 14,
  },
  grabber: {
    marginInline: 'auto',
    marginTop: 10,
    height: 4,
    width: 36,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  sheetBody: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
    paddingInline: 16,
    paddingBottom: 16,
  },
  sheetFoot: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 'max(1.125rem, env(safe-area-inset-bottom))',
  },
  footerRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  footerEnd: {
    justifyContent: 'flex-end',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  panelTight: { display: 'flex', flexDirection: 'column', gap: 10 },
  // Two halves that scroll on their own, in a body of one height: what was
  // filed on a tinted card to the left, what is determined to the right. The
  // filing must not leave the screen while a long form is filled in; what the
  // values come to and the word for the participant stay at the dialog's foot.
  columns: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.desktop]: 'minmax(0, 5fr) minmax(0, 6fr)',
    },
    columnGap: 24,
    rowGap: 20,
    height: { default: null, [breakpoints.desktop]: 'min(66dvh, 46rem)' },
  },
  half: { display: 'flex', minWidth: 0, minHeight: 0, flexDirection: 'column' },
  halfHead: { display: 'flex', flexShrink: 0, alignItems: 'baseline', gap: 8, paddingBottom: 10 },
  halfTitle: { margin: 0, fontSize: 13, fontWeight: 600, color: tokens.surfaceMutedForeground },
  halfNote: {
    display: 'inline-flex',
    gap: 8,
    margin: 0,
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  halfNoteInk: { color: tokens.surfaceMutedForeground },
  halfNoteWarn: { color: tokens.warning },
  halfNoteBad: { color: tokens.danger },
  fadedHolder: {
    position: 'relative',
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  fade: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    height: 36,
    pointerEvents: 'none',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
  },
  fadeOn: { opacity: 1 },
  fadeSurface: {
    backgroundImage: `linear-gradient(to bottom, transparent, ${tokens.surface})`,
  },
  fadeInset: {
    backgroundImage: `linear-gradient(to bottom, transparent, ${tokens.surfaceInset})`,
  },
  halfArea: { minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  // room for the focus ring of whatever stands at the edge, and for the bar
  halfInner: { paddingLeft: 2, paddingRight: 16, paddingBottom: 2 },
  fieldStack: { display: 'flex', flexDirection: 'column', gap: 14 },
  fieldOne: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLocked: { opacity: 0.6 },
  afterFields: { marginTop: 16 },
  reasonBlock: {
    marginTop: 2,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  // under a determination typed away from the filing: what the filing said,
  // struck through, and the way back to it
  sourceLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    margin: 0,
    fontSize: 12,
    lineHeight: 1.55,
    color: tokens.mutedForeground,
  },
  noShrink: { flexShrink: 0 },
  struck: { minWidth: 0, overflowWrap: 'anywhere', textDecorationLine: 'line-through' },
  linkTag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 18,
    paddingInline: 6,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 400,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    cursor: 'default',
  },
  resetLink: {
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  },
  filing: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
  },
  // a narrow window gives the whole width to what is being written
  filingNarrow: { display: { default: 'none', [breakpoints.desktop]: 'flex' } },
  filingHead: { paddingInline: 16, paddingTop: 14 },
  filingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    margin: 0,
    paddingInline: 16,
    paddingBottom: 14,
  },
  filingRow: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  filingLabel: { fontSize: 12, color: tokens.mutedForeground },
  filingValue: { margin: 0, fontSize: 14, lineHeight: 1.55, overflowWrap: 'anywhere' },
  filingFiles: { display: 'flex', flexDirection: 'column', gap: 4 },
  // the dialog's foot: the score beside the word for the participant, and
  // under them what is still missing and the two keys
  foot: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 10 },
  // what the values come to, under the form that produces them and always in view
  pinned: { flexShrink: 0, paddingTop: 12 },
  standingDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 9999,
    backgroundColor: tokens.warning,
  },
  standingReady: { backgroundColor: tokens.success },
  standingWrong: { backgroundColor: tokens.danger },
  footNote: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12.5,
    textAlign: 'left',
    color: tokens.mutedForeground,
    cursor: 'pointer',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 2,
  },
  preview: {
    display: 'flex',
    minHeight: 58,
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    paddingInline: 14,
    paddingBlock: 10,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
  },
  previewBad: {
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  previewAlert: { width: 15, height: 15, flexShrink: 0, marginTop: 1, color: tokens.danger },
  previewText: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  previewTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
  },
  previewDot: { width: 6, height: 6, borderRadius: 9999, backgroundColor: tokens.border },
  previewDotOn: { backgroundColor: tokens.success },
  previewSpin: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderTopColor: tokens.surfaceMutedForeground,
    animationName: spin,
    animationDuration: '0.8s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  previewQuiet: { color: tokens.mutedForeground },
  previewWords: { fontSize: 12.5, lineHeight: 1.5, color: tokens.mutedForeground },
  previewWordsInk: { fontSize: 13, color: tokens.foreground },
  previewFigure: { display: 'flex', flexShrink: 0, alignItems: 'baseline', gap: 4 },
  previewAmount: {
    flexShrink: 0,
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  previewDash: { color: tokens.border },
  previewUnit: { fontSize: 13, color: tokens.mutedForeground },
  // The verdict solids: the semantic tokens mixed toward black stand in for
  // the fixed emerald and rose shades, hover a step darker, in both schemes.
  // The verdict keys paint their own ground, so they also owe their own
  // answer to a pointer - and their own silence when there is nothing to
  // press. `:hover` still matches a disabled button (only `:active` does
  // not), so a key that refuses every click was lighting up under the
  // cursor as though it were on offer. The lift is a separate style, worn
  // only while the key can be pressed.
  //
  // Each lift restates the resting ground it lifts FROM, and has to: styles
  // compose by property, not by property-and-condition, so a later one
  // saying `default: null` does not leave the earlier value standing - it
  // leaves the property unset, and the button falls back to the ground its
  // own variant paints. These three went black the moment they became
  // pressable, which is the moment somebody had finished filling the form.
  approveSolid: {
    backgroundColor: RESTING.approve,
    color: 'white',
  },
  approveLift: {
    backgroundColor: {
      default: RESTING.approve,
      ':hover': `color-mix(in oklab, ${tokens.success} 70%, black)`,
    },
  },
  rejectSolid: {
    backgroundColor: RESTING.reject,
    color: 'white',
  },
  rejectLift: {
    backgroundColor: {
      default: RESTING.reject,
      ':hover': `color-mix(in oklab, ${tokens.danger} 70%, black)`,
    },
  },
  escalateSolid: {
    backgroundColor: RESTING.escalate,
  },
  escalateLift: {
    backgroundColor: {
      default: RESTING.escalate,
      ':hover': tokens.primary,
    },
  },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 16,
  },
  frameTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  suggestToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 500,
  },
  suggestGrid: {
    display: 'grid',
    gridTemplateColumns: '8rem minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 12,
  },
  gridFoot: {
    gridColumn: 'span 3 / span 3',
    paddingTop: 4,
  },
  rowName: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  rowTheirs: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  rowStruck: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
  },
  suggestInput: {
    height: 32,
    fontSize: 14,
  },
  suggestSeat: { display: 'block', minWidth: 0 },
  // the same two looks, for a widget that takes one style at a time
  suggestPickChanged: {
    height: 32,
    fontSize: 14,
    borderColor: tokens.focusRing,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
  },
  suggestPickIdle: {
    height: 32,
    fontSize: 14,
    backgroundColor: `color-mix(in oklab, ${tokens.input} 10%, transparent)`,
    color: tokens.mutedForeground,
  },
  suggestChanged: {
    borderColor: tokens.focusRing,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
  },
  suggestIdle: {
    backgroundColor: `color-mix(in oklab, ${tokens.input} 10%, transparent)`,
    color: tokens.mutedForeground,
  },
  stageList: {
    display: 'flex',
    flexDirection: {
      default: 'row',
      [breakpoints.phone]: 'column',
    },
    gap: {
      default: 12,
      [breakpoints.phone]: 8,
    },
  },
  stage: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
  },
  stageLast: {
    borderColor: `color-mix(in oklab, ${tokens.foreground} 30%, transparent)`,
  },
  stageNo: {
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
  },
  stageNoLast: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  stageNoIdle: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  stageName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
})

const recognitionStyles = stylex.create({
  sectionLabel: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--q-surface-muted-foreground)',
  },
  quietNote: { margin: 0, fontSize: 12, color: 'var(--q-surface-muted-foreground)' },
})

/** the longest opinion or adjustment reason the decision endpoint takes */
const WORDS_MAX = 2000

/** what both dialogs hand back: exactly the decision endpoint's payload */
export interface WordedDecision {
  reason?: string
  comment: string
  suggestedPayload?: unknown
  /** the determination this approval makes, where the contract asks for one */
  recognition?: { values: Record<string, unknown>; reason?: string }
}

/**
 * The configured labels, one pickable at a time; absent list, absent block.
 *
 * Every label up to the ninth answers to its bare digit - picking the
 * reason is the one thing every send-back and escalation does, so the
 * plainest keys belong to it. The chosen one goes solid with a check: an
 * outline that only thickened was invisible from the corner of an eye.
 */
function ReasonPicker({
  reasons,
  value,
  onChange,
}: {
  reasons: readonly string[]
  value: string
  onChange: (next: string) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  // read from the document, like the dialog's other keys - but never over
  // the comment box: a digit typed into a sentence is a digit, so the keys
  // only answer while the cursor is out of the fields. The dialog holds the
  // cursor back until a reason is picked, which is what makes them land.
  useEffect(() => {
    if (!fine || reasons.length === 0) return
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const typing =
        event.target instanceof HTMLElement && event.target.closest('input, textarea') !== null
      if (typing) return
      const digit = event.code.startsWith('Digit') ? Number(event.code.slice(5)) : Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, reasons.length)) {
        event.preventDefault()
        onChange(reasons[digit - 1]!)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [fine, reasons, onChange])
  if (reasons.length === 0) return null
  return (
    <div {...stylex.props(styles.picker)}>
      <div {...stylex.props(styles.pickerHead)}>
        <span {...stylex.props(styles.pickerLabel)}>
          {format(m.reviewReasonLabel)}
          <RequiredMark />
        </span>
        <span {...stylex.props(styles.quietNote)}>{format(m.reviewReasonHint)}</span>
      </div>
      <ChipGroup value={value} onChange={(next) => onChange(next)}>
        {reasons.map((reason, index) => (
          <Chip key={reason} value={reason}>
            <span {...stylex.props(styles.reasonWords)}>
              {reason}
              {fine && index < 9 && <Kbd>{index + 1}</Kbd>}
            </span>
          </Chip>
        ))}
      </ChipGroup>
    </div>
  )
}

/**
 * The touch face of a worded decision: a sheet from the foot of the screen,
 * confirmed by a slide across.
 *
 * The same questions as the dialog - the reason, the word - but where the
 * thumb is: a centred modal on a phone floats out of reach of the hand
 * that has to answer it, and the hold replaces the ⌘↵ that needs a
 * keyboard. The suggestion grid stays a desktop affordance; three columns
 * of comparison have no honest rendering at 390px.
 */
export function DecisionSheet({
  open,
  title,
  hint,
  slideLabel,
  waiting,
  ready,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  hint: string
  /** the slider's instruction, naming the act it completes */
  slideLabel: string
  waiting: string
  ready: boolean
  onClose: () => void
  onConfirm: () => void
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" xstyle={styles.drawerPanel}>
        <span aria-hidden data-sheet-grab="" {...stylex.props(styles.grabber)} />
        <SheetHeader className={stylex.props(styles.drawerHead).className}>
          <SheetTitle className={stylex.props(styles.drawerTitle).className}>{title}</SheetTitle>
          <SheetDescription className={stylex.props(styles.drawerHint).className}>
            {hint}
          </SheetDescription>
        </SheetHeader>
        <div {...stylex.props(styles.sheetBody)}>{children}</div>
        <div {...stylex.props(styles.sheetFoot)}>
          <SlideKey label={slideLabel} waiting={waiting} ready={ready} onConfirmed={onConfirm} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * A scroll area that says it scrolls: while more lies below, its foot fades
 * into the ground it stands on. The shared bar only shows itself under a
 * pointer, and a column cut off at a clean edge reads as a column that ended.
 */
function FadedScroll({ ground, children }: { ground: 'surface' | 'inset'; children: ReactNode }) {
  const holder = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const viewport = holder.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (viewport === null || viewport === undefined) return
    const read = () =>
      setMore(viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 4)
    read()
    viewport.addEventListener('scroll', read, { passive: true })
    const watch = new ResizeObserver(read)
    watch.observe(viewport)
    if (viewport.firstElementChild !== null) watch.observe(viewport.firstElementChild)
    return () => {
      viewport.removeEventListener('scroll', read)
      watch.disconnect()
    }
  }, [])
  return (
    <div ref={holder} {...stylex.props(styles.fadedHolder)} data-more={more}>
      <ScrollArea xstyle={styles.halfArea}>{children}</ScrollArea>
      <span
        aria-hidden
        {...stylex.props(
          styles.fade,
          ground === 'inset' ? styles.fadeInset : styles.fadeSurface,
          more && styles.fadeOn,
        )}
      />
    </div>
  )
}

/**
 * Approving, with room for a word.
 *
 * The lightest of the four: no reason list, no suggestion grid, one
 * optional opinion. It exists so that approving is the same shape as every
 * other act - the act opens, says what it needs, and is confirmed - rather
 * than the one decision that fires on a bare press.
 */
export function ApproveDialog({
  open,
  review,
  caution,
  initial,
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  /** a last quiet word above the act - faces that matter, still unread */
  caution?: ReactNode
  /**
   * What the last attempt said, when the rule sent it back: the reviewer's
   * own words and determination, returned to them to correct rather than
   * retyped from the seed
   */
  initial?: WordedDecision
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format, locale } = useI18n()
  const listJoin = useList()
  const words = usePickerWords()
  const fine = useFinePointer()
  const [comment, setComment] = useState(initial?.comment ?? '')

  // The determination, where the frozen contract asks for one. The wire
  // hands the fields as opaque ids with their frozen schemas; a sitting
  // that has already settled on a text shows it read-only, and approving
  // confirms that text verbatim. The mount key upstairs remakes this state
  // whenever the review or the locked text changes, so one claim's drafts
  // never leak into the next.
  // `?? null` guards fixtures and callers built before the field existed
  const form = review.recognitionForm ?? null
  const fields = useMemo(
    () =>
      form === null
        ? []
        : form.fields.map((field) => ({ id: field.id, schema: field.schema as AtomicSchema })),
    [form],
  )
  const seed = useMemo(() => (form?.seed ?? {}) as Record<string, unknown>, [form])
  // `?? {}` guards fixtures and callers built before the two fields existed
  const filed = (form?.filed ?? {}) as Record<string, unknown>
  const sources = useMemo(() => (form?.sources ?? {}) as Record<string, string>, [form])
  const filedFields = useMemo(() => fieldsOf(review.form.formConfig), [review.form.formConfig])
  // the other way round, for the filing's side: which determinations read each filed field
  const linked = useMemo(() => {
    const found = new Map<string, string[]>()
    for (const field of fields) {
      const key = sources[field.id]
      if (key === undefined) continue
      found.set(key, [...(found.get(key) ?? []), declaredTitle(field.schema, locale) ?? field.id])
    }
    return found
  }, [fields, sources, locale])
  const locked = form?.locked ?? null
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>(() =>
    draftsFromFields(fields, locked?.values ?? initial?.recognition?.values ?? seed),
  )
  const [determinationReason, setDeterminationReason] = useState(initial?.recognition?.reason ?? '')
  // what the rule sent back outranks what was merely left unfinished, and a
  // settled sitting is read-only, so neither keeps a draft
  const blank = useMemo(
    () => draftsFromFields(fields, (locked?.values ?? seed) as Record<string, unknown>),
    [fields, locked, seed],
  )
  const draft = useLocalDraft<{
    comment: string
    reason: string
    values: Record<string, FieldDraft>
  }>({
    id: initial === undefined && locked === null ? `${review.id}:approve` : null,
    value: { comment, reason: determinationReason, values: drafts },
    empty: (one) =>
      one.comment === '' &&
      one.reason === '' &&
      JSON.stringify(one.values) === JSON.stringify(blank),
    onRestore: (one) => {
      setComment(one.comment)
      setDeterminationReason(one.reason)
      setDrafts(one.values)
    },
  })
  const materialized = useMemo(() => materializeFields(fields, drafts), [fields, drafts])
  const changed =
    form !== null &&
    locked === null &&
    materialized.value !== null &&
    changedSeedKeys(seed, materialized.value).length > 0
  // emptiness disables quietly; only a value that is wrong gets a sentence
  const problems = useMemo(() => {
    const said = new Map<string, string>()
    for (const [id, reason] of materialized.issues) {
      if (reason === 'required') continue
      const schema = fields.find((field) => field.id === id)?.schema
      said.set(id, recognitionProblemText(format, schema, reason))
    }
    return said
  }, [materialized, fields, format])

  const ready =
    form === null ||
    locked !== null ||
    (materialized.value !== null && (!changed || determinationReason.trim() !== ''))

  // what these values would come to, said while they are typed: the same
  // judge and arithmetic the decision runs, a beat after the typing stops
  const preview = useDeterminationPreview(
    review.id,
    form === null
      ? null
      : locked !== null
        ? (locked.values as Record<string, unknown>)
        : materialized.value,
  )

  // values the rule will not take are stopped here, not after the press
  const blocked = preview.kind === 'refused' || preview.kind === 'issues'
  const confirm = () => {
    if (!ready || blocked) return
    const recognition =
      form === null
        ? undefined
        : locked !== null
          ? { values: locked.values as Record<string, unknown> }
          : {
              values: materialized.value!,
              ...(changed ? { reason: determinationReason.trim() } : {}),
            }
    draft.forget()
    onConfirm({
      comment: comment.trim(),
      ...(recognition === undefined ? {} : { recognition }),
    })
  }

  const titleOf = (id: string) => {
    const field = fields.find((one) => one.id === id)
    return field === undefined ? id : (declaredTitle(field.schema, locale) ?? id)
  }
  // a filed value in the words the reviewer reads it in
  const sayFiled = (schema: AtomicSchema, value: unknown) =>
    typeof value === 'boolean'
      ? value
        ? format(m.recognitionYes)
        : format(m.recognitionNo)
      : kindOf(schema) === 'choice'
        ? (choiceLabel(schema as never, String(value), locale) ?? String(value))
        : String(value)
  const movedIds = fields
    .filter((field) => {
      if (sources[field.id] === undefined || !Object.hasOwn(filed, field.id)) return false
      const now = materializeFields([field], drafts).value?.[field.id]
      return now !== undefined && JSON.stringify(now) !== JSON.stringify(filed[field.id])
    })
    .map((field) => field.id)
  const missingIds = [...materialized.issues]
    .filter(([id, reason]) => id !== '' && reason === 'required')
    .map(([id]) => id)
  const changedNames =
    changed && materialized.value !== null
      ? changedSeedKeys(seed, materialized.value).map(titleOf)
      : []
  const reach = (id: string) => {
    const row = document.querySelector(`[data-recognition="${CSS.escape(id)}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus({ preventScroll: true })
  }

  const determination = form !== null && (
    <div {...stylex.props(styles.fieldStack)} data-testid="recognition-form">
      {fields.map((field) => {
        const sourceKey = sources[field.id]
        const sourceLabel =
          sourceKey === undefined
            ? undefined
            : filedFields.find((one) => one.key === sourceKey)?.label
        const filedValue = Object.hasOwn(filed, field.id) ? filed[field.id] : undefined
        const moved = movedIds.includes(field.id)
        return (
          <div
            key={field.id}
            {...stylex.props(styles.fieldOne, locked !== null && styles.fieldLocked)}
            data-recognition={field.id}
            data-linked={sourceLabel !== undefined}
            data-moved={moved}
          >
            <ValueFieldsForm
              words={words}
              fields={[field]}
              drafts={drafts}
              onDraft={(id, draft) => setDrafts((current) => ({ ...current, [id]: draft }))}
              locale={locale}
              disabled={locked !== null}
              problems={problems}
              scope="recognition"
              asideOf={() =>
                locked !== null ? (
                  <span {...stylex.props(styles.linkTag)}>{format(m.reviewTagLocked)}</span>
                ) : sourceLabel !== undefined ? (
                  <span {...stylex.props(styles.linkTag)} data-testid="recognition-source">
                    {format(m.reviewTagLinked, { name: sourceLabel })}
                  </span>
                ) : undefined
              }
            />
            {moved && locked === null && (
              <p {...stylex.props(styles.sourceLine)}>
                <span {...stylex.props(styles.noShrink)}>{format(m.reviewFiledWas)}</span>
                <span {...stylex.props(styles.struck)}>{sayFiled(field.schema, filedValue)}</span>
                <button
                  type="button"
                  data-testid="recognition-reset"
                  {...stylex.props(styles.resetLink)}
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      ...draftsFromFields([field], { [field.id]: filedValue }),
                    }))
                  }
                >
                  {format(m.reviewResetToFiled)}
                </button>
              </p>
            )}
          </div>
        )
      })}
      {locked !== null && (
        <p {...stylex.props(styles.sourceLine)}>{format(m.recognitionLockedNote)}</p>
      )}
      {changed && (
        <div {...stylex.props(styles.reasonBlock)}>
          <Field
            label={format(m.recognitionReasonLabel)}
            required
            hint={format(m.reviewAdjustHint, { names: listJoin(changedNames) })}
          >
            {(id) => (
              <Input
                id={id}
                value={determinationReason}
                maxLength={WORDS_MAX}
                onChange={(event) => setDeterminationReason(event.target.value)}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  )
  // Two different things are written here and they go to different readers:
  // the opinion is a word for the participant, the adjustment reason (above,
  // inside the determination) is kept with the determination for whoever
  // reads it next. Each says so under its own box.
  const commentField = (
    <Field label={format(m.reviewComment)} hint={format(m.reviewApproveHint)}>
      {(id) => (
        <Textarea
          id={id}
          value={comment}
          rows={3}
          maxLength={WORDS_MAX}
          autoFocus={fine && form === null}
          onChange={(event) => setComment(event.target.value)}
        />
      )}
    </Field>
  )

  // Where the approval stands, in one line with a light before it: red for
  // something written that cannot be taken, amber for something still to
  // write, green once the key will work. Red first - a wrong value is the one
  // that will not resolve itself by carrying on down the form.
  const wrongId = [...problems.keys()][0]
  const standing: { tone: 'ready' | 'owed' | 'wrong'; words: string; at?: string } | null =
    form === null || locked !== null
      ? null
      : wrongId !== undefined
        ? {
            tone: 'wrong',
            words: format(m.reviewSummaryWrong, { count: problems.size }),
            at: wrongId,
          }
        : blocked
          ? { tone: 'wrong', words: format(m.reviewStandingRefused) }
          : missingIds[0] !== undefined
            ? {
                tone: 'owed',
                words: format(m.reviewFillFirst, { name: titleOf(missingIds[0]) }),
                at: missingIds[0],
              }
            : !ready
              ? { tone: 'owed', words: format(m.reviewStandingReasonOwed) }
              : { tone: 'ready', words: format(m.reviewStandingReady) }

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewApprove)}
        // in the middle of the escalation route approving is an opinion
        hint={format(
          review.actions.approvalConcludes ? m.reviewApproveSheetHint : m.reviewOpinionFoot,
        )}
        slideLabel={format(m.reviewSlideApprove)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        <DraftNote
          draft={draft}
          onDiscard={() => {
            setComment('')
            setDeterminationReason('')
            setDrafts(blank)
          }}
        />
        {caution}
        {determination}
        {form !== null && <ScorePreview preview={preview} fields={fields} />}
        {commentField}
      </DecisionSheet>
    )
  }

  return (
    <FormDialog
      open={open}
      size={form === null ? 'default' : 'wide'}
      title={format(
        review.actions.approvalConcludes ? m.reviewApproveTitle : m.reviewApproveOpinionTitle,
        { name: review.participantName },
      )}
      description={format(m.reviewRejectSubtitle, {
        item: review.itemTitle,
        no: review.revision.revisionNo,
      })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.foot)}>
          <div {...stylex.props(styles.footerRow)}>
            {standing !== null && (
              <button
                type="button"
                data-testid="approve-standing"
                data-standing={standing.tone}
                {...stylex.props(styles.footNote)}
                {...(standing.at === undefined
                  ? { disabled: true }
                  : { onClick: () => reach(standing.at!) })}
              >
                <span
                  aria-hidden
                  {...stylex.props(
                    styles.standingDot,
                    standing.tone === 'ready' && styles.standingReady,
                    standing.tone === 'wrong' && styles.standingWrong,
                  )}
                />
                {standing.words}
              </button>
            )}
            <span {...stylex.props(styles.spacer)} />
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
              <Kbd>Esc</Kbd>
            </Button>
            <Button
              className={stylex.props(styles.approveSolid, styles.approveLift).className}
              disabled={!ready || blocked}
              onClick={confirm}
            >
              {format(m.reviewApprove)}
              <Kbd className={stylex.props(styles.onSolid).className}>⌘↵</Kbd>
            </Button>
          </div>
        </div>
      }
    >
      <div
        {...stylex.props(styles.panel)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // the page listens for this chord too; one press is one act
            event.stopPropagation()
            confirm()
          }
        }}
      >
        <DraftNote
          draft={draft}
          onDiscard={() => {
            setComment('')
            setDeterminationReason('')
            setDrafts(blank)
          }}
        />
        {caution}
        {form === null ? (
          commentField
        ) : (
          <div {...stylex.props(styles.columns)} data-testid="approve-columns">
            <FiledValues review={review} linked={linked} xstyle={styles.filingNarrow} />
            <section {...stylex.props(styles.half)}>
              <div {...stylex.props(styles.halfHead)}>
                <p {...stylex.props(styles.halfTitle)}>{format(m.recognitionSection)}</p>
                <span {...stylex.props(styles.spacer)} />
                <p
                  {...stylex.props(styles.halfNote)}
                  data-testid="recognition-summary"
                  data-count={fields.length}
                  data-moved={movedIds.length}
                  data-missing={missingIds.length}
                  data-wrong={problems.size}
                >
                  {format(m.reviewSummaryCount, { count: fields.length })}
                  {movedIds.length > 0 && (
                    <span {...stylex.props(styles.halfNoteInk)}>
                      {format(m.reviewSummaryDiffer, { count: movedIds.length })}
                    </span>
                  )}
                  {problems.size > 0 && (
                    <span {...stylex.props(styles.halfNoteBad)}>
                      {format(m.reviewSummaryWrong, { count: problems.size })}
                    </span>
                  )}
                  {missingIds.length > 0 && (
                    <span {...stylex.props(styles.halfNoteWarn)}>
                      {format(m.reviewSummaryMissing, { count: missingIds.length })}
                    </span>
                  )}
                </p>
              </div>
              {fine ? (
                <FadedScroll ground="surface">
                  <div {...stylex.props(styles.halfInner)}>
                    {determination}
                    <div {...stylex.props(styles.reasonBlock, styles.afterFields)}>
                      {commentField}
                    </div>
                  </div>
                </FadedScroll>
              ) : (
                determination
              )}
              <div {...stylex.props(styles.pinned)}>
                <ScorePreview preview={preview} fields={fields} />
              </div>
            </section>
          </div>
        )}
      </div>
    </FormDialog>
  )
}

/** how long the typing has to rest before the arithmetic is asked */
const PREVIEW_SETTLE_MS = 400

type PreviewState =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'issues'
      readonly issues: readonly { readonly recognitionId: string; readonly reason: string }[]
    }
  | { readonly kind: 'amount'; readonly amount: string }

/**
 * The decision path's judgement of the values as they stand, asked a beat
 * after the last keystroke.
 *
 * Nothing is asked while a field is still empty: the screen already says
 * what is missing, and the arithmetic has nothing to add. Keyed by the
 * values themselves, so stepping back to an answer already asked about
 * costs no round trip.
 */
function useDeterminationPreview(
  instanceId: string,
  values: Record<string, unknown> | null,
): PreviewState {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const key = values === null ? null : JSON.stringify(values)
  const [settledKey, setSettledKey] = useState(key)
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), PREVIEW_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [key])
  const settled = useMemo(
    () => (settledKey === null ? null : (JSON.parse(settledKey) as Record<string, unknown>)),
    [settledKey],
  )
  // the endpoint is reached only from inside the query: a screen with no
  // determination to preview never asks, and never needs the door to exist
  const asked = useQuery({
    queryKey: ['assessment', 'previewDetermination', instanceId, settledKey],
    queryFn: () =>
      run(
        api.assessment.previewDetermination({
          params: { instanceId },
          payload: { values: settled ?? {} },
        }),
      ),
    enabled: settled !== null,
    staleTime: 60_000,
    retry: false,
  })
  if (values === null) return { kind: 'incomplete' }
  if (settledKey !== key || asked.isPending) return { kind: 'checking' }
  if (asked.isError || asked.data === undefined) return { kind: 'unavailable' }
  if (asked.data.refusal !== null) return { kind: 'refused', reason: asked.data.refusal }
  if (asked.data.issues.length > 0) return { kind: 'issues', issues: asked.data.issues }
  if (asked.data.amount !== null) return { kind: 'amount', amount: asked.data.amount }
  return { kind: 'unavailable' }
}

/**
 * What the determination would score, or what stops it.
 *
 * One card of one height in every state, so the foot of the dialog does not
 * jump while the values are typed: a figure where there is one, a grey dash
 * where there is not yet. Only a refusal changes ground, because it is the
 * one state that also stops the approval.
 */
function ScorePreview({
  preview,
  fields,
}: {
  preview: PreviewState
  fields: readonly { readonly id: string; readonly schema: AtomicSchema }[]
}) {
  const { format } = useI18n()
  const bad = preview.kind === 'refused' || preview.kind === 'issues'
  const words =
    preview.kind === 'amount'
      ? format(m.reviewPreviewStands)
      : preview.kind === 'refused'
        ? format(m.reviewPreviewRefused, { reason: preview.reason })
        : preview.kind === 'issues'
          ? recognitionProblemText(
              format,
              fields.find((field) => field.id === preview.issues[0]!.recognitionId)?.schema,
              preview.issues[0]!.reason,
            )
          : preview.kind === 'checking'
            ? format(m.reviewPreviewChecking)
            : preview.kind === 'unavailable'
              ? format(m.reviewPreviewUnavailable)
              : format(m.reviewPreviewIncomplete)
  return (
    <div
      {...stylex.props(styles.preview, bad && styles.previewBad)}
      data-testid="score-preview"
      data-preview={preview.kind}
      {...(preview.kind === 'amount' ? { 'data-amount': preview.amount } : {})}
      aria-live="polite"
    >
      {bad && <CircleAlertIcon aria-hidden {...stylex.props(styles.previewAlert)} />}
      <span {...stylex.props(styles.previewText)}>
        <span {...stylex.props(styles.previewTitle)}>
          {!bad &&
            (preview.kind === 'checking' ? (
              <span aria-hidden {...stylex.props(styles.previewSpin)} />
            ) : (
              <span
                aria-hidden
                {...stylex.props(
                  styles.previewDot,
                  preview.kind === 'amount' && styles.previewDotOn,
                )}
              />
            ))}
          {format(m.reviewPreviewTitle)}
        </span>
        <span {...stylex.props(styles.previewWords, bad && styles.previewWordsInk)}>{words}</span>
        {bad && (
          <span {...stylex.props(styles.previewWords)}>{format(m.reviewPreviewFixFirst)}</span>
        )}
      </span>
      {!bad &&
        (preview.kind === 'amount' ? (
          <span {...stylex.props(styles.previewFigure)}>
            <span {...stylex.props(styles.previewAmount)}>{preview.amount}</span>
            <span {...stylex.props(styles.previewUnit)}>{format(m.reviewPreviewUnit)}</span>
          </span>
        ) : (
          <span aria-hidden {...stylex.props(styles.previewAmount, styles.previewDash)}>
            –
          </span>
        ))}
    </div>
  )
}

/** the filing being judged, beside the form that judges it */
function FiledValues({
  review,
  linked,
  xstyle,
}: {
  xstyle?: stylex.StyleXStyles
  review: ReviewDto
  /** payload key of a filed field -> the determinations that take their value from it */
  linked?: ReadonlyMap<string, readonly string[]>
}) {
  const { format } = useI18n()
  const listJoin = useList()
  const words = { yes: format(m.recognitionYes), no: format(m.recognitionNo) }
  const record = (review.revision.payload ?? {}) as Record<string, unknown>
  const fields = fieldsOf(review.form.formConfig)
  return (
    <section
      {...stylex.props(styles.filing, xstyle)}
      data-testid="approve-filing"
      aria-label={format(m.reviewPayloadTitle)}
    >
      <div {...stylex.props(styles.halfHead, styles.filingHead)}>
        <p {...stylex.props(styles.halfTitle)}>{format(m.reviewPayloadTitle)}</p>
        <span {...stylex.props(styles.spacer)} />
        <p {...stylex.props(styles.halfNote)}>
          {format(m.entryVersionNo, { no: review.revision.revisionNo })}
        </p>
      </div>
      <FadedScroll ground="inset">
        <dl {...stylex.props(styles.filingList)}>
          {fields.map((field) => {
            const raw = answerOf(record, field.key)
            const ids = field.type === 'attachment' ? idsOf(raw) : []
            const text = displayValueOf(field, raw, words) || valueOf(raw)
            return (
              <div key={field.key} {...stylex.props(styles.filingRow)}>
                <dt {...stylex.props(styles.filingLabel)}>
                  {field.label}
                  {(linked?.get(field.key)?.length ?? 0) > 0 && (
                    <>
                      {' '}
                      <span
                        {...stylex.props(styles.linkTag)}
                        data-testid="filed-linked"
                        data-field={field.key}
                        title={format(m.reviewLinkedTo, {
                          names: listJoin(linked?.get(field.key) ?? []),
                        })}
                      >
                        {format(m.reviewLinkedTag)}
                      </span>
                    </>
                  )}
                </dt>
                <dd {...stylex.props(styles.filingValue)}>
                  {field.type === 'attachment' ? (
                    ids.length === 0 ? (
                      <span {...stylex.props(styles.previewQuiet)}>
                        {format(m.reviewPreviewNoFiles)}
                      </span>
                    ) : (
                      <span {...stylex.props(styles.filingFiles)}>
                        {ids.map((attachmentId) => (
                          <AttachmentLink
                            key={attachmentId}
                            attachmentId={attachmentId}
                            variant="line"
                          />
                        ))}
                      </span>
                    )
                  ) : text === '' ? (
                    '–'
                  ) : (
                    text
                  )}
                </dd>
              </div>
            )
          })}
          {review.revision.note !== null && review.revision.note !== '' && (
            <div {...stylex.props(styles.filingRow)}>
              <dt {...stylex.props(styles.filingLabel)}>{format(m.entryNote)}</dt>
              <dd {...stylex.props(styles.filingValue)}>{review.revision.note}</dd>
            </div>
          )}
        </dl>
      </FadedScroll>
    </section>
  )
}

/**
 * Sending a submission back (1c): a picked reason, a required word, and -
 * when the reviewer has something concrete to offer - a field-by-field
 * suggestion beside what was filed. The suggestion may rearrange answers,
 * never grow the evidence, so attachment fields are not here at all.
 */
export function RejectDialog({
  open,
  review,
  reasons,
  caution,
  initial,
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  reasons: readonly string[]
  /** a last quiet word above the act - faces that matter, still unread */
  caution?: ReactNode
  /** what the last attempt said, when it came back unsent */
  initial?: WordedDecision
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format, locale } = useI18n()
  const pickerWords = usePickerWords()
  const fine = useFinePointer()
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const fields = fieldsOf(review.form.formConfig).filter((field) => field.type !== 'attachment')
  const filed = (review.revision.payload ?? {}) as Record<string, unknown>
  // advice goes to the person who filed, so it is offered only where this
  // rejection actually reaches them: a word that moves the round on to the
  // next judge carries none, and the server refuses the whole rejection
  // rather than quietly dropping the words somebody wrote
  const maySuggest = fields.length > 0 && review.actions.rejectionReturns
  // empty means "keep theirs": only what the reviewer actually typed becomes
  // part of the suggestion, so a box left alone never overwrites anything.
  // A send-back that came back unsent reopens with its advice as well as
  // its words: the fields it changed, as they were typed.
  const [suggested, setSuggested] = useState<Record<string, string>>(() =>
    suggestionDraftsOf(fields, filed, initial?.suggestedPayload),
  )
  const [suggesting, setSuggesting] = useState(() => Object.keys(suggested).length > 0)
  const commentBox = useRef<HTMLTextAreaElement | null>(null)
  const ready = comment.trim() !== '' && (reasons.length === 0 || reason !== '')
  const draft = useLocalDraft<{
    reason: string
    comment: string
    suggested: Record<string, string>
    suggesting: boolean
  }>({
    id: `${review.id}:reject`,
    value: { reason, comment, suggested, suggesting },
    empty: (one) =>
      one.reason === '' && one.comment === '' && Object.keys(one.suggested).length === 0,
    onRestore: (one) => {
      setReason(one.reason)
      setComment(one.comment)
      setSuggested(one.suggested)
      setSuggesting(one.suggesting)
    },
  })
  const startAgain = () => {
    setReason('')
    setComment('')
    setSuggested({})
    setSuggesting(false)
  }

  // The dialog opens with the cursor in the box, so its keys are read from
  // the document rather than from the panel - a handler on the panel hears
  // nothing once focus moves anywhere else, and heard the letter twice while
  // it was inside. Bare digits belong to the reasons; ⌥ carries G and the
  // slot digits through, writing or not.
  useEffect(() => {
    if (!fine || !maySuggest) return
    const down = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement && event.target.closest('input, textarea') !== null
      if (event.metaKey || event.ctrlKey) return
      if (event.key === 'g' || event.key === 'G' || event.code === 'KeyG') {
        if (!event.altKey && typing) return
        event.preventDefault()
        setSuggesting((on) => !on)
        return
      }
      if (!event.altKey) return
      const digit = event.code.startsWith('Digit') ? Number(event.code.slice(5)) : Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= fields.length) {
        event.preventDefault()
        setSuggesting(true)
        // the row has to exist before it can take the cursor
        requestAnimationFrame(() => {
          // the seat is the input itself, or the widget whose trigger is inside it
          const seat = document.querySelector<HTMLElement>(`[data-suggest-slot="${digit}"]`)
          const focusable =
            seat === null
              ? null
              : seat.matches('input, button, [tabindex]')
                ? seat
                : seat.querySelector<HTMLElement>('input, button, [tabindex]')
          focusable?.focus()
        })
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [fine, maySuggest, fields.length])

  // a typo in a suggestion must hold the door, never file as text where a
  // number belongs - and an all-empty grid stays "keep everything"
  const suggestionsInvalid =
    suggesting &&
    fields.some((field) => suggestionDraftInvalid(field, answerOf(suggested, field.key) ?? ''))
  const confirm = () => {
    if (!ready || suggestionsInvalid) return
    const changes = Object.fromEntries(
      fields
        .filter((field) => (answerOf(suggested, field.key) ?? '').trim() !== '')
        .map((field) => [field.key, materializeSuggestion(field, answerOf(suggested, field.key)!)]),
    )
    draft.forget()
    onConfirm({
      ...(reason === '' ? {} : { reason }),
      comment: comment.trim(),
      ...(maySuggest && suggesting && Object.keys(changes).length > 0
        ? { suggestedPayload: { ...filed, ...changes } }
        : {}),
    })
  }

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewReject)}
        hint={format(review.actions.rejectionReturns ? m.reviewRejectFoot : m.reviewOpinionFoot)}
        slideLabel={format(m.reviewSlideReject)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        <DraftNote draft={draft} onDiscard={startAgain} />
        {caution}
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
        <Field required label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
              aria-required
              id={id}
              value={comment}
              rows={3}
              maxLength={WORDS_MAX}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
      </DecisionSheet>
    )
  }

  return (
    <FormDialog
      open={open}
      size="wide"
      restfulFocus={reasons.length > 0}
      title={format(
        !review.actions.rejectionReturns
          ? m.reviewRejectOpinionTitle
          : review.events.some((event) => event.kind === 'appealed' || event.kind === 'reopened')
            ? m.reviewRejectRevisitTitle
            : m.reviewRejectTitle,
        { name: review.participantName },
      )}
      description={format(m.reviewRejectSubtitle, {
        item: review.itemTitle,
        no: review.revision.revisionNo,
      })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footerRow)}>
          <p {...stylex.props(recognitionStyles.quietNote)}>
            {format(review.actions.rejectionReturns ? m.reviewRejectFoot : m.reviewOpinionFoot)}
          </p>
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            disabled={!ready || suggestionsInvalid}
            className={stylex.props(styles.rejectSolid, ready && styles.rejectLift).className}
            onClick={confirm}
          >
            {format(m.reviewRejectConfirm)}
            <Kbd className={stylex.props(styles.onSolid).className}>⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      <div
        {...stylex.props(styles.panel)}
        onKeyDown={(event) => {
          // the panel answers for the submit chord and nothing else: the
          // suggestion keys are on the document, and a second handler for
          // them here toggled everything twice and so not at all
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // the page listens for this chord too; one press is one act
            event.stopPropagation()
            confirm()
          }
        }}
      >
        <DraftNote draft={draft} onDiscard={startAgain} />
        {caution}
        <ReasonPicker
          reasons={reasons}
          value={reason}
          onChange={(next) => {
            setReason(next)
            // the pick answers the first question; the cursor moves on to
            // the second so the hands never leave the keyboard
            commentBox.current?.focus()
          }}
        />
        <Field required label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
              aria-required
              id={id}
              ref={commentBox}
              value={comment}
              rows={3}
              maxLength={WORDS_MAX}
              // With reasons to pick, the cursor waits: focus in the box
              // would swallow the digits that pick them. Without any, the
              // words are the first question and the cursor starts there.
              autoFocus={fine && reasons.length === 0}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>

        {maySuggest && (
          <div {...stylex.props(styles.frame)}>
            <label {...stylex.props(styles.suggestToggle)}>
              <Checkbox
                checked={suggesting}
                onCheckedChange={(next) => setSuggesting(next === true)}
              />
              {format(m.reviewSuggestToggle)}
              <KbdGroup>
                <Kbd>⌥</Kbd>
                <Kbd>G</Kbd>
              </KbdGroup>
            </label>
            {suggesting && (
              <div {...stylex.props(styles.suggestGrid)}>
                <span {...stylex.props(styles.quietNote)}>{format(m.reviewSuggestField)}</span>
                <span {...stylex.props(styles.quietNote)}>{format(m.reviewSuggestTheirs)}</span>
                <span {...stylex.props(styles.quietNote)}>{format(m.reviewSuggestMine)}</span>
                {fields.map((field, index) => (
                  <FieldRow
                    key={field.key}
                    slot={index + 1}
                    field={field}
                    original={displayValueOf(field, answerOf(filed, field.key), {
                      yes: format(m.recognitionYes),
                      no: format(m.recognitionNo),
                    })}
                    value={answerOf(suggested, field.key) ?? ''}
                    keepLabel={format(m.reviewSuggestKeep)}
                    yesLabel={format(m.recognitionYes)}
                    noLabel={format(m.recognitionNo)}
                    pickerWords={pickerWords}
                    locale={locale}
                    onChange={(next) =>
                      setSuggested((current) => ({ ...current, [field.key]: next }))
                    }
                  />
                ))}
                <p {...stylex.props(styles.quietNote, styles.gridFoot)}>
                  {format(m.reviewSuggestHint)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  )
}

/** whether a typed suggestion draft could ever file as this field's value */
const suggestionDraftInvalid = (field: EvidenceFieldSpec, draft: string): boolean => {
  const trimmed = draft.trim()
  if (trimmed === '') return false
  if (field.type === 'integer')
    return !/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))
  if (field.type === 'decimal') return parseDecimal(trimmed) === null
  return false
}

/** the value a suggestion actually files: numbers as numbers, a yes or no as itself */
const materializeSuggestion = (field: EvidenceFieldSpec, draft: string): unknown => {
  const trimmed = draft.trim()
  if (field.type === 'boolean') return trimmed === 'true'
  return field.type === 'integer' ? Number(trimmed) : trimmed
}

/**
 * The boxes a sent suggestion was typed into, read back out of it: every
 * field it changed, spelled the way that field's box takes it. What it kept
 * of theirs stays empty, which is what keeping theirs looks like.
 */
const suggestionDraftsOf = (
  fields: readonly EvidenceFieldSpec[],
  filed: Record<string, unknown>,
  suggestedPayload: unknown,
): Record<string, string> => {
  if (suggestedPayload === null || typeof suggestedPayload !== 'object') return {}
  const sent = suggestedPayload as Record<string, unknown>
  const drafts: Record<string, string> = {}
  for (const field of fields) {
    const value = answerOf(sent, field.key)
    if (JSON.stringify(value) === JSON.stringify(answerOf(filed, field.key))) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      drafts[field.key] = String(value)
    }
  }
  return drafts
}

/** the pick that keeps their answer, in a list that must name every row */
const KEEP_THEIRS = '\u0000keep'

/**
 * One field of the comparison: what they wrote, and what would replace it.
 * The box starts empty - empty is "keep theirs" - and a box that has been
 * written in stops looking like the empty ones around it.
 */
function FieldRow({
  slot,
  field,
  original,
  value,
  keepLabel,
  yesLabel,
  noLabel,
  pickerWords,
  locale,
  onChange,
}: {
  slot: number
  field: EvidenceFieldSpec
  original: string
  value: string
  keepLabel: string
  yesLabel: string
  noLabel: string
  pickerWords: ReturnType<typeof usePickerWords>
  locale: string
  onChange: (next: string) => void
}) {
  const changed = value.trim() !== ''
  const invalid = suggestionDraftInvalid(field, value)
  return (
    <>
      <span {...stylex.props(styles.rowName)}>
        {slot <= 9 && (
          <KbdGroup>
            <Kbd>⌥</Kbd>
            <Kbd>{slot}</Kbd>
          </KbdGroup>
        )}
        {field.label}
      </span>
      <span {...stylex.props(styles.rowTheirs, changed && styles.rowStruck)}>
        {original || '–'}
      </span>
      {field.type === 'choice' || field.type === 'boolean' ? (
        <span data-suggest-slot={slot} {...stylex.props(styles.suggestSeat)}>
          <Choice
            aria-label={field.label}
            xstyle={changed ? styles.suggestPickChanged : styles.suggestPickIdle}
            value={value === '' ? KEEP_THEIRS : value}
            options={[
              // keeping theirs is the first row, like an untouched text box
              { value: KEEP_THEIRS, label: keepLabel },
              ...(field.type === 'boolean'
                ? [
                    { value: 'true', label: yesLabel },
                    { value: 'false', label: noLabel },
                  ]
                : offeredOptions(field).map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))),
            ]}
            onChange={(next) => onChange(next === KEEP_THEIRS ? '' : next)}
          />
        </span>
      ) : field.type === 'date' ? (
        <span data-suggest-slot={slot} {...stylex.props(styles.suggestSeat)}>
          <DatePicker
            value={value === '' ? null : value}
            placeholder={keepLabel}
            clearLabel={pickerWords.clear}
            localeTag={locale}
            monthLabel={pickerWords.month}
            yearLabel={pickerWords.year}
            xstyle={changed ? styles.suggestPickChanged : styles.suggestPickIdle}
            onChange={(next) => onChange(next ?? '')}
          />
        </span>
      ) : (
        <Input
          type="text"
          aria-label={field.label}
          inputMode={
            field.type === 'integer' ? 'numeric' : field.type === 'decimal' ? 'decimal' : undefined
          }
          aria-invalid={invalid ? true : undefined}
          data-suggest-slot={slot}
          className={
            stylex.props(styles.suggestInput, changed ? styles.suggestChanged : styles.suggestIdle)
              .className
          }
          value={value}
          placeholder={keepLabel}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  )
}

/**
 * Escalating (1f): the picked reason, the word for whoever concludes it, and
 * where the round goes - the escalation route drawn stage by stage, its last
 * step marked as the one that decides.
 */
export function EscalateDialog({
  open,
  review,
  reasons,
  initial,
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  reasons: readonly string[]
  /** what the last attempt said, when it came back unsent */
  initial?: WordedDecision
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const commentBox = useRef<HTMLTextAreaElement | null>(null)
  const stages = review.chain.escalation
  const ready = comment.trim() !== '' && (reasons.length === 0 || reason !== '')

  const confirm = () => {
    if (!ready) return
    onConfirm({ ...(reason === '' ? {} : { reason }), comment: comment.trim() })
  }

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewEscalate)}
        hint={format(m.reviewEscalateFoot)}
        slideLabel={format(m.reviewSlideEscalate)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
        <Field
          required
          label={format(m.reviewEscalateCommentLabel)}
          hint={format(m.reviewEscalateCommentHint)}
        >
          {(id) => (
            <Textarea
              aria-required
              id={id}
              value={comment}
              rows={3}
              maxLength={WORDS_MAX}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
      </DecisionSheet>
    )
  }

  return (
    <FormDialog
      open={open}
      restfulFocus={reasons.length > 0}
      size="wide"
      title={format(m.reviewEscalate)}
      description={format(m.reviewEscalateSubtitle, {
        name: review.participantName,
        item: review.itemTitle,
      })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footerRow)}>
          <p {...stylex.props(recognitionStyles.quietNote)}>{format(m.reviewEscalateFoot)}</p>
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            disabled={!ready}
            className={stylex.props(styles.escalateSolid, ready && styles.escalateLift).className}
            onClick={confirm}
          >
            {format(m.reviewEscalate)}
            <Kbd className={stylex.props(styles.onSolid).className}>⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      <div
        {...stylex.props(styles.panel)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // the page listens for this chord too; one press is one act
            event.stopPropagation()
            confirm()
          }
        }}
      >
        <ReasonPicker
          reasons={reasons}
          value={reason}
          onChange={(next) => {
            setReason(next)
            commentBox.current?.focus()
          }}
        />
        <Field
          required
          label={format(m.reviewEscalateCommentLabel)}
          hint={format(m.reviewEscalateCommentHint)}
        >
          {(id) => (
            <Textarea
              aria-required
              id={id}
              ref={commentBox}
              value={comment}
              rows={3}
              maxLength={WORDS_MAX}
              // the same handover as the send-back: digits first, words next
              autoFocus={fine && reasons.length === 0}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
        {stages.length > 0 && (
          <div {...stylex.props(styles.frame)}>
            <p {...stylex.props(styles.frameTitle)}>{format(m.reviewEscalateFlow)}</p>
            <ol {...stylex.props(styles.stageList)}>
              {stages.map((stage, index) => {
                const last = index === stages.length - 1
                return (
                  <li key={stage.id} {...stylex.props(styles.stage, last && styles.stageLast)}>
                    <span
                      {...stylex.props(
                        styles.stageNo,
                        last ? styles.stageNoLast : styles.stageNoIdle,
                      )}
                    >
                      {index + 1}
                    </span>
                    {/* the administrator's name for the step where one
                        exists; the unit only as the fallback. What each step
                        may do is the same at every rung - any of them can
                        settle it - so the chain says the names and stops */}
                    <span {...stylex.props(styles.stageName)}>
                      {stage.veiled === true
                        ? format(m.reviewStageVeiled)
                        : (stage.label ?? stage.nodeName ?? format(m.reviewStageSkipped))}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </FormDialog>
  )
}
