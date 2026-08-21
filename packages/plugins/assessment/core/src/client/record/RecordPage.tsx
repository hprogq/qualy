import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { NativeSelect } from '@qualy/ui/native-select'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage } from '../entry/refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { EvidenceForm, type EvidencePayload } from '../entry/EvidenceForm.tsx'
import { fieldsOf, type ItemDto } from '../entry/model.ts'

// Recording an administrative fact about somebody. It takes effect the
// moment it is filed - no review round - which is exactly why the basis is
// required: a fact nobody can check is an assertion.

export default function RecordPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.recordTab)} description={format(m.recordHint)}>
      {(batch) =>
        batch.capabilities.record ? (
          <Recorder batchId={batch.id} materialRange={batch.materialRange} />
        ) : (
          <p className="text-sm text-muted-foreground">{format(m.recordNoStanding)}</p>
        )
      }
    </BatchScreen>
  )
}

function Recorder({
  batchId,
  materialRange,
}: {
  batchId: string
  materialRange: { start: string; end: string }
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const roster = useQuery(
    query.assessment.listParticipants.queryOptions({ params: { batchId }, query: {} }),
  )
  const [itemId, setItemId] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [payload, setPayload] = useState<EvidencePayload>({})
  const [basis, setBasis] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const administrative = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) => item.status === 'active' && item.currentRevision?.entrySource === 'administrative',
  )
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null

  const record = useMutation({
    mutationFn: () =>
      run(
        api.assessment.createEntry({
          payload: {
            itemId,
            participantId,
            payload,
            note: basis.trim(),
            // the form on screen is this item's current version; if it moved
            // while the record was being written, nothing is filed
            ...(item?.currentRevision?.id === undefined
              ? {}
              : { expectedItemRevisionId: item.currentRevision.id }),
          },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.recordDone))
      setPayload({})
      setBasis('')
      setParticipantId('')
    },
    onError: (error) => setProblem(formatError(error)),
  })

  return (
    <AsyncSection
      pending={items.isPending || roster.isPending}
      error={
        items.error ? formatError(items.error) : roster.error ? formatError(roster.error) : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void roster.refetch()
      }}
      skeleton={<Skeleton className="h-40 w-full" />}
    >
      {administrative.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.recordEmpty)}</p>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <Field label={format(m.itemsListTitle)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="" />
                {administrative.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={format(m.recordWho)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
              >
                <option value="" />
                {(roster.data?.items ?? [])
                  .filter((participant) => participant.status === 'active')
                  .map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.displayName}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
          {item !== null && (
            <EvidenceForm
              fields={fieldsOf(item.currentRevision?.formConfig)}
              value={payload}
              onChange={setPayload}
              doors={{
                prepare: (input) => run(api.assessment.prepareAttachmentUpload({ payload: input })),
                complete: (reservationId) =>
                  run(api.assessment.completeAttachmentUpload({ params: { reservationId } })),
              }}
              where={{ batchId, itemId: item.id }}
              materialRange={materialRange}
            />
          )}
          <Field label={format(m.recordBasis)} hint={format(m.recordBasisHint)}>
            {(id) => (
              <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />
            )}
          </Field>
          <Feedback message={problem} />
          <div className="flex justify-end">
            <Button
              disabled={
                record.isPending || itemId === '' || participantId === '' || basis.trim() === ''
              }
              onClick={() => record.mutate()}
            >
              {format(m.recordSubmit)}
            </Button>
          </div>
        </div>
      )}
    </AsyncSection>
  )
}
