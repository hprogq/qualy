import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { isRecordId, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import type { NavigationBadgeContext } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ALERTED_ENTRIES, entryAlerted, useAdminAlerts } from './admin-alerts.ts'

// A dot beside the administration entries that have something waiting
// behind them: questions whose review cannot go on, a roster the
// organization has moved away from, appointments the batch has yet to take.
//
// A dot and not a number: the counts are of different things - people,
// submissions, appointments - and a number beside "Questions" would read as
// a count of questions. The overview's desk says what each one is. Answered
// only for this plugin's own three entries, and only to whoever administers
// the open batch; everybody else's rail is untouched.

const styles = stylex.create({
  dot: {
    flexShrink: 0,
    width: 7,
    height: 7,
    marginLeft: 'auto',
    borderRadius: '9999px',
    backgroundColor: tokens.warning,
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
  const { format } = useI18n()
  // the bar above the rail has read the batch already; this is its answer
  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
    enabled: isRecordId(batchId),
  })
  const alerts = useAdminAlerts(batchId, detail.data?.batch.capabilities.manage === true)
  if (!entryAlerted(alerts, navigationId)) return null
  // named, so the entry reads as one that needs attention to whoever
  // hears the rail rather than sees it
  return (
    <span
      role="img"
      aria-label={format(m.railAlert)}
      data-testid="rail-alert"
      data-navigation={navigationId}
      {...stylex.props(styles.dot)}
    />
  )
}
