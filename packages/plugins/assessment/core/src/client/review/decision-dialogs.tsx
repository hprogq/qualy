import { useEffect, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { Kbd, KbdGroup } from '@qualy/ui/kbd'
import { Textarea } from '@qualy/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { assessmentMessages as m } from '../i18n.ts'
import { fieldsOf } from '../entry/model.ts'
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

/** the configured labels, one pickable at a time; absent list, absent block */
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
        {reasons.map((reason) => (
          <ToggleGroupItem key={reason} value={reason} className="whitespace-nowrap">
            {reason}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
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
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const fields = fieldsOf(review.form.formConfig).filter((field) => field.type !== 'attachment')
  const filed = (review.revision.payload ?? {}) as Record<string, unknown>
  // empty means "keep theirs": only what the reviewer actually typed becomes
  // part of the suggestion, so a box left alone never overwrites anything
  const [suggested, setSuggested] = useState<Record<string, string>>({})
  const ready = comment.trim() !== '' && (reasons.length === 0 || reason !== '')

  // The dialog opens with the cursor in the box, so its keys are read from
  // the document rather than from the panel - a handler on the panel hears
  // nothing once focus moves anywhere else, and heard the letter twice while
  // it was inside. ⌥ carries them through while writing; bare keys work
  // whenever the cursor is not in a field.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement && event.target.closest('input, textarea') !== null
      const reachable = event.altKey || !typing
      if (event.metaKey || event.ctrlKey) return
      if (!reachable) return
      if (event.key === 'g' || event.key === 'G' || event.code === 'KeyG') {
        event.preventDefault()
        setSuggesting((on) => !on)
        return
      }
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
  }, [fields.length])

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

  return (
    <FormDialog
      open={open}
      size="wide"
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
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
        <Field label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
              id={id}
              value={comment}
              rows={3}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
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
        {slot <= 9 && <Kbd>{slot}</Kbd>}
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
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const stages = review.chain.escalation
  const ready = comment.trim() !== '' && (reasons.length === 0 || reason !== '')

  const confirm = () => {
    if (!ready) return
    onConfirm({ ...(reason === '' ? {} : { reason }), comment: comment.trim() })
  }

  return (
    <FormDialog
      open={open}
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
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
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
                      <span className="min-w-0 truncate text-sm">
                        {stage.nodeName ?? format(m.reviewStageSkipped)}
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
