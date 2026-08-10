import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n, useLocale } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
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
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import { RosterPanel } from './RosterPanel.tsx'
import { refusalMessage, refusalsOf } from './refusals.ts'

/** rows per page; the page indicator divides the total by it */
const PAGE_SIZE = 20

// The batches: a table of them, and one batch opened at a time.
//
// The list is the whole page until a row is chosen; the chosen batch takes
// over with its stages and its participants in tabs. Which batch is open
// lives in the query string, so a colleague can be sent the link to the one
// being discussed. Creation happens in a dialog on top of the list.
export default function BatchAdminPage() {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [locale] = useLocale()
  const [selected, setSelected] = usePageQueryState('batch')
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<'activate' | 'archive' | null>(null)
  const [tab, setTab] = useState('phases')
  const [failure, setFailure] = useState<string | null>(null)
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
  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId: selected } }),
    enabled: selected !== '',
  })

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId: selected },
          payload: { status },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.assessment.key() })
      setConfirming(null)
    },
    onError: (error: unknown) => {
      setConfirming(null)
      // activation answers with the plan's own reasons; anything else is a
      // sentence the error catalog already has
      const refusals = refusalsOf(error)
      setFailure(
        refusals.length > 0
          ? refusals
              .map((refusal) => {
                const sentence = refusalMessage(refusal.reason)
                return sentence ? format(sentence) : refusal.reason
              })
              .join(' ')
          : formatError(error),
      )
    },
  })

  const statusBadge = (status: 'draft' | 'active' | 'archived') =>
    status === 'draft' ? (
      <Badge variant="outline">{format(m.statusDraft)}</Badge>
    ) : status === 'active' ? (
      <Badge>{format(m.statusActive)}</Badge>
    ) : (
      <Badge variant="secondary">{format(m.statusArchived)}</Badge>
    )

  const open = (batchId: string) => {
    setFailure(null)
    setTab('phases')
    setSelected(batchId)
  }

  const batch = selected !== '' ? detail.data?.batch : undefined
  const rows = batches.data?.items ?? []
  const total = batches.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ------------------------------------------------------------------
  // the list, until a batch is chosen
  if (selected === '') {
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
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => open(row.id)}
                            >
                              {row.name}
                            </button>
                          </TableCell>
                          <TableCell>{statusBadge(row.status)}</TableCell>
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

  // ------------------------------------------------------------------
  // one batch, opened
  return (
    <Reveal className="flex flex-col">
      <AsyncSection
        pending={detail.isPending}
        error={detail.isError ? formatError(detail.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void detail.refetch()}
      >
        {batch && (
          <div className="flex flex-col">
            <header className="relative border-b bg-gradient-to-b from-muted/50 to-background">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-[size:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
              />
              <div className="relative mx-auto flex min-h-40 w-full max-w-5xl flex-col justify-end gap-3 px-6 pt-4 pb-8">
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2 mb-auto w-fit"
                  onClick={() => setSelected('')}
                >
                  <ArrowLeftIcon />
                  {format(m.backToList)}
                </Button>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
                      {statusBadge(batch.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {/* before activation there is no roster to speak of, so
                          the line describes the intent instead of the fact */}
                      {batch.status === 'draft'
                        ? format(m.batchSummaryDraft, {
                            units: batch.scopeNodeIds.length,
                            from: batch.materialRange.start,
                            until: batch.materialRange.end,
                          })
                        : format(m.batchSummary, {
                            count: batch.participantCount,
                            from: batch.materialRange.start,
                            until: batch.materialRange.end,
                          })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {batch.status === 'draft' && (
                      <Button
                        disabled={setStatus.isPending}
                        onClick={() => setConfirming('activate')}
                      >
                        {format(m.activate)}
                      </Button>
                    )}
                    {batch.status === 'active' && (
                      <Button
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setConfirming('archive')}
                      >
                        {format(m.archive)}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </header>

            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
              <Feedback message={failure} />
              {batch.status === 'draft' && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {format(m.draftBanner)}
                </p>
              )}

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="phases">{format(m.tabPhases)}</TabsTrigger>
                  <TabsTrigger value="roster">{format(m.tabRoster)}</TabsTrigger>
                </TabsList>
                <TabsContent value="phases">
                  <PhaseTimelineEditor batch={batch} />
                </TabsContent>
                <TabsContent value="roster">
                  <RosterPanel batch={batch} />
                </TabsContent>
              </Tabs>

              <ConfirmDialog
                open={confirming === 'activate'}
                title={format(m.activateConfirmTitle)}
                description={format(m.activateConfirmBody)}
                confirmLabel={format(m.activate)}
                cancelLabel={format(m.cancel)}
                pending={setStatus.isPending}
                onConfirm={() => setStatus.mutate('active')}
                onCancel={() => setConfirming(null)}
              />
              <ConfirmDialog
                open={confirming === 'archive'}
                title={format(m.archiveConfirmTitle)}
                description={format(m.archiveConfirmBody)}
                confirmLabel={format(m.archive)}
                cancelLabel={format(m.cancel)}
                pending={setStatus.isPending}
                tone="destructive"
                onConfirm={() => setStatus.mutate('archived')}
                onCancel={() => setConfirming(null)}
              />
            </div>
          </div>
        )}
      </AsyncSection>
    </Reveal>
  )
}
