import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'

// How many submissions are waiting for this reader, beside the rail entry
// that opens them.
//
// The shell offers the slot and passes the entry's id; this answers only for
// its own entry and renders nothing for any other, so a rail full of other
// plugins' pages stays untouched. Nothing while the queue is empty either -
// a badge saying zero is a badge saying nothing.
//
// The number is the server's own count of the queue, read with the reader's
// desk, not the queue walked page by page: the rail stands on every page of
// the round, and walking the whole list every half minute to count it cost
// a request per page of work for a figure one query answers.

const styles = stylex.create({
  count: {
    marginLeft: 'auto',
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.primary,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 500,
    color: tokens.primaryForeground,
    fontVariantNumeric: 'tabular-nums',
  },
})

export default function QueueBadge({ navigationId }: { navigationId?: string }) {
  if (navigationId !== 'assessment/batch-reviews/rail') return null
  return <Count />
}

function Count() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const desk = useQuery({
    ...query.assessment.getMyOverview.queryOptions({ params: { batchId } }),
    refetchInterval: 30_000,
  })
  const waiting = desk.data?.reviewer?.pendingCount ?? 0
  if (waiting === 0) return null
  return (
    <span {...stylex.props(styles.count)} data-testid="queue-badge" data-count={waiting}>
      {waiting}
    </span>
  )
}
