import { useEffect, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { AddPeopleDialog } from './roster/AddPeopleDialog.tsx'
import { ImportDialog } from './roster/ImportDialog.tsx'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { PersonCell } from '@qualy/ui/person'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import { cn } from '@qualy/ui/cn'
import { Skeleton } from '@qualy/ui/skeleton'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import type { ApiResult } from '@qualy/web-runtime/api'
import { orgNodePicker, personCard } from '@qualy/ui-contract'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'

// Who takes part in this round.
//
// The roster is the batch's population - there is no scope behind it that it
// has to be kept in step with. People get in by being imported from the
// organization or by being named one at a time, and out by somebody taking
// them out, which keeps the row and everything hanging off it.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']

const PAGE_SIZE = 25

export function RosterPanel({ batch }: { batch: BatchDto }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [excluding, setExcluding] = useState<{ id: string; name: string } | null>(null)
  // which units the reader is looking at; empty means the whole round
  const [units, setUnits] = useState<readonly string[]>([])
  const [unitScope, setUnitScope] = useState<'self' | 'subtree'>('subtree')
  // open where there is room for it beside the list, folded where there is not
  const isMobile = useIsMobile()
  const [unitsOpen, setUnitsOpen] = useState(!isMobile)
  useEffect(() => setUnitsOpen(!isMobile), [isMobile])

  // keyset paging walked by page, the same way the access list does it
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [at, setAt] = useState(0)
  const participants = useQuery(
    query.assessment.listParticipants.queryOptions({
      params: { batchId: batch.id },
      query: {
        ...(units.length > 0 ? { orgNodeIds: [...units], orgScope: unitScope } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
  )
  useEffect(() => {
    // a different question deserves a first page
    setCursors([undefined])
    setAt(0)
  }, [units, unitScope])
  const nextCursor = participants.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, at + 1), nextCursor])
  }, [nextCursor, at, cursors])

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
    onSuccess: (result: { added: number }) => {
      setImporting(false)
      toast.success(format(m.toastImported, { count: result.added }))
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
    onSuccess: (result: { added: number; skipped: number }) => {
      setAdding(false)
      toast.success(format(m.toastAdded, { count: result.added }))
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
      ).then((answer) => ({ ...answer, status: input.status })),
    onMutate: () => setFailure(null),
    onSuccess: (result: { status: 'active' | 'excluded' }) => {
      setExcluding(null)
      toast.success(format(result.status === 'excluded' ? m.toastExcluded : m.toastRestored))
      invalidate()
    },
    onError,
  })

  const rows = participants.data?.items ?? []

  return (
    <div className="space-y-5">
      <Feedback message={failure} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* on a phone the tree is a second screenful in front of the list
            somebody came for, so it starts folded and says what it is */}
        <Collapsible
          open={unitsOpen}
          onOpenChange={setUnitsOpen}
          className="min-w-0 space-y-2"
          asChild
        >
          <aside>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between px-2 lg:pointer-events-none"
                aria-label={format(m.rosterUnits)}
              >
                <span className="text-sm font-medium">{format(m.rosterUnits)}</span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn('size-4 transition-transform lg:hidden', unitsOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <UiSlot
                token={orgNodePicker}
                context={{
                  // one unit, pointed at rather than collected, plus how far
                  // down to look: a filter is not a shopping list
                  single: true,
                  value: units,
                  onChange: setUnits,
                  scope: unitScope,
                  onScopeChange: setUnitScope,
                }}
                fallback={null}
                loading={<Skeleton className="h-64 w-full" />}
              />
            </CollapsibleContent>
          </aside>
        </Collapsible>

        <section aria-label={format(m.tabRoster)} className="min-w-0 space-y-2">
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
                                row.status === 'excluded'
                                  ? setStatus.mutate({ participantId: row.id, status: 'active' })
                                  : // taking somebody off is worth a question,
                                    // because what it keeps is not obvious
                                    setExcluding({ id: row.id, name: row.displayName })
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

          {(at > 0 || nextCursor !== null) && (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={at === 0}
                onClick={() => setAt((page) => Math.max(0, page - 1))}
              >
                {format(m.previousPage)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={nextCursor === null}
                onClick={() => setAt((page) => page + 1)}
              >
                {format(m.nextPage)}
              </Button>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={excluding !== null}
        title={format(m.excludeTitle, { name: excluding?.name ?? '' })}
        description={format(m.excludeBody)}
        confirmLabel={format(m.exclude)}
        cancelLabel={format(commonMessages.cancel)}
        pending={setStatus.isPending}
        tone="destructive"
        onConfirm={() =>
          excluding && setStatus.mutate({ participantId: excluding.id, status: 'excluded' })
        }
        onCancel={() => setExcluding(null)}
      />

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
