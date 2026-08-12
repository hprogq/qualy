import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Feedback, Field, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateRangePicker } from '@qualy/ui/date-range-picker'
import { FieldGroup } from '@qualy/ui/field'
import { Input } from '@qualy/ui/input'
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
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null)
  const [reopening, setReopening] = useState(false)

  // the batch as it is now, whoever changed it: a form holding the values
  // from the request that opened the page would silently write them back
  useEffect(() => {
    setName(batch.name)
    setDescription(batch.descriptionMd ?? '')
    setRange(batch.materialRange)
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
    range.end === batch.materialRange.end

  return (
    <div className="flex flex-col gap-4">
      <Feedback message={failure} />

      <Panel title={format(m.settingsBasics)} description={format(m.settingsBasicsHint)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <FieldGroup>
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
          </FieldGroup>
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
          <div className="flex justify-end">
            <Button type="submit" disabled={!editable || unchanged || save.isPending}>
              {format(m.saveShort)}
            </Button>
          </div>
        </form>
      </Panel>

      {batch.manageable && (
        <Panel title={format(m.settingsLifecycle)} description={format(m.settingsLifecycleHint)}>
          <div className="flex flex-wrap gap-2">
            {batch.status === 'active' && (
              <Button
                variant="outline"
                disabled={archive.isPending}
                onClick={() => setConfirming('archive')}
              >
                {format(m.archive)}
              </Button>
            )}
            {batch.status === 'archived' && (
              <Button
                variant="outline"
                disabled={reopen.isPending}
                onClick={() => setReopening(true)}
              >
                <RotateCcwIcon />
                {format(m.reopen)}
              </Button>
            )}
            {batch.status === 'draft' && (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => setConfirming('delete')}
              >
                <Trash2Icon />
                {format(m.deleteBatch)}
              </Button>
            )}
          </div>
        </Panel>
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
