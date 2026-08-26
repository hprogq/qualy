import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useLocale } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
import { Badge } from '@qualy/ui/badge'
import { Reveal } from '@qualy/ui/reveal'
import { PageContainer } from '@qualy/ui/page-container'
import { Input } from '@qualy/ui/input'
import { Skeleton } from '@qualy/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { ChevronLeftIcon, ChevronRightIcon, LayersIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { standingOf } from './batch/standing.ts'
import { BatchCard } from './batch/BatchCard.tsx'

/** rows per page; the page indicator divides the total by it */
const PAGE_SIZE = 20

const styles = stylex.create({
  searchSeat: {
    width: '100%',
    maxWidth: {
      default: null,
      '@media (min-width: 640px)': 320,
    },
  },
  searchGlyph: {
    width: 16,
    height: 16,
    color: tokens.mutedForeground,
  },
  pager: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: {
      default: 16,
      '@media (min-width: 640px)': 20,
    },
  },
  masthead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  mastheadWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  totalBadge: {
    fontVariantNumeric: 'tabular-nums',
  },
  hint: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  createButton: {
    flexShrink: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: {
      default: 16,
      '@media (min-width: 640px)': 20,
    },
  },
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: {
      default: 10,
      '@media (min-width: 640px)': 12,
    },
  },
  fetchSpinner: {
    marginLeft: 'auto',
    width: 16,
    height: 16,
  },
  // one line whatever the width: on a phone the chips scroll sideways
  // rather than stacking under each other
  chipScroller: {
    width: {
      default: null,
      '@media (max-width: 639.98px)': '100%',
    },
    overflowX: {
      default: null,
      '@media (max-width: 639.98px)': 'auto',
    },
  },
  // The room a chip's number will need is taken from the first paint, empty.
  // Appearing into no room widened every chip the moment the count landed,
  // and the filter bar shuffled under the reader's eye - 1ch of tabular
  // figures is exactly one digit, which is what nearly every one of these is.
  chipCount: {
    minWidth: '1ch',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
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
  emptyFrame: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
    transitionProperty: 'opacity',
    transitionDuration: '300ms',
  },
  resultsStale: {
    opacity: 0.5,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  endedList: {
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
  },
  endedRow: {
    position: 'relative',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 4,
    paddingInline: 20,
    paddingBlock: 12,
    borderTopWidth: {
      default: 1,
      ':first-child': 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  endedName: {
    minWidth: 0,
  },
  endedLink: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
    '::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
    },
  },
  endedDate: {
    flexShrink: 0,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  cardGrid: {
    display: 'grid',
    alignItems: 'stretch',
    gap: 12,
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  pagerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pagerNote: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
})

// Every batch there is, and the way into one.
//
// Opening a batch is a link to the batch, not a selection this screen keeps:
// the address names the batch and the section, so it survives a reload and
// can be sent to somebody. Creation happens in a dialog on top of the list.

/** a chip's number, said only once the server has counted */
const chipCount = (count: number | undefined) => (
  <span {...stylex.props(styles.chipCount)}>{count}</span>
)

export default function BatchListPage() {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [locale] = useLocale()
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
  const groups = [
    { id: 'active', label: m.groupRunning, rows: rows.filter((row) => standing(row) === 'active') },
    {
      id: 'pending',
      label: m.groupPending,
      rows: rows.filter((row) => standing(row) === 'pending'),
    },
    { id: 'draft', label: m.groupDraft, rows: rows.filter((row) => standing(row) === 'draft') },
    { id: 'ended', label: m.groupEnded, rows: rows.filter((row) => standing(row) === 'archived') },
  ] as const

  return (
    <Reveal>
      <PageContainer xstyle={styles.page}>
        {/* the application's own landing page, so it introduces itself once
            rather than repeating a banner on every screen below it */}
        <div {...stylex.props(styles.masthead)}>
          <div {...stylex.props(styles.mastheadWords)}>
            <div {...stylex.props(styles.titleRow)}>
              <h1 {...stylex.props(styles.title)}>{format(m.batchesTitle)}</h1>
              {total > 0 && (
                <Badge variant="secondary" className={stylex.props(styles.totalBadge).className}>
                  {format(m.totalCount, { count: total })}
                </Badge>
              )}
            </div>
            <p {...stylex.props(styles.hint)}>{format(m.batchesHint)}</p>
          </div>
          {canCreate && (
            <Button
              variant="outline"
              className={stylex.props(styles.createButton).className}
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
              {format(m.newBatch)}
            </Button>
          )}
        </div>

        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.filterBar)}>
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
            {batches.isFetching && !batches.isPending && (
              <Spinner
                aria-label={format(commonMessages.loading)}
                className={stylex.props(styles.fetchSpinner).className}
              />
            )}
            <div {...stylex.props(styles.chipScroller)}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                className="w-max"
                value={statusFilter}
                aria-label={format(m.filterStatus)}
                // a filter group always has an answer: clicking the active item
                // would otherwise clear the group and mean nothing
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
                {/* a draft is a round being set up, and it is only ever listed
                    for whoever sets rounds up: offered to a participant the
                    filter is a promise of an empty page */}
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
            {rows.length === 0 ? (
              // an empty list and an empty result set are different situations,
              // and only one of them is answered by clearing a filter
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
              <div {...stylex.props(styles.results, batches.isFetching && styles.resultsStale)}>
                {/* grouped by what the reader is looking for: what is running
                    now, what is about to, what is still being set up, and
                    what is over - and the last of those needs a line each
                    rather than a card, because all anybody wants there is to
                    find it and open it */}
                {groups.map((group) =>
                  group.rows.length === 0 ? null : (
                    <section key={group.id} {...stylex.props(styles.group)}>
                      <h2 {...stylex.props(styles.groupTitle)}>{format(group.label)}</h2>
                      {group.id === 'ended' ? (
                        <ul {...stylex.props(styles.endedList)}>
                          {group.rows.map((row) => (
                            <li key={row.id} {...stylex.props(styles.endedRow)}>
                              <div {...stylex.props(styles.endedName)}>
                                <PageLink
                                  page="assessment/batch"
                                  params={{ batchId: row.id }}
                                  className={stylex.props(styles.endedLink).className}
                                >
                                  {row.name}
                                </PageLink>
                              </div>
                              <span {...stylex.props(styles.endedDate)}>
                                {format(m.endedOn, {
                                  date: new Date(row.createdAt).toLocaleDateString(locale),
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul {...stylex.props(styles.cardGrid)}>
                          {group.rows.map((row) => (
                            <BatchCard key={row.id} row={row} />
                          ))}
                        </ul>
                      )}
                    </section>
                  ),
                )}
                <div {...stylex.props(styles.pagerRow)}>
                  <span
                    data-testid="batch-pager"
                    data-page={String(pageIndex + 1)}
                    data-pages={String(pageCount)}
                    {...stylex.props(styles.pagerNote)}
                  >
                    {/* how many there are is said beside the title; here is
                      only where in them this page falls */}
                    {pageCount > 1
                      ? format(m.pageOfTotal, { page: pageIndex + 1, pages: pageCount })
                      : ''}
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
          </AsyncSection>
        </div>

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
