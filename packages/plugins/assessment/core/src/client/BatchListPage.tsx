import { useEffect, useState, type MouseEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApiQuery, usePageNavigate, usePageTitle } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Spinner } from '@qualy/ui/spinner'
import { Button } from '@qualy/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@qualy/ui/empty'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Reveal } from '@qualy/ui/reveal'
import { PageContainer } from '@qualy/ui/page-container'
import { Input } from '@qualy/ui/input'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { Count } from '@qualy/ui/count'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { standingOf, type BatchStanding } from './batch/standing.ts'
import { dotDay } from './batch/dates.ts'
import { HeroSkeleton, ListSkeleton } from './batch/ListSkeleton.tsx'
import { BatchCard } from './batch/BatchCard.tsx'
import { agendaOf, type BatchCardRow, type HeroFrame } from './batch/hero.ts'

// Every batch there is, and the way into one.
//
// The page leads with what is running: one card for the batch under way,
// or one of several with a way to the others. The card asks the server its
// own question - the running batches, whatever the list below is filtered
// or paged to - because a filter narrows the list and the running round
// is not in the list's second page any less. Typing a name folds the card
// away: a search is looking for one batch, and the card would only push
// the answer down. Under it every batch, running ones included, as a table
// - the card says what to do, the table says what there is. Opening a
// batch is a link to the batch, not a selection this screen keeps: the
// address names the batch and the section, so it survives a reload and can
// be sent to somebody. Creation happens in a dialog on top of the list.

/** rows per page; the page indicator divides the total by it */
const PAGE_SIZE = 20

// the card shows one running batch and says which; up to this many the
// others are a pair of arrows away, past it they are a name to pick
const ARROWS_UP_TO = 4

const styles = stylex.create({
  wide: { width: 'max-content' },
  // the container takes the shell's height and stacks; the page inside it
  // is what arrives, and grows to fill it
  column: {
    display: 'flex',
    flexDirection: 'column',
  },
  page: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    gap: {
      default: 24,
      [breakpoints.phone]: 16,
    },
  },
  masthead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    margin: 0,
    fontSize: { default: 20, [breakpoints.phone]: 22 },
    fontWeight: 600,
    letterSpacing: { default: '-0.025em', [breakpoints.phone]: '-0.03em' },
    lineHeight: { default: null, [breakpoints.phone]: 1.2 },
  },
  // On a phone the search is a place to go rather than a field standing
  // open: the row already has the page's name in it, and a box wide enough
  // to type a batch name into would leave nowhere to put that name. It
  // opens in the row it sits in, and closes back to its glyph.
  iconButton: {
    display: 'inline-flex',
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
  /** the one that starts something is the one that is filled in */
  iconButtonInk: {
    backgroundColor: { default: tokens.primary, ':hover': tokens.primary },
    color: tokens.primaryForeground,
  },
  searchOpenSeat: { minWidth: 0, flexGrow: 1 },
  mastheadTools: {
    display: 'flex',
    // it grows only so the search box can have the rest of the row when it
    // opens; with the box shut the glyphs still belong at the far edge,
    // not floated against the page's name
    flexGrow: {
      default: 0,
      [breakpoints.phone]: 1,
    },
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: { default: 10, [breakpoints.phone]: 4 },
  },
  searchSeat: {
    width: '100%',
    // narrower on a tablet, where the row it shares with the page's name
    // and the button that starts a round has less to go round
    maxWidth: {
      default: null,
      [breakpoints.tablet]: 200,
      [breakpoints.desktop]: 320,
    },
  },
  searchGlyph: {
    width: 16,
    height: 16,
    color: tokens.mutedForeground,
  },
  createButton: {
    flexShrink: 0,
  },
  refreshing: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  // a filter changes the question and the answer replaces the old one in
  // place, which is what keeping the previous data is for; nothing here
  // dims meanwhile - a dimming that a fast answer cut short read as a flash
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: {
      default: 28,
      [breakpoints.phone]: 20,
    },
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  listHead: {
    display: 'flex',
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    alignItems: { default: 'center', [breakpoints.phone]: 'stretch' },
    gap: { default: 16, [breakpoints.phone]: 10 },
  },
  listHeadLine: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
  },
  listLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // One line whatever the width: on a phone the pills scroll sideways
  // rather than stacking under each other, and the track runs to both
  // edges of the screen - a row that scrolls should look like it carries
  // on, and a pill stopped by a gutter looks like a pill drawn wrong.
  pillScroller: {
    width: {
      default: null,
      [breakpoints.phone]: 'auto',
    },
    overflowX: {
      default: null,
      [breakpoints.phone]: 'auto',
    },
    marginInline: { default: null, [breakpoints.phone]: `calc(${layout.pageGutter} * -1)` },
    paddingInline: { default: null, [breakpoints.phone]: layout.pageGutter },
    scrollbarWidth: { default: null, [breakpoints.phone]: 'none' },
    '::-webkit-scrollbar': { display: { default: null, [breakpoints.phone]: 'none' } },
  },

  // Several rounds under way, on a phone: one card at a time with the next
  // one showing its edge, so there is something to pull at. Snapped, so a
  // flick lands on a card rather than between two.
  deck: {
    display: 'flex',
    gap: 12,
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    marginInline: `calc(${layout.pageGutter} * -1)`,
    paddingInline: layout.pageGutter,
    // A track that scrolls sideways clips top and bottom too, and what it
    // was clipping was the cards' own shadow. The padding is that shadow's
    // reach - it falls 12 below the card and blurs 24, less 8 of spread,
    // so 28 under and 4 over - and the margin hands the room straight back
    // to the page, leaving the cards where they were.
    marginTop: -6,
    paddingTop: 6,
    marginBottom: -28,
    paddingBottom: 28,
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': { display: 'none' },
  },
  deckCard: {
    flexGrow: 0,
    flexShrink: 0,
    // the screen's width less its two gutters, whatever the screen and
    // whatever the gutter: the card was drawn 358 wide on a 390 phone,
    // which is that measure, and a fixed 358 on any other phone is a card
    // that misses one edge
    flexBasis: '100%',
    scrollSnapAlign: 'center',
  },
  deckDots: { display: 'flex', justifyContent: 'center', gap: 6 },
  deckDot: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklch, ${tokens.foreground} 15%, transparent)`,
  },
  deckDotHere: { backgroundColor: tokens.foreground },

  // The table's rows, as cards. Five columns do not become narrow, they
  // become a sideways scroll, and a list nobody can read without dragging
  // it sideways is not a list. Two lines: what it is called, and where it
  // stands.
  rows: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  rowCard: {
    display: 'flex',
    minHeight: 64,
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    // the name starts where the card above it starts its own title: two
    // white surfaces one under the other, and a reader's eye runs down
    // their left edge whether or not anybody meant it to
    paddingLeft: 20,
    paddingRight: 16,
    color: tokens.foreground,
    textDecoration: 'none',
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  rowWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 4 },
  rowName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 500,
  },
  // Three things on one line, and only one of them can run long: the stage
  // is whatever somebody called it. So the standing and the time hold their
  // width and the name gives way - a line that wraps instead turns a row of
  // the same height as every other into a row of its own.
  rowMeta: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  rowStage: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowWhen: { flexShrink: 0, whiteSpace: 'nowrap' },
  rowGlyph: { flexShrink: 0, color: tokens.surfaceMutedForeground },
  // one more page, asked for rather than paged to: on a phone the list is
  // one column somebody is already scrolling down
  more: {
    display: 'flex',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 13,
    fontWeight: 500,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
  sheet: {
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  sheetScroller: {
    overflowX: 'auto',
  },
  // Fixed, so the declared column widths are the widths. Left automatic,
  // a column is never narrower than its own longest unbreakable run, and
  // the name - a single nowrap line - simply refused to give any of its
  // 304px back: at 768 the four columns and the name came to eighteen
  // pixels more than the page had, and the whole table grew a scrollbar
  // for them. Fixed makes the name the column that gives way, which is
  // what it was always meant to be.
  table: {
    minWidth: 640,
    tableLayout: 'fixed',
  },
  head: {
    height: 'auto',
    paddingTop: 10,
    paddingBottom: 12,
    paddingInline: 12,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  cell: {
    paddingBlock: 14,
    paddingInline: { default: 12, [breakpoints.tablet]: 14 },
  },
  leading: {
    paddingInlineStart: 20,
  },
  trailing: {
    paddingInlineEnd: 20,
    textAlign: 'right',
  },
  // a tablet keeps all four columns by giving each of them a little less
  colStatus: { width: { default: 110, [breakpoints.tablet]: 96 } },
  colStage: { width: { default: 164, [breakpoints.tablet]: 132 } },
  colTime: { width: { default: 190, [breakpoints.tablet]: 172 } },
  colOpen: { width: 64 },
  // the header is not a row anybody opens, so it does not light up as one
  headRow: {
    backgroundColor: {
      default: null,
      ':hover': 'transparent',
    },
  },
  row: {
    cursor: 'pointer',
  },
  name: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
    textDecoration: 'none',
  },
  standing: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  standingActive: {
    color: tokens.successForeground,
  },
  standingPending: {
    color: tokens.warningForeground,
  },
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  dotActive: {
    backgroundColor: tokens.success,
  },
  dotPending: {
    backgroundColor: tokens.warning,
  },
  quiet: {
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // the stage is what the row says about the batch, the time is when: a
  // row of one ink cell and three grey ones read as a row of nothing
  stage: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.foreground,
  },
  // a column of a fixed width holds what it holds; what will not fit ends
  // in an ellipsis rather than running under the column beside it
  time: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  openGlyph: {
    display: 'inline-flex',
    color: tokens.mutedForeground,
    verticalAlign: 'middle',
  },
  pagerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingBlock: 10,
    paddingInline: 20,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  pagerNote: {
    fontSize: 13,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  pager: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
})

type StatusFilter = 'all' | 'draft' | 'active' | 'archived'

/** a chip's number, said only once the server has counted */
const chipCount = (count: number | undefined) => <Count>{count}</Count>

/** how long a refresh may take before the page says it is refreshing */
const REFRESH_NOTICE_AFTER = 180

/**
 * True once `active` has held for `ms`; false the moment it drops. For a
 * signal a fast answer would otherwise flash: a spinner that appears and
 * leaves inside eighty milliseconds says nothing but "something happened".
 */
function useHeld(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!active) {
      setHeld(false)
      return
    }
    const timer = window.setTimeout(() => setHeld(true), ms)
    return () => window.clearTimeout(timer)
  }, [active, ms])
  return held
}

/**
 * The stage column: where the batch is, or what it has of a plan. A batch
 * with no stages at all is one whose setting up is not finished.
 */
function stageOf(row: BatchCardRow, format: ReturnType<typeof useI18n>['format']) {
  if (row.currentPhaseName !== null) return row.currentPhaseName
  return row.timeline.length > 0
    ? format(m.stageCount, { total: row.timeline.length })
    : format(m.stageIncomplete)
}

/**
 * The time column, one date per standing: when the stage under way gives
 * way, when a scheduled batch begins, when an ended one ended - and for a
 * batch nobody has scheduled, that its time is not set.
 */
function timeOf(
  row: BatchCardRow & { createdAt: string },
  standing: BatchStanding,
  format: ReturnType<typeof useI18n>['format'],
) {
  const timeline = row.timeline
  if (standing === 'archived') {
    // the last stage that was entered is the closest thing to a close the
    // plan records; a batch that never ran a stage ended when it was made
    const last = [...timeline].reverse().find((entry) => entry.entry.kind === 'entered')
    return format(m.endedOn, { date: dotDay(last?.entry.at ?? row.createdAt) })
  }
  if (standing === 'active') {
    const at = timeline.findIndex((entry) => entry.status === 'current')
    const next = timeline[at + 1]
    return next?.entry.kind === 'planned' && next.entry.at !== null
      ? format(m.stageUntil, { date: dotDay(next.entry.at) })
      : format(m.flowEndPending)
  }
  const first = timeline.find((entry) => entry.entry.kind === 'planned' && entry.entry.at !== null)
  return first?.entry.at
    ? format(m.startsOn, { date: dotDay(first.entry.at) })
    : format(m.timeUnset)
}

export default function BatchListPage() {
  const query = useApiQuery(assessmentApi)
  // the page changes shape, not just its measurements, so the choice is
  // made here rather than in a media query
  const narrow = useIsMobile()
  const [searchOpen, setSearchOpen] = useState(false)
  const { format, formatError } = useI18n()
  // the shell repeats this once the heading itself has scrolled away
  const titleRef = usePageTitle(format(m.batchesTitle))
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  // 'all' rather than '': a single-choice toggle group treats the empty
  // string as "nothing selected", so an item carrying it can never light up
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // typing filters the list, but not on every keystroke: the query the table
  // reads settles a moment after the person stops
  const [settledSearch, setSettledSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Keyset paging walked by page number: each page's cursor is remembered as
  // it is handed out, so going back is a cursor we already hold rather than
  // an offset the database has to count to.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const filtered = settledSearch !== '' || statusFilter !== 'all'
  useEffect(() => {
    // a different question deserves a first page, and none of the pages
    // held for the old one answer it
    setCursors([undefined])
    setPageIndex(0)
    setPiles({})
  }, [settledSearch, statusFilter])

  const batches = useQuery({
    ...query.assessment.listBatches.queryOptions({
      query: {
        ...(settledSearch !== '' ? { q: settledSearch } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(cursors[pageIndex] !== undefined ? { cursor: cursors[pageIndex] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
    // switching a filter re-keys the query; without a carried answer the
    // capabilities blink to false and the draft button jumps out from
    // under the pointer that is about to press it
    placeholderData: keepPreviousData,
  })

  // the card's own question, untouched by the filter and the page: the
  // running batches, first page - past twenty running rounds the card's
  // picker is the wrong control anyway
  const runningQuery = useQuery(
    query.assessment.listBatches.queryOptions({
      query: { status: 'active', limit: String(PAGE_SIZE) },
    }),
  )

  // What this reader has to do in the rounds under way, for the card's
  // right column. Its own question rather than a column on the list: the
  // list is paged and filtered, and this is not a fact about the batch.
  // Polled on the same beat as the review rail's badge - the queue it
  // counts is the one that badge counts.
  const agendas = useQuery({
    ...query.assessment.listMyStanding.queryOptions({}),
    refetchInterval: 30_000,
  })

  // said by the server, not guessed here: a control the api would refuse is
  // not drawn, and this reader's own list is still theirs to read
  const canCreate = batches.data?.capabilities.create ?? false
  const counts = batches.data?.statusCounts
  const nextCursor = batches.data?.nextCursor ?? null
  useEffect(() => {
    // remember where the next page starts, the moment this one says
    if (nextCursor === null || cursors[pageIndex + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor])
  }, [nextCursor, pageIndex, cursors])

  const open = (batchId: string) => navigate('assessment/batch', { params: { batchId } })

  const rows = batches.data?.items ?? []
  // On a phone the pages pile up instead of replacing each other: the list
  // is one column somebody is already scrolling, and a pager that swapped
  // the rows under them would lose their place. Kept by the cursor that
  // fetched each page, so asking twice cannot count a page twice and
  // stepping back is a page already held.
  const [piles, setPiles] = useState<Readonly<Record<string, readonly (typeof rows)[number][]>>>({})
  const pileKey = cursors[pageIndex] ?? ''
  useEffect(() => {
    const items = batches.data?.items
    if (items === undefined) return
    setPiles((held) => (held[pileKey] === items ? held : { ...held, [pileKey]: items }))
  }, [batches.data, pileKey])
  const piled = cursors.slice(0, pageIndex + 1).flatMap((cursor) => piles[cursor ?? ''] ?? [])
  const shownRows = narrow ? piled : rows
  const total = batches.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const standing = (row: (typeof rows)[number]) => standingOf(row.status, row.currentPhaseId)

  // Which running batch the card shows. Remembered against the set it was
  // chosen from: a different set starts again at the first, rather than at
  // a position that meant something only in the old one. A batch whose
  // status is running but whose first stage has not arrived is scheduled,
  // not running, and is not the card's.
  const searching = search.trim() !== ''
  const running = searching
    ? []
    : (runningQuery.data?.items ?? []).filter((row) => standing(row) === 'active')
  const runningKey = running.map((row) => row.id).join('\n')
  const [hero, setHero] = useState<{
    key: string
    index: number
    entered: 'forward' | 'backward' | null
  }>({ key: '', index: 0, entered: null })
  const heroIndex = hero.key === runningKey ? Math.min(hero.index, running.length - 1) : 0
  const shown = running[heroIndex]
  const step = (by: 1 | -1) =>
    setHero({
      key: runningKey,
      index: (heroIndex + by + running.length) % running.length,
      entered: by === 1 ? 'forward' : 'backward',
    })
  const agenda = agendaOf(agendas.data?.items ?? [], shown?.id)
  const frame: HeroFrame =
    running.length <= 1
      ? { kind: 'single' }
      : running.length <= ARROWS_UP_TO
        ? {
            kind: 'arrows',
            index: heroIndex,
            total: running.length,
            onPrevious: () => step(-1),
            onNext: () => step(1),
          }
        : {
            kind: 'picker',
            options: running.map((row) => ({ id: row.id, name: row.name })),
            onPick: (id) =>
              setHero({
                key: runningKey,
                index: Math.max(
                  0,
                  running.findIndex((row) => row.id === id),
                ),
                entered: 'forward',
              }),
          }

  // the whole row opens the batch; the name is the link that says so, and
  // a press on it is already on its way
  const openRow = (event: MouseEvent<HTMLTableRowElement>, batchId: string) => {
    if ((event.target as HTMLElement).closest('a') !== null) return
    open(batchId)
  }

  // what the empty table says: the search it matched nothing for, or the
  // standing it found nothing in
  const emptyLine = () => {
    if (settledSearch !== '') return format(m.emptySearch, { q: settledSearch })
    return format(
      {
        all: m.batchesEmpty,
        active: m.emptyActive,
        draft: m.emptyDraft,
        archived: m.emptyArchived,
      }[statusFilter],
    )
  }

  const standingStyle = {
    draft: null,
    pending: styles.standingPending,
    active: styles.standingActive,
    archived: null,
  } as const
  const dotStyle = {
    draft: null,
    pending: styles.dotPending,
    active: styles.dotActive,
    archived: null,
  } as const

  const paged = nextCursor !== null || pageIndex > 0
  // the list is being asked again - a filter, a search, a page - and the
  // answer is slow enough to be worth saying so
  const refreshing = useHeld(batches.isFetching && !batches.isPending, REFRESH_NOTICE_AFTER)
  // the card's question is open until the running rounds are known; its
  // room is kept meanwhile, so the answer does not push the list down
  const heroPending = runningQuery.isPending && !searching

  return (
    <PageContainer xstyle={styles.column}>
      <Reveal className={stylex.props(styles.page).className}>
        <div {...stylex.props(styles.masthead)}>
          {/* on a phone the row holds either the page's name or the box to
              search it, never both: there is room for one of them */}
          {(!narrow || !searchOpen) && (
            <h1 ref={titleRef} {...stylex.props(styles.title)}>
              {format(m.batchesTitle)}
            </h1>
          )}
          <div {...stylex.props(styles.mastheadTools)}>
            {narrow && !searchOpen ? (
              <button
                type="button"
                aria-label={format(m.searchPlaceholder)}
                onClick={() => setSearchOpen(true)}
                {...stylex.props(styles.iconButton)}
              >
                <SearchIcon size={20} aria-hidden />
              </button>
            ) : (
              <Input
                name="batches-search"
                value={search}
                autoFocus={narrow}
                placeholder={format(m.searchPlaceholder)}
                aria-label={format(m.searchPlaceholder)}
                onChange={(event) => setSearch(event.target.value)}
                lead={
                  <SearchIcon aria-hidden className={stylex.props(styles.searchGlyph).className} />
                }
                wrapperXstyle={narrow ? styles.searchOpenSeat : styles.searchSeat}
              />
            )}
            {narrow && searchOpen && (
              <button
                type="button"
                aria-label={format(commonMessages.close)}
                onClick={() => {
                  setSearchOpen(false)
                  setSearch('')
                }}
                {...stylex.props(styles.iconButton)}
              >
                <XIcon size={20} aria-hidden />
              </button>
            )}
            {canCreate && !(narrow && searchOpen) && (
              <>
                {narrow ? (
                  <button
                    type="button"
                    aria-label={format(m.newBatch)}
                    onClick={() => setCreating(true)}
                    {...stylex.props(styles.iconButton, styles.iconButtonInk)}
                  >
                    <PlusIcon size={20} aria-hidden />
                  </button>
                ) : (
                  <Button
                    className={stylex.props(styles.createButton).className}
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon />
                    {format(m.newBatch)}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <AsyncSection
          pending={batches.isPending}
          error={batches.isError ? formatError(batches.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void batches.refetch()}
          skeleton={
            <div {...stylex.props(styles.results)}>
              {heroPending && <HeroSkeleton />}
              <ListSkeleton />
            </div>
          }
        >
          <div {...stylex.props(styles.results)}>
            {heroPending ? (
              <HeroSkeleton />
            ) : narrow ? (
              // On a phone every running round is a card in a row that
              // snaps, rather than one card with a way to step between
              // them: a thumb already knows how to do this, and arrows
              // would be two more targets on the busiest part of the page.
              running.length > 0 && (
                <div {...stylex.props(styles.list)}>
                  <div {...stylex.props(styles.deck)}>
                    {running.map((one) => (
                      <div key={one.id} {...stylex.props(styles.deckCard)}>
                        <BatchCard
                          row={one}
                          agenda={agendaOf(agendas.data?.items ?? [], one.id)}
                          frame={{ kind: 'single' }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* one card is not a choice, so it gets no marks */}
                  {running.length > 1 && (
                    <div aria-hidden {...stylex.props(styles.deckDots)}>
                      {running.map((one, index) => (
                        <span
                          key={one.id}
                          {...stylex.props(
                            styles.deckDot,
                            index === heroIndex && styles.deckDotHere,
                          )}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : (
              shown !== undefined && (
                // keyed by the batch, so a change of batch is a new card
                // arriving rather than the old one's words swapped in place
                <BatchCard
                  key={shown.id}
                  row={shown}
                  agenda={agenda}
                  frame={frame}
                  entered={hero.entered}
                />
              )
            )}

            <section {...stylex.props(styles.list)}>
              {/* the list has a name of its own because the cards above it
                  are batches too: without it the pills read as filtering
                  the whole page. A refresh that runs long is said beside
                  that name, since it is the table being asked again */}
              <div {...stylex.props(styles.listHead)}>
                <div {...stylex.props(styles.listHeadLine)}>
                  <span {...stylex.props(styles.listLabel)}>{format(m.batchesAll)}</span>
                  {refreshing && (
                    <Spinner
                      aria-label={format(commonMessages.loading)}
                      className={stylex.props(styles.refreshing).className}
                    />
                  )}
                </div>
                <div {...stylex.props(styles.pillScroller)}>
                  <ToggleGroup
                    className={stylex.props(styles.wide).className}
                    value={statusFilter}
                    aria-label={format(m.filterStatus)}
                    // a filter group always has an answer: clicking the active
                    // item would otherwise clear the group and mean nothing
                    onValueChange={(next) => next !== '' && setStatusFilter(next as StatusFilter)}
                  >
                    <ToggleGroupItem value="all">
                      {format(m.filterAll)}
                      {chipCount(counts && counts.draft + counts.active + counts.archived)}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="active">
                      {format(m.statusActive)}
                      {chipCount(counts?.active)}
                    </ToggleGroupItem>
                    {/* a draft is a round being set up, and it is only ever
                      listed for whoever sets rounds up: offered to a
                      participant the filter is a promise of an empty page */}
                    {canCreate && (
                      <ToggleGroupItem value="draft">
                        {format(m.statusDraft)}
                        {chipCount(counts?.draft)}
                      </ToggleGroupItem>
                    )}
                    {/* "archived" is the word the column stores; what a reader
                      recognises is that the assessment is over */}
                    <ToggleGroupItem value="archived">
                      {format(m.filterEnded)}
                      {chipCount(counts?.archived)}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              <div {...stylex.props(styles.sheet)}>
                {shownRows.length === 0 ? (
                  // an empty list and an empty result set are different
                  // situations: the first is answered by creating a batch,
                  // the second by the search box and the pills already on
                  // the page, so it is one line where the rows would be
                  filtered ? (
                    <EmptyRow data-testid="batch-list-empty" data-empty="filtered">
                      {emptyLine()}
                    </EmptyRow>
                  ) : (
                    <Empty data-testid="batch-list-empty" data-empty="none">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <LayersIcon />
                        </EmptyMedia>
                        <EmptyTitle>{format(m.batchesEmpty)}</EmptyTitle>
                        <EmptyDescription>{format(m.batchesEmptyHint)}</EmptyDescription>
                      </EmptyHeader>
                      {canCreate && (
                        <EmptyContent>
                          <Button variant="outline" onClick={() => setCreating(true)}>
                            <PlusIcon />
                            {format(m.newBatch)}
                          </Button>
                        </EmptyContent>
                      )}
                    </Empty>
                  )
                ) : narrow ? (
                  <div {...stylex.props(styles.rows)}>
                    {shownRows.map((row) => {
                      const at = standing(row)
                      return (
                        <PageLink
                          key={row.id}
                          page="assessment/batch"
                          params={{ batchId: row.id }}
                          data-testid="batch-row"
                          data-batch={row.id}
                          data-standing={at}
                          className={stylex.props(styles.rowCard).className}
                        >
                          <span {...stylex.props(styles.rowWords)}>
                            <span {...stylex.props(styles.rowName)}>{row.name}</span>
                            <span {...stylex.props(styles.rowMeta)}>
                              <span {...stylex.props(styles.standing, standingStyle[at])}>
                                <span aria-hidden {...stylex.props(styles.dot, dotStyle[at])} />
                                {format(
                                  {
                                    draft: m.statusDraft,
                                    pending: m.statusPending,
                                    active: m.statusActive,
                                    archived: m.statusArchived,
                                  }[at],
                                )}
                              </span>
                              <span {...stylex.props(styles.rowStage)}>{stageOf(row, format)}</span>
                              {/* a round still being set up has no date to
                                  give, and its stage has just said so */}
                              {at !== 'draft' && (
                                <span {...stylex.props(styles.rowWhen)}>
                                  {timeOf(row, at, format)}
                                </span>
                              )}
                            </span>
                          </span>
                          <ChevronRightIcon
                            size={16}
                            aria-hidden
                            {...stylex.props(styles.rowGlyph)}
                          />
                        </PageLink>
                      )
                    })}
                    {/* one more page, where a pager would be */}
                    {nextCursor !== null && (
                      <button
                        type="button"
                        data-testid="batch-more"
                        onClick={() => setPageIndex((index) => index + 1)}
                        {...stylex.props(styles.more)}
                      >
                        {format(m.nextPage)}
                      </button>
                    )}
                  </div>
                ) : (
                  <div {...stylex.props(styles.sheetScroller)}>
                    <Table xstyle={styles.table}>
                      <TableHeader>
                        <TableRow xstyle={styles.headRow}>
                          <TableHead xstyle={[styles.head, styles.leading]}>
                            {format(m.columnBatch)}
                          </TableHead>
                          <TableHead xstyle={[styles.head, styles.colStatus]}>
                            {format(m.filterStatus)}
                          </TableHead>
                          <TableHead xstyle={[styles.head, styles.colStage]}>
                            {format(m.columnStage)}
                          </TableHead>
                          <TableHead xstyle={[styles.head, styles.colTime]}>
                            {format(m.columnTime)}
                          </TableHead>
                          <TableHead
                            aria-label={format(m.enterBatch)}
                            xstyle={[styles.head, styles.colOpen, styles.trailing]}
                          />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => {
                          const at = standing(row)
                          return (
                            <TableRow
                              key={row.id}
                              data-testid="batch-row"
                              data-batch={row.id}
                              data-standing={at}
                              xstyle={styles.row}
                              onClick={(event) => openRow(event, row.id)}
                            >
                              <TableCell xstyle={[styles.cell, styles.leading]}>
                                <PageLink
                                  page="assessment/batch"
                                  params={{ batchId: row.id }}
                                  className={stylex.props(styles.name).className}
                                >
                                  {row.name}
                                </PageLink>
                              </TableCell>
                              <TableCell xstyle={styles.cell}>
                                <span {...stylex.props(styles.standing, standingStyle[at])}>
                                  <span aria-hidden {...stylex.props(styles.dot, dotStyle[at])} />
                                  {format(
                                    {
                                      draft: m.statusDraft,
                                      pending: m.statusPending,
                                      active: m.statusActive,
                                      archived: m.statusArchived,
                                    }[at],
                                  )}
                                </span>
                              </TableCell>
                              <TableCell xstyle={[styles.cell, styles.stage]}>
                                {stageOf(row, format)}
                              </TableCell>
                              <TableCell xstyle={[styles.cell, styles.quiet, styles.time]}>
                                {timeOf(row, at, format)}
                              </TableCell>
                              <TableCell xstyle={[styles.cell, styles.trailing]}>
                                <span aria-hidden {...stylex.props(styles.openGlyph)}>
                                  <ChevronRightIcon size={14} />
                                </span>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {/* the foot exists only when there is somewhere to page to:
                    how many there are is on the pills already */}
                {paged && !narrow && (
                  <div {...stylex.props(styles.pagerRow)}>
                    <span
                      data-testid="batch-pager"
                      data-page={String(pageIndex + 1)}
                      data-pages={String(pageCount)}
                      {...stylex.props(styles.pagerNote)}
                    >
                      {format(m.pageOfTotal, { page: pageIndex + 1, pages: pageCount })}
                    </span>
                    {/* buttons, not anchors: these move client-side state,
                        and an anchor with no href is neither focusable nor
                        disableable */}
                    <nav aria-label="pagination" {...stylex.props(styles.pager)}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pageIndex === 0}
                        onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                      >
                        <ChevronLeftIcon />
                        {format(m.previousPage)}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={nextCursor === null}
                        onClick={() => setPageIndex((index) => index + 1)}
                      >
                        {format(m.nextPage)}
                        <ChevronRightIcon />
                      </Button>
                    </nav>
                  </div>
                )}
              </div>
            </section>
          </div>
        </AsyncSection>

        <NewBatchDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(batchId) => {
            setCreating(false)
            open(batchId)
          }}
        />
      </Reveal>
    </PageContainer>
  )
}
