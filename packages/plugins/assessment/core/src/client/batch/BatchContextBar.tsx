import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import { PageLink, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchProgress } from './BatchProgress.tsx'
import { BatchSwitcher } from './BatchSwitcher.tsx'

// Which batch is open and where it stands.
//
// The shell renders this above the rail without knowing what a batch is, and
// this renders without knowing what the shell put around it: it reads the
// batch from the route it was mounted at, the same way the pages beside it
// do. What may happen to the batch as a whole is not here - archiving and
// deleting ask twice and happen once, and a row of them across the top of
// every section made each section look like the smaller subject.
export default function BatchContextBar() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const batch = detail.data?.batch
  // the derived timeline, which is where "the stage ends when the next one
  // starts" is already worked out; the bar only counts the clock down to it
  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })

  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="flex min-w-0 items-center">
        <Button size="sm" variant="ghost" className="-ml-1 shrink-0 text-muted-foreground" asChild>
          <PageLink page="assessment/batches">
            <ArrowLeftIcon />
            <span className="max-sm:sr-only">{format(m.backToList)}</span>
          </PageLink>
        </Button>
      </div>

      {/* the middle column, so the batch sits in the centre of the bar
          whatever is beside it, and the switch is where the eye already is */}
      {batch === undefined ? (
        <Skeleton className="h-6 w-56 justify-self-center" />
      ) : (
        <BatchSwitcher
          batchId={batchId}
          name={batch.name}
          status={batch.status}
          currentPhaseId={batch.currentPhaseId}
        />
      )}

      <div className="flex min-w-0 items-center justify-end gap-2">
        {batch !== undefined && (
          <BatchProgress
            showStage
            timeline={plan.data?.timeline ?? []}
            // on a phone the stage name gives way to the time, which is the half
            // somebody checks in passing; the whole line is never hidden
            className="inline-flex min-w-0 items-center truncate text-[0.9375rem] max-sm:[&_[data-slot=stage]]:hidden"
          />
        )}
      </div>
    </div>
  )
}
