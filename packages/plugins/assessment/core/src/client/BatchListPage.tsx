import { useEffect, useState, type MouseEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Wordmark } from '@qualy/brand/wordmark'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
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
import { Reveal } from '@qualy/ui/reveal'
import { PageContainer } from '@qualy/ui/page-container'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { Count } from '@qualy/ui/count'
import { ChevronLeftIcon, ChevronRightIcon, LayersIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { standingOf, type BatchStanding } from './batch/standing.ts'
import { BatchCard, type BatchAgenda, type BatchCardRow, type HeroFrame } from './batch/BatchCard.tsx'

// Every batch there is, and the way into one.
//
// The page leads with what is running: one card for the batch under way,
// or one of several with a way to the others. Under it every batch, running
// ones included, as a table - the card says what to do, the table says
// what there is. Opening a batch is a link to the batch, not a selection
// this screen keeps: the address names the batch and the section, so it
// survives a reload and can be sent to somebody. Creation happens in a
// dialog on top of the list.

/** rows per page; the page indicator divides the total by it */
const PAGE_SIZE = 20

// Stand-in for what the reader has to do in a round, until the api that
// answers it lands: the same two lines the design shows, so the card's
// right column is there to be judged. Nothing here is true of any batch.
const PLACEHOLDER_AGENDA: BatchAgenda = { review: { count: 12 }, own: { count: 2 } }

// the card shows one running batch and says which; up to this many the
// others are a pair of arrows away, past it they are a name to pick
const ARROWS_UP_TO = 4

const styles = stylex.create({
  wide: { width: 'max-content' },
  page: {
    display: 'flex',
    minHeight: '100%',
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
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  mastheadTools: {
    display: 'flex',
    flexGrow: {
      default: 0,
      [breakpoints.phone]: 1,
    },
    alignItems: 'center',
    gap: 10,
  },
  searchSeat: {
    width: '100%',
    maxWidth: {
      default: null,
      [breakpoints.tablet]: 320,
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
  fetchSpinner: {
    width: 16,
    height: 16,
  },
  skeletonColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  skeletonLine: {
    height: 40,
    width: '100%',
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: {
      default: 28,
      [breakpoints.phone]: 20,
    },
    transitionProperty: 'opacity',
    transitionDuration: '300ms',
  },
  resultsStale: {
    opacity: 0.5,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  listHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  listTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // one line whatever the width: on a phone the pills scroll sideways
  // rather than stacking under each other
  pillScroller: {
    width: {
      default: null,
      [breakpoints.phone]: '100%',
    },
    overflowX: {
      default: null,
      [breakpoints.phone]: 'auto',
    },
  },
  emptyFrame: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
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
  table: {
    minWidth: 640,
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
    paddingInline: 12,
  },
  leading: {
    paddingInlineStart: 20,
  },
  trailing: {
    paddingInlineEnd: 20,
    textAlign: 'right',
  },
  colStatus: { width: 110 },
  colStage: { width: 150 },
  colTime: { width: 190 },
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
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
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
  time: {
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
    borderTopColor: tokens.border,
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
  foot: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 'auto',
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  footBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: tokens.foreground,
  },
  footLinks: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 20,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  footLink: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    textDecoration: 'none',
  },
})

/** a chip's number, said only once the server has counted */
const chipCount = (count: number | undefined) => <Count>{count}</Count>

const dayOf = (at: string, locale: string) => new Date(at).toLocaleDateString(locale)

/** the stage column: where the batch is, or how much of a plan it has */
function stageOf(row: BatchCardRow, format: ReturnType<typeof useI18n>['format']) {
  if (row.currentPhaseName !== null) return row.currentPhaseName
  return row.timeline.length > 0
    ? format(m.stageCount, { total: row.timeline.length })
    : format(m.noStagesYet)
}

/**
 * The time column, one date per standing: when the stage under way gives
 * way, when a scheduled or drafted batch begins, when an ended one ended.
 */
function timeOf(
  row: BatchCardRow & { createdAt: string },
  standing: BatchStanding,
  format: ReturnType<typeof useI18n>['format'],
  locale: string,
) {
  const timeline = row.timeline
  if (standing === 'archived') {
    // the last stage that was entered is the closest thing to a close the
    // plan records; a batch that never ran a stage ended when it was made
    const last = [...timeline].reverse().find((entry) => entry.entry.kind === 'entered')
    return format(m.endedOn, { date: dayOf(last?.entry.at ?? row.createdAt, locale) })
  }
  if (standing === 'active') {
    const at = timeline.findIndex((entry) => entry.status === 'current')
    const next = timeline[at + 1]
    return next?.entry.kind === 'planned' && next.entry.at !== null
      ? format(m.stageUntil, { date: dayOf(next.entry.at, locale) })
      : format(m.flowEndPending)
  }
  const first = timeline.find((entry) => entry.entry.kind === 'planned' && entry.entry.at !== null)
  if (first?.entry.at) return format(m.startsOn, { date: dayOf(first.entry.at, locale) })
  return timeline.length > 0 ? format(m.notScheduled) : format(m.noStagesYet)
}

export default function BatchListPage() {
  const query = useApiQuery(assessmentApi)
  const { format, formatError, locale } = useI18n()
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  // 'all' rather than '': a single-choice toggle group treats the empty
  // string as "nothing selected", so an item carrying it can never light up
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active' | 'archived'>('all')

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
    // a different question deserves a first page
    setCursors([undefined])
    setPageIndex(0)
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
  const total = batches.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const standing = (row: (typeof rows)[number]) => standingOf(row.status, row.currentPhaseId)

  // Which running batch the card shows. Remembered against the set it was
  // chosen from: a different set - another page, another filter - starts
  // again at the first, rather than at a position that meant something
  // only in the old one.
  const running = rows.filter((row) => standing(row) === 'active')
  const runningKey = running.map((row) => row.id).join('\n')
  const [hero, setHero] = useState<{
    key: string
    index: number
    entered: 'forward' | 'backward'
  }>({ key: '', index: 0, entered: 'forward' })
  const heroIndex = hero.key === runningKey ? Math.min(hero.index, running.length - 1) : 0
  const shown = running[heroIndex]
  const step = (by: 1 | -1) =>
    setHero({
      key: runningKey,
      index: (heroIndex + by + running.length) % running.length,
      entered: by === 1 ? 'forward' : 'backward',
    })
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

  return (
    <Reveal>
      <PageContainer xstyle={styles.page}>
        <div {...stylex.props(styles.masthead)}>
          <h1 {...stylex.props(styles.title)}>{format(m.batchesTitle)}</h1>
          <div {...stylex.props(styles.mastheadTools)}>
            {batches.isFetching && !batches.isPending && (
              <Spinner
                aria-label={format(commonMessages.loading)}
                className={stylex.props(styles.fetchSpinner).className}
              />
            )}
            <Input
              name="batches-search"
              value={search}
              placeholder={format(m.searchPlaceholder)}
              aria-label={format(m.searchPlaceholder)}
              onChange={(event) => setSearch(event.target.value)}
              lead={
                <SearchIcon aria-hidden className={stylex.props(styles.searchGlyph).className} />
              }
              wrapperXstyle={styles.searchSeat}
            />
            {canCreate && (
              <Button
                className={stylex.props(styles.createButton).className}
                onClick={() => setCreating(true)}
              >
                <PlusIcon />
                {format(m.newBatch)}
              </Button>
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
            <div {...stylex.props(styles.skeletonColumn)}>
              <Skeleton className={stylex.props(styles.skeletonLine).className} />
              <Skeleton className={stylex.props(styles.skeletonLine).className} />
              <Skeleton className={stylex.props(styles.skeletonLine).className} />
            </div>
          }
        >
          <div {...stylex.props(styles.results, batches.isFetching && styles.resultsStale)}>
            {shown !== undefined && (
              // keyed by the batch, so a change of batch is a new card
              // arriving rather than the old one's words swapped in place
              <BatchCard
                key={shown.id}
                row={shown}
                agenda={PLACEHOLDER_AGENDA}
                frame={frame}
                entered={hero.entered}
              />
            )}

            <section {...stylex.props(styles.list)}>
              <div {...stylex.props(styles.listHead)}>
                <h2 {...stylex.props(styles.listTitle)}>{format(m.allBatches)}</h2>
                <div {...stylex.props(styles.pillScroller)}>
                  <ToggleGroup
                    className={stylex.props(styles.wide).className}
                    value={statusFilter}
                    aria-label={format(m.filterStatus)}
                    // a filter group always has an answer: clicking the active
                    // item would otherwise clear the group and mean nothing
                    onValueChange={(next) =>
                      next !== '' && setStatusFilter(next as typeof statusFilter)
                    }
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

              {rows.length === 0 ? (
                // an empty list and an empty result set are different
                // situations, and only one of them is answered by clearing
                // a filter
                <Empty
                  data-testid="batch-list-empty"
                  data-empty={filtered ? 'filtered' : 'none'}
                  xstyle={styles.emptyFrame}
                >
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {filtered ? <SearchIcon /> : <LayersIcon />}
                    </EmptyMedia>
                    <EmptyTitle>{format(filtered ? m.noMatchTitle : m.batchesEmpty)}</EmptyTitle>
                    <EmptyDescription>
                      {format(filtered ? m.noMatchHint : m.batchesEmptyHint)}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {filtered ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch('')
                          setStatusFilter('all')
                        }}
                      >
                        {format(m.clearFilters)}
                      </Button>
                    ) : (
                      canCreate && (
                        <Button variant="outline" onClick={() => setCreating(true)}>
                          <PlusIcon />
                          {format(m.newBatch)}
                        </Button>
                      )
                    )}
                  </EmptyContent>
                </Empty>
              ) : (
                <div {...stylex.props(styles.sheet)}>
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
                              <TableCell xstyle={[styles.cell, styles.quiet]}>
                                {stageOf(row, format)}
                              </TableCell>
                              <TableCell xstyle={[styles.cell, styles.quiet, styles.time]}>
                                {timeOf(row, at, format, locale)}
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
                  <div {...stylex.props(styles.pagerRow)}>
                    <span
                      data-testid="batch-pager"
                      data-page={String(pageIndex + 1)}
                      data-pages={String(pageCount)}
                      {...stylex.props(styles.pagerNote)}
                    >
                      {pageCount > 1
                        ? format(m.pageOfTotal, { page: pageIndex + 1, pages: pageCount })
                        : format(m.totalCount, { count: total })}
                    </span>
                    {/* buttons, not anchors: these move client-side state,
                        and an anchor with no href is neither focusable nor
                        disableable */}
                    {(pageCount > 1 || pageIndex > 0) && (
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
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </AsyncSection>

        <footer {...stylex.props(styles.foot)}>
          <div {...stylex.props(styles.footBrand)}>
            <Wordmark height={12} title="Qualy" />
            <span>{format(m.tagline)}</span>
          </div>
          <ul {...stylex.props(styles.footLinks)}>
            {(
              [
                ['help', m.footHelp],
                ['contact', m.footContact],
                ['privacy', m.footPrivacy],
                ['terms', m.footTerms],
              ] as const
            ).map(([id, label]) => (
              <li key={id}>
                <a href="#" {...stylex.props(styles.footLink)}>
                  {format(label)}
                </a>
              </li>
            ))}
          </ul>
        </footer>

        <NewBatchDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(batchId) => {
            setCreating(false)
            open(batchId)
          }}
        />
      </PageContainer>
    </Reveal>
  )
}
