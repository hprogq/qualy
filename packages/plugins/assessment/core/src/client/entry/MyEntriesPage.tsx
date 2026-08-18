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
import { useRestOfTheScroller } from '../rest-of-the-scroller.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntrySheet } from './EntrySheet.tsx'
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
          batchName={batch.name}
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
        value={standing.data === undefined ? '—' : Number(standing.data.total).toFixed(2)}
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
  batchName,
  materialRange,
  selected,
  onSelect,
}: {
  batchId: string
  batchName: string
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
  const [detail, setDetail] = useLayer('detail')
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
  // the claim the drawer is holding, resolved from the address: a parameter
  // naming a claim that is gone simply opens nothing
  const detailed = (() => {
    if (detail === '') return null
    for (const [itemId, list] of entriesByItem) {
      const found = list.find((one) => one.id === detail)
      if (found !== undefined) {
        const itemRow = rows.find((one) => one.id === itemId)
        if (itemRow?.item !== undefined) {
          return { entry: found, item: itemRow.item, trail: itemRow.trail }
        }
      }
    }
    return null
  })()
  const lingeringDetail = useLingering(detailed)

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
            batchName={batchName}
            standing={(standing.data ?? null) as Standing | null}
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
                  onDetail={(entry) => setDetail(entry.id)}
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
      {/* the drawer that holds the whole claim; its account is a tab inside */}
      {lingeringDetail !== null && (
        <EntrySheet
          open={detailed !== null}
          entry={detailed?.entry ?? lingeringDetail.entry}
          item={lingeringDetail.item}
          trail={lingeringDetail.trail}
          busy={setStatus.isPending || declare.isPending}
          onClose={() => setDetail('')}
          onEdit={() => setFiling(lingeringDetail.entry.id)}
          onStatus={(status) => setStatus.mutate({ entryId: lingeringDetail.entry.id, status })}
          onAppeal={() => setAppealing(lingeringDetail.entry)}
          onSupplement={() => setAnswering(lingeringDetail.entry)}
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
 * The round, as one list of rows to choose from.
 *
 * Groups and questions sit at the same indent scale rather than as headings
 * over lists, so the depth of the paper reads the way it is written and a
 * question two levels down is reachable in one press.
 */
function Structure({
  rows,
  batchName,
  standing,
  openId,
  onOpen,
  className,
}: {
  rows: readonly StructureRow[]
  batchName: string
  standing: Standing | null
  openId: string | null
  onOpen: (id: string) => void
  /** whether this pane is the one showing, where only one of the two is */
  className?: string | undefined
}) {
  const { format } = useI18n()
  const [showing, setShowing] = useState<'all' | 'todo'>('all')
  // The summary card at the top IS the paper's root: when the round has one
  // top group holding everything, that group's name and numbers go up there
  // and the list starts straight at its children - a root row over children
  // saying the same thing said it twice. Papers with several top groups
  // have no single root to lift, so the batch stands in.
  const root =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? rows[0]!
      : null
  const body = root === null ? rows : rows.slice(1).map((row) => ({ ...row, depth: row.depth - 1 }))
  const questions = body.filter((row) => row.kind === 'item').length
  const todo = body.filter((row) => row.todo).length
  // narrowed to what is outstanding, the sections above it are scaffolding
  // for rows that are no longer there
  const listed = showing === 'all' ? body : body.filter((row) => row.todo)
  // stops at the page's own bottom padding rather than running into it
  const [measure, height] = useRestOfTheScroller(24, 240)

  // the card's numbers: the root group's own ledger, or the paper-wide sum
  const capSum =
    root !== null && root.cap != null && root.cap !== ''
      ? Number(root.cap)
      : body
          .filter((row) => row.kind === 'group' && row.depth === 0)
          .reduce((sum, row) => sum + (row.cap == null || row.cap === '' ? 0 : Number(row.cap)), 0)
  const got =
    root !== null && root.right !== ''
      ? Number(root.right)
      : standing === null
        ? 0
        : Number(standing.total)
  const groupCount = body.filter((row) => row.kind === 'group' && row.depth === 0).length

  // Which rows still have a sibling below them at their own depth, and which
  // open a subtree: the connector lines are drawn per row from these two
  // facts, the way a file tree draws them.
  const joints = listed.map((row, index) => {
    const after = listed.slice(index + 1).find((one) => one.depth <= row.depth)
    const next = listed[index + 1]
    return {
      last: after === undefined || after.depth < row.depth,
      hasKids: next !== undefined && next.depth > row.depth,
    }
  })

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

      {/* the round in one card over the list of it: its name, what it has
          granted, and how much paper there is */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-xs font-semibold">{root?.name ?? batchName}</span>
          <span className="flex-1" />
          <span className="shrink-0 text-[17px] leading-none font-semibold tabular-nums">
            {got.toFixed(2)}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(m.myEntriesPaperUnit)}
          </span>
        </div>
        {capSum > 0 && (
          <span className="block h-0.75 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-foreground"
              style={{ width: `${Math.min(100, Math.round((got / capSum) * 100))}%` }}
            />
          </span>
        )}
        <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
          {capSum > 0 && (
            <span className="shrink-0 whitespace-nowrap">
              {format(m.myEntriesPaperCap, { value: capSum.toFixed(0) })}
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 whitespace-nowrap">
            {format(m.myEntriesPaperMeta, { groups: groupCount, items: questions })}
          </span>
        </div>
      </div>

      {listed.length === 0 ? (
        <p className="rounded-xl border px-3 py-4 text-sm text-muted-foreground">
          {format(m.myEntriesFilterNone)}
        </p>
      ) : (
        <ul className="relative flex min-h-0 flex-col overflow-y-auto rounded-xl border p-1.5 lg:flex-1">
          {listed.map((row, index) => {
            const depth = showing === 'all' ? row.depth : 0
            const joint = joints[index]!
            const hollow = row.tag === 'open' || row.tag === 'voided'
            const alert = row.todo && (row.tag === 'needs_revision' || row.tag === 'draft')
            const capNum =
              row.cap === null || row.cap === undefined || row.cap === '' ? 0 : Number(row.cap)
            const gotNum = row.right === '' ? 0 : Number(row.right)
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  style={{ paddingLeft: `${depth * 14 + 10}px` }}
                  className={cn(
                    'relative flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left transition-colors',
                    openId === row.id ? 'bg-accent' : 'hover:bg-accent/50',
                    row.kind === 'group' && row.depth === 0 && index > 0 && 'mt-1',
                  )}
                >
                  {/* the joints of the tree: an elbow into this row, and the
                      sibling line running past it while siblings remain */}
                  {showing === 'all' && depth > 0 && (
                    <>
                      <span
                        aria-hidden
                        className="absolute top-0 h-1/2 w-2.5 rounded-bl-[7px] border-b border-l border-border"
                        style={{ left: `${(depth - 1) * 14 + 12}px` }}
                      />
                      {!joint.last && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 w-px bg-border"
                          style={{ left: `${(depth - 1) * 14 + 12}px` }}
                        />
                      )}
                    </>
                  )}
                  {showing === 'all' && row.kind === 'group' && joint.hasKids && (
                    <span
                      aria-hidden
                      className="absolute bottom-0 h-1/2 w-px bg-border"
                      style={{ left: `${depth * 14 + 12}px` }}
                    />
                  )}
                  {row.kind === 'group' ? (
                    <span aria-hidden className="size-[7px] shrink-0 rounded-[2px] bg-border" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'size-[7px] shrink-0 rounded-full',
                        alert
                          ? 'bg-destructive'
                          : hollow
                            ? 'border border-muted-foreground/45'
                            : 'bg-muted-foreground/60',
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      row.kind === 'group' && 'font-semibold',
                      openId === row.id && 'font-semibold',
                      row.kind === 'item' && row.tag === 'recorded' && 'text-muted-foreground',
                    )}
                  >
                    {row.name}
                  </span>
                  {row.kind === 'item' && row.tag !== null && row.tag !== 'recorded' && (
                    <span
                      className={cn(
                        'max-w-24 shrink-0 truncate text-xs',
                        alert ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {format(ROW_TAG[row.tag])}
                    </span>
                  )}
                  {row.kind === 'group' ? (
                    // the group's own ledger line: how much, of how much
                    <span className="flex w-16 shrink-0 flex-col items-end gap-1">
                      <span className="flex items-baseline gap-0.5 whitespace-nowrap">
                        <span className="text-xs font-semibold tabular-nums">
                          {row.right === '' ? '0' : trimAmount(row.right)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {capNum > 0
                            ? `/ ${trimAmount(String(capNum))}`
                            : format(m.myEntriesPaperUnit)}
                        </span>
                      </span>
                      {capNum > 0 && (
                        <span className="block h-0.75 w-full overflow-hidden rounded-full bg-border">
                          <span
                            className="block h-full rounded-full bg-foreground"
                            style={{
                              width: `${Math.round(Math.min(1, gotNum / capNum) * 100)}%`,
                            }}
                          />
                        </span>
                      )}
                    </span>
                  ) : (
                    row.right !== '' && (
                      <span className="shrink-0 text-xs whitespace-nowrap tabular-nums">
                        {trimAmount(row.right)} {format(m.myEntriesPaperUnit)}
                      </span>
                    )
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
