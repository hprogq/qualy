import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { refusalMessage, refusalsOf } from '../refusals.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { ReopenDialog } from './ReopenDialog.tsx'

// Which batch is open, where it stands, and what can be done to it as a whole.
//
// The shell renders this above the rail without knowing what a batch is, and
// this renders without knowing what the shell put around it: it reads the
// batch from the route it was mounted at, the same way the pages beside it
// do. The lifecycle actions live here rather than on a page because they are
// about the batch rather than about any one section of it - and because a
// button repeated at the top of every section is a button in no particular
// place.
export default function BatchContextBar() {
  const { batchId } = usePageRouteParams('batchId')
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const navigate = usePageNavigate()
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null)
  const [reopening, setReopening] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const batch = detail.data?.batch

  // the plan answers with its own reasons; anything else is a sentence the
  // error catalog already has
  const said = (error: unknown) => {
    const refusals = refusalsOf(error)
    return refusals.length > 0
      ? refusals
          .map((refusal) => {
            const sentence = refusalMessage(refusal.reason)
            return sentence ? format(sentence) : refusal.reason
          })
          .join(' ')
      : formatError(error)
  }
  const settle = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })

  const archive = useMutation({
    mutationFn: () =>
      run(api.assessment.setBatchStatus({ params: { batchId }, payload: { status: 'archived' } })),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      await settle()
      setConfirming(null)
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  const reopen = useMutation({
    mutationFn: (input: { reason: string; displayName: string }) =>
      run(
        api.assessment.setBatchStatus({
          params: { batchId },
          payload: {
            status: 'active',
            reason: input.reason,
            phase: { displayName: input.displayName },
            // a reopening that waits has nothing to wait for yet: the new
            // phase is scheduled from the plan afterwards
            plannedEntryAt: null,
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      await settle()
      setReopening(false)
    },
    onError: (error: unknown) => {
      setReopening(false)
      setFailure(said(error))
    },
  })

  const remove = useMutation({
    mutationFn: () => run(api.assessment.deleteBatch({ params: { batchId } })),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      setConfirming(null)
      // the batch this workspace is about no longer exists
      navigate('assessment/batches', { replace: true })
      void settle()
    },
    onError: (error: unknown) => {
      setConfirming(null)
      setFailure(said(error))
    },
  })

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Button size="sm" variant="ghost" className="-ml-1 shrink-0 text-muted-foreground" asChild>
        <PageLink page="assessment/batches">
          <ArrowLeftIcon />
          {format(m.backToList)}
        </PageLink>
      </Button>
      {batch === undefined ? (
        <Skeleton className="h-5 w-52" />
      ) : (
        <>
          <span className="min-w-0 truncate text-sm font-semibold">{batch.name}</span>
          <StatusBadge status={batch.status} currentPhaseId={batch.currentPhaseId} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {failure !== null && <Feedback message={failure} />}
            {batch.status === 'draft' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => setConfirming('delete')}
              >
                <Trash2Icon />
                {format(m.deleteBatch)}
              </Button>
            )}
            {batch.status === 'active' && (
              <Button
                size="sm"
                variant="outline"
                disabled={archive.isPending}
                onClick={() => setConfirming('archive')}
              >
                {format(m.archive)}
              </Button>
            )}
            {batch.status === 'archived' && (
              <Button
                size="sm"
                variant="outline"
                disabled={reopen.isPending}
                onClick={() => setReopening(true)}
              >
                <RotateCcwIcon />
                {format(m.reopen)}
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming === 'archive'}
        title={format(m.archiveConfirmTitle)}
        description={format(m.archiveConfirmBody)}
        confirmLabel={format(m.archive)}
        cancelLabel={format(m.cancel)}
        pending={archive.isPending}
        tone="destructive"
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title={format(m.deleteConfirmTitle)}
        description={format(m.deleteConfirmBody)}
        confirmLabel={format(m.deleteBatch)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        tone="destructive"
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(null)}
      />
      <ReopenDialog
        open={reopening}
        pending={reopen.isPending}
        onCancel={() => setReopening(false)}
        onReopen={(input) => reopen.mutate(input)}
      />
    </div>
  )
}
