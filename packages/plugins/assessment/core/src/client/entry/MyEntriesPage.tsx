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
import { RefreshCwIcon, TableOfContentsIcon } from 'lucide-react'
import { AsyncSection } from '@qualy/ui/admin'
import { cn } from '@qualy/ui/cn'
import { Appear, Glide, Sift, SiftRow, Swap } from '@qualy/ui/reveal'
import { Button } from '@qualy/ui/button'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { entryRefusalMessage } from './refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { useRestOfTheScroller } from '../rest-of-the-scroller.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntrySheet } from './EntrySheet.tsx'
import { Paper } from './Paper.tsx'
import { ROW_DOT, ROW_TAG, standingRows, type Standing, type StructureRow } from './standing.ts'
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
  const [selected] = useLayer('open')
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
        />
      )}
    </BatchScreen>
  )
}

/**
 * The line a row has to reach before it counts as the one being read: clear
 * of the band strip pinned under the toolbar, which is all that stands over
 * the paper - 36px of strip and a little air.
 */
const READING_EDGE = 44

/**
 * The paper's own scroller, where it has one.
 *
 * Side by side the paper scrolls inside itself; narrow it is part of the
 * page and the page's scroller is the right one to move.
 */
const paneViewport = (pane: HTMLElement | null): HTMLElement | null => {
  const found = pane?.querySelector('[data-slot="scroll-area-viewport"]')
  return found instanceof HTMLElement ? found : null
}

/** the nearest scroller the paper flows in, when it has none of its own */
const pageScroller = (pane: HTMLElement | null): HTMLElement | null => {
  for (let at = pane?.parentElement ?? null; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

/**
 * Bring a row under the reader, reporting whether it could and where the
 * scroll will come to rest.
 *
 * Arithmetic rather than `scrollIntoView`, which scrolls every scrollable
 * ancestor it can find: in a pane that scrolls inside itself that means the
 * shell moves too, taking the toolbar and the rail off the top of the window
 * with it. Narrow, the toolbar rides inside the scroller as a sticky block,
 * so its height joins what the row has to clear; the strip's 36px are
 * counted whether or not the strip is up right now, because it will be by
 * the time the scroll ends.
 */
const bring = (
  pane: HTMLElement | null,
  head: HTMLElement | null,
  id: string,
  how: 'smooth' | 'instant',
): { moved: boolean; top: number | null } => {
  const row = pane?.querySelector(`[data-paper-row="${id}"]`)
  if (!(row instanceof HTMLElement)) return { moved: false, top: null }
  const inPane = paneViewport(pane)
  const viewport = inPane ?? pageScroller(pane)
  if (viewport === null) return { moved: false, top: null }
  // a band card wants the top of the reading area; a question wants to
  // clear the strip that names the band it is in
  const sticky = inPane !== null ? 0 : (head?.offsetHeight ?? 0)
  const clear = sticky + (row.hasAttribute('data-paper-band') ? 0 : READING_EDGE)
  const at =
    viewport.scrollTop + row.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  // where it will come to rest: the end of the paper stops short of what a
  // row near the bottom asks for, and the mark has to know that
  const top = Math.min(
    Math.max(0, at - clear),
    Math.max(0, viewport.scrollHeight - viewport.clientHeight),
  )
  viewport.scrollTo({ top, behavior: how })
  return { moved: true, top }
}

function Body({
  batchId,
  batchName,
  materialRange,
  selected,
}: {
  batchId: string
  batchName: string
  materialRange: { start: string; end: string }
  /** which row of the structure is open, by id; '' is the first one that is */
  selected: string
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  // Wake-ups from the server, mapped to the exact reads they stale. The
  // paper redraws itself from fresh answers; nothing here touches the form
  // a person may be filling - the open dialog holds its own snapshot and
  // its own stale protocol.
  const { live } = useBatchLive(batchId, (kind) => {
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    switch (kind) {
      case 'sync':
        stale(query.assessment.key())
        return
      case 'entries-changed':
        stale(query.assessment.listMyEntries.key({ params: { batchId }, query: {} }))
        stale(query.assessment.listAwaitingSupplements.key({ query: { batchId } }))
        return
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
        return
      case 'result-changed':
        stale(query.assessment.getMyResult.key({ params: { batchId } }))
        return
      default:
        return
    }
  })

  const items = useQuery({
    ...query.assessment.listItems.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  const groups = useQuery({
    ...query.assessment.listScoreGroups.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  // what the round has already granted, so a group can say where it stands.
  // It is part of the first paint like the rest: an amount that arrives a
  // moment later moves every card underneath it out from under the cursor
  const standing = useQuery({
    ...query.assessment.getMyResult.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const mine = useQuery({
    ...query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  // 'new' is a claim about to exist on whichever question is open; anything
  // else names the claim being rewritten. The question itself is never
  // repeated here - `open` already says which one this is about.
  const [filing, setFiling] = useLayer('entry')
  const [detail, setDetail] = useLayer('detail')
  // narrow only: the structure folded into a drawer the toolbar opens
  const [structure, setStructure] = useLayer('rail')
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

  // the refresh key's one press: every read this screen stands on, again
  const refetchAll = () => {
    void items.refetch()
    void groups.refetch()
    void mine.refetch()
    void standing.refetch()
  }
  const anyFetching =
    items.isFetching || groups.isFetching || mine.isFetching || standing.isFetching

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
      // a declaration has no fields, but its worth and its route are still
      // the question's current version - the press names what it saw
      const seen = (items.data?.items ?? []).find((one) => one.id === input.itemId)?.currentRevision
        ?.id
      const created = await run(
        api.assessment.createEntry({
          payload: {
            itemId: input.itemId,
            participantId: mine.data.participantId,
            payload: {},
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
      const sent = await run(
        api.assessment.setEntryStatus({
          params: { entryId: created.entry.id },
          payload: {
            status: 'in_review',
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
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
    mutationFn: (input: {
      entryId: string
      status: 'in_review' | 'draft' | 'voided'
      expectedItemRevisionId?: string
    }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: {
            status: input.status,
            ...(input.expectedItemRevisionId === undefined
              ? {}
              : { expectedItemRevisionId: input.expectedItemRevisionId }),
          },
        }),
      ),
    // said out loud, per act: three different things just happened to the
    // claim, and a silently refreshed list reports none of them
    onSuccess: (_result, input) => {
      toast.success(
        format(
          input.status === 'in_review'
            ? m.entrySubmittedToast
            : input.status === 'draft'
              ? m.entryWithdrawnToast
              : m.entryAbandonedToast,
        ),
      )
      refresh()
    },
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

  const unreadItems = useMemo(
    () => new Set(mine.data?.attention?.unreadItemIds ?? []),
    [mine.data?.attention?.unreadItemIds],
  )
  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing: (standing.data ?? null) as Standing | null,
        unreadItems,
      }),
    [groups.data, visible, entriesByItem, standing.data, unreadItems],
  )

  // Looking silences the dot (§32.72). "Looking" is a settled pause on the
  // question - the scroll spy's row, held for a moment - or opening one of
  // its claims outright; a fast scroll past ten questions marks nothing.
  // The cache is corrected locally: a look is not a business change, so no
  // refetch and no announcement ride on it.
  const listKey = query.assessment.listMyEntries.key({ params: { batchId }, query: {} })
  const markRead = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.markMyEntryRead({ params: { batchId, itemId } })),
    onSuccess: (_result, itemId) => {
      queryClient.setQueryData(
        listKey,
        (old: { attention: { unreadItemIds: readonly string[] } } | undefined) =>
          old === undefined
            ? old
            : {
                ...old,
                attention: {
                  unreadItemIds: old.attention.unreadItemIds.filter((id) => id !== itemId),
                },
              },
      )
    },
  })
  const lookAt = (itemId: string | null | undefined) => {
    if (itemId != null && unreadItems.has(itemId)) markRead.mutate(itemId)
  }
  // opening a question outright is a look, no pause required
  useEffect(() => {
    const row = rows.find((one) => one.id === selected)
    if (row?.kind === 'item') lookAt(row.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows])

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
  // Held as state, not a ref: the paper mounts on its own schedule - the
  // rows exist for the moment between the questions arriving and the last
  // read the page waits for - and everything that watches the paper has to
  // start watching when it appears, not when the rows change.
  const [paper, setPaper] = useState<HTMLElement | null>(null)
  // the toolbar block that rides sticky inside the narrow scroller; its
  // height is what a scroll target has to clear there
  const [head, setHead] = useState<HTMLElement | null>(null)
  const [passing, setPassing] = useState('')
  // which band's card has gone above the toolbar, and so wants naming in the
  // strip; a band whose card is still on screen names itself
  const [passedBand, setPassedBand] = useState('')
  // While a click's scroll is in flight, the spy would call out every row it
  // passes and the rail's mark would strobe through all of them. The
  // steering lock holds the mark on the destination until the scroll gets
  // there (or gives up).
  const steering = useRef<{ id: string; top: number; until: number } | null>(null)
  useEffect(() => {
    const viewport = paneViewport(paper) ?? pageScroller(paper)
    if (viewport === null) return
    let frame = 0
    const read = () => {
      frame = 0
      const port = viewport.getBoundingClientRect()
      // Where the reading starts: under the sticky toolbar where the paper
      // flows in the page, at the pane's own top where it scrolls inside
      // itself - the toolbar stands outside the pane there, so its bottom
      // IS the pane's top. One base for both shapes.
      const base =
        head === null ? port.top : Math.max(port.top, head.getBoundingClientRect().bottom)
      // past the pinned band strip as well: what counts as "under the
      // reader" is what stands clear of everything pinned above it
      const edge = base + READING_EDGE
      // The tail of the paper can never reach that line: a last band of two
      // questions stops the scroll long before its rows climb that high, and
      // a rail that never lights them is a rail that lies. At the end of the
      // scroll the reader is reading whatever the end shows, so the last row
      // on screen is the one being read.
      const stopped = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 2
      let current = ''
      for (const el of viewport.querySelectorAll('[data-paper-row]')) {
        const box = el.getBoundingClientRect()
        if (box.top <= edge || (stopped && box.top < port.bottom)) {
          current = el.getAttribute('data-paper-row') ?? ''
        } else break
      }
      // the strip is geometry, not inference: it names the band whose own
      // card has left the top of the pane, so it never repeats a card the
      // reader can still see
      let band = ''
      for (const el of viewport.querySelectorAll('[data-paper-band]')) {
        if (el.getBoundingClientRect().bottom <= base + 1) {
          band = el.getAttribute('data-paper-band') ?? ''
        } else break
      }
      setPassedBand(band)
      const held = steering.current
      if (held !== null) {
        // parked where the click put it: the reader has not moved since, so
        // the row they asked for is still the row they are reading - true
        // as well of a row near the end, which the scroll stops short of
        // bringing all the way up
        if (Math.abs(viewport.scrollTop - held.top) <= 4) {
          setPassing(held.id)
          return
        }
        // still on its way there
        if (Date.now() <= held.until) return
        steering.current = null
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
    // the scroller itself is swapped out when the two panes stop standing
    // side by side, and the new one needs its own listener
  }, [paper, head, beside, rows.length])

  /**
   * A rail click: name it in the address, then bring it under the reader.
   * One write moves both layers - the chosen row lands in `open` and the
   * drawer's own layer clears - because two writes from one click race on
   * the router's snapshot and the second silently drops the first.
   */
  const goTo = (id: string) => {
    updateQuery({ open: id, rail: '' }, { history: beside ? 'replace' : 'push' })
    setPassing(id)
    const { top } = bring(paper, head, id, 'smooth')
    steering.current = top === null ? null : { id, top, until: Date.now() + 1500 }
  }
  // The row the page ARRIVED at, jumped to once and never again: a row the
  // reader names later by clicking the rail is theirs to scroll to smoothly,
  // and an instant jump racing that scroll is what makes the first click of
  // a session snap while every later one glides. The jump waits for its row
  // to exist, too - the groups arrive before the questions do, and a landing
  // spent on the commit in between scrolls to nothing at all.
  const arrivedAt = useRef(selected)
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || arrivedAt.current === '') return
    // side by side the paper scrolls inside itself, and until that scroller
    // exists the only thing a jump can move is the shell around it
    if (beside && paneViewport(paper) === null) return
    landed.current = bring(paper, head, arrivedAt.current, 'instant').moved
    // reading the address is not a scroll; the spy fills in from here
  }, [paper, head, beside, rows.length])

  // the depth the bands sit at: one down when a single root group holds the
  // whole paper, since the summary card stands in for that one
  const bandDepth =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? 1
      : 0
  const isBand = (id: string): boolean => {
    const at = rows.find((row) => row.id === id)
    return at !== undefined && at.kind === 'group' && at.depth === bandDepth
  }
  // The band named by the strip pinned under the toolbar: the one whose own
  // card has gone off the top, because a strip repeating a card still on
  // screen names the place twice. A click that sent the reader to a band
  // whose card is on screen quiets it too - naming the band before the one
  // they asked for reads as a wrong answer.
  const currentBand =
    passedBand === '' || (passing !== passedBand && isBand(passing))
      ? null
      : (rows.find((row) => row.id === passedBand) ?? null)
  const bandNoOf = (band: StructureRow): string => {
    const tops = rows.filter((row) => row.kind === 'group' && row.depth === bandDepth)
    return String(tops.findIndex((row) => row.id === band.id) + 1).padStart(2, '0')
  }

  // What the rail marks is what the reader is looking at, and only the spy
  // knows that. Falling back to the first question meant the mark opened on
  // question one and then slid up to the band the reader was actually on,
  // which reads as the page correcting itself; on a phone, where the paper
  // scrolls as the page, the drawer opened marking a question nobody had
  // scrolled to. Nothing is marked until the paper has been read once - the
  // spy answers on mount, so that is one frame, not a wait.
  const marked = passing !== '' ? passing : selected !== '' ? selected : null
  useEffect(() => {
    const row = rows.find((one) => one.id === marked)
    if (row?.kind !== 'item' || !row.unread) return
    const timer = setTimeout(() => lookAt(row.id), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked, rows])

  const [paperView, setPaperView] = useState<'all' | 'todo'>('all')
  const questionCount = rows.filter((row) => row.kind === 'item').length
  const todoCount = rows.filter((row) => row.todo).length
  const bandCount = rows.filter((row) => row.kind === 'group' && row.depth === bandDepth).length
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
        // the page's own shape, greyed: a rail of question rows, and on a
        // desk the paper beside it - not two anonymous slabs
        <div className="flex min-h-0 flex-1 gap-6">
          <div className="flex w-94 shrink-0 flex-col gap-2 max-lg:w-full">
            {['w-3/5', 'w-2/5', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'].map((width, index) => (
              <div key={index} className="flex items-center gap-3 rounded-xl border px-4 py-3.5">
                <Skeleton className="size-[7px] shrink-0 rounded-full" />
                <Skeleton className={`h-4 ${width}`} />
                <Skeleton className="ml-auto h-4 w-12 shrink-0" />
              </div>
            ))}
          </div>
          <div className="hidden min-w-0 flex-1 flex-col gap-4 pt-1 lg:flex">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80" />
            <div className="flex flex-col gap-3 pt-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          </div>
        </div>
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">{format(m.myEntriesEmpty)}</p>
      ) : (
        // the structure as its own column, the paper as the page: both panes
        // scroll inside themselves where they stand side by side; narrow,
        // the paper flows in the page and the structure folds into a drawer
        <div className="relative flex min-h-96 flex-col lg:min-h-0 lg:flex-1">
          <div className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
            <Structure
              rows={rows}
              batchName={batchName}
              standing={(standing.data ?? null) as Standing | null}
              openId={marked}
              onOpen={goTo}
            />

            <div ref={setPaper} className="flex min-w-0 flex-col lg:min-h-0 lg:border-l">
              {/* The paper's own toolbar. Beside the rail it is the pane's
                  own edge, outside the scroller and level with the rail's
                  heading; narrow it rides sticky at the top of the page's
                  scroll, with the strip naming the section being read pinned
                  to its underside. The display card stays in the paper; the
                  strip is its short understudy, gone whenever the card
                  itself is on screen. */}
              <div className="z-10 max-lg:sticky max-lg:top-0">
                <div ref={setHead} className="bg-background">
                  {/* phone: the name gets a line, the controls get the next */}
                  <div className="flex flex-col gap-2.5 border-b px-4 pt-3 pb-2.5 md:hidden">
                    <div className="flex items-end gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h1 className="text-[17px] leading-tight font-semibold">
                          {format(m.myEntriesTab)}
                        </h1>
                        <p className="text-xs text-muted-foreground">
                          {format(m.myEntriesPaperMeta, {
                            groups: bandCount,
                            items: questionCount,
                          })}
                        </p>
                      </div>
                      <span className="flex-1" />
                      <div className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                        <span className="text-[11px] text-muted-foreground">
                          {format(m.myEntriesCounted)}
                        </span>
                        <span className="text-xl leading-none font-semibold tabular-nums">
                          {standing.data === undefined
                            ? '—'
                            : Number(standing.data.total).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tabs
                        className="min-w-0 flex-1"
                        value={paperView}
                        onValueChange={(next) => setPaperView(next as 'all' | 'todo')}
                      >
                        <TabsList className="w-full">
                          <TabsTrigger className="flex-1" value="all">
                            {format(m.paperViewAll)}
                          </TabsTrigger>
                          <TabsTrigger className="flex-1" value="todo">
                            {format(m.paperViewTodo)}
                            {todoCount > 0 && <span className="tabular-nums">{todoCount}</span>}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setStructure('1')}
                      >
                        <TableOfContentsIcon aria-hidden />
                        {format(m.paperStructureShort)}
                      </Button>
                    </div>
                  </div>
                  {/* tablet up: one row; the structure key leaves once the
                      rail stands beside the paper */}
                  <div className="hidden h-12 border-b md:block">
                    <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-4 lg:px-6">
                      <h1 className="shrink-0 text-base font-semibold">{format(m.myEntriesTab)}</h1>
                      <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />
                      <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                        <span className="text-xs text-muted-foreground">
                          {format(m.myEntriesCounted)}
                        </span>
                        <span className="text-lg leading-none font-semibold tabular-nums">
                          {standing.data === undefined
                            ? '—'
                            : Number(standing.data.total).toFixed(2)}
                        </span>
                      </span>
                      <span className="flex-1" />
                      {/* the escape hatch, not the mechanism: state flows in
                          on its own, and this is for the person who wants to
                          ask the server directly anyway */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        disabled={anyFetching}
                        onClick={refetchAll}
                      >
                        <RefreshCwIcon aria-hidden className={cn(anyFetching && 'animate-spin')} />
                        <span className="sr-only">{format(m.myEntriesRefresh)}</span>
                      </Button>
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 lg:hidden"
                        onClick={() => setStructure('1')}
                      >
                        <TableOfContentsIcon aria-hidden />
                        {format(m.paperStructureShort)}
                      </Button>
                    </div>
                  </div>
                </div>
                {/* the 36px understudy of the section card, narrow only:
                    the rail keeps the desktop reader oriented instead */}
                <div className="lg:hidden">
                  <Appear show={currentBand !== null} collapse>
                    <div className="border-b bg-background/95 backdrop-blur-sm">
                      <div className="mx-auto flex h-9 w-full max-w-6xl items-center gap-2.5 px-4">
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground/60 tabular-nums">
                          {currentBand !== null ? bandNoOf(currentBand) : ''}
                        </span>
                        <span className="min-w-0 truncate text-[13px] font-semibold">
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
              </div>
              <PaneScroller>
                {/* the same paper, narrowed: it fades over itself so the
                    switch reads as this paper changing rather than another
                    one arriving */}
                <Swap swapKey={paperView} className="w-full">
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
                </Swap>
              </PaneScroller>
            </div>
          </div>
        </div>
      )}

      {/* Narrow only: the structure, folded into a drawer the toolbar
          opens. The same rows, the same goTo - picking one scrolls the
          paper and the drawer's own layer clears in the same address write,
          so the back key walks drawer-then-page like any other layer. */}
      {!beside && (
        <Sheet
          open={structure !== ''}
          onOpenChange={(next) => {
            if (!next) setStructure('')
          }}
        >
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-[20px] p-0"
          >
            <SheetTitle className="sr-only">{format(m.paperStructure)}</SheetTitle>
            <span
              aria-hidden
              className="mx-auto mt-2.5 mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
            />
            <Structure
              variant="sheet"
              rows={rows}
              batchName={batchName}
              standing={(standing.data ?? null) as Standing | null}
              openId={marked}
              onOpen={goTo}
            />
          </SheetContent>
        </Sheet>
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
          onStale={() => void items.refetch()}
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
          onStatus={(status, expectedItemRevisionId) =>
            setStatus.mutate({
              entryId: lingeringDetail.entry.id,
              status,
              ...(expectedItemRevisionId === undefined ? {} : { expectedItemRevisionId }),
            })
          }
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
  variant = 'rail',
}: {
  rows: readonly StructureRow[]
  batchName: string
  standing: Standing | null
  openId: string | null
  onOpen: (id: string) => void
  /**
   * Where the structure is standing: `rail` is the column beside the paper,
   * `sheet` is the same list inside the drawer the narrow toolbar opens -
   * without the summary card, because the drawer's little height belongs to
   * the rows, and the card's numbers are already on the toolbar above.
   */
  variant?: 'rail' | 'sheet'
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

  // the tree itself, one list shared by the rail and the drawer
  const tree =
    listed.length === 0 ? (
      <p className="rounded-xl border px-3 py-4 text-sm text-muted-foreground">
        {format(m.myEntriesFilterNone)}
      </p>
    ) : (
      <ul ref={listRef} className="relative isolate flex min-h-0 flex-col">
        {markBox !== null && (
          <Glide top={markBox.top} height={markBox.height} className="-z-10 rounded-lg bg-accent" />
        )}
        <Sift>
          {listed.map((row, index) => {
            const depth = showing === 'all' ? row.depth : 0
            const joint = joints[index]!
            const gone = row.tag === 'voided'
            // the row's word asks for a raised voice only while the round
            // is waiting on the reader
            const urgent = row.tag === 'supplement' || row.tag === 'needs_revision'
            const capNum =
              row.cap === null || row.cap === undefined || row.cap === '' ? 0 : Number(row.cap)
            const gotNum = row.right === '' ? 0 : Number(row.right)
            return (
              <SiftRow key={row.id}>
                <button
                  type="button"
                  data-rail-row={row.id}
                  // the mark behind the row is paint; this is the part a
                  // screen reader can hear
                  aria-current={openId === row.id ? 'true' : undefined}
                  onClick={() => onOpen(row.id)}
                  style={{ paddingLeft: `${depth * 14 + 10}px` }}
                  className={cn(
                    'relative isolate flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left transition-colors',
                    openId !== row.id && 'hover:bg-accent/50',
                    row.kind === 'group' && row.depth === 0 && index > 0 && 'mt-1',
                    // withdrawn: still listed, because what was filed
                    // under it is still there to read, but it takes
                    // less room and wears the fact on its name
                    gone && 'py-1',
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
                  ) : row.unread ? (
                    // unread paints over everything: something here changed
                    // and its owner has not seen it
                    <span
                      role="status"
                      data-testid="unread-dot"
                      aria-label={format(m.rowUnread)}
                      className="size-[7px] shrink-0 rounded-full bg-destructive"
                    />
                  ) : (
                    // the row's own word as a colour, never an alarm: amber
                    // waits on the reader, verdict inks say how it ended,
                    // hollow means nothing is claimed here yet
                    <span
                      aria-hidden
                      className={cn(
                        'size-[7px] shrink-0 rounded-full',
                        row.tag === null ? 'border border-muted-foreground/30' : ROW_DOT[row.tag],
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      row.kind === 'group' && 'font-semibold',
                      openId === row.id && 'font-semibold',
                      row.kind === 'item' && row.tag === 'recorded' && 'text-muted-foreground',
                      gone &&
                        'text-xs font-normal text-muted-foreground line-through decoration-muted-foreground/40',
                    )}
                  >
                    {row.name}
                  </span>
                  {row.kind === 'item' && row.tag !== null && row.tag !== 'recorded' && (
                    <span
                      className={cn(
                        'max-w-24 shrink-0 truncate text-xs',
                        urgent
                          ? 'font-medium text-amber-700 dark:text-amber-300'
                          : 'text-muted-foreground',
                      )}
                    >
                      {format(ROW_TAG[row.tag])}
                    </span>
                  )}
                  {row.kind === 'group' ? (
                    // the group's own ledger line: how much, of how much
                    <span className="flex w-16 shrink-0 flex-col items-end gap-1">
                      <span className="flex items-baseline gap-0.5 whitespace-nowrap">
                        <span
                          className={cn(
                            'text-xs font-semibold tabular-nums',
                            gotNum === 0 && 'text-muted-foreground',
                          )}
                        >
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
                    // a question that has granted nothing yet says
                    // nothing: a 0 beside every untouched row reads as a
                    // page full of failures
                    gotNum > 0 && (
                      <span className="shrink-0 text-xs whitespace-nowrap tabular-nums">
                        {trimAmount(row.right)} {format(m.myEntriesPaperUnit)}
                      </span>
                    )
                  )}
                </button>
              </SiftRow>
            )
          })}
        </Sift>
      </ul>
    )

  const filterTabs = (
    <Tabs value={showing} onValueChange={(next) => setShowing(next as 'all' | 'todo')}>
      <TabsList>
        <TabsTrigger value="all">{format(m.myEntriesFilterAll)}</TabsTrigger>
        <TabsTrigger value="todo">
          {format(m.myEntriesFilterTodo)}
          {todo > 0 && <span className="tabular-nums">{todo}</span>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )

  if (variant === 'sheet') {
    return (
      <div ref={railRef} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2.5 border-b px-4 pb-2.5">
          <p className="shrink-0 text-[13px] font-semibold">{format(m.paperStructure)}</p>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {format(m.myEntriesPaperMeta, { groups: groupCount, items: questions })}
          </span>
          <span className="flex-1" />
          {filterTabs}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {tree}
        </div>
      </div>
    )
  }

  return (
    // its own column, on the widths that afford one: the page's index,
    // scrolling inside itself beside the paper
    <div ref={railRef} className="relative flex min-w-0 flex-col max-lg:hidden lg:min-h-0">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <p className="text-sm font-semibold">{format(m.paperStructure)}</p>
      </div>
      <PaneScroller>
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex shrink-0 items-center gap-3">
            {filterTabs}
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
              <span
                className={cn(
                  'shrink-0 text-lg leading-none font-semibold tabular-nums',
                  got === 0 && 'text-muted-foreground',
                )}
              >
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

          {tree}
        </div>
      </PaneScroller>
    </div>
  )
}
