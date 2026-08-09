import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { assessmentMessages as m } from './i18n.ts'
import { assessmentApi } from './api.ts'
import { NewBatchDialog } from './NewBatchForm.tsx'
import { PhaseTimelineEditor } from './PhaseTimelineEditor.tsx'
import { RosterPanel } from './RosterPanel.tsx'
import { refusalMessage, refusalsOf } from './refusals.ts'

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
  const [selected, setSelected] = usePageQueryState('batch')
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<'activate' | 'archive' | null>(null)
  const [tab, setTab] = useState('phases')
  const [failure, setFailure] = useState<string | null>(null)

  const batches = useQuery(query.assessment.listBatches.queryOptions({ query: {} }))
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

  // ------------------------------------------------------------------
  // the list, until a batch is chosen
  if (selected === '') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{format(m.batchesTitle)}</h1>
            <p className="text-sm text-muted-foreground">{format(m.batchesHint)}</p>
          </div>
          <Button onClick={() => setCreating(true)}>{format(m.newBatch)}</Button>
        </header>

        <AsyncSection
          pending={batches.isPending}
          error={batches.isError ? formatError(batches.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void batches.refetch()}
        >
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">{format(m.batchesEmpty)}</p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{format(m.columnName)}</TableHead>
                    <TableHead>{format(m.columnStatus)}</TableHead>
                    <TableHead>{format(m.columnMaterialRange)}</TableHead>
                    <TableHead>{format(m.columnUnits)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => open(row.id)}>
                      <TableCell className="font-medium">
                        <button type="button" className="text-left" onClick={() => open(row.id)}>
                          {row.name}
                        </button>
                      </TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.materialRange.start} – {row.materialRange.end}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(m.unitsCount, { count: row.scopeNodeIds.length })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AsyncSection>

        <NewBatchDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(batchId) => {
            setCreating(false)
            open(batchId)
          }}
        />
      </div>
    )
  }

  // ------------------------------------------------------------------
  // one batch, opened
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <Button size="sm" variant="ghost" onClick={() => setSelected('')}>
        ← {format(m.backToList)}
      </Button>

      <AsyncSection
        pending={detail.isPending}
        error={detail.isError ? formatError(detail.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void detail.refetch()}
      >
        {batch && (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold">{batch.name}</h1>
                  {statusBadge(batch.status)}
                </div>
                <p className="text-sm text-muted-foreground">
                  {format(m.columnMaterialRange)}: {batch.materialRange.start} –{' '}
                  {batch.materialRange.end}
                  {' · '}
                  {format(m.unitsCount, { count: batch.scopeNodeIds.length })}
                </p>
              </div>
              <div className="flex gap-2">
                {batch.status === 'draft' && (
                  <Button disabled={setStatus.isPending} onClick={() => setConfirming('activate')}>
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
            </header>

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
              onConfirm={() => setStatus.mutate('archived')}
              onCancel={() => setConfirming(null)}
            />
          </div>
        )}
      </AsyncSection>
    </div>
  )
}
