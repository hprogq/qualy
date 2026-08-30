import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog, RequiredMark } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Kbd, KbdGroup } from '@qualy/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Textarea } from '@qualy/ui/textarea'
import { Chip, ChipGroup } from '@qualy/ui/chip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { displayValueOf, fieldsOf } from '../entry/model.ts'
import type { EvidenceFieldSpec } from '../entry/EvidenceForm.tsx'
import { SlideKey } from './touch.tsx'
import { useFinePointer } from './pointer.ts'
import { ValueFieldsForm } from '@qualy/web-value-form/InputValueForm'
import { draftsFromFields, materializeFields, type FieldDraft } from '@qualy/web-value-form/model'
import { parseDecimal, type AtomicSchema } from '@qualy/value-schema'
import { changedSeedKeys, recognitionProblemText } from './recognition.ts'
import type { ReviewDto } from './model.ts'

// The two decisions that carry a word: sending back, and escalating. Each
// dialog collects the word (and the picked reason when the batch configured
// a list), and hands one staged decision back to the workbench - the same
// undo window applies to these as to a plain approval.

const sm = '@media (min-width: 640px)'

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
      default: 'column',
      [sm]: 'row',
    },
    gap: {
      default: 8,
      [sm]: 12,
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
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  /** a last quiet word above the act - faces that matter, still unread */
  caution?: ReactNode
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format, locale } = useI18n()
  const fine = useFinePointer()
  const [comment, setComment] = useState('')

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
  const seed = (form?.seed ?? {}) as Record<string, unknown>
  const locked = form?.locked ?? null
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>(() =>
    draftsFromFields(fields, (locked?.values ?? seed) as Record<string, unknown>),
  )
  const [determinationReason, setDeterminationReason] = useState('')
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

  const confirm = () => {
    if (!ready) return
    const recognition =
      form === null
        ? undefined
        : locked !== null
          ? { values: locked.values as Record<string, unknown> }
          : {
              values: materialized.value!,
              ...(changed ? { reason: determinationReason.trim() } : {}),
            }
    onConfirm({
      comment: comment.trim(),
      ...(recognition === undefined ? {} : { recognition }),
    })
  }

  const body = (
    <>
      {form !== null && (
        <div {...stylex.props(styles.panel)} data-testid="recognition-form">
          <p {...stylex.props(recognitionStyles.sectionLabel)}>{format(m.recognitionSection)}</p>
          {locked !== null && (
            <p {...stylex.props(recognitionStyles.quietNote)}>{format(m.recognitionLockedNote)}</p>
          )}
          <ValueFieldsForm
            fields={fields}
            drafts={drafts}
            onDraft={(id, draft) => setDrafts((current) => ({ ...current, [id]: draft }))}
            locale={locale}
            disabled={locked !== null}
            problems={problems}
            scope="recognition"
          />
          {changed && (
            <Field label={format(m.recognitionReasonLabel)}>
              {(id) => (
                <Input
                  id={id}
                  value={determinationReason}
                  onChange={(event) => setDeterminationReason(event.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      )}
      <Field label={format(m.reviewComment)} hint={fine ? format(m.reviewApproveHint) : undefined}>
        {(id) => (
          <Textarea
            id={id}
            value={comment}
            rows={3}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={fine && form === null}
            onChange={(event) => setComment(event.target.value)}
          />
        )}
      </Field>
    </>
  )

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewApprove)}
        hint={format(m.reviewApproveSheetHint)}
        slideLabel={format(m.reviewSlideApprove)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        {caution}
        {body}
      </DecisionSheet>
    )
  }

  return (
    <FormDialog
      open={open}
      title={format(m.reviewApproveTitle, { name: review.participantName })}
      description={format(m.reviewRejectSubtitle, {
        item: review.itemTitle,
        no: review.revision.revisionNo,
      })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footerRow, styles.footerEnd)}>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            className={stylex.props(styles.approveSolid, styles.approveLift).className}
            disabled={!ready}
            onClick={confirm}
          >
            {format(m.reviewApprove)}
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
        {caution}
        {body}
      </div>
    </FormDialog>
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
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  reasons: readonly string[]
  /** a last quiet word above the act - faces that matter, still unread */
  caution?: ReactNode
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const fields = fieldsOf(review.form.formConfig).filter((field) => field.type !== 'attachment')
  const filed = (review.revision.payload ?? {}) as Record<string, unknown>
  // empty means "keep theirs": only what the reviewer actually typed becomes
  // part of the suggestion, so a box left alone never overwrites anything
  const [suggested, setSuggested] = useState<Record<string, string>>({})
  const commentBox = useRef<HTMLTextAreaElement | null>(null)
  const ready = comment.trim() !== '' && (reasons.length === 0 || reason !== '')

  // The dialog opens with the cursor in the box, so its keys are read from
  // the document rather than from the panel - a handler on the panel hears
  // nothing once focus moves anywhere else, and heard the letter twice while
  // it was inside. Bare digits belong to the reasons; ⌥ carries G and the
  // slot digits through, writing or not.
  useEffect(() => {
    if (!fine) return
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
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>(`[data-suggest-slot="${digit}"]`)?.focus(),
        )
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [fine, fields.length])

  // a typo in a suggestion must hold the door, never file as text where a
  // number belongs - and an all-empty grid stays "keep everything"
  const suggestionsInvalid =
    suggesting &&
    fields.some((field) => suggestionDraftInvalid(field, suggested[field.key] ?? ''))
  const confirm = () => {
    if (!ready || suggestionsInvalid) return
    const changes = Object.fromEntries(
      fields
        .filter((field) => (suggested[field.key] ?? '').trim() !== '')
        .map((field) => [field.key, materializeSuggestion(field, suggested[field.key]!)]),
    )
    onConfirm({
      ...(reason === '' ? {} : { reason }),
      comment: comment.trim(),
      ...(suggesting && Object.keys(changes).length > 0
        ? { suggestedPayload: { ...filed, ...changes } }
        : {}),
    })
  }

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewReject)}
        hint={format(m.reviewRejectFoot)}
        slideLabel={format(m.reviewSlideReject)}
        waiting={format(m.reviewSheetFillFirst)}
        ready={ready}
        onClose={onClose}
        onConfirm={confirm}
      >
        {caution}
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
        <Field required label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
              aria-required
              id={id}
              value={comment}
              rows={3}
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
      title={format(m.reviewRejectTitle, { name: review.participantName })}
      description={format(m.reviewRejectSubtitle, {
        item: review.itemTitle,
        no: review.revision.revisionNo,
      })}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footerRow)}>
          <p {...stylex.props(recognitionStyles.quietNote)}>{format(m.reviewRejectFoot)}</p>
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
              // With reasons to pick, the cursor waits: focus in the box
              // would swallow the digits that pick them. Without any, the
              // words are the first question and the cursor starts there.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={fine && reasons.length === 0}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>

        {fields.length > 0 && (
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
                    original={displayValueOf(field, filed[field.key])}
                    value={suggested[field.key] ?? ''}
                    keepLabel={format(m.reviewSuggestKeep)}
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

/**
 * One field of the comparison: what they wrote, and what would replace it.
 * The box starts empty - empty is "keep theirs" - and a box that has been
 * written in stops looking like the empty ones around it.
 */
/** whether a typed suggestion draft could ever file as this field's value */
const suggestionDraftInvalid = (field: EvidenceFieldSpec, draft: string): boolean => {
  const trimmed = draft.trim()
  if (trimmed === '') return false
  if (field.type === 'integer')
    return !/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))
  if (field.type === 'decimal') return parseDecimal(trimmed) === null
  return false
}

/** the value a suggestion actually files: numbers as numbers */
const materializeSuggestion = (field: EvidenceFieldSpec, draft: string): unknown => {
  const trimmed = draft.trim()
  return field.type === 'integer' ? Number(trimmed) : trimmed
}

function FieldRow({
  slot,
  field,
  original,
  value,
  keepLabel,
  onChange,
}: {
  slot: number
  field: EvidenceFieldSpec
  original: string
  value: string
  keepLabel: string
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
        {original || '—'}
      </span>
      {field.type === 'choice' ? (
        <NativeSelect
          data-suggest-slot={slot}
          className={
            stylex.props(styles.suggestInput, changed ? styles.suggestChanged : styles.suggestIdle)
              .className
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {/* '' keeps theirs, like an untouched text box */}
          <option value="">{keepLabel}</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          type={field.type === 'date' ? 'date' : 'text'}
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
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  reasons: readonly string[]
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
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
              // the same handover as the send-back: digits first, words next
              // eslint-disable-next-line jsx-a11y/no-autofocus
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
                      {stage.label ?? stage.nodeName ?? format(m.reviewStageSkipped)}
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
