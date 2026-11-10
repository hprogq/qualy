'use client'
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router'
import { partialMatchKey, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, InboxIcon, LockIcon, SearchIcon, SearchXIcon, ShieldIcon } from 'lucide-react'
import {
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageQueryState,
  usePageQueryUpdate,
  usePageRouteParams,
} from '@qualy/web-runtime'

import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'

import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AwaitingSection } from './AwaitingSection.tsx'
import { useAwaitingQuery, useQueueRefresh, useReviewQueueQuery, type QueuePage } from './queue.ts'
import { queueRequestOf, viewOf, type View } from './inbox-reads.ts'
import { useDraftSweep } from './use-draft.ts'
import { rememberQueuePlace } from './queue-place.ts'
import { QueueBoard, QueueScope, QueueScopeSkeleton, QueueSkeleton } from './QueueBoard.tsx'
import { QueueEmpty } from './QueueEmpty.tsx'
import { ReviewDock } from './ReviewDock.tsx'
import { pageNumberOf, type InboxItemDto } from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import { ReviewActions } from './ReviewActions.tsx'
import { reviewLayout } from './queue-layout.stylex.ts'
import * as m from '#messages'

// The queue, laid out three ways: by question so one standard is applied in
// a row, by submitted time to clear a backlog oldest first, by participant
// so one person's duplicates sit next to each other. Every row opens the
// same workbench; the layout only decides which rows it walks in a run.
//
// How much is waiting, and the way to start on it, stand in the band above:
// they are about the whole queue, whichever way it is laid out below.

const TOOLBAR_ROOM = '@container review-board (min-width: 560px)'
const TOOLBAR_MID = '@container review-board (min-width: 560px) and (max-width: 879.98px)'
const TOOLBAR_WIDE = '@container review-board (min-width: 1240px)'
const SEARCH_DELAY = 250
const BOARD_WIDE = reviewLayout.wide
const FADE_SCROLL_DISTANCE = 64

const styles = stylex.create({
  viewsField: { gridArea: 'grouping', minWidth: 0 },
  fill: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  queue: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
    // the board below lays out by this room, and the controls with it, so
    // the keys over the list start where the list does
    containerType: 'inline-size',
    containerName: 'review-board',
  },
  // Give every control a seat at each width, rather than letting flex wrapping
  // produce half rows around the project index.
  controls: (areas: string) => ({
    display: 'grid',
    gridTemplateAreas: {
      default: areas,
      [TOOLBAR_MID]: '"grouping search" "filters filters"',
      [BOARD_WIDE]: '"grouping filters search"',
    },
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto',
      [TOOLBAR_MID]: 'minmax(0, 1fr) minmax(0, 15rem)',
      [BOARD_WIDE]: `${reviewLayout.indexWidth} minmax(0, 1fr) minmax(0, 14rem)`,
    },
    alignItems: 'center',
    columnGap: 8,
    rowGap: 8,
  }),
  // Only pin the toolbar when the board can lay it out on one line.
  // Keep the controls and cards in their normal positions before it sticks.
  pinnedControls: {
    position: { default: null, [BOARD_WIDE]: 'sticky' },
    top: { default: null, [BOARD_WIDE]: reviewLayout.toolbarStickyTop },
    zIndex: { default: null, [BOARD_WIDE]: 2 },
    minHeight: { default: null, [BOARD_WIDE]: reviewLayout.controlHeight },
  },
  // Bleed past the card edges. At the foot, let the cards fade in rather
  // than cutting across their borders or text with a hard line. The scrim
  // covers the sticky inset without taking up any space before scrolling.
  toolbarScrim: {
    display: { default: 'none', [BOARD_WIDE]: 'block' },
    position: 'absolute',
    insetBlockStart: `calc(0px - ${reviewLayout.toolbarStickyTop})`,
    insetBlockEnd: 0,
    insetInline: `calc(0px - ${reviewLayout.scrimBleed})`,
    zIndex: -1,
    pointerEvents: 'none',
    backgroundColor: tokens.background,
  },
  // A fixed marker in the queue's flow crosses the scrollport when the
  // toolbar reaches its sticky inset. The extra fade is paint only.
  toolbarMarker: {
    position: 'absolute',
    insetBlockStart: `calc(-1px - ${reviewLayout.toolbarStickyTop})`,
    insetInlineStart: 0,
    width: 1,
    height: 1,
    pointerEvents: 'none',
  },
  toolbarFade: {
    position: 'absolute',
    insetBlockStart: '100%',
    insetInline: 0,
    display: 'grid',
    gridTemplateColumns: `calc(${reviewLayout.indexWidth} + ${reviewLayout.indexGap}) minmax(0, 1fr)`,
    alignItems: 'start',
  },
  fadeEdge: {
    height: reviewLayout.toolbarFadeEdge,
    backgroundImage: `linear-gradient(to bottom, ${tokens.background} calc(100% - 6px), transparent)`,
  },
  resultsFadeEdge: {
    height: `calc(${reviewLayout.toolbarFadeEdge} + ${reviewLayout.pinnedResultsFadeExtra} * var(--review-fade-progress, 0))`,
  },
  filters: {
    gridArea: 'filters',
    display: { default: 'grid', [TOOLBAR_ROOM]: 'flex' },
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    // The first filter still lines up with the cards' 28px gutter.
    paddingInlineStart: { default: 0, [BOARD_WIDE]: 20 },
  },
  seekKey: {
    gridArea: 'seek',
    width: 36,
    height: 36,
    display: { default: 'inline-flex', [TOOLBAR_ROOM]: 'none' },
  },
  seekKeyOpen: {
    backgroundColor: tokens.surfaceMuted,
  },
  tabCount: {
    marginInlineStart: 6,
    fontSize: 13,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  // the keys that narrow the queue to one kind of round: a quiet outline
  // at rest, the product's ink where chosen
  marks: {
    display: { default: 'none', [TOOLBAR_WIDE]: 'flex' },
    minWidth: 0,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    alignItems: 'center',
    gap: 6,
  },
  markSelect: {
    display: { default: 'block', [TOOLBAR_WIDE]: 'none' },
    flex: '0 1 10rem',
    minWidth: 0,
  },
  markTrigger: { width: '100%' },
  markOption: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  markOptionLabel: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  filterCount: { marginInlineStart: 0, flexShrink: 0 },
  groupingList: { height: reviewLayout.controlHeight, padding: 3 },
  groupingKey: { height: 30, paddingInline: 12, fontSize: 13.5 },
  mark: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingInline: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: tokens.border,
      ':hover': `color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
    },
    borderRadius: 999,
    backgroundColor: tokens.surface,
    color: tokens.foreground,
    fontFamily: 'inherit',
    fontSize: 13,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, color',
    transitionDuration: '120ms',
  },
  markOn: {
    borderColor: { default: tokens.primary, ':hover': tokens.primary },
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    fontWeight: 500,
  },
  markCount: {
    fontSize: 12,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  markCountOn: { color: 'inherit', opacity: 0.72 },
  unitFilter: {
    display: { default: 'none', [TOOLBAR_ROOM]: 'block' },
    gridColumn: { default: '1 / -1', [TOOLBAR_ROOM]: 'auto' },
    flex: '0 1 9rem',
    minWidth: 0,
    marginInlineStart: { default: 0, [BOARD_WIDE]: 'auto' },
  },
  unitFilterShown: { display: 'block' },
  filterWidth: { width: '100%' },
  searchSeat: {
    gridArea: 'search',
    position: 'relative',
    display: { default: 'none', [TOOLBAR_ROOM]: 'block' },
    minWidth: 0,
  },
  searchShown: { display: 'block' },
  searchIcon: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  searchInput: { height: reviewLayout.controlHeight, width: '100%', paddingLeft: 34 },
  // ---- how much is waiting, in the band ----
  roomTabs: { display: 'flex', width: 'fit-content', marginBlockStart: 10 },
  standing: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 2,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  standingPart: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  // a phone's line wraps, and a rule carried to the start of the next line
  // separates nothing; there the gap alone parts them
  standingRule: {
    display: { default: null, [breakpoints.phone]: 'none' },
    width: 1,
    height: 12,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 14%, transparent)`,
  },
  standingBones: { height: 14, width: 200, maxWidth: '100%', marginBlock: 3 },
  // ---- a quiet day, said in full ----
  emptyIcon: {
    width: 20,
    height: 20,
  },
})

/** the batch went while its queue was being read */
const BATCH_NOT_FOUND = 'ASSESSMENT_BATCH_NOT_FOUND'

type QueueSummary = Pick<
  QueuePage,
  'queueTotal' | 'queueFirstId' | 'handledToday' | 'marks' | 'unitOptions'
>

/**
 * Everything waiting for this reader's decision in the round, and what their
 * step has asked somebody else for: paged by the server, kept current by the batch's
 * wake-ups, and read at all only by somebody who reviews here.
 */
function useQueue(batchId: string, reviewing: boolean) {
  const [viewRaw] = usePageQueryState('view', 'item')
  const [item] = usePageQueryState('item')
  const [person] = usePageQueryState('person')
  const [day] = usePageQueryState('day')
  const [mark] = usePageQueryState('mark')
  const [unit] = usePageQueryState('unit')
  const [search] = usePageQueryState('q')
  const [page] = usePageQueryState('page')
  const [groupPage] = usePageQueryState('groupPage')
  const query = useApiQuery(assessmentApi)
  // queue changes arrive as wake-ups; the poll below is the fallback pace
  const refreshQueue = useQueueRefresh(batchId)
  const { live } = useBatchLive(batchId, ({ kinds, stale }) => {
    const moves = [
      'sync',
      'phase-changed',
      'review-inbox-changed',
      'review-instance-changed',
    ] as const
    if (!moves.some((kind) => kinds.has(kind))) return
    // the list and the rail's count, which is the desk's rather than this list's
    refreshQueue(stale)
    // a stage that began may have opened or closed reviewing
    if (kinds.has('phase-changed')) stale(query.assessment.getTimeline.key({ params: { batchId } }))
    stale(query.assessment.listAwaitingSupplements.key({ query: { batchId } }))
  })
  // The place in the address, read as the server reads it (inbox-reads.ts).
  const request = queueRequestOf({
    view: viewRaw,
    item,
    person,
    day,
    mark,
    unit,
    search,
    page,
    groupPage,
  })
  const groupingKey = query.assessment.listReviewInbox.key({
    query: { batchId, view: request.view, layout: request.layout },
  })
  const inbox = useQuery({
    ...useReviewQueueQuery(batchId, request),
    // Pages and filters can keep their old rows while reading. A different
    // grouping cannot interpret the old response's group keys or row order.
    placeholderData: (previous, previousQuery) =>
      previousQuery && partialMatchKey(previousQuery.queryKey, groupingKey) ? previous : undefined,
    enabled: reviewing,
    refetchInterval: live ? 60_000 : 30_000,
  })
  // Keep the batch-wide controls steady while the new grouping is read.
  const [last, setLast] = useState<{ batchId: string; summary: QueueSummary }>()
  if (
    inbox.data !== undefined &&
    !inbox.isPlaceholderData &&
    (last?.batchId !== batchId || last.summary !== inbox.data)
  ) {
    setLast({ batchId, summary: inbox.data })
  }
  const summary: QueueSummary | undefined =
    inbox.data ?? (last?.batchId === batchId ? last.summary : undefined)
  // what is out with somebody else, counted beside what can be decided now
  const asked = useQuery({
    ...useAwaitingQuery(batchId),
    enabled: reviewing,
    refetchInterval: live ? 60_000 : 30_000,
  })
  const selected =
    (request.view === 'person'
      ? request.person
      : request.view === 'time'
        ? request.day
        : request.itemId) ?? ''
  // A compatible placeholder still carries the index and filter options,
  // but its rows belong to the previous selection.
  const loadingSelection =
    inbox.isPlaceholderData && (inbox.data?.selected ?? '') !== selected ? selected : null
  return {
    inbox,
    summary,
    scoped: selected !== '',
    loadingSelection,
    awaiting: asked.data?.total ?? 0,
  }
}

type Queue = ReturnType<typeof useQueue>

/** opens a filing from the queue, remembering where in the queue it was opened from */
function useOpenRow(batchId: string) {
  const navigate = usePageNavigate()
  const location = useLocation()
  return (row: Pick<InboxItemDto, 'instanceId'>, run: string) => {
    rememberQueuePlace(batchId, location.search)
    navigate('assessment/review-instance', {
      params: { batchId, instanceId: row.instanceId },
      search: run === '' ? {} : { run },
    })
  }
}

export default function ReviewInboxPage() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const [view] = usePageQueryState('view', 'item')
  const update = usePageQueryUpdate()
  const activeView = viewOf(view)
  // the batch the screen below reads, from the same cache: only somebody who
  // reviews here is asked about a queue
  const standing = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const reviewing = standing.data?.batch.capabilities.review === true
  const queue = useQueue(batchId, reviewing)
  const open = useOpenRow(batchId)
  const first = queue.summary?.queueFirstId
  const pending = queue.summary?.queueTotal ?? 0
  return (
    <BatchScreen
      size="wide"
      flushFoot={reviewing}
      title={m.review_tab()}
      summary={reviewing ? <QueueStanding queue={queue} /> : undefined}
      actions={
        reviewing && first != null ? (
          <ReviewActions count={pending} onStart={() => open({ instanceId: first }, '')} />
        ) : undefined
      }
      bannerFooter={
        reviewing ? (
          <Tabs
            value={activeView === 'asked' ? 'asked' : 'queue'}
            onValueChange={(next) =>
              update({ view: next === 'asked' ? 'asked' : '', page: '', groupPage: '' })
            }
          >
            <TabsList xstyle={styles.roomTabs}>
              <TabsTrigger value="queue">
                {m.review_queueTab()}
                {pending > 0 && <span {...stylex.props(styles.tabCount)}>{pending}</span>}
              </TabsTrigger>
              <TabsTrigger value="asked">
                {m.review_awaitingTab()}
                {queue.awaiting > 0 && (
                  <span {...stylex.props(styles.tabCount)}>{queue.awaiting}</span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : undefined
      }
    >
      {(batch) =>
        batch.capabilities.review ? (
          <QueueBody batchId={batch.id} view={activeView} queue={queue} onOpen={open} />
        ) : (
          <QueueEmpty
            state="no-standing"
            icon={<ShieldIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />}
            title={m.review_noRoleTitle()}
            body={m.review_noStandingHint()}
          />
        )
      }
    </BatchScreen>
  )
}

/**
 * How much is waiting, how much this reader moved today, and how much is out
 * with somebody else - beside the action, or under the title where space
 * is tight. Only show the last count when there is any material awaited.
 */
function QueueStanding({ queue }: { queue: Queue }) {
  if (queue.summary === undefined) {
    return queue.inbox.isPending ? (
      <Skeleton className={stylex.props(styles.standingBones).className} />
    ) : null
  }
  const pending = queue.summary.queueTotal
  const today = queue.summary.handledToday
  const parts: ReactNode[] = [
    m.review_groupCount({ count: pending }),
    m.review_standingToday({ count: today }),
    ...(queue.awaiting > 0 ? [m.review_standingAwaiting({ count: queue.awaiting })] : []),
  ]
  return (
    <span
      data-testid="review-stats"
      data-pending={pending}
      data-today={today}
      data-awaiting={queue.awaiting}
      {...stylex.props(styles.standing)}
    >
      {parts.map((part, index) => (
        <span key={index} {...stylex.props(styles.standingPart)}>
          {index > 0 && <span aria-hidden {...stylex.props(styles.standingRule)} />}
          <span>{part}</span>
        </span>
      ))}
    </span>
  )
}

function QueueBody({
  batchId,
  view,
  queue,
  onOpen,
}: {
  batchId: string
  view: View
  queue: Queue
  onOpen: (row: Pick<InboxItemDto, 'instanceId'>, run: string) => void
}) {
  const loadFailure = useLoadFailure()
  const location = useLocation()
  const update = usePageQueryUpdate()
  useDraftSweep()
  const [unitFilter] = usePageQueryState('unit')
  const [markRaw] = usePageQueryState('mark')
  const [search] = usePageQueryState('q')
  const [pageRaw] = usePageQueryState('page')
  const page = pageNumberOf(pageRaw)
  // the phone's search input stands behind its key; a search already typed
  // (arriving via the address) keeps the input on show
  const [seeking, setSeeking] = useState(search !== '')

  // the way back to the queue finds it where it was left
  useEffect(() => {
    rememberQueuePlace(batchId, location.search)
  }, [batchId, location.search])

  /** any narrowing of the queue starts it again from its first page */
  const narrow = (changes: Record<string, string>, history: 'replace' | 'push' = 'replace') =>
    update({ ...changes, page: '', groupPage: '' }, { history })

  // picking a group is a step the back key steps out of
  const pick = (key: 'item' | 'person' | 'day', value: string) => narrow({ [key]: value }, 'push')

  const data = queue.inbox.data
  const summary = queue.summary
  const unitOptions = (summary?.unitOptions ?? []).map(({ id, name }) => [id, name] as const)
  const onGroupPage = (next: number) =>
    update({ groupPage: String(next), item: '', person: '', day: '', page: '' })
  useEffect(() => {
    if (data === undefined || queue.inbox.isPlaceholderData || view === 'asked') return
    const corrected: Record<string, string> = {}
    if (page !== data.page) corrected.page = data.page === 1 ? '' : String(data.page)
    if (Object.keys(corrected).length > 0) update(corrected)
  }, [data, queue.inbox.isPlaceholderData, page, view, update])
  const onPage = (next: number) => update({ page: next === 1 ? '' : String(next) })
  const searchInput = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)
  useEffect(() => {
    if (!seeking || !focusSearch.current) return
    focusSearch.current = false
    searchInput.current?.focus()
  }, [seeking])
  const showFilters = view !== 'asked'
  const { resetSearch, ...searchField } = useReviewSearch(search, showFilters, update)
  const toolbarMarker = useRef<HTMLSpanElement>(null)
  const resultsFade = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!showFilters) return
    const marker = toolbarMarker.current
    const fade = resultsFade.current
    const root = marker?.closest('main')
    if (marker == null || root == null || fade == null) return
    let frame = 0
    let previous = 0
    // Read the distance past the sticky point, not the time since it stuck.
    // Paint only the fade; scrolling never rerenders the queue.
    const paint = () => {
      frame = 0
      if (fade.offsetParent === null) return
      const distance = root.getBoundingClientRect().top - marker.getBoundingClientRect().bottom
      const progress = Math.max(0, Math.min(1, distance / FADE_SCROLL_DISTANCE))
      if (progress === previous) return
      previous = progress
      fade.style.setProperty('--review-fade-progress', String(progress))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(paint)
    }
    schedule()
    root.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      root.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
      fade.style.removeProperty('--review-fade-progress')
    }
  }, [showFilters])

  return (
    <div {...stylex.props(styles.queue)}>
      <span ref={toolbarMarker} aria-hidden {...stylex.props(styles.toolbarMarker)} />
      {showFilters && (
        <div
          data-testid="review-filters"
          {...stylex.props(
            styles.controls(
              seeking
                ? '"grouping seek" "filters filters" "search search"'
                : '"grouping seek" "filters filters"',
            ),
            styles.pinnedControls,
          )}
        >
          <span aria-hidden {...stylex.props(styles.toolbarScrim)}>
            <span {...stylex.props(styles.toolbarFade)}>
              <span {...stylex.props(styles.fadeEdge)} />
              <span
                ref={resultsFade}
                data-slot="review-results-fade"
                {...stylex.props(styles.fadeEdge, styles.resultsFadeEdge)}
              />
            </span>
          </span>
          <Tabs
            variant="segmented"
            value={view}
            onValueChange={(next) =>
              update({
                view: next === 'item' ? '' : next,
                page: '',
                groupPage: '',
                item: '',
                person: '',
                day: '',
              })
            }
            xstyle={styles.viewsField}
          >
            <TabsList xstyle={styles.groupingList}>
              <TabsTrigger value="item" xstyle={styles.groupingKey}>
                {m.review_tabByItem()}
              </TabsTrigger>
              <TabsTrigger value="person" xstyle={styles.groupingKey}>
                {m.review_tabByPerson()}
              </TabsTrigger>
              <TabsTrigger value="time" xstyle={styles.groupingKey}>
                {m.review_tabByTime()}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="icon"
            className={stylex.props(styles.seekKey, seeking && styles.seekKeyOpen).className}
            aria-expanded={seeking}
            aria-controls="review-queue-search"
            onClick={() => {
              focusSearch.current = !seeking
              setSeeking(!seeking)
            }}
          >
            <SearchIcon aria-hidden />
            <VisuallyHidden>{m.review_searchPlaceholder()}</VisuallyHidden>
          </Button>
          {summary !== undefined && (
            <div {...stylex.props(styles.filters)}>
              {data !== undefined && data.queueTotal > 0 ? (
                <QueueScope
                  grouping={view}
                  data={data}
                  loadingSelection={queue.loadingSelection}
                  onPick={(key) => pick(groupKey(view), key)}
                />
              ) : queue.inbox.isPending && summary.queueTotal > 0 ? (
                <QueueScopeSkeleton />
              ) : null}
              <StatusFilter
                value={markOf(markRaw) ?? ALL}
                counts={summary.marks}
                onChange={(next) => narrow({ mark: next === ALL ? '' : next })}
              />
              {unitOptions.length > 0 && (
                <div
                  {...stylex.props(
                    styles.unitFilter,
                    (seeking || unitFilter !== '') && styles.unitFilterShown,
                  )}
                >
                  <Filter
                    label={m.review_filterAllUnits()}
                    value={unitFilter}
                    options={unitOptions}
                    onChange={(next) => narrow({ unit: next })}
                  />
                </div>
              )}
            </div>
          )}
          <div {...stylex.props(styles.searchSeat, seeking && styles.searchShown)}>
            <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
            <Input
              id="review-queue-search"
              ref={searchInput}
              name="review-search"
              aria-label={m.review_searchPlaceholder()}
              className={stylex.props(styles.searchInput).className}
              placeholder={m.review_searchPlaceholder()}
              onFocus={() => setSeeking(true)}
              {...searchField}
            />
          </div>
        </div>
      )}

      {/* the awaiting view is its own room; the queue's empty states are
            about the queue alone, so all-done gets its whole screen back */}
      {view === 'asked' ? (
        <AwaitingSection batchId={batchId} page={page} onPage={onPage} />
      ) : (
        <AsyncSection
          pending={queue.inbox.isPending}
          error={
            data === undefined && queue.inbox.error
              ? loadFailure.of(queue.inbox.error, { missing: [BATCH_NOT_FOUND] })
              : null
          }
          retrying={queue.inbox.isFetching}
          framed
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void queue.inbox.refetch()}
          skeleton={
            <QueueSkeleton grouping={view} scoped={queue.scoped} total={summary?.queueTotal} />
          }
          xstyle={styles.fill}
        >
          {data?.queueTotal === 0 ? (
            // a phase that keeps judging shut empties the queue however much
            // is waiting, and nothing will arrive until it opens: that is not
            // a quiet day, and promising new work would be wrong
            data.judging === false ? (
              <QueueEmpty
                state="closed"
                icon={<LockIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />}
                title={m.review_closedTitle()}
                body={m.review_closedBody()}
              />
            ) : // two different quiet days: everything handled, or nothing has
            // arrived yet. The counter is what tells them apart
            data.handledToday > 0 ? (
              <QueueEmpty
                state="done"
                tone="ok"
                icon={
                  <CheckIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                }
                title={m.review_allDoneTitle()}
                body={
                  queue.awaiting > 0
                    ? m.review_allDoneAwaiting({
                        count: data.handledToday,
                        awaiting: queue.awaiting,
                      })
                    : m.review_allDoneBody({ count: data.handledToday })
                }
                hint={m.review_allDoneHint()}
              />
            ) : (
              <QueueEmpty
                state="nothing"
                icon={
                  <InboxIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                }
                title={m.review_nothingTitle()}
                body={m.review_nothingBody()}
              />
            )
          ) : data !== undefined ? (
            <QueueBoard
              grouping={view}
              data={data}
              loadingSelection={queue.loadingSelection}
              fetching={queue.inbox.isFetching}
              onPick={(key) => pick(groupKey(view), key)}
              onPage={onPage}
              onGroupPage={onGroupPage}
              onOpen={onOpen}
              empty={
                <QueueEmpty
                  state="no-matches"
                  icon={
                    <SearchXIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                  }
                  title={m.review_matchesNone()}
                  body={m.review_matchesHint()}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resetSearch()
                        narrow({ mark: '', unit: '', q: '' })
                      }}
                    >
                      {m.review_matchesClear()}
                    </Button>
                  }
                />
              }
            />
          ) : null}
        </AsyncSection>
      )}
      <ReviewDock batchId={batchId} />
    </div>
  )
}

/**
 * One narrowing of the queue: everything, or one of something.
 *
 * The empty value is the whole list rather than a blank, so the control
 * always says what the reader is looking at instead of what they are not.
 */
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (next: string) => void
}) {
  return (
    <Select
      value={value === '' ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? '' : next)}
    >
      <SelectTrigger aria-label={label} xstyle={styles.filterWidth}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** a select cannot carry an empty value, so "no filter" needs a name of its own */
const ALL = 'all'

const groupKey = (view: 'item' | 'person' | 'time') => (view === 'time' ? 'day' : view)

/**
 * The address records finished searches, not keystrokes. In particular a
 * composition must not navigate, even if a user pauses to pick a candidate.
 */
function useReviewSearch(
  search: string,
  enabled: boolean,
  update: ReturnType<typeof usePageQueryUpdate>,
) {
  const [draft, setDraft] = useState(search)
  const [composing, setComposing] = useState(false)
  const composingNow = useRef(false)
  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (sent.current === search) {
      sent.current = null
      return
    }
    if (!composingNow.current) setDraft(search)
  }, [search])
  useEffect(() => {
    if (!enabled || composing || draft === search) return
    const timer = setTimeout(() => {
      if (composingNow.current) return
      sent.current = draft
      update({ q: draft, page: '', groupPage: '' })
    }, SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [enabled, composing, draft, search, update])
  const start = () => {
    composingNow.current = true
    setComposing(true)
  }
  return {
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing) start()
      setDraft(event.currentTarget.value)
    },
    onCompositionStart: start,
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      setDraft(event.currentTarget.value)
      composingNow.current = false
      setComposing(false)
    },
    resetSearch: () => setDraft(''),
  }
}

/** the kinds of round that are more than waiting, in the order their keys stand */
const MARKS = ['escalated', 'resubmitted', 'supplemented'] as const
type Mark = (typeof MARKS)[number]

/** the address's word for a mark, where it names one */
const markOf = (raw: string): Mark | undefined =>
  (MARKS as readonly string[]).includes(raw) ? (raw as Mark) : undefined

const markLabel = (mark: Mark) =>
  mark === 'escalated'
    ? m.review_markEscalated()
    : mark === 'resubmitted'
      ? m.review_markResubmitted()
      : m.review_markSupplemented()

function StatusFilter({
  value,
  counts,
  onChange,
}: {
  value: Mark | typeof ALL
  counts: QueuePage['marks']
  onChange: (value: string) => void
}) {
  const options = [
    { key: ALL, label: m.review_markAll(), count: counts.all },
    ...MARKS.map((mark) => ({ key: mark, label: markLabel(mark), count: counts[mark] })),
  ]
  return (
    <>
      <div role="group" aria-label={m.review_markGroup()} {...stylex.props(styles.marks)}>
        {options.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            data-testid="review-mark"
            data-mark={key}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            {...stylex.props(styles.mark, value === key && styles.markOn)}
          >
            {label}
            <span {...stylex.props(styles.markCount, value === key && styles.markCountOn)}>
              {count}
            </span>
          </button>
        ))}
      </div>
      <div {...stylex.props(styles.markSelect)}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label={m.review_markGroup()} xstyle={styles.markTrigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(({ key, label, count }) => {
              const name = key === ALL ? m.review_markAllStatuses() : label
              return (
                <SelectItem key={key} value={key}>
                  <span {...stylex.props(styles.markOption)}>
                    <span title={name} {...stylex.props(styles.markOptionLabel)}>
                      {name}
                    </span>
                    <Count xstyle={styles.filterCount}>{count}</Count>
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
