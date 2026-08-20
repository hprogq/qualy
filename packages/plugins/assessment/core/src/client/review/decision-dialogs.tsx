import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { Kbd, KbdGroup } from '@qualy/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Textarea } from '@qualy/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { assessmentMessages as m } from '../i18n.ts'
import { fieldsOf } from '../entry/model.ts'
import { SlideKey } from './touch.tsx'
import { useFinePointer } from './pointer.ts'
import type { ReviewDto } from './model.ts'

// The two decisions that carry a word: sending back, and escalating. Each
// dialog collects the word (and the picked reason when the batch configured
// a list), and hands one staged decision back to the workbench - the same
// undo window applies to these as to a plain approval.

/** what both dialogs hand back: exactly the decision endpoint's payload */
export interface WordedDecision {
  reason?: string
  comment: string
  suggestedPayload?: unknown
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
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">
          {format(m.reviewReasonLabel)}
          <span aria-hidden className="pl-0.5 text-destructive">
            *
          </span>
        </span>
        <span className="text-xs text-muted-foreground">{format(m.reviewReasonHint)}</span>
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="flex-wrap justify-start"
        value={value}
        onValueChange={(next) => onChange(next)}
      >
        {reasons.map((reason, index) => {
          const picked = value === reason
          return (
            <ToggleGroupItem
              key={reason}
              value={reason}
              className={cn(
                'whitespace-nowrap',
                'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
              )}
            >
              {picked && <CheckIcon aria-hidden className="size-3.5" />}
              {reason}
              {fine && index < 9 && (
                <Kbd className={cn(picked && 'bg-white/20 text-white')}>{index + 1}</Kbd>
              )}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
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
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-[20px] p-0"
      >
        <span
          aria-hidden
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
        />
        <SheetHeader className="gap-0.5 px-4 pt-1.5 pb-2">
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          <SheetDescription className="text-xs">{hint}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {children}
        </div>
        <div className="shrink-0 border-t px-4 pt-3 pb-[max(1.125rem,env(safe-area-inset-bottom))]">
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
  onClose,
  onConfirm,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  review: ReviewDto
  onClose: () => void
  onConfirm: (decision: WordedDecision) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const [comment, setComment] = useState('')
  const confirm = () => onConfirm({ comment: comment.trim() })

  const body = (
    <Field label={format(m.reviewComment)} hint={fine ? format(m.reviewApproveHint) : undefined}>
      {(id) => (
        <Textarea
          id={id}
          value={comment}
          rows={3}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={fine}
          onChange={(event) => setComment(event.target.value)}
        />
      )}
    </Field>
  )

  if (!fine) {
    return (
      <DecisionSheet
        open={open}
        title={format(m.reviewApprove)}
        hint={format(m.reviewApproveSheetHint)}
        slideLabel={format(m.reviewSlideApprove)}
        waiting={format(m.reviewSheetFillFirst)}
        ready
        onClose={onClose}
        onConfirm={confirm}
      >
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
        <div className="flex w-full items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            className="bg-emerald-600/90 text-white hover:bg-emerald-600 dark:bg-emerald-700/80 dark:hover:bg-emerald-700"
            onClick={confirm}
          >
            {format(m.reviewApprove)}
            <Kbd className="bg-white/20 text-white">⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      <div
        className="flex flex-col gap-5"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // the page listens for this chord too; one press is one act
            event.stopPropagation()
            confirm()
          }
        }}
      >
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

  const confirm = () => {
    if (!ready) return
    const changes = Object.fromEntries(
      Object.entries(suggested).filter(([, value]) => value.trim() !== ''),
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
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
        <Field label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
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
        <div className="flex w-full items-center gap-3">
          <p className="text-xs text-muted-foreground">{format(m.reviewRejectFoot)}</p>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            disabled={!ready}
            className="bg-rose-600/90 text-white hover:bg-rose-600 dark:bg-rose-700/80 dark:hover:bg-rose-700"
            onClick={confirm}
          >
            {format(m.reviewRejectConfirm)}
            <Kbd className="bg-white/20 text-white">⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      <div
        className="flex flex-col gap-5"
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
        <Field label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
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
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
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
              <div className="grid grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  {format(m.reviewSuggestField)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(m.reviewSuggestTheirs)}
                </span>
                <span className="text-xs text-muted-foreground">{format(m.reviewSuggestMine)}</span>
                {fields.map((field, index) => {
                  const original =
                    typeof filed[field.key] === 'string' ? (filed[field.key] as string) : ''
                  const mine = suggested[field.key] ?? ''
                  return (
                    <FieldRow
                      key={field.key}
                      slot={index + 1}
                      label={field.label}
                      original={original}
                      value={mine}
                      type={field.type === 'date' ? 'date' : 'text'}
                      keepLabel={format(m.reviewSuggestKeep)}
                      onChange={(next) =>
                        setSuggested((current) => ({ ...current, [field.key]: next }))
                      }
                    />
                  )
                })}
                <p className="col-span-3 pt-1 text-xs text-muted-foreground">
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
function FieldRow({
  slot,
  label,
  original,
  value,
  type,
  keepLabel,
  onChange,
}: {
  slot: number
  label: string
  original: string
  value: string
  type: 'text' | 'date'
  keepLabel: string
  onChange: (next: string) => void
}) {
  const changed = value.trim() !== ''
  return (
    <>
      <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground">
        {slot <= 9 && (
          <KbdGroup>
            <Kbd>⌥</Kbd>
            <Kbd>{slot}</Kbd>
          </KbdGroup>
        )}
        {label}
      </span>
      <span
        className={cn('min-w-0 truncate text-sm', changed && 'text-muted-foreground line-through')}
      >
        {original || '—'}
      </span>
      <Input
        type={type}
        data-suggest-slot={slot}
        className={cn(
          'h-8 text-sm',
          changed ? 'border-ring bg-accent/50' : 'bg-input/10 text-muted-foreground',
        )}
        value={value}
        placeholder={keepLabel}
        onChange={(event) => onChange(event.target.value)}
      />
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
          label={format(m.reviewEscalateCommentLabel)}
          hint={format(m.reviewEscalateCommentHint)}
        >
          {(id) => (
            <Textarea
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
        <div className="flex w-full items-center gap-3">
          <p className="text-xs text-muted-foreground">{format(m.reviewEscalateFoot)}</p>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
            <Kbd>Esc</Kbd>
          </Button>
          <Button disabled={!ready} className="bg-primary/90 hover:bg-primary" onClick={confirm}>
            {format(m.reviewEscalate)}
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">⌘↵</Kbd>
          </Button>
        </div>
      }
    >
      <div
        className="flex flex-col gap-5"
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
          label={format(m.reviewEscalateCommentLabel)}
          hint={format(m.reviewEscalateCommentHint)}
        >
          {(id) => (
            <Textarea
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
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <p className="text-sm font-medium">{format(m.reviewEscalateFlow)}</p>
            <ol className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              {stages.map((stage, index) => {
                const last = index === stages.length - 1
                return (
                  <li
                    key={stage.id}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2',
                      last && 'border-foreground/30',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums',
                        last
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      {/* the administrator's name for the step where one
                          exists; the unit only as the fallback */}
                      <span className="min-w-0 truncate text-sm">
                        {stage.label ?? stage.nodeName ?? format(m.reviewStageSkipped)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {last
                          ? format(m.reviewEscalateStageDecide)
                          : format(m.reviewEscalateStageAdvise)}
                      </span>
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
