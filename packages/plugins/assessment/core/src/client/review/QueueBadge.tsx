import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'

// How many submissions are waiting for this reader, beside the rail entry
// that opens them.
//
// The shell offers the slot and passes the entry's id; this answers only for
// its own entry and renders nothing for any other, so a rail full of other
// plugins' pages stays untouched. Nothing while the queue is empty either -
// a badge saying zero is a badge saying nothing.

export default function QueueBadge({ navigationId }: { navigationId?: string }) {
  if (navigationId !== 'assessment/batch-reviews/rail') return null
  return <Count />
}

function Count() {
  const query = useApiQuery(assessmentApi)
  const { batchId } = usePageRouteParams('batchId')
  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  const waiting = (inbox.data?.items ?? []).length
  if (waiting === 0) return null
  return (
    <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none font-medium text-primary-foreground tabular-nums">
      {waiting}
    </span>
  )
}
