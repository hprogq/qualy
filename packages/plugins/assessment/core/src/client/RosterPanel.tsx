import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { AddPeopleDialog } from './roster/AddPeopleDialog.tsx'
import { ImportDialog } from './roster/ImportDialog.tsx'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import type { ApiResult } from '@qualy/web-runtime/api'
import { personCard } from '@qualy/ui-contract'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// Who takes part in this round.
//
// The roster is the batch's population - there is no scope behind it that it
// has to be kept in step with. People get in by being imported from the
// organization or by being named one at a time, and out by somebody taking
// them out, which keeps the row and everything hanging off it.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

export function RosterPanel({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)

  const participants = useQuery(
    query.assessment.listParticipants.queryOptions({
      params: { batchId: batch.id },
      query: {},
    }),
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))

  const importPeople = useMutation({
    mutationFn: (selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }) =>
      run(
        api.assessment.importParticipants({
          params: { batchId: batch.id },
          payload: {
            orgNodeIds: [...selection.orgNodeIds],
            userTypeIds: [...selection.userTypeIds],
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      setImporting(false)
      invalidate()
    },
    onError,
  })
  const addPeople = useMutation({
    mutationFn: (userIds: readonly string[]) =>
      run(
        api.assessment.addParticipants({
          params: { batchId: batch.id },
          payload: { userIds: [...userIds] },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      setAdding(false)
      invalidate()
    },
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

  const rows = participants.data?.items ?? []

  return (
    <div className="space-y-5">
      <Feedback message={failure} />

      <section aria-label={format(m.tabRoster)} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{format(m.tabRoster)}</h3>
            <span className="text-xs text-muted-foreground">
              {format(m.participantCount, { count: rows.length })}
            </span>
          </div>
          {batch.manageable && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                {format(m.importFromOrganization)}
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                {format(m.addPeople)}
              </Button>
            </div>
          )}
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
                        <UiSlot
                          token={personCard}
                          context={{
                            userId: row.userId,
                            displayName: row.displayName,
                            businessNo: row.businessNo,
                          }}
                          fallback={
                            <PersonCell
                              name={row.displayName}
                              secondary={row.businessNo ?? format(m.noBusinessNoShort)}
                            />
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {row.status === 'excluded' ? (
                          <Badge variant="secondary">{format(m.excludedBadge)}</Badge>
                        ) : (
                          <Badge variant="outline">{format(m.participantActive)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {batch.manageable && (
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AsyncSection>
      </section>

      <AddPeopleDialog
        open={adding}
        pending={addPeople.isPending}
        onAdd={(userIds) => addPeople.mutate(userIds)}
        onClose={() => setAdding(false)}
      />

      <ImportDialog
        batchId={batch.id}
        open={importing}
        pending={importPeople.isPending}
        onImport={(selection) => importPeople.mutate(selection)}
        onClose={() => setImporting(false)}
      />
    </div>
  )
}
