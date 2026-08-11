import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageLink, useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useLocale } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@qualy/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@qualy/ui/input-group'
import { Pagination, PaginationContent, PaginationItem } from '@qualy/ui/pagination'
import { Badge } from '@qualy/ui/badge'
import { Reveal } from '@qualy/ui/reveal'
import { PageContainer } from '@qualy/ui/page-container'
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

// Every batch there is, and the way into one.
//
// Opening a batch is a link to the batch, not a selection this screen keeps:
// the address names the batch and the section, so it survives a reload and
// can be sent to somebody. Creation happens in a dialog on top of the list.
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

  const batches = useQuery(
    query.assessment.listBatches.queryOptions({
      query: {
        ...(settledSearch !== '' ? { q: settledSearch } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(cursors[pageIndex] !== undefined ? { cursor: cursors[pageIndex] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
  )

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
      <PageContainer className="flex flex-col gap-5">
        {/* the application's own landing page, so it introduces itself once
            rather than repeating a banner on every screen below it */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{format(m.batchesTitle)}</h1>
              {total > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {format(m.totalCount, { count: total })}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{format(m.batchesHint)}</p>
          </div>
          <Button variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon />
            {format(m.newBatch)}
          </Button>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupInput
                value={search}
                placeholder={format(m.searchPlaceholder)}
                aria-label={format(m.searchPlaceholder)}
                onChange={(event) => setSearch(event.target.value)}
              />
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
            </InputGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={statusFilter}
              aria-label={format(m.filterStatus)}
              // a filter group always has an answer: clicking the active item
              // would otherwise clear the group and mean nothing
              onValueChange={(next) => next !== '' && setStatusFilter(next as typeof statusFilter)}
            >
              <ToggleGroupItem value="all">{format(m.filterAll)}</ToggleGroupItem>
              <ToggleGroupItem value="active">{format(m.statusActive)}</ToggleGroupItem>
              <ToggleGroupItem value="draft">{format(m.statusDraft)}</ToggleGroupItem>
              {/* "archived" is the word the column stores; what a reader
                  recognises is that the assessment is over */}
              <ToggleGroupItem value="archived">{format(m.filterEnded)}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <AsyncSection
            pending={batches.isPending}
            error={batches.isError ? formatError(batches.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void batches.refetch()}
            skeleton={
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            }
          >
            {rows.length === 0 ? (
              // an empty list and an empty result set are different situations,
              // and only one of them is answered by clearing a filter
              <Empty className="rounded-lg border border-dashed">
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
                    <Button variant="outline" onClick={() => setCreating(true)}>
                      <PlusIcon />
                      {format(m.newBatch)}
                    </Button>
                  )}
                </EmptyContent>
              </Empty>
            ) : (
              <div className="flex flex-col gap-8">
                {/* grouped by what the reader is looking for: what is running
                    now, what is about to, what is still being set up, and
                    what is over - and the last of those needs a line each
                    rather than a card, because all anybody wants there is to
                    find it and open it */}
                {groups.map((group) =>
                  group.rows.length === 0 ? null : (
                    <section key={group.id} className="flex flex-col gap-3">
                      <h2 className="text-sm font-medium text-muted-foreground">
                        {format(group.label)}
                      </h2>
                      {group.id === 'ended' ? (
                        <ul className="divide-y rounded-xl border bg-background">
                          {group.rows.map((row) => (
                            <li
                              key={row.id}
                              className="group relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3"
                            >
                              <div className="min-w-0">
                                <PageLink
                                  page="assessment/batch"
                                  params={{ batchId: row.id }}
                                  className="truncate text-sm font-medium before:absolute before:inset-0 before:content-['']"
                                >
                                  {row.name}
                                </PageLink>
                              </div>
                              <span className="shrink-0 text-sm text-muted-foreground">
                                {format(m.endedOn, {
                                  date: new Date(row.createdAt).toLocaleDateString(locale),
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="grid items-stretch gap-3 sm:grid-cols-2">
                          {group.rows.map((row) => (
                            <BatchCard key={row.id} row={row} />
                          ))}
                        </ul>
                      )}
                    </section>
                  ),
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {/* how many there are is said beside the title; here is
                      only where in them this page falls */}
                    {pageCount > 1
                      ? format(m.pageOfTotal, { page: pageIndex + 1, pages: pageCount })
                      : ''}
                  </span>
                  {/* the navigation structure is the library's; the controls
                    are buttons rather than its anchors, because these move
                    client-side state - an anchor with no href is neither
                    focusable nor disableable, and its label is english */}
                  {(pageCount > 1 || pageIndex > 0) && (
                    <Pagination className="mx-0 w-auto">
                      <PaginationContent>
                        <PaginationItem>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pageIndex === 0}
                            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                          >
                            <ChevronLeftIcon />
                            {format(m.previousPage)}
                          </Button>
                        </PaginationItem>
                        <PaginationItem>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={nextCursor === null}
                            onClick={() => setPageIndex((index) => index + 1)}
                          >
                            {format(m.nextPage)}
                            <ChevronRightIcon />
                          </Button>
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
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
