import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// The participants, and what has drifted away from them.
//
// The list never moves on its own: every organizational change is a
// suggestion below, each with the one action that answers it - add the
// arrival, remove the departed, apply the move. Nothing here decides anything
// by itself.

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
    enabled: true,
  })
  const diff = useQuery({
    ...query.assessment.getRosterDiff.queryOptions({ params: { batchId: batch.id } }),
    enabled: true,
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
    <div className="space-y-6">
      <Feedback message={failure} />

      {/* a draft's list was drawn when the batch was created and is redrawn
          whenever its coverage changes, so there is nothing to reconcile yet */}
      {isDraft && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {format(m.rosterDraft)}
        </p>
      )}

      {/* what changed in the organization since the list was drawn up */}
      {!isDraft && (
        <section aria-label={format(m.diffTitle)} className="space-y-4">
          <h3 className="text-sm font-semibold">{format(m.diffTitle)}</h3>
          <AsyncSection
            pending={diff.isPending}
            error={diff.isError ? formatError(diff.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void diff.refetch()}
            skeleton={<Skeleton className="h-10 w-full" />}
          >
            {quiet ? (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {format(m.diffEmpty)}
              </p>
            ) : (
              <div className="space-y-4">
                {(drift?.newArrivals ?? []).length > 0 && (
                  <section aria-label={format(m.diffArrivals)} className="rounded-lg border">
                    <header className="space-y-0.5 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">{format(m.diffArrivals)}</h4>
                        <Badge variant="secondary">{drift?.newArrivals.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{format(m.diffArrivalsHint)}</p>
                    </header>
                    <ul className="divide-y">
                      {(drift?.newArrivals ?? []).map((row) => (
                        <li
                          key={row.userId}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <span className="text-sm">
                            {row.displayName}
                            {row.businessNo !== null && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {row.businessNo}
                              </span>
                            )}
                            {row.activeElsewhere.length > 0 && (
                              <span className="ml-2 text-xs text-destructive">
                                {format(m.alsoActiveIn, {
                                  batches: row.activeElsewhere
                                    .map((other) => other.name)
                                    .join('、'),
                                })}
                              </span>
                            )}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
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
                  <section aria-label={format(m.diffDeparted)} className="rounded-lg border">
                    <header className="space-y-0.5 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">{format(m.diffDeparted)}</h4>
                        <Badge variant="secondary">{drift?.departed.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{format(m.diffDepartedHint)}</p>
                    </header>
                    <ul className="divide-y">
                      {(drift?.departed ?? []).map((row) => (
                        <li
                          key={row.participantId}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
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
                  <section aria-label={format(m.diffAnchor)} className="rounded-lg border">
                    <header className="space-y-0.5 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">{format(m.diffAnchor)}</h4>
                        <Badge variant="secondary">{drift?.anchorChanged.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{format(m.diffAnchorHint)}</p>
                    </header>
                    <ul className="divide-y">
                      {(drift?.anchorChanged ?? []).map((row) => (
                        <li
                          key={row.participantId}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <span className="text-sm">{row.displayName}</span>
                          <Button
                            size="sm"
                            variant="outline"
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
                  <section aria-label={format(m.diffUserType)} className="rounded-lg border">
                    <header className="flex items-center gap-2 border-b px-4 py-2.5">
                      <h4 className="text-sm font-medium">{format(m.diffUserType)}</h4>
                      <Badge variant="secondary">{drift?.userTypeChanged.length}</Badge>
                    </header>
                    <ul className="divide-y">
                      {(drift?.userTypeChanged ?? []).map((row) => (
                        <li key={row.participantId} className="px-4 py-2.5 text-sm">
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
                  <section aria-label={format(m.diffScope)} className="rounded-lg border">
                    <header className="space-y-0.5 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">{format(m.diffScope)}</h4>
                        <Badge variant="destructive">{drift?.scopeIntegrity.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{format(m.diffScopeHint)}</p>
                    </header>
                  </section>
                )}
              </div>
            )}
          </AsyncSection>
        </section>
      )}

      {/* the list itself */}
      <section aria-label={format(m.tabRoster)} className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{format(m.tabRoster)}</h3>
          <span className="text-xs text-muted-foreground">
            {format(m.participantCount, { count: rows.length })}
          </span>
        </div>
        <AsyncSection
          pending={participants.isPending}
          error={participants.isError ? formatError(participants.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void participants.refetch()}
          skeleton={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.rosterEmpty)}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{format(m.columnParticipant)}</TableHead>
                    <TableHead>{format(m.columnParticipantStatus)}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <PersonCell
                          name={row.displayName}
                          secondary={row.businessNo ?? format(m.noBusinessNoShort)}
                        >
                          <div className="flex flex-col gap-2 text-sm">
                            <span className="font-medium">{row.displayName}</span>
                            <span className="text-xs text-muted-foreground">
                              {row.businessNo ?? format(m.noBusinessNoShort)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {format(m.includedAt, {
                                time: new Date(row.includedAt).toLocaleDateString(),
                              })}
                            </span>
                            <span>
                              {row.status === 'excluded' ? (
                                <Badge variant="secondary">{format(m.excludedBadge)}</Badge>
                              ) : (
                                <Badge variant="outline">{format(m.participantActive)}</Badge>
                              )}
                            </span>
                          </div>
                        </PersonCell>
                      </TableCell>
                      <TableCell>
                        {row.status === 'excluded' ? (
                          <Badge variant="secondary">{format(m.excludedBadge)}</Badge>
                        ) : (
                          <Badge variant="outline">{format(m.participantActive)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AsyncSection>
      </section>
    </div>
  )
}
