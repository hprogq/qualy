import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import { PageLink, useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Reveal } from '@qualy/ui/reveal'
import { cn } from '@qualy/ui/cn'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { refusalMessage, refusalsOf } from '../refusals.ts'
import { StatusBadge } from './StatusBadge.tsx'
import type { BatchDto } from '../phase/model.ts'

// Everything a batch shows whichever of its sections is open: who it is,
// where it stands, what can be done to it as a whole, and the way between
// its sections.
//
// The sections are pages of their own rather than tabs over one page. That is
// what the address bar says, so a reload, a shared link and the back button
// all land where the reader was - and it is also what they are: a stage plan
// and a roster are two things about a batch, not two views of one.
//
// Which means each section mounts this chrome again, and only the section
// below it is actually new. So the chrome makes no entrance of its own - the
// heading and the buttons would otherwise fade and lift every time somebody
// changed tab, announcing a change that did not happen - and the batch it
// reads stays fresh for long enough that a change of section is not a round
// trip either.

/** the sections of a batch, in the order they are offered */
const SECTIONS = [
  { page: 'assessment/batch-phases', label: m.tabPhases },
  { page: 'assessment/batch-participants', label: m.tabRoster },
] as const

export type BatchSection = (typeof SECTIONS)[number]['page']

export function BatchScreen({
  section,
  children,
}: {
  section: BatchSection
  /** rendered once the batch is loaded, because a section without one is blank */
  children: (batch: BatchDto) => ReactNode
}) {
  const { batchId } = usePageRouteParams('batchId')
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [confirming, setConfirming] = useState<'activate' | 'archive' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    // a section is a route away, not a reload: what changes the batch
    // invalidates this key explicitly and is not waiting on the clock
    staleTime: 30_000,
  })
  const batch = detail.data?.batch

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(api.assessment.setBatchStatus({ params: { batchId }, payload: { status } })),
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

  return (
    <div className="flex flex-col">
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
                <Button size="sm" variant="ghost" className="-ml-2 mb-auto w-fit" asChild>
                  <PageLink page="assessment/batches">
                    <ArrowLeftIcon />
                    {format(m.backToList)}
                  </PageLink>
                </Button>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
                      <StatusBadge status={batch.status} />
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

              <div className="flex flex-col gap-2">
                <nav
                  aria-label={format(m.sectionsLabel)}
                  className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px]"
                >
                  {SECTIONS.map((entry) => (
                    <PageLink
                      key={entry.page}
                      page={entry.page}
                      params={{ batchId }}
                      aria-current={entry.page === section ? 'page' : undefined}
                      className={cn(
                        'inline-flex h-full items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors',
                        entry.page === section
                          ? 'border-input bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {format(entry.label)}
                    </PageLink>
                  ))}
                </nav>
                {/* the one part that is new when the section changes */}
                <Reveal key={section}>{children(batch)}</Reveal>
              </div>

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
    </div>
  )
}
