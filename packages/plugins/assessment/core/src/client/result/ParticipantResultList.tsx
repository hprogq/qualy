import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, EllipsisIcon } from 'lucide-react'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { orgNodePicker } from '@qualy/ui-contract'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { Card, CardEmpty, Cell, Status, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { ResizableSplit } from '@qualy/ui/screen'
import { AddPeopleDialog } from '../roster/AddPeopleDialog.tsx'
import { ImportDialog } from '../roster/ImportDialog.tsx'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentMessages as m } from '../i18n.ts'
import { assessmentApi } from '../api.ts'

// Finding one person, and nothing else.
//
// No totals in this list, and that is a decision rather than an omission: a
// standing is not a stored number, it is one repeatable-read snapshot per
// participant with the round's arithmetic run over it. Putting a score in
// every row would run twenty-five of those to draw one page, and the page
// only exists to get somebody to the one person they came for.

const PAGE_SIZE = 25

/** the width the tree and the list stop competing for, tailwind's `lg` */
const TWO_COLUMNS = 1024

const wide = '@media (min-width: 1024px)'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 20 },
  columns: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { default: null, [wide]: 'minmax(0, 18rem) minmax(0, 1fr)' },
  },
  unitsAside: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  unitsTrigger: {
    width: '100%',
    justifyContent: 'space-between',
    paddingInline: 8,
    pointerEvents: { default: null, [wide]: 'none' },
  },
  unitsWord: { fontSize: 13, fontWeight: 500 },
  unitsChevron: {
    width: 16,
    height: 16,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    display: { default: null, [wide]: 'none' },
  },
  unitsChevronOpen: { transform: 'rotate(180deg)' },
  unitsSeat: { minWidth: 0 },
  treeWaiting: { display: 'flex', flexDirection: 'column', gap: 10, paddingBlock: 8 },
  bone: { height: 14, borderRadius: 4 },
  listColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  listHead: { display: 'flex', alignItems: 'baseline', gap: 8 },
  listTitle: { fontSize: 14, fontWeight: 600 },
  listCount: { fontSize: 12, color: tokens.mutedForeground },
  listSpacer: { flexGrow: 1 },
  listActions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
  // one person per ruled line: a card per row would make finding somebody a
  // matter of scrolling past twenty-five boxes
  pagerRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  listSkeleton: { height: 320, width: '100%', borderRadius: 12 },
})

export function ParticipantResultList({
  batchId,
  manageable,
  onOpen,
}: {
  batchId: string
  /** whether this reader may add people to the round */
  manageable: boolean
  onOpen: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [excluding, setExcluding] = useState<{ id: string; name: string } | null>(null)
  const businessNo = useTerm(authTerms.businessNumber)
  const [units, setUnits] = useState<readonly string[]>([])
  const [unitScope, setUnitScope] = useState<'self' | 'subtree'>('subtree')
  const narrow = useIsBelow(TWO_COLUMNS)
  const [unitsOpen, setUnitsOpen] = useState(!narrow)
  useEffect(() => setUnitsOpen(!narrow), [narrow])

  // Keyset paging walked by page, with the question it belongs to carried
  // beside it: a cursor means nothing against a question it did not come
  // from, so changing the filter starts the walk over in the same render.
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
      params: { batchId },
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

  const rows = participants.data?.items ?? []

  // targeted invalidation: only this plugin's reads, never the whole cache
  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))
  const addPeople = useMutation({
    mutationFn: (userIds: readonly string[]) =>
      run(
        api.assessment.addParticipants({
          params: { batchId },
          payload: { userIds: [...userIds] },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: (result: { added: number }) => {
      setAdding(false)
      toast.success(format(m.toastAdded, { count: result.added }))
      invalidate()
    },
    onError,
  })
  const importPeople = useMutation({
    mutationFn: (selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }) =>
      run(
        api.assessment.importParticipants({
          params: { batchId },
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

  const setStatus = useMutation({
    mutationFn: (input: { participantId: string; status: 'active' | 'excluded' }) =>
      run(
        api.assessment.setParticipantStatus({
          params: { batchId, participantId: input.participantId },
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

  const tree = (
    <UiSlot
      token={orgNodePicker}
      context={{
        // one unit, pointed at rather than collected, plus how far down to
        // look: a filter is not a shopping list
        single: true,
        fill: true,
        value: units,
        onChange: setUnits,
        scope: unitScope,
        onScopeChange: setUnitScope,
      }}
      fallback={null}
      // the shape of a tree, not a block the size of one: a grey rectangle
      // where a list of units will be says only that something is missing
      loading={
        <div {...stylex.props(styles.treeWaiting)}>
          {[0, 1, 2, 3, 4].map((depth) => (
            <Skeleton
              key={depth}
              className={stylex.props(styles.bone).className}
              style={{
                width: `${[68, 84, 56, 76, 48][depth]!}%`,
                marginInlineStart: depth % 2 === 0 ? 0 : 14,
              }}
            />
          ))}
        </div>
      }
    />
  )

  return (
    <div {...stylex.props(styles.panel)}>
      <Feedback message={failure} />
      <ResizableSplit
        storageKey="qualy:assessment-roster-tree"
        initial={300}
        min={240}
        max={480}
        handleLabel={format(m.rosterUnitsResize)}
        side={
          <>
            {/* On a phone the tree is a second screenful in front of the list
            somebody came for, so it folds behind a disclosure that says what
                it is. With room for two columns it is simply there: a
                heading over a tree that is already open is a word doing no
                work, and a control that cannot be pressed is worse than one
                that is absent, and how wide it should be is the reader's. */}
            <aside {...stylex.props(styles.unitsAside)}>
              {narrow ? (
                <Collapsible open={unitsOpen} onOpenChange={setUnitsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className={stylex.props(styles.unitsTrigger).className}>
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
                    {tree}
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                tree
              )}
            </aside>
          </>
        }
      >
        <section aria-label={format(m.participantResultsTab)} {...stylex.props(styles.listColumn)}>
          <div {...stylex.props(styles.listHead)}>
            <h3 {...stylex.props(styles.listTitle)}>{format(m.tabRoster)}</h3>
            <span {...stylex.props(styles.listCount)}>
              {format(m.participantCount, { count: rows.length })}
            </span>
            <span {...stylex.props(styles.listSpacer)} />
            {manageable && (
              <span {...stylex.props(styles.listActions)}>
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                  {format(m.importFromOrganization)}
                </Button>
                <Button size="sm" onClick={() => setAdding(true)}>
                  {format(m.addPeople)}
                </Button>
              </span>
            )}
          </div>
          <AsyncSection
            pending={participants.isPending}
            error={participants.isError ? formatError(participants.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void participants.refetch()}
            skeleton={<Skeleton className={stylex.props(styles.listSkeleton).className} />}
          >
            <Card>
              <Table columns="8.5rem minmax(0, 1fr) 6rem 2rem">
                <TableHead>
                  <span>{businessNo}</span>
                  <span>{format(m.columnParticipant)}</span>
                  <span>{format(m.columnParticipantStatus)}</span>
                  <span />
                </TableHead>
                {rows.length === 0 ? (
                  <CardEmpty>{format(m.rosterEmpty)}</CardEmpty>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      height="compact"
                      nested
                      onOpen={() => onOpen(row.id)}
                      data-testid="participant-row"
                      data-participant={row.id}
                      data-participant-status={row.status}
                    >
                      <Cell lead numeric tone={row.businessNo === null ? 'quiet' : 'plain'}>
                        {row.businessNo ?? format(m.noBusinessNoShort, { businessNo })}
                      </Cell>
                      <Cell tone="plain">{row.displayName}</Cell>
                      <Status tone={row.status === 'excluded' ? 'bad' : 'plain'}>
                        {format(row.status === 'excluded' ? m.excludedBadge : m.participantActive)}
                      </Status>
                      {/* the act on one person, where the person is: walking
                          into their account to take them off the round was a
                          detour through a page that answers a different
                          question */}
                      {manageable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              data-testid="participant-actions"
                              aria-label={format(m.rosterRowActions, { name: row.displayName })}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <EllipsisIcon aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onOpen(row.id)}>
                              {format(m.participantResultsOpen)}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              data-testid="participant-standing"
                              onSelect={() =>
                                row.status === 'excluded'
                                  ? setStatus.mutate({ participantId: row.id, status: 'active' })
                                  : setExcluding({ id: row.id, name: row.displayName })
                              }
                            >
                              {format(row.status === 'excluded' ? m.restore : m.exclude)}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span />
                      )}
                    </TableRow>
                  ))
                )}
              </Table>
            </Card>
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
      </ResizableSplit>

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
        batchId={batchId}
        open={importing}
        pending={importPeople.isPending}
        onImport={(selection) => importPeople.mutate(selection)}
        onClose={() => setImporting(false)}
      />
    </div>
  )
}
