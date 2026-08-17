import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { ChevronLeftIcon } from 'lucide-react'
import { cn } from '@qualy/ui/cn'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { Separator } from '@qualy/ui/separator'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage } from './refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntryHistory } from './EntryHistory.tsx'
import { GroupDetail } from './GroupDetail.tsx'
import { ItemDetail } from './ItemDetail.tsx'
import { ROW_TAG, standingRows, type Standing, type StructureRow } from './standing.ts'
import { lastDay, trimAmount, type EntryDto, type ItemDto } from './model.ts'

// One's own filings: the round's structure down the left, and whatever is
// selected in it opened on the right.
//
// The structure is one list rather than three screens. A group and a question
// are both rows in it, because a participant reading down what a round asks
// of them does not think of the groups as a different kind of place - they
// think "what is in here, and what have I done about it". Selecting a group
// answers the first, selecting a question answers the second.

/**
 * Whether the two panes are standing side by side.
 *
 * The same query the layout switches on, asked in javascript for the one
 * thing css cannot decide: what pressing back should mean. Narrow, a layer
 * is somewhere the reader went and back is how anybody leaves it; wide, the
 * layers are furniture beside a list, and clicking ten questions must not
 * cost ten presses of back to undo.
 */
function useSideBySide(): boolean {
  const [beside, setBeside] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 64rem)')
    const read = () => setBeside(query.matches)
    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])
  return beside
}

/**
 * One piece of this screen that lives in the address.
 *
 * Every layer of this page - which question is open, whose account is being
 * read, which claim is being written - is a query parameter rather than
 * component state, so a reload keeps it, a link carries it, and the phone's
 * back key walks out of it one layer at a time instead of leaving the page.
 * Closing sets it to '' and the parameter goes: an empty one left behind
 * would open the layer again on the next reload.
 */
function useLayer(key: string): [string, (next: string) => void] {
  const beside = useSideBySide()
  return usePageQueryState(key, '', { history: beside ? 'replace' : 'push' })
}

export default function MyEntriesPage() {
  const { format } = useI18n()
  const [selected, setSelected] = useLayer('open')
  return (
    // wide, not default and not full: at the default width the detail pane
    // is 728px however wide the screen is, and unbounded a claim's line
    // would grow past where it can be read back to its start
    <BatchScreen
      title={format(m.myEntriesTab)}
      description={format(m.myEntriesHint)}
      size="wide"
      actions={<Totals />}
    >
      {(batch) => (
        <Body
          batchId={batch.id}
          materialRange={batch.materialRange}
          selected={selected}
          onSelect={setSelected}
        />
      )}
    </BatchScreen>
  )
}

/**
 * What the round has granted so far, beside the page's own name.
 *
 * A score, then two counts - said as counts rather than as amounts, because
 * what a submission will be worth is not decided until somebody approves it,
 * and a number in the same shape as the granted one would read as a promise.
 * Then the window itself: every date in every form on this page has to fall
 * inside it, so it belongs where the page can be read from, not in a hint
 * under one field.
 */
function Totals() {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  // rendered beside the heading rather than inside the loaded batch, so it
  // reads the route for itself
  const { batchId } = usePageRouteParams('batchId')
  const standing = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const mine = useQuery(
    query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
  )
  // the same read the screen around it already made; asking again costs a
  // cache lookup
  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
  const pending = entries.filter((entry) => entry.status === 'in_review').length
  const drafts = entries.filter((entry) => entry.status === 'draft').length
  const range = detail.data?.batch.materialRange

  return (
    // On a phone only the granted total stays. The other three are answers
    // the list underneath gives again - how many are waiting, how many are
    // drafts, what window they must fall in - and three rows of statistics
    // above a list is a screen that has to be scrolled before it can be read.
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <Stat
        label={format(m.myEntriesCounted)}
        value={standing.data === undefined ? '—' : trimAmount(standing.data.total)}
        strong
      />
      <Stat
        className="max-sm:hidden"
        label={format(m.entryStatusInReview)}
        value={format(m.myEntriesRows, { count: pending })}
      />
      <Stat
        className="max-sm:hidden"
        label={format(m.entryStatusDraft)}
        value={format(m.myEntriesRows, { count: drafts })}
      />
      {range !== undefined && (
        <>
          <Separator orientation="vertical" className="hidden self-stretch sm:block" />
          <Stat
            className="max-sm:hidden"
            label={format(m.myEntriesWindow)}
            value={format(m.myEntriesWindowValue, {
              start: range.start,
              end: lastDay(range.end),
            })}
          />
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  strong,
  className,
}: {
  label: string
  value: string
  strong?: boolean
  className?: string
}) {
  return (
    <span className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
      <span
        className={cn('tabular-nums', strong ? 'text-lg font-semibold' : 'text-sm font-medium')}
      >
        {value}
      </span>
    </span>
  )
}

function Body({
  batchId,
  materialRange,
  selected,
  onSelect,
}: {
  batchId: string
  materialRange: { start: string; end: string }
  /** which row of the structure is open, by id; '' is the first one that is */
  selected: string
  onSelect: (id: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  // what the round has already granted, so a group can say where it stands.
  // It is part of the first paint like the rest: an amount that arrives a
  // moment later moves every card underneath it out from under the cursor
  const standing = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const mine = useQuery(
    query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
  )
  // 'new' is a claim about to exist on whichever question is open; anything
  // else names the claim being rewritten. The question itself is never
  // repeated here - `open` already says which one this is about.
  const [filing, setFiling] = useLayer('entry')
  const [history, setHistory] = useLayer('history')
  const [appealing, setAppealing] = useState<EntryDto | null>(null)
  const lingeringAppeal = useLingering(appealing)
  const [answering, setAnswering] = useState<EntryDto | null>(null)
  const lingeringAnswer = useLingering(answering)

  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>()
    for (const entry of (mine.data?.entries ?? []) as readonly EntryDto[]) {
      const bucket = grouped.get(entry.itemId)
      if (bucket === undefined) grouped.set(entry.itemId, [entry])
      else bucket.push(entry)
    }
    return grouped
  }, [mine.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  /**
   * A declaration filed in its one press: created and handed on in the same
   * breath. The dialog never opens - there is nothing in it to fill - and
   * the toast says what the press amounted to, which depends on whether the
   * question reviews its claims at all.
   */
  const declare = useMutation({
    mutationFn: async (input: { itemId: string }) => {
      if (mine.data === undefined) throw new Error('roster not loaded')
      const created = await run(
        api.assessment.createEntry({
          payload: {
            itemId: input.itemId,
            participantId: mine.data.participantId,
            payload: {},
          },
        }),
      )
      const sent = await run(
        api.assessment.setEntryStatus({
          params: { entryId: created.entry.id },
          payload: { status: 'in_review' },
        }),
      )
      return sent.entry
    },
    onSuccess: (entry) => {
      toast.success(
        format(entry.status === 'approved' ? m.entryDeclaredCounted : m.entryDeclaredFiled),
      )
      refresh()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      toast.error(refusal === null ? formatError(error) : format(refusal))
    },
  })

  const setStatus = useMutation({
    mutationFn: (input: { entryId: string; status: 'in_review' | 'draft' | 'voided' }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: { status: input.status },
        }),
      ),
    onSuccess: refresh,
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      toast.error(refusal === null ? formatError(error) : format(refusal))
    },
  })

  // Every question of the round this person takes part in, whoever fills it
  // in. One the school records is still theirs to read - it is how their
  // round adds up, and "somebody else writes this one" is a fact about the
  // question, not a reason to hide it. A question still being composed is
  // the only one nobody outside the paper can see.
  const visible = useMemo(
    () =>
      ((items.data?.items ?? []) as readonly ItemDto[]).filter((item) => item.status !== 'draft'),
    [items.data],
  )

  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing: (standing.data ?? null) as Standing | null,
      }),
    [groups.data, visible, entriesByItem, standing.data],
  )

  // the address names a row; before it names one, the first question there is
  // to answer is a better place to land than an empty pane
  const fallback = rows.find((row) => row.kind === 'item') ?? rows[0]
  const open = rows.find((row) => row.id === selected) ?? fallback ?? null
  const move = useMove(rows, open?.id ?? null)
  // whether the reader picked a row, as against having been shown one. The
  // fallback is what fills the pane beside the list; on a phone, where only
  // one of the two shows, being shown something is not the same as having
  // asked for it - unasked, the list is the page.
  const chosen = rows.some((row) => row.id === selected)

  // The claim being written, resolved from the address rather than carried
  // in state: 'new' is one about to exist on the open question, anything
  // else is one of that question's own claims by id. A parameter naming a
  // claim that is not there any more simply opens nothing.
  const writing =
    filing === '' || open?.kind !== 'item' || open.item === undefined
      ? null
      : {
          item: open.item,
          trail: open.trail,
          entry:
            filing === 'new'
              ? null
              : ((entriesByItem.get(open.id) ?? []).find((one) => one.id === filing) ?? null),
        }
  const lingeringFiling = useLingering(writing)
  const lingeringHistory = useLingering(history === '' ? null : history)

  return (
    <AsyncSection
      pending={items.isPending || mine.isPending || groups.isPending || standing.isPending}
      error={
        items.error
          ? formatError(items.error)
          : groups.error
            ? formatError(groups.error)
            : mine.error
              ? formatError(mine.error)
              : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void groups.refetch()
        void mine.refetch()
        void standing.refetch()
      }}
      skeleton={
        <div className="flex gap-6">
          <Skeleton className="h-96 w-94 shrink-0" />
          <Skeleton className="h-96 flex-1" />
        </div>
      }
      className="flex flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.myEntriesEmpty)}</p>
      ) : (
        // Beside each other where there is room, and one at a time where
        // there is not: on a phone the two stacked meant scrolling past the
        // whole paper to reach the question you had just chosen. Both panes
        // stay in the DOM and a breakpoint picks which one shows, so widening
        // the window brings the other back with no re-render and no flash.
        <div className="flex flex-1 flex-col items-start gap-6 lg:flex-row">
          <Structure
            rows={rows}
            openId={open?.id ?? null}
            onOpen={onSelect}
            className={cn(chosen && 'max-lg:hidden')}
          />

          <div className={cn('min-w-0 flex-1', !chosen && 'max-lg:hidden')}>
            {/* the way back to the list, only where the list is not beside it */}
            <button
              type="button"
              onClick={() => onSelect('')}
              className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
            >
              <ChevronLeftIcon aria-hidden className="size-4" />
              {format(m.myEntriesBack)}
            </button>
            {open?.kind === 'group' && (
              <Drill move={move} drillKey={open.id}>
                <GroupDetail
                  row={open}
                  rows={rows}
                  entriesByItem={entriesByItem}
                  standing={(standing.data ?? null) as Standing | null}
                  onOpen={onSelect}
                />
              </Drill>
            )}
            {open?.kind === 'item' && (
              <Drill move={move} drillKey={open.id}>
                <ItemDetail
                  row={open}
                  entries={entriesByItem.get(open.id) ?? []}
                  standing={(standing.data ?? null) as Standing | null}
                  busy={setStatus.isPending || declare.isPending}
                  onFile={(entry) => setFiling(entry?.id ?? 'new')}
                  onDeclare={() => declare.mutate({ itemId: open.id })}
                  onHistory={setHistory}
                  onStatus={(entryId, status) => setStatus.mutate({ entryId, status })}
                  onAppeal={setAppealing}
                  onSupplement={setAnswering}
                />
              </Drill>
            )}
          </div>
        </div>
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringFiling !== null && mine.data !== undefined && (
        <EntryDialog
          key={lingeringFiling.entry?.id ?? `new:${lingeringFiling.item.id}`}
          open={writing !== null}
          batchId={batchId}
          materialRange={materialRange}
          participantId={mine.data.participantId}
          item={lingeringFiling.item}
          entry={lingeringFiling.entry}
          trail={lingeringFiling.trail}
          siblings={(entriesByItem.get(lingeringFiling.item.id) ?? []).filter(
            (one) => one.id !== lingeringFiling.entry?.id,
          )}
          onClose={() => setFiling('')}
          onSaved={() => {
            setFiling('')
            refresh()
          }}
        />
      )}
      {lingeringHistory !== null && (
        <EntryHistory
          open={history !== ''}
          entryId={lingeringHistory}
          itemTitle={titleOfEntry(rows, entriesByItem, lingeringHistory)}
          onClose={() => setHistory('')}
        />
      )}
      {lingeringAppeal?.currentReviewInstanceId != null && (
        <AppealDialog
          open={appealing !== null}
          instanceId={lingeringAppeal.currentReviewInstanceId}
          onClose={() => setAppealing(null)}
          onDone={() => {
            setAppealing(null)
            refresh()
          }}
        />
      )}
      {lingeringAnswer?.supplement != null && (
        <SupplementAnswerDialog
          open={answering !== null}
          entry={lingeringAnswer}
          supplement={lingeringAnswer.supplement}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null)
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}

/** the question a claim answers, for the panel that tells the claim's story */
const titleOfEntry = (
  rows: readonly StructureRow[],
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>,
  entryId: string,
): string | undefined => {
  for (const [itemId, entries] of entriesByItem) {
    if (entries.some((entry) => entry.id === entryId)) {
      return rows.find((row) => row.id === itemId)?.name
    }
  }
  return undefined
}

/**
 * Which way the reader went to get to the pane now showing.
 *
 * Only the list knows: the same two rows can be reached by opening a group's
 * child, by stepping to the row underneath, or by landing on the address
 * cold. What is drawn should say which of those happened.
 */
function useMove(rows: readonly StructureRow[], openId: string | null): DrillMove {
  // read during the render, written after it: what the screen was showing a
  // moment ago is not state this render may change, and a strict double
  // render that recorded it in place would call every move a non-move
  const wasAt = useRef<string | null>(null)
  const previous = wasAt.current
  useEffect(() => {
    wasAt.current = openId
  }, [openId])

  if (openId === null || previous === null || previous === openId) return 'none'
  const from = rows.find((row) => row.id === previous)
  const to = rows.find((row) => row.id === openId)
  if (from === undefined || to === undefined) return 'none'
  if (to.parentId === from.id) return 'in'
  if (from.parentId === to.id) return 'out'
  return rows.indexOf(to) > rows.indexOf(from) ? 'next' : 'previous'
}

/**
 * However much of the window is left below wherever this lands.
 *
 * The index should reach the bottom of the screen and no further - a height
 * of a whole viewport, measured from partway down the page, is a viewport
 * plus whatever was above it, and the page grows a scrollbar it did not need.
 * What is above it is a heading band whose height depends on the copy in it,
 * so it is measured rather than assumed.
 *
 * Only where the two panes stand side by side. Stacked, the list is a
 * section of the page like any other and a height would just crop it.
 */
function useRestOfTheWindow(): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (node === null) return
    const beside = window.matchMedia('(min-width: 64rem)')
    const measure = () => {
      if (!beside.matches) {
        setHeight(null)
        return
      }
      // the gutter is the page's own bottom padding, which the list should
      // stop short of rather than run into
      const room = window.innerHeight - node.getBoundingClientRect().top - 24
      setHeight(Math.max(240, Math.round(room)))
    }
    measure()
    window.addEventListener('resize', measure)
    beside.addEventListener('change', measure)
    return () => {
      window.removeEventListener('resize', measure)
      beside.removeEventListener('change', measure)
    }
  }, [node])

  return [setNode, height]
}

/**
 * The round, as one list of rows to choose from.
 *
 * Groups and questions sit at the same indent scale rather than as headings
 * over lists, so the depth of the paper reads the way it is written and a
 * question two levels down is reachable in one press.
 */
function Structure({
  rows,
  openId,
  onOpen,
  className,
}: {
  rows: readonly StructureRow[]
  openId: string | null
  onOpen: (id: string) => void
  /** whether this pane is the one showing, where only one of the two is */
  className?: string | undefined
}) {
  const { format } = useI18n()
  const [showing, setShowing] = useState<'all' | 'todo'>('all')
  const questions = rows.filter((row) => row.kind === 'item').length
  const todo = rows.filter((row) => row.todo).length
  // narrowed to what is outstanding, the sections above it are scaffolding
  // for rows that are no longer there
  const listed = showing === 'all' ? rows : rows.filter((row) => row.todo)
  const [measure, height] = useRestOfTheWindow()

  return (
    // the structure is the page's index, so it stays put and scrolls inside
    // itself: a round with sixty questions would otherwise leave the reader
    // scrolling a list to reach a pane that left the screen ten rows ago
    <div
      ref={measure}
      style={height === null ? undefined : { height }}
      className={cn('flex w-full shrink-0 flex-col gap-2.5 lg:sticky lg:top-0 lg:w-88', className)}
    >
      <div className="flex shrink-0 items-center gap-3">
        <Tabs value={showing} onValueChange={(next) => setShowing(next as 'all' | 'todo')}>
          <TabsList>
            <TabsTrigger value="all">{format(m.myEntriesFilterAll)}</TabsTrigger>
            <TabsTrigger value="todo">
              {format(m.myEntriesFilterTodo)}
              {todo > 0 && <span className="tabular-nums">{todo}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <p className="text-xs whitespace-nowrap text-muted-foreground">
          {format(m.myEntriesQuestions, { count: questions })}
        </p>
      </div>
      {listed.length === 0 ? (
        <p className="rounded-xl border px-3 py-4 text-sm text-muted-foreground">
          {format(m.myEntriesFilterNone)}
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto rounded-xl border p-1.5 lg:flex-1">
          {listed.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                style={{
                  paddingLeft: `${(showing === 'all' ? row.depth : 0) * 0.875 + 0.625}rem`,
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border-l-2 py-1.5 pr-2.5 text-left transition-colors',
                  openId === row.id
                    ? 'border-l-foreground bg-accent'
                    : 'border-l-transparent hover:bg-accent/50',
                )}
              >
                {row.kind === 'group' ? (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</span>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        row.todo ? 'bg-foreground' : 'bg-muted-foreground/40',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    {row.tag !== null && (
                      <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
                        {format(ROW_TAG[row.tag])}
                      </span>
                    )}
                  </>
                )}
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    row.kind === 'group' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {row.right}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
