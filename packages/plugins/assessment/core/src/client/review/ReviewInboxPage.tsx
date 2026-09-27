import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { FileTextIcon, SearchIcon, ShieldIcon } from 'lucide-react'
import {
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageQueryState,
  usePageQueryUpdate,
  usePageRouteParams,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { DoneMark, Stagger } from '@qualy/ui/reveal'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Count } from '@qualy/ui/count'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AwaitingSection } from './AwaitingSection.tsx'
import { useAwaitingQuery, useQueueRefresh, useReviewQueueQuery } from './queue.ts'
import { useDraftSweep } from './use-draft.ts'
import { rememberQueuePlace } from './queue-place.ts'
import { ItemQueue, PersonQueue, QueueSkeleton, TimeQueue } from './QueueViews.tsx'
import { matchesSearch, pageNumberOf, type InboxItemDto } from './model.ts'

// The queue, laid out three ways: by question so one standard is applied in
// a row, by submitted time to clear a backlog oldest first, by participant
// so one person's duplicates sit next to each other. Every row opens the
// same workbench; the layout only decides which rows it walks in a run.
//
// How much is waiting, and the way to start on it, stand in the band above:
// they are about the whole queue, whichever way it is laid out below.

const md = '@media (min-width: 768px)'

const styles = stylex.create({
  // on a phone the four views share the row rather than scrolling it
  // the views are what this row is for: the filters and the search beside
  // them give way first, and the row wraps before the tablist narrows
  viewsField: { flexShrink: 0 },
  fill: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  queue: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
  },
  // One register per breakpoint. On a phone the row is the segmented switch
  // and one search key - the selects are desktop instruments, and stacked
  // together here they were a wall of controls above three rows of work. On
  // a desk everything stands at tab height, side by side.
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  controlRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  seekKey: {
    width: 36,
    height: 36,
    display: {
      default: 'inline-flex',
      [md]: 'none',
    },
  },
  seekKeyOpen: {
    backgroundColor: tokens.surfaceMuted,
  },
  deskOnly: {
    display: {
      default: 'none',
      [md]: 'contents',
    },
  },
  // one narrowing of the queue never wider than its longest sensible name
  filterWidth: {
    maxWidth: 208,
  },
  searchSeat: {
    position: 'relative',
  },
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
  searchInput: {
    height: 36,
    width: 240,
    paddingLeft: 34,
  },
  searchInputWide: {
    height: 36,
    width: '100%',
    paddingLeft: 34,
  },
  phoneSearchSeat: {
    position: 'relative',
    display: {
      default: 'block',
      [md]: 'none',
    },
  },
  noMatches: {
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}`,
    paddingInline: 20,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  // ---- how much is waiting, in the band ----
  standing: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: { default: 10, [breakpoints.phone]: 14 },
    rowGap: 2,
    fontVariantNumeric: 'tabular-nums',
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
  standingBones: { height: 14, width: 200, marginBlock: 3 },
  // ---- a quiet day, said in full ----
  emptyScreen: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 64,
  },
  emptyStack: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    textAlign: 'center',
  },
  emptyBadge: {
    display: 'flex',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  emptyIcon: {
    width: 20,
    height: 20,
  },
  emptyWords: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
})

type View = 'item' | 'time' | 'person' | 'asked'

/** the batch went while its queue was being read */
const BATCH_NOT_FOUND = 'ASSESSMENT_BATCH_NOT_FOUND'

const VIEWS: readonly View[] = ['item', 'time', 'person', 'asked']

const viewOf = (raw: string): View =>
  (VIEWS as readonly string[]).includes(raw) ? (raw as View) : 'item'

/**
 * Everything waiting for this reader's decision in the round, and what their
 * step has asked somebody else for: read whole, kept current by the batch's
 * wake-ups, and read at all only by somebody who reviews here.
 */
function useQueue(batchId: string, reviewing: boolean) {
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
    stale(query.assessment.listAwaitingSupplements.key({ query: { batchId } }))
  })
  const inbox = useQuery({
    ...useReviewQueueQuery(batchId),
    enabled: reviewing,
    refetchInterval: live ? 60_000 : 30_000,
  })
  // what is out with somebody else, counted beside what can be decided now
  const asked = useQuery({
    ...useAwaitingQuery(batchId),
    enabled: reviewing,
    refetchInterval: live ? 60_000 : 30_000,
  })
  const all = useMemo(
    () => (inbox.data?.items ?? []).filter((item) => item.batchId === batchId),
    [inbox.data, batchId],
  )
  return { inbox, asked, all, awaiting: asked.data?.items.length ?? 0 }
}

type Queue = ReturnType<typeof useQueue>

/** opens a filing from the queue, remembering where in the queue it was opened from */
function useOpenRow(batchId: string) {
  const navigate = usePageNavigate()
  const location = useLocation()
  return (row: InboxItemDto, run: string) => {
    rememberQueuePlace(batchId, location.search)
    navigate('assessment/review-instance', {
      params: { batchId, instanceId: row.instanceId },
      search: run === '' ? {} : { run },
    })
  }
}

export default function ReviewInboxPage() {
  const { format } = useI18n()
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const [view] = usePageQueryState('view', 'item')
  // the batch the screen below reads, from the same cache: only somebody who
  // reviews here is asked about a queue
  const standing = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const reviewing = standing.data?.batch.capabilities.review === true
  const queue = useQueue(batchId, reviewing)
  const open = useOpenRow(batchId)
  const first = queue.all[0]
  return (
    <BatchScreen
      title={format(m.reviewTab)}
      description={
        // held open while the batch is read, so the line arriving does not
        // push the page down under the reader
        standing.isPending ? (
          <Skeleton className={stylex.props(styles.standingBones).className} />
        ) : reviewing ? (
          <QueueStanding queue={queue} />
        ) : undefined
      }
      actions={
        // the whole queue from its oldest filing: the way in for somebody
        // who only wants to get through what is waiting
        reviewing && first !== undefined ? (
          <Button data-testid="review-start" onClick={() => open(first, '')}>
            {format(m.reviewRunStart)}
          </Button>
        ) : undefined
      }
      size="wide"
    >
      {(batch) =>
        batch.capabilities.review ? (
          <QueueBody batchId={batch.id} view={viewOf(view)} queue={queue} onOpen={open} />
        ) : (
          // said as what it is: no standing here, not an empty queue -
          // pretending otherwise makes permission problems look like quiet
          // days
          <EmptyScreen
            state="no-standing"
            icon={<ShieldIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />}
            title={format(m.reviewNoRoleTitle)}
            body={format(m.reviewNoStandingHint)}
          />
        )
      }
    </BatchScreen>
  )
}

/**
 * How much is waiting, how much this reader moved today, and how much is out
 * with somebody else - one line under the page's name. The last only where
 * there is any: a zero there is a fact nobody asked for.
 */
function QueueStanding({ queue }: { queue: Queue }) {
  const { format } = useI18n()
  if (queue.inbox.data === undefined) {
    return queue.inbox.isPending ? (
      <Skeleton className={stylex.props(styles.standingBones).className} />
    ) : null
  }
  const pending = queue.all.length
  const today = queue.inbox.data.handledToday
  const parts: ReactNode[] = [
    format(m.reviewGroupCount, { count: pending }),
    format(m.reviewStandingToday, { count: today }),
    ...(queue.awaiting > 0 ? [format(m.reviewStandingAwaiting, { count: queue.awaiting })] : []),
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
  onOpen: (row: InboxItemDto, run: string) => void
}) {
  const { format } = useI18n()
  const loadFailure = useLoadFailure()
  const location = useLocation()
  const navigate = useNavigate()
  const update = usePageQueryUpdate()
  useDraftSweep()
  const [itemKey] = usePageQueryState('item')
  const [personKey] = usePageQueryState('person')
  const [unitFilter] = usePageQueryState('unit')
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
    update({ ...changes, page: '' }, { history })

  // Where the list and the filings are one screen after the other, picking
  // a question or a person is a step into its own screen, and the back key
  // is how anybody leaves one. The way back drawn above the list goes back
  // over that same step where this sitting took it, so the list is not left
  // in the history twice. Which of the two it is is the queue's to say: it
  // is laid out by its own room, not the window's.
  const steppedIn = useRef(false)
  const choose = (key: 'item' | 'person', value: string, drills: boolean) => {
    if (!drills) {
      narrow({ [key]: value })
      return
    }
    steppedIn.current = true
    narrow({ [key]: value }, 'push')
  }
  const back = (key: 'item' | 'person') => {
    if (steppedIn.current) {
      steppedIn.current = false
      void navigate(-1)
      return
    }
    narrow({ [key]: '' })
  }

  const all = queue.all
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          // each narrowing only where its control stands
          (view !== 'time' || itemKey === '' || row.itemId === itemKey) &&
          (unitFilter === '' || row.unitId === unitFilter) &&
          matchesSearch(row, search.trim()),
      ),
    [all, view, itemKey, unitFilter, search],
  )
  const itemOptions = useMemo(
    () =>
      [...new Map(all.map((row) => [row.itemId, row.itemTitle])).entries()]
        .map(([id, title]) => [id, title] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )
  const unitOptions = useMemo(
    () =>
      [
        ...new Map(
          all.flatMap((row) => (row.unitId === null ? [] : [[row.unitId, row.unitName ?? '']])),
        ).entries(),
      ]
        .map(([id, name]) => [id, String(name)] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )
  const onPage = (next: number) => update({ page: next === 1 ? '' : String(next) })
  const onSearch = (value: string) => narrow({ q: value })

  return (
    <AsyncSection
      pending={queue.inbox.isPending}
      // a read that failed only in the background keeps the queue it last
      // showed: the page is somebody's place in their work
      error={
        queue.inbox.data === undefined && queue.inbox.error
          ? loadFailure.of(queue.inbox.error, { missing: [BATCH_NOT_FOUND] })
          : null
      }
      retrying={queue.inbox.isFetching}
      // on the page's own ground, under its title, where the queue would stand
      framed
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void queue.inbox.refetch()}
      skeleton={<QueueSkeleton />}
      xstyle={styles.fill}
    >
      <div {...stylex.props(styles.queue)}>
        <div {...stylex.props(styles.controls)}>
          <div {...stylex.props(styles.controlRow)}>
            <Tabs
              variant="segmented"
              value={view}
              onValueChange={(next) => update({ view: next === 'item' ? '' : next, page: '' })}
              xstyle={styles.viewsField}
            >
              <TabsList>
                <TabsTrigger value="item">{format(m.reviewTabByItem)}</TabsTrigger>
                <TabsTrigger value="time">{format(m.reviewTabByTime)}</TabsTrigger>
                <TabsTrigger value="person">{format(m.reviewTabByPerson)}</TabsTrigger>
                {/* Its own room, not a section under the queue: what is out
                    with somebody else is nothing to decide now, and stacked
                    below the queue it shouted over every empty state. The
                    count rides the tab so the door says whether it is worth
                    opening. */}
                <TabsTrigger value="asked">
                  {format(m.reviewAwaitingTab)}
                  {queue.awaiting > 0 && <Count>{queue.awaiting}</Count>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {view !== 'asked' && (
              <Button
                variant="outline"
                size="icon"
                className={stylex.props(styles.seekKey, seeking && styles.seekKeyOpen).className}
                aria-pressed={seeking}
                onClick={() => setSeeking((open) => !open)}
              >
                <SearchIcon aria-hidden />
                <VisuallyHidden>{format(m.reviewSearchPlaceholder)}</VisuallyHidden>
              </Button>
            )}
            {view !== 'asked' && (
              <div {...stylex.props(styles.deskOnly)}>
                {/* by question the list beside the filings is the question
                    picker; by time a question is one more narrowing */}
                {view === 'time' && (
                  <Filter
                    label={format(m.reviewFilterAllItems)}
                    value={itemKey}
                    options={itemOptions}
                    onChange={(next) => narrow({ item: next })}
                  />
                )}
                {unitOptions.length > 0 && (
                  <Filter
                    label={format(m.reviewFilterAllUnits)}
                    value={unitFilter}
                    options={unitOptions}
                    onChange={(next) => narrow({ unit: next })}
                  />
                )}
                <div {...stylex.props(styles.searchSeat)}>
                  <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
                  <Input
                    name="review-search"
                    aria-label={format(m.reviewSearchPlaceholder)}
                    className={stylex.props(styles.searchInput).className}
                    value={search}
                    placeholder={format(m.reviewSearchPlaceholder)}
                    onChange={(event) => onSearch(event.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          {seeking && view !== 'asked' && (
            <div {...stylex.props(styles.phoneSearchSeat)}>
              <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
              <Input
                autoFocus
                name="review-search"
                aria-label={format(m.reviewSearchPlaceholder)}
                className={stylex.props(styles.searchInputWide).className}
                value={search}
                placeholder={format(m.reviewSearchPlaceholder)}
                onChange={(event) => onSearch(event.target.value)}
              />
            </div>
          )}
        </div>

        {/* the awaiting view is its own room; the queue's empty states are
            about the queue alone, so all-done gets its whole screen back */}
        {view === 'asked' ? (
          <AwaitingSection batchId={batchId} page={page} onPage={onPage} />
        ) : all.length === 0 ? (
          // a phase that keeps judging shut empties the queue however much
          // is waiting, and nothing will arrive until it opens: that is not
          // a quiet day, and promising new work would be wrong
          queue.inbox.data?.judging === false ? (
            <EmptyScreen
              state="closed"
              icon={
                <FileTextIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
              }
              title={format(m.reviewClosedTitle)}
              body={format(m.reviewClosedBody)}
            />
          ) : // two different quiet days: everything handled, or nothing has
          // arrived yet. The counter is what tells them apart
          (queue.inbox.data?.handledToday ?? 0) > 0 ? (
            <EmptyScreen
              state="done"
              mark={<DoneMark />}
              title={format(m.reviewAllDoneTitle)}
              body={format(m.reviewAllDoneBody, { count: queue.inbox.data?.handledToday ?? 0 })}
            />
          ) : (
            <EmptyScreen
              state="nothing"
              icon={
                <FileTextIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
              }
              title={format(m.reviewNothingTitle)}
              body={format(m.reviewNothingBody)}
            />
          )
        ) : rows.length === 0 ? (
          <p data-testid="review-no-matches" {...stylex.props(styles.noMatches)}>
            {format(m.reviewMatchesNone)}
          </p>
        ) : view === 'item' ? (
          <ItemQueue
            rows={rows}
            chosen={itemKey}
            page={page}
            onChoose={(itemId, drills) => choose('item', itemId, drills)}
            onBack={() => back('item')}
            onPage={onPage}
            onOpen={onOpen}
          />
        ) : view === 'time' ? (
          <TimeQueue rows={rows} page={page} onPage={onPage} onOpen={onOpen} />
        ) : (
          <PersonQueue
            rows={rows}
            chosen={personKey}
            page={page}
            onChoose={(key, drills) => choose('person', key, drills)}
            onBack={() => back('person')}
            onPage={onPage}
            onOpen={onOpen}
          />
        )}
      </div>
    </AsyncSection>
  )
}

/**
 * A quiet day, said in full: the screen a reviewer lands on when there is
 * nothing to do is the screen they see most often, so it gets the room.
 */
function EmptyScreen({
  state,
  icon,
  mark,
  title,
  body,
}: {
  /** which kind of empty this is: no standing, judging closed, all handled, nothing yet */
  state: 'no-standing' | 'closed' | 'done' | 'nothing'
  icon?: ReactNode
  /** a drawn mark instead of a still icon, where the emptiness was earned */
  mark?: ReactNode
  title: string
  body: string
}) {
  return (
    <div {...stylex.props(styles.emptyScreen)} data-testid="review-inbox-empty" data-empty={state}>
      <Stagger className={stylex.props(styles.emptyStack).className} step={0.08}>
        {mark ?? <span {...stylex.props(styles.emptyBadge)}>{icon}</span>}
        <div {...stylex.props(styles.emptyWords)}>
          <h2 {...stylex.props(styles.emptyTitle)}>{title}</h2>
          <p {...stylex.props(styles.emptyBody)}>{body}</p>
        </div>
      </Stagger>
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
