import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import type { NavigationBadgeContext } from '@qualy/ui-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'

// How many submissions are waiting for this reader, beside the rail entry
// that opens them.
//
// The shell offers the slot and hands it the entry's id, inside the context
// it gives every contribution; this answers only for its own entry and
// renders nothing for any other, so a rail full of other plugins' pages
// stays untouched. Nothing while the queue is empty either - a badge saying
// zero is a badge saying nothing.
//
// The number is the server's own count of the queue, read with the reader's
// desk, not the queue walked page by page: the rail stands on every page of
// the round, and walking the whole list every half minute to count it cost
// a request per page of work for a figure one query answers.

// The count is asked once the page is up, so on a fresh page it comes a
// moment after the rail. It arrives rather than blinks in, as the rail's
// administration dot does (AdminAlertBadge); one already known when the rail
// is drawn again, moving between pages, is simply there.
const arrive = stylex.keyframes({
  from: { opacity: 0, transform: 'scale(0.6)' },
  to: { opacity: 1, transform: 'scale(1)' },
})

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
  arriving: {
    animationName: { default: arrive, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
  },
})

// the slot hands its context over as one prop, the entry's id inside it
export default function QueueBadge({ context }: { context?: NavigationBadgeContext }) {
  if (context?.navigationId !== 'assessment/batch-reviews/rail') return null
  return <Count />
}

function Count() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const desk = useQuery({
    ...query.assessment.getMyOverview.queryOptions({ params: { batchId } }),
    refetchInterval: 30_000,
  })
  const [waited] = useState(() => desk.data === undefined)
  const waiting = desk.data?.reviewer?.pendingCount ?? 0
  if (waiting === 0) return null
  return (
    <span
      {...stylex.props(styles.count, waited && styles.arriving)}
      data-testid="queue-badge"
      data-count={waiting}
    >
      {waiting}
    </span>
  )
}
