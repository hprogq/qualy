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
  const query = useApiQuery(assessmentApi)
  const { batchId } = usePageRouteParams('batchId')
  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  const waiting = (inbox.data?.items ?? []).length
  if (waiting === 0) return null
  return <span {...stylex.props(styles.count)}>{waiting}</span>
}
