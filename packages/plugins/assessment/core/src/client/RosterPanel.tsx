import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { AddPeopleDialog } from './roster/AddPeopleDialog.tsx'
import { ImportDialog } from './roster/ImportDialog.tsx'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { PersonCell } from '@qualy/ui/person'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import { Skeleton } from '@qualy/ui/skeleton'
import { useIsBelow } from '@qualy/ui/use-mobile'
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

/** the width the tree and the table stop competing for, tailwind's `lg` */
const TWO_COLUMNS = 1024

const wide = '@media (min-width: 1024px)'

const styles = stylex.create({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  columns: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: null,
      [wide]: 'minmax(0, 18rem) minmax(0, 1fr)',
    },
  },
  unitsAside: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 8,
  },
  unitsTrigger: {
    width: '100%',
    justifyContent: 'space-between',
    paddingInline: 8,
    pointerEvents: {
      default: null,
      [wide]: 'none',
    },
  },
  unitsWord: {
    fontSize: 14,
    fontWeight: 500,
  },
  unitsChevron: {
    display: {
      default: 'inline',
      [wide]: 'none',
    },
    width: 16,
    height: 16,
    transitionProperty: 'transform',
  },
  unitsChevronOpen: {
    transform: 'rotate(180deg)',
  },
  // as tall as what is left of the window: a filter that stops halfway down
  // leaves a column of nothing beside a list that keeps going
  unitsSeat: {
    position: {
      default: null,
      [wide]: 'sticky',
    },
    top: {
      default: null,
      [wide]: 16,
    },
  },
  treeSkeleton: {
    height: 256,
    width: '100%',
  },
  listColumn: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 8,
  },
  listHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  listTitleSeat: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  listCount: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  listActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  skeletonColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  skeletonLine: {
    height: 36,
    width: '100%',
  },
  quietNote: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  tableFrame: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  rightCell: {
    textAlign: 'right',
  },
  pagerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
})

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
  // Folded until the layout actually has two columns for it. Following the
  // shell's own breakpoint left a band between the two where the tree was
  // open and the grid was not, so it sat on top of the list rather than
  // beside it and pushed the thing somebody came for off the screen.
  const narrow = useIsBelow(TWO_COLUMNS)
  const [unitsOpen, setUnitsOpen] = useState(!narrow)
  useEffect(() => setUnitsOpen(!narrow), [narrow])

  // Keyset paging walked by page, with the question it belongs to carried
  // beside it. Resetting the stack from an effect ran a render too late: the
  // request for the new filter had already gone out holding the old filter's
  // cursor, which the server rightly refuses - a cursor means nothing against
  // a question it did not come from.
  const question = `${[...units].sort().join(',')}:${unitScope}`
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question, cursors: [undefined], at: 0 })
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page
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
  const nextCursor = participants.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setPaging({ question, cursors: [...cursors.slice(0, at + 1), nextCursor], at })
  }, [nextCursor, at, cursors, question])

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
    <div {...stylex.props(styles.panel)}>
      <Feedback message={failure} />

      <div {...stylex.props(styles.columns)}>
        {/* on a phone the tree is a second screenful in front of the list
            somebody came for, so it starts folded and says what it is */}
        <Collapsible
          open={unitsOpen}
          onOpenChange={setUnitsOpen}
          className={stylex.props(styles.unitsAside).className}
          asChild
        >
          <aside>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className={stylex.props(styles.unitsTrigger).className}
                aria-label={format(m.rosterUnits)}
              >
                <span {...stylex.props(styles.unitsWord)}>{format(m.rosterUnits)}</span>
                <ChevronDownIcon
                  aria-hidden
                  className={
                    stylex.props(styles.unitsChevron, unitsOpen && styles.unitsChevronOpen)
                      .className
                  }
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className={stylex.props(styles.unitsSeat).className}>
              <UiSlot
                token={orgNodePicker}
                context={{
                  // one unit, pointed at rather than collected, plus how far
                  // down to look: a filter is not a shopping list
                  single: true,
                  fill: true,
                  value: units,
                  onChange: setUnits,
                  scope: unitScope,
                  onScopeChange: setUnitScope,
                }}
                fallback={null}
                loading={<Skeleton className={stylex.props(styles.treeSkeleton).className} />}
              />
            </CollapsibleContent>
          </aside>
        </Collapsible>

        <section aria-label={format(m.tabRoster)} {...stylex.props(styles.listColumn)}>
          <div {...stylex.props(styles.listHead)}>
            <div {...stylex.props(styles.listTitleSeat)}>
              <h3 {...stylex.props(styles.listTitle)}>{format(m.tabRoster)}</h3>
              <span {...stylex.props(styles.listCount)}>
                {format(m.participantCount, { count: rows.length })}
              </span>
            </div>
            {batch.manageable && (
              <div {...stylex.props(styles.listActions)}>
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
              <div {...stylex.props(styles.skeletonColumn)}>
                <Skeleton className={stylex.props(styles.skeletonLine).className} />
                <Skeleton className={stylex.props(styles.skeletonLine).className} />
                <Skeleton className={stylex.props(styles.skeletonLine).className} />
              </div>
            }
          >
            {rows.length === 0 ? (
              <p {...stylex.props(styles.quietNote)}>{format(m.rosterEmpty)}</p>
            ) : (
              <div {...stylex.props(styles.tableFrame)}>
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
                        <TableCell xstyle={styles.rightCell}>
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
            <div {...stylex.props(styles.pagerRow)}>
              <Button
                size="sm"
                variant="ghost"
                disabled={at === 0}
                onClick={() => setPaging({ question, cursors, at: Math.max(0, at - 1) })}
              >
                {format(m.previousPage)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={nextCursor === null}
                onClick={() => setPaging({ question, cursors, at: at + 1 })}
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
