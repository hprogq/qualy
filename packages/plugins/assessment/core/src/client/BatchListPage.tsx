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
import { Reveal } from '@qualy/ui/reveal'
import { Skeleton } from '@qualy/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { ChevronLeftIcon, ChevronRightIcon, LayersIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { StatusBadge } from './batch/StatusBadge.tsx'

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

  const open = (batchId: string) => navigate('assessment/batch-phases', { params: { batchId } })

  const rows = batches.data?.items ?? []
  const total = batches.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Reveal className="flex flex-col">
      <header className="relative border-b bg-gradient-to-b from-muted/50 to-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-[size:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        />
        <div className="relative mx-auto flex min-h-40 w-full max-w-5xl flex-col justify-end px-6 pt-4 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{format(m.batchesTitle)}</h1>
              <p className="text-sm text-muted-foreground">{format(m.batchesHint)}</p>
            </div>
            <Button variant="outline" onClick={() => setCreating(true)}>
              <PlusIcon />
              {format(m.newBatch)}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 pt-8 pb-10">
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
            <ToggleGroupItem value="draft">{format(m.statusDraft)}</ToggleGroupItem>
            <ToggleGroupItem value="active">{format(m.statusActive)}</ToggleGroupItem>
            <ToggleGroupItem value="archived">{format(m.statusArchived)}</ToggleGroupItem>
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
                <EmptyMedia variant="icon">{filtered ? <SearchIcon /> : <LayersIcon />}</EmptyMedia>
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
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{format(m.columnName)}</TableHead>
                      <TableHead>{format(m.columnStatus)}</TableHead>
                      <TableHead>{format(m.columnMaterialRange)}</TableHead>
                      <TableHead>{format(m.columnParticipants)}</TableHead>
                      <TableHead>{format(m.columnCreatedAt)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => open(row.id)}
                      >
                        <TableCell className="font-medium">
                          {/* a real link, so a batch can be opened in another
                              tab or reached by keyboard; the row around it is
                              a convenience for the pointer */}
                          <PageLink
                            page="assessment/batch-phases"
                            params={{ batchId: row.id }}
                            className="text-left hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.name}
                          </PageLink>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.materialRange.start} – {row.materialRange.end}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {/* a draft has no roster yet, so it has no number */}
                          {row.status === 'draft' ? '—' : row.participantCount}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(row.createdAt).toLocaleDateString(locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {/* the count answers "is that all of them?", which a cursor
                      list has to answer even when it fits on one page */}
                  {format(m.totalCount, { count: total })}
                  {pageCount > 1 &&
                    ` · ${format(m.pageOfTotal, { page: pageIndex + 1, pages: pageCount })}`}
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
    </Reveal>
  )
}
