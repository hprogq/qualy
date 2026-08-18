import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageQueryUpdate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { cn } from '@qualy/ui/cn'
import { Appear, Glide } from '@qualy/ui/reveal'
import { ScrollArea } from '@qualy/ui/scroll-area'
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
import { Paper } from './Paper.tsx'
import { ROW_TAG, standingRows, type Standing, type StructureRow } from './standing.ts'
import { trimAmount, type EntryDto, type ItemDto } from './model.ts'

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
    // no band: the paper carries its own toolbar, with the page's name and
    // numbers on it, and fills whatever the shell gives it
    <BatchScreen title={format(m.myEntriesTab)} size="full" chrome="none">
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
  // moving two layers at once - open this question AND start a claim on
  // it - must be one address write: two writes from one click race on the
  // router's snapshot and the second silently drops the first, which is a
  // filing dialog that opens on the wrong question or not at all
  const beside = useSideBySide()
  const updateQuery = usePageQueryUpdate()
  const openAndFile = (itemId: string, entryId: string) =>
    updateQuery({ open: itemId, entry: entryId }, { history: beside ? 'replace' : 'push' })
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

  // The rail follows the scroll: whichever paper row is under the toolbar
  // is the one the rail highlights, with the same mark a click leaves. The
  // address is written only by clicks - a scroll is reading, not going
  // somewhere, and a hundred history entries per page would prove it.
  const paperRef = useRef<HTMLDivElement | null>(null)
  const [passing, setPassing] = useState('')
  // While a click's smooth scroll is in flight, the spy would call out every
  // row it passes and the rail's mark would strobe through all of them. The
  // steering lock holds the mark on the destination until the scroll gets
  // there (or gives up).
  const steering = useRef<{ id: string; until: number } | null>(null)
  useEffect(() => {
    const pane = paperRef.current
    if (pane === null) return
    const viewport = pane.querySelector('[data-slot="scroll-area-viewport"]')
    if (!(viewport instanceof HTMLElement)) return
    let frame = 0
    const read = () => {
      frame = 0
      // past the toolbar and the sticky band both: what counts as "under
      // the reader" is what stands clear of everything pinned above it
      const edge = viewport.getBoundingClientRect().top + 96
      let current = ''
      for (const el of viewport.querySelectorAll('[data-paper-row]')) {
        if (el.getBoundingClientRect().top <= edge) {
          current = el.getAttribute('data-paper-row') ?? ''
        } else break
      }
      const held = steering.current
      if (held !== null) {
        if (current === held.id || Date.now() > held.until) steering.current = null
        else return
      }
      setPassing(current)
    }
    const on = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    read()
    viewport.addEventListener('scroll', on, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', on)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [rows.length])

  /** a rail click: name it in the address, then bring it under the reader */
  const goTo = (id: string) => {
    onSelect(id)
    steering.current = { id, until: Date.now() + 1500 }
    setPassing(id)
    paperRef.current
      ?.querySelector(`[data-paper-row="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // the address's row, once, when the page arrives already naming one
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || rows.length === 0) return
    landed.current = true
    if (selected !== '') {
      paperRef.current
        ?.querySelector(`[data-paper-row="${selected}"]`)
        ?.scrollIntoView({ block: 'start' })
    }
    // reading the address is not a scroll; the spy fills in from here
  }, [rows.length, selected])

  // the band the reader is inside, for the strip pinned under the toolbar:
  // shown only while the band's own card is off the top, because a strip
  // repeating a card still on screen names the place twice
  const currentBand = (() => {
    if (passing === '') return null
    const rooted =
      rows.length > 0 &&
      rows[0]!.kind === 'group' &&
      rows.filter((row) => row.depth === 0).length === 1
    const bandDepth = rooted ? 1 : 0
    let at: StructureRow | null = rows.find((row) => row.id === passing) ?? null
    if (at === null) return null
    if (at.kind === 'group' && at.depth === bandDepth) return null
    while (at !== null && !(at.kind === 'group' && at.depth === bandDepth)) {
      const parent: string | null = at.parentId
      at = parent === null ? null : (rows.find((row) => row.id === parent) ?? null)
    }
    return at
  })()
  const bandNoOf = (band: StructureRow): string => {
    const rooted =
      rows.length > 0 &&
      rows[0]!.kind === 'group' &&
      rows.filter((row) => row.depth === 0).length === 1
    const bandDepth = rooted ? 1 : 0
    const tops = rows.filter((row) => row.kind === 'group' && row.depth === bandDepth)
    return String(tops.findIndex((row) => row.id === band.id) + 1).padStart(2, '0')
  }

  const [paperView, setPaperView] = useState<'all' | 'todo'>('all')
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
  const pendingCount = entries.filter((entry) => entry.status === 'in_review').length
  const draftCount = entries.filter((entry) => entry.status === 'draft').length
  const backCount = entries.filter((entry) => entry.status === 'needs_revision').length

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
      className="flex min-h-0 flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{format(m.myEntriesEmpty)}</p>
      ) : (
        // the structure as its own column, the paper as the page: both panes
        // scroll inside themselves where they stand side by side, and stack
        // into one flowing page where they do not
        <div className="relative flex min-h-96 flex-col lg:min-h-0 lg:flex-1">
          <div className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
            <Structure
              rows={rows}
              batchName={batchName}
              standing={(standing.data ?? null) as Standing | null}
              openId={passing !== '' ? passing : (open?.id ?? null)}
              onOpen={goTo}
            />

            <div
              ref={paperRef}
              className="relative flex min-w-0 flex-col border-t lg:min-h-0 lg:border-t-0 lg:border-l"
            >
              {/* the low bar naming the section being read: pinned to the
                  pane, not the content - inside the scroller it rode away
                  with the paper and only flashed past. The display card
                  stays in the paper; this is its short understudy, gone
                  whenever the card itself is on screen. */}
              <div className="pointer-events-none absolute inset-x-0 top-13 z-[5] max-lg:hidden">
                <Appear show={currentBand !== null}>
                  <div className="border-b bg-background/95 backdrop-blur-sm">
                    <div className="mx-auto flex h-9 w-full max-w-6xl items-center gap-2.5 px-6">
                      <span className="shrink-0 text-sm font-semibold text-muted-foreground/60">
                        {currentBand !== null ? bandNoOf(currentBand) : ''}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {currentBand?.name}
                      </span>
                      <span className="flex-1" />
                      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {currentBand === null || currentBand.right === ''
                          ? ''
                          : Number(currentBand.right).toFixed(2)}
                        {currentBand?.cap != null && currentBand.cap !== ''
                          ? ` / ${trimAmount(String(currentBand.cap))}`
                          : ''}
                      </span>
                    </div>
                  </div>
                </Appear>
              </div>
              <PaneScroller>
                {/* the paper's own toolbar: the page's name and numbers ride
                    the top of the scroll */}
                <div className="sticky top-0 z-10 border-b bg-background">
                  <div className="mx-auto flex h-13 w-full max-w-6xl items-center gap-3 px-6">
                    <h1 className="shrink-0 text-base font-semibold">{format(m.myEntriesTab)}</h1>
                    <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />
                    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-xs text-muted-foreground">
                        {format(m.myEntriesCounted)}
                      </span>
                      <span className="text-lg leading-none font-semibold tabular-nums">
                        {standing.data === undefined ? '—' : Number(standing.data.total).toFixed(2)}
                      </span>
                    </span>
                    <span className="flex-1" />
                    <span className="hidden shrink-0 items-center gap-3 rounded-lg bg-muted px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground sm:inline-flex">
                      <span className="inline-flex items-baseline gap-1">
                        {format(m.entryStatusInReview)}
                        <span className="font-semibold text-foreground tabular-nums">
                          {pendingCount}
                        </span>
                      </span>
                      <span className="inline-flex items-baseline gap-1">
                        {format(m.entryStatusDraft)}
                        <span className="font-semibold text-foreground tabular-nums">
                          {draftCount}
                        </span>
                      </span>
                      <span className="inline-flex items-baseline gap-1">
                        {format(m.entryStatusNeedsRevision)}
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            backCount > 0 ? 'text-destructive' : 'text-foreground',
                          )}
                        >
                          {backCount}
                        </span>
                      </span>
                    </span>
                    <Tabs
                      value={paperView}
                      onValueChange={(next) => setPaperView(next as 'all' | 'todo')}
                    >
                      <TabsList>
                        <TabsTrigger value="all">{format(m.paperViewAll)}</TabsTrigger>
                        <TabsTrigger value="todo">{format(m.paperViewTodo)}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
                <div className="mx-auto w-full max-w-6xl">
                  <Paper
                    rows={rows}
                    entriesByItem={entriesByItem}
                    standing={(standing.data ?? null) as Standing | null}
                    showTodoOnly={paperView === 'todo'}
                    busy={setStatus.isPending || declare.isPending}
                    onFile={(item, entry) => openAndFile(item.id, entry?.id ?? 'new')}
                    onDeclare={(item) => declare.mutate({ itemId: item.id })}
                    onDetail={(entry) => setDetail(entry.id)}
                  />
                </div>
              </PaneScroller>
            </div>
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
          onEdit={() => openAndFile(lingeringDetail.item.id, lingeringDetail.entry.id)}
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
 * A pane that scrolls inside itself beside its peer, and flows as part of
 * the page when the two stack. ScrollArea's viewport always clips, so the
 * stacked case renders none at all. `relative`, because a scroller that is
 * not a positioning context cannot clip its absolute descendants.
 */
function PaneScroller({ children }: { children: ReactNode }) {
  const beside = useSideBySide()
  return beside ? (
    <ScrollArea className="relative min-h-0 flex-1">{children}</ScrollArea>
  ) : (
    <>{children}</>
  )
}

/** the groups above a row, outermost first, with the ids that open them */
const crumbsOf = (
  rows: readonly StructureRow[],
  row: StructureRow,
): readonly { id: string; name: string }[] => {
  const out: { id: string; name: string }[] = []
  let at = row.parentId
  while (at !== null) {
    const group = rows.find((one) => one.id === at)
    if (group === undefined) break
    out.unshift({ id: group.id, name: group.name })
    at = group.parentId
  }
  return out
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
}: {
  rows: readonly StructureRow[]
  batchName: string
  standing: Standing | null
  openId: string | null
  onOpen: (id: string) => void
}) {
  const { format } = useI18n()
  const [showing, setShowing] = useState<'all' | 'todo'>('all')
  // the rail reads along: when the paper's scroll moves the mark, the rail
  // scrolls its own list just enough to keep the marked row in view
  const railRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  // where the mark stands: the active row's box within the list. Measured,
  // not rendered per row - a permanently mounted mark that slides has no
  // unmount between two positions for the eye to catch as a blink.
  const [markBox, setMarkBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const list = listRef.current
    if (list === null || openId === null) {
      setMarkBox(null)
      return
    }
    const row = list.querySelector(`[data-rail-row="${openId}"]`)
    if (!(row instanceof HTMLElement)) {
      setMarkBox(null)
      return
    }
    setMarkBox({ top: row.offsetTop, height: row.offsetHeight })
  }, [openId, showing, rows])
  useEffect(() => {
    if (openId === null) return
    const viewport = railRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    const row = railRef.current?.querySelector(`[data-rail-row="${openId}"]`)
    if (!(viewport instanceof HTMLElement) || !(row instanceof Element)) return
    // plain arithmetic instead of scrollIntoView: nearest-edge scrolling
    // that nothing can cancel, and it never tugs any other scroller
    const port = viewport.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    if (at.top < port.top + 8) {
      viewport.scrollTop += at.top - port.top - 8
    } else if (at.bottom > port.bottom - 8) {
      viewport.scrollTop += at.bottom - port.bottom + 8
    }
  }, [openId])
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
    // its own column now: the page's index, scrolling inside itself beside
    // the paper, one section of the page above it when the two stack
    <div ref={railRef} className="relative flex min-w-0 flex-col lg:min-h-0">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <p className="text-sm font-semibold">{format(m.paperStructure)}</p>
      </div>
      <PaneScroller>
        <div className="flex flex-col gap-2.5 p-3">
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
              <span className="min-w-0 truncate text-xs font-semibold">
                {root?.name ?? batchName}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 text-lg leading-none font-semibold tabular-nums">
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
            <ul ref={listRef} className="isolate relative flex min-h-0 flex-col">
              {markBox !== null && (
                <Glide
                  top={markBox.top}
                  height={markBox.height}
                  className="-z-10 rounded-lg bg-accent"
                />
              )}
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
                      data-rail-row={row.id}
                      onClick={() => onOpen(row.id)}
                      style={{ paddingLeft: `${depth * 14 + 10}px` }}
                      className={cn(
                        'relative isolate flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left transition-colors',
                        openId !== row.id && 'hover:bg-accent/50',
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
      </PaneScroller>
    </div>
  )
}
