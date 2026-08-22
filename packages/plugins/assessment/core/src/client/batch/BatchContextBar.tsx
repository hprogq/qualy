import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import {
  PageLink,
  useApiQuery,
  usePageRouteParams,
  usePublishWorkspaceCapabilities,
} from '@qualy/web-runtime'
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
  // the workspace speaks for itself: who this reader is in the open batch,
  // straight from the server's projection, withdrawn while a batch loads so
  // gated rail entries never flash before the answer arrives
  usePublishWorkspaceCapabilities(
    batch === undefined
      ? null
      : new Set(
          [
            batch.capabilities.personal && 'assessment/personal',
            batch.capabilities.review && 'assessment/review',
            batch.capabilities.record && 'assessment/record',
            batch.capabilities.manage && 'assessment/manage',
          ].filter((token): token is string => token !== false),
        ),
  )
  // the derived timeline, which is where "the stage ends when the next one
  // starts" is already worked out; the bar only counts the clock down to it
  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })

  // A row on a phone, three measured columns from a tablet up. The named
  // door to the list is a desk affordance, and with it gone there is nothing
  // on the left for the name to be centred against: a title floating in the
  // middle of a bar with empty space beside it reads as decoration, so on a
  // narrow screen the switch starts where every other line of the page does.
  return (
    <div className="flex min-w-0 items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
      <div data-bar-start className="flex min-w-0 items-center max-sm:hidden">
        {/* A named destination, not a Back: the arrow beside the words is
            fine on a desk, but alone on a phone it reads as navigation
            history and gets pressed by mistake - there the switcher's own
            menu already carries this door, so the shortcut leaves. */}
        <Button size="sm" variant="ghost" className="-ml-1 shrink-0 text-muted-foreground" asChild>
          <PageLink page="assessment/batches">
            <ArrowLeftIcon />
            {format(m.backToList)}
          </PageLink>
        </Button>
      </div>

      {/* The switch: centred between the two doors on a desk, and hard left
          on a phone where the left door is gone. Its ceiling is generous -
          these are names somebody chose, and cutting one early to protect
          space nothing else is using was the wrong trade - and short of the
          width where the bar becomes a title bar. The sides keep their own
          content whatever happens, so a longer name is cut here rather than
          pushing the countdown off the end. */}
      <div className="flex min-w-0 max-w-[min(70vw,40rem)] flex-1 justify-start sm:flex-none sm:justify-center">
        {batch === undefined ? (
          <Skeleton className="h-6 w-56" />
        ) : (
          <BatchSwitcher
            batchId={batchId}
            name={batch.name}
            status={batch.status}
            currentPhaseId={batch.currentPhaseId}
          />
        )}
      </div>

      {/* never shrunk and never clipped: the clock is short by design, and a
          column that gave way would hand its own text to the name beside it */}
      <div className="flex shrink-0 items-center justify-end gap-2">
        {batch !== undefined && (
          <BatchProgress
            showStage
            timeline={plan.data?.timeline ?? []}
            className="inline-flex items-center text-sm"
          />
        )}
      </div>
    </div>
  )
}
