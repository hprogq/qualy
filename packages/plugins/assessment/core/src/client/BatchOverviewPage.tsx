import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from './api.ts'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchFlow, BatchFlowStrip } from './batch/BatchFlow.tsx'
import { PhaseContextBar } from './batch/PhaseContextBar.tsx'
import { assessmentMessages as m } from './i18n.ts'

// Where a batch opens, for whoever it belongs to.
//
// The flow of the round is one of the two things this page is for, so it is
// here in full and read-only. Which shape it takes is a question of what the
// screen has spare: a wide one has width, so the flow runs down a column
// beside the page; a narrow one has none to give a second column and cannot
// spend the height either, so the flow becomes one scrollable line above the
// work. The break is at the width the two columns stop fitting, not at any
// idea of what device is holding it.

export default function BatchOverviewPage() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()

  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const timeline = plan.data?.timeline ?? []

  return (
    <BatchScreen title={format(m.tabOverview)} description={format(m.overviewHint)}>
      {() => (
        <div className="flex flex-col gap-5">
          {plan.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <PhaseContextBar timeline={timeline} />
          )}

          {!plan.isPending && <BatchFlowStrip timeline={timeline} className="lg:hidden" />}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{format(m.overviewPlaceholder)}</p>
            </div>
            {/* it follows the page down rather than scrolling away, and keeps
                its own scrollbar when the round has more stages than the
                screen has height */}
            <aside className="sticky top-6 hidden max-h-[calc(100dvh-9rem)] self-start overflow-y-auto lg:block">
              <p className="pb-3 text-xs font-medium text-muted-foreground">
                {format(m.flowTitle)}
              </p>
              {plan.isPending ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (
                <BatchFlow timeline={timeline} keepPast={1} />
              )}
            </aside>
          </div>
        </div>
      )}
    </BatchScreen>
  )
}
