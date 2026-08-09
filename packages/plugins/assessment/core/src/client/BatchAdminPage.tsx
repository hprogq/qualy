import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchForm } from './NewBatchForm.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import { RosterPanel } from './RosterPanel.tsx'
import { refusalMessage, refusalsOf } from './refusals.ts'

// A batch, whole: what it is, when its phases run, and who is on it.
//
// Master and detail share one screen because the list is short and the work
// is always about one batch at a time; which batch is in the query string, so
// a colleague can be sent the link to the one being discussed.
export default function BatchAdminPage() {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('batch')
  const [failure, setFailure] = useState<string | null>(null)

  const batches = useQuery(query.assessment.listBatches.queryOptions({ query: {} }))
  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId: selected } }),
    enabled: selected !== '',
  })

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: selected },
          payload: { status },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: query.assessment.key() }),
    onError: (error: unknown) => {
      // activation refuses with the plan's own reasons; anything else is a
      // sentence the error catalog already has
      const refusals = refusalsOf(error)
      setFailure(
        refusals.length > 0
          ? refusals
              .map((refusal) => {
                const sentence = refusalMessage(refusal.reason)
                return sentence ? format(sentence) : refusal.reason
              })
              .join(' ')
          : formatError(error),
      )
    },
  })

  const statusLabel = (status: 'draft' | 'active' | 'archived') =>
    format(
      status === 'draft' ? m.statusDraft : status === 'active' ? m.statusActive : m.statusArchived,
    )

  const batch = detail.data?.batch

  return (
    <div className="space-y-4 p-4">
      <Panel title={format(m.batchesTitle)} description={format(m.batchesHint)}>
        <AsyncSection
          pending={batches.isPending}
          error={batches.isError ? formatError(batches.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void batches.refetch()}
        >
          {(batches.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.batchesEmpty)}</p>
          ) : (
            <ul className="divide-y">
              {(batches.data?.items ?? []).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={row.id === selected}
                    className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => setSelected(row.id === selected ? '' : row.id)}
                  >
                    <span className="text-sm font-medium">
                      {row.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {statusLabel(row.status)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.materialRange.start} – {row.materialRange.end}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </Panel>

      {batch && (
        <>
          <Panel
            title={batch.name}
            description={statusLabel(batch.status)}
            actions={
              <div className="flex gap-2">
                {batch.status === 'draft' && (
                  <Button
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate('active')}
                  >
                    {format(m.activate)}
                  </Button>
                )}
                {batch.status === 'active' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate('archived')}
                  >
                    {format(m.archive)}
                  </Button>
                )}
              </div>
            }
          >
            <Feedback message={failure} />
            <p className="text-xs text-muted-foreground">
              {batch.status === 'draft' ? format(m.activateHint) : format(m.rosterHint)}
            </p>
          </Panel>

          <PhaseTimelineEditor batch={batch} />
          <RosterPanel batch={batch} />
        </>
      )}

      <NewBatchForm onCreated={setSelected} />
    </div>
  )
}
