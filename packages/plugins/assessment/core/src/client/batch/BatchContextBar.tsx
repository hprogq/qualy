import { useEffect, useRef, useState } from 'react'
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
/** the gap the grid puts between its three columns, in pixels */
const GAP = 12

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

  // How much the batch's name may take: everything the bar has left once the
  // wider of its two ends is kept on both sides.
  //
  // Measured rather than guessed at a fixed maximum, because the two ends
  // grow with what they say - a back link that keeps its words, a countdown
  // that swaps units - and because the middle has to stay in the middle: it
  // is centred by having equal room either side, not by the grid.
  const bar = useRef<HTMLDivElement>(null)
  const start = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  useEffect(() => {
    const whole = bar.current
    const left = start.current
    const right = end.current
    if (!whole || !left || !right) return
    const measure = () => {
      const sides = Math.max(left.scrollWidth, right.scrollWidth)
      // the grid's own two gaps, which are not the middle's to spend
      setRoom(Math.max(0, whole.clientWidth - 2 * sides - 2 * GAP))
    }
    const observer = new ResizeObserver(measure)
    for (const node of [whole, left, right]) observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={bar} className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div data-bar-start ref={start} className="flex min-w-0 items-center">
        <Button size="sm" variant="ghost" className="-ml-1 shrink-0 text-muted-foreground" asChild>
          <PageLink page="assessment/batches">
            <ArrowLeftIcon />
            <span className="max-sm:sr-only">{format(m.backToList)}</span>
          </PageLink>
        </Button>
      </div>

      {/* the middle column, so the batch sits in the centre of the bar
          whatever is beside it, and the switch is where the eye already is */}
      <div
        className="flex min-w-0 justify-center"
        style={room === null ? undefined : { maxWidth: room }}
      >
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

      <div ref={end} className="flex min-w-0 items-center justify-end gap-2">
        {batch !== undefined && (
          <BatchProgress
            showStage
            timeline={plan.data?.timeline ?? []}
            className="inline-flex min-w-0 items-center truncate text-sm"
          />
        )}
      </div>
    </div>
  )
}
