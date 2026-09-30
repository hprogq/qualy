import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { isRecordId, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import type { NavigationBadgeContext } from '@qualy/ui-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'

import {
  ALERTED_ENTRIES,
  entryAlerted,
  owesAdministration,
  useAdminAlerts,
} from './admin-alerts.ts'
import * as m from '#messages'

// A dot beside the administration entries that have something waiting
// behind them: questions whose review cannot go on, a roster the
// organization has moved away from, appointments the batch has yet to take.
//
// A dot and not a number: the counts are of different things - people,
// submissions, appointments - and a number beside "Questions" would read as
// a count of questions. The overview's desk says what each one is. Answered
// only for this plugin's own three entries, and only to whoever administers
// the open batch while it is not archived, where none of it could be mended;
// everybody else's rail is untouched.

// The counts behind a dot are asked once the batch is read, so on a fresh
// page it comes a moment after the rail. It arrives rather than blinks in,
// and nothing stands in for it meanwhile: a placeholder would read as
// something waiting, where mostly nothing is.
const arrive = stylex.keyframes({
  from: { opacity: 0, transform: 'scale(0.6)' },
  to: { opacity: 1, transform: 'scale(1)' },
})

const styles = stylex.create({
  dot: {
    flexShrink: 0,
    width: 7,
    height: 7,
    marginLeft: 'auto',
    borderRadius: '9999px',
    backgroundColor: tokens.warning,
  },
  arriving: {
    animationName: { default: arrive, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
  },
})

const ALERTED: readonly string[] = Object.values(ALERTED_ENTRIES)

// the slot hands its context over as one prop, the entry's id inside it
export default function AdminAlertBadge({ context }: { context?: NavigationBadgeContext }) {
  const navigationId = context?.navigationId
  if (navigationId === undefined || !ALERTED.includes(navigationId)) return null
  return <Dot navigationId={navigationId} />
}

function Dot({ navigationId }: { navigationId: string }) {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)

  // the bar above the rail has read the batch already; this is its answer
  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
    enabled: isRecordId(batchId),
  })
  const batch = detail.data?.batch
  const alerts = useAdminAlerts(batchId, batch !== undefined && owesAdministration(batch))
  // only a dot that was waited for arrives; one already known when the rail
  // is drawn again, moving between the batch's pages, is simply there
  const [waited] = useState(() => batch === undefined || alerts.pending)
  if (!entryAlerted(alerts, navigationId)) return null
  // named, so the entry reads as one that needs attention to whoever
  // hears the rail rather than sees it
  return (
    <span
      role="img"
      aria-label={m.batch_railAlert()}
      data-testid="rail-alert"
      data-navigation={navigationId}
      {...stylex.props(styles.dot, waited && styles.arriving)}
    />
  )
}
