import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Panel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// The roster and what has drifted away from it.
//
// The panel exists because the roster does not move on its own: every line in
// the diff is a question for a person, and each of the five classes has its
// own answer - add them, remove them, apply the move, edit the enrolled types,
// or fix the scope. Nothing here decides anything by itself.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

export function RosterPanel({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)

  const isDraft = batch.status === 'draft'
  const participants = useQuery({
    ...query.assessment.listParticipants.queryOptions({
      params: { batchId: batch.id },
      query: {},
    }),
    enabled: !isDraft,
  })
  const diff = useQuery({
    ...query.assessment.getRosterDiff.queryOptions({ params: { batchId: batch.id } }),
    enabled: !isDraft,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))

  const include = useMutation({
    mutationFn: (userId: string) =>
      run(
        api.assessment.includeParticipant({ params: { batchId: batch.id }, payload: { userId } }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: invalidate,
    onError,
  })
  const setStatus = useMutation({
    mutationFn: (input: { participantId: string; status: 'active' | 'excluded' }) =>
      run(
        api.assessment.setParticipantStatus({
          params: { batchId: batch.id, participantId: input.participantId },
          payload: { status: input.status },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: invalidate,
    onError,
  })
  const applyAnchor = useMutation({
    mutationFn: (participantId: string) =>
      run(
        api.assessment.applyParticipantAnchor({
          params: { batchId: batch.id, participantId },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: invalidate,
    onError,
  })

  if (isDraft) {
    return (
      <Panel title={format(m.rosterTitle)} description={format(m.rosterHint)}>
        <p className="text-sm text-muted-foreground">{format(m.rosterDraft)}</p>
      </Panel>
    )
  }

  const rows = participants.data?.items ?? []
  const drift = diff.data?.diff
  const quiet =
    drift !== undefined &&
    drift.newArrivals.length === 0 &&
    drift.departed.length === 0 &&
    drift.anchorChanged.length === 0 &&
    drift.userTypeChanged.length === 0 &&
    drift.scopeIntegrity.length === 0

  return (
    <>
      <Panel
        title={format(m.rosterTitle)}
        description={format(m.rosterHint)}
        actions={
          <span className="text-xs text-muted-foreground">
            {format(m.participantCount, { count: rows.length })}
          </span>
        }
      >
        <Feedback message={failure} />
        <AsyncSection
          pending={participants.isPending}
          error={participants.isError ? formatError(participants.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void participants.refetch()}
        >
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.rosterEmpty)}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm">
                    {row.displayName}
                    {row.businessNo !== null && (
                      <span className="ml-2 text-xs text-muted-foreground">{row.businessNo}</span>
                    )}
                    {row.status === 'excluded' && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(m.excludedBadge)}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({
                        participantId: row.id,
                        status: row.status === 'excluded' ? 'active' : 'excluded',
                      })
                    }
                  >
                    {format(row.status === 'excluded' ? m.restore : m.exclude)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </Panel>

      <Panel title={format(m.diffTitle)}>
        <AsyncSection
          pending={diff.isPending}
          error={diff.isError ? formatError(diff.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void diff.refetch()}
        >
          {quiet ? (
            <p className="text-sm text-muted-foreground">{format(m.diffEmpty)}</p>
          ) : (
            <div className="space-y-4">
              {(drift?.newArrivals ?? []).length > 0 && (
                <section aria-label={format(m.diffArrivals)}>
                  <h3 className="text-sm font-medium">{format(m.diffArrivals)}</h3>
                  <ul className="divide-y">
                    {(drift?.newArrivals ?? []).map((row) => (
                      <li key={row.userId} className="flex items-center justify-between gap-2 py-2">
                        <span className="text-sm">
                          {row.displayName}
                          {row.activeElsewhere.length > 0 && (
                            <span className="ml-2 text-xs text-destructive">
                              {format(m.alsoActiveIn, {
                                batches: row.activeElsewhere.map((other) => other.name).join(', '),
                              })}
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          disabled={include.isPending}
                          onClick={() => include.mutate(row.userId)}
                        >
                          {format(m.include)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(drift?.departed ?? []).length > 0 && (
                <section aria-label={format(m.diffDeparted)}>
                  <h3 className="text-sm font-medium">{format(m.diffDeparted)}</h3>
                  <ul className="divide-y">
                    {(drift?.departed ?? []).map((row) => (
                      <li
                        key={row.participantId}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <span className="text-sm">{row.displayName}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setStatus.isPending}
                          onClick={() =>
                            setStatus.mutate({
                              participantId: row.participantId,
                              status: 'excluded',
                            })
                          }
                        >
                          {format(m.exclude)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(drift?.anchorChanged ?? []).length > 0 && (
                <section aria-label={format(m.diffAnchor)}>
                  <h3 className="text-sm font-medium">{format(m.diffAnchor)}</h3>
                  <ul className="divide-y">
                    {(drift?.anchorChanged ?? []).map((row) => (
                      <li
                        key={row.participantId}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <span className="text-sm">
                          {row.displayName}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {row.from.path} → {row.to.path}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          disabled={applyAnchor.isPending}
                          onClick={() => applyAnchor.mutate(row.participantId)}
                        >
                          {format(m.applyAnchor)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(drift?.userTypeChanged ?? []).length > 0 && (
                <section aria-label={format(m.diffUserType)}>
                  <h3 className="text-sm font-medium">{format(m.diffUserType)}</h3>
                  <ul className="divide-y">
                    {(drift?.userTypeChanged ?? []).map((row) => (
                      <li key={row.participantId} className="py-2 text-sm">
                        {row.displayName}
                        {!row.toEnrolled && (
                          <span className="ml-2 text-xs text-destructive">
                            {format(m.typeNotEnrolled)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(drift?.scopeIntegrity ?? []).length > 0 && (
                <section aria-label={format(m.diffScope)}>
                  <h3 className="text-sm font-medium">{format(m.diffScope)}</h3>
                  <p className="text-xs text-muted-foreground">{format(m.diffScopeHint)}</p>
                  <ul className="text-xs text-muted-foreground">
                    {(drift?.scopeIntegrity ?? []).map((row) => (
                      <li key={row.nodeId}>{row.nodeId}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </AsyncSection>
      </Panel>
    </>
  )
}
