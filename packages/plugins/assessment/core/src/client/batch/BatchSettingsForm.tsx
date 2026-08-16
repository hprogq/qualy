import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateRangePicker } from '@qualy/ui/date-range-picker'
import { FieldGroup } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
import { Badge } from '@qualy/ui/badge'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { refusalMessage, refusalsOf } from '../refusals.ts'
import { ReopenDialog } from './ReopenDialog.tsx'
import type { BatchDto } from '../phase/model.ts'

// What the batch is, and what may happen to the batch as a whole.
//
// The lifecycle actions live here rather than in the bar above the rail: they
// are rare, they are the kind that asks twice, and a row of them across the
// top of every section made the section itself look like the smaller subject.

/**
 * One subject of the screen: what it is on the left, what to do about it on
 * the right.
 *
 * No card. A card is a thing lifted off the page because it stands beside
 * others like it; a settings screen is one column of subjects read top to
 * bottom, and boxing each of them only adds edges to count.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-b py-6 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 max-w-xl">{children}</div>
    </section>
  )
}

/** one thing that can happen to the round, what it does, and the way to do it */
function LifecycleRow({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

/**
 * One list of pickable labels: chips with a remove, and a box to add one.
 * Order is presentation order in the reviewer's dialog; duplicates fold.
 */
function ReasonList({
  id,
  reasons,
  disabled,
  onChange,
}: {
  id: string
  reasons: readonly string[]
  disabled: boolean
  onChange: (next: readonly string[]) => void
}) {
  const { format } = useI18n()
  const [draft, setDraft] = useState('')
  const add = () => {
    const label = draft.trim()
    if (label === '') return
    if (!reasons.includes(label)) onChange([...reasons, label])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-2">
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason) => (
            <Badge key={reason} variant="outline" className="gap-1 pr-1">
              {reason}
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(reasons.filter((one) => one !== reason))}
                >
                  <XIcon aria-hidden className="size-3" />
                  <span className="sr-only">{reason}</span>
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="h-8 max-w-56 text-sm"
          value={draft}
          disabled={disabled}
          placeholder={format(m.settingsReasonPlaceholder)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || draft.trim() === ''}
          onClick={add}
        >
          <PlusIcon aria-hidden />
          {format(m.settingsReasonAdd)}
        </Button>
      </div>
    </div>
  )
}

export function BatchSettingsForm({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const navigate = usePageNavigate()

  const [name, setName] = useState(batch.name)
  const [description, setDescription] = useState(batch.descriptionMd ?? '')
  const [range, setRange] = useState(batch.materialRange)
  const [rejectReasons, setRejectReasons] = useState<readonly string[]>(batch.reviewReasons.reject)
  const [escalateReasons, setEscalateReasons] = useState<readonly string[]>(
    batch.reviewReasons.escalate,
  )
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null)
  const [reopening, setReopening] = useState(false)

  // the batch as it is now, whoever changed it: a form holding the values
  // from the request that opened the page would silently write them back
  useEffect(() => {
    setName(batch.name)
    setDescription(batch.descriptionMd ?? '')
    setRange(batch.materialRange)
    setRejectReasons(batch.reviewReasons.reject)
    setEscalateReasons(batch.reviewReasons.escalate)
  }, [batch])

  const settle = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  // the plan answers with its own reasons; anything else is a sentence the
  // error catalog already has
  const said = (error: unknown) => {
    const refusals = refusalsOf(error)
    return refusals.length > 0
      ? refusals
          .map((refusal) => {
            const sentence = refusalMessage(refusal.reason)
            return sentence ? format(sentence) : refusal.reason
          })
          .join(' ')
      : formatError(error)
  }

  const save = useMutation({
    mutationFn: () =>
      run(
        api.assessment.updateBatch({
          params: { batchId: batch.id },
          payload: {
            name,
            descriptionMd: description.trim() === '' ? null : description,
            materialRange: range,
            reviewReasons: { reject: rejectReasons, escalate: escalateReasons },
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchSaved))
      await settle()
    },
    onError: (error: unknown) => setFailure(said(error)),
  })

  const archive = useMutation({
    mutationFn: () =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: batch.id },
          payload: { status: 'archived' },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchArchived))
      await settle()
      setConfirming(null)
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  const reopen = useMutation({
    mutationFn: (input: { reason: string; displayName: string }) =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: batch.id },
          payload: {
            status: 'active',
            reason: input.reason,
            phase: { displayName: input.displayName },
            // a reopening that waits has nothing to wait for yet: the new
            // phase is scheduled from the plan afterwards
            plannedEntryAt: null,
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.toastBatchReopened))
      await settle()
      setReopening(false)
    },
    onError: (error: unknown) => {
      setReopening(false)
      setFailure(said(error))
    },
  })

  const remove = useMutation({
    mutationFn: () => run(api.assessment.deleteBatch({ params: { batchId: batch.id } })),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      toast.success(format(m.toastBatchDeleted))
      setConfirming(null)
      // the batch this workspace is about no longer exists
      navigate('assessment/batches', { replace: true })
      void settle()
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  const editable = batch.manageable && batch.status !== 'archived'
  const unchanged =
    name === batch.name &&
    description === (batch.descriptionMd ?? '') &&
    range.start === batch.materialRange.start &&
    range.end === batch.materialRange.end &&
    JSON.stringify(rejectReasons) === JSON.stringify(batch.reviewReasons.reject) &&
    JSON.stringify(escalateReasons) === JSON.stringify(batch.reviewReasons.escalate)

  return (
    <div className="flex flex-col">
      <Feedback message={failure} />

      <Section title={format(m.settingsBasics)} description={format(m.settingsBasicsHint)}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <FieldGroup className="gap-5">
            <Field label={format(m.nameLabel)}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  disabled={!editable}
                  placeholder={format(m.namePlaceholder)}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label={format(m.materialRange)}>
              {(id) => (
                <DateRangePicker
                  id={id}
                  value={range}
                  disabled={!editable}
                  onChange={setRange}
                  placeholder={format(m.pickDateRange)}
                  localeTag={locale}
                  monthLabel={format(commonMessages.calendarMonth)}
                  yearLabel={format(commonMessages.calendarYear)}
                />
              )}
            </Field>
            <Field label={format(m.settingsNote)} hint={format(m.settingsNoteHint)}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={description}
                  disabled={!editable}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            <Field label={format(m.settingsRejectReasons)} hint={format(m.settingsReasonsHint)}>
              {(id) => (
                <ReasonList
                  id={id}
                  reasons={rejectReasons}
                  disabled={!editable}
                  onChange={setRejectReasons}
                />
              )}
            </Field>
            <Field label={format(m.settingsEscalateReasons)} hint={format(m.settingsReasonsEmpty)}>
              {(id) => (
                <ReasonList
                  id={id}
                  reasons={escalateReasons}
                  disabled={!editable}
                  onChange={setEscalateReasons}
                />
              )}
            </Field>
          </FieldGroup>
          <div className="mt-5 flex items-center justify-end gap-3">
            {!unchanged && (
              <span className="text-xs text-muted-foreground">{format(m.settingsUnsaved)}</span>
            )}
            <Button type="submit" disabled={!editable || unchanged || save.isPending}>
              {format(m.saveShort)}
            </Button>
          </div>
        </form>
      </Section>

      {batch.manageable && (
        <Section title={format(m.settingsLifecycle)} description={format(m.settingsLifecycleHint)}>
          <div className="divide-y">
            {batch.status === 'active' && (
              <LifecycleRow
                title={format(m.archive)}
                description={format(m.archiveConfirmBody)}
                action={
                  <Button
                    variant="outline"
                    disabled={archive.isPending}
                    onClick={() => setConfirming('archive')}
                  >
                    {format(m.archive)}
                  </Button>
                }
              />
            )}
            {batch.status === 'archived' && (
              <LifecycleRow
                title={format(m.reopen)}
                description={format(m.reopenBody)}
                action={
                  <Button
                    variant="outline"
                    disabled={reopen.isPending}
                    onClick={() => setReopening(true)}
                  >
                    <RotateCcwIcon />
                    {format(m.reopen)}
                  </Button>
                }
              />
            )}
            {batch.status === 'draft' && (
              <LifecycleRow
                title={format(m.deleteBatch)}
                description={format(m.deleteConfirmBody)}
                action={
                  <Button
                    variant="outline"
                    className="border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => setConfirming('delete')}
                  >
                    <Trash2Icon />
                    {format(m.deleteBatch)}
                  </Button>
                }
              />
            )}
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirming === 'archive'}
        title={format(m.archiveConfirmTitle)}
        description={format(m.archiveConfirmBody)}
        confirmLabel={format(m.archive)}
        cancelLabel={format(m.cancel)}
        pending={archive.isPending}
        tone="destructive"
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title={format(m.deleteConfirmTitle)}
        description={format(m.deleteConfirmBody)}
        confirmLabel={format(m.deleteBatch)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        tone="destructive"
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ReopenDialog
        open={reopening}
        pending={reopen.isPending}
        onCancel={() => setReopening(false)}
        onReopen={(input) => reopen.mutate(input)}
      />
    </div>
  )
}
