import { BatchNoticeViewport } from '../batch/BatchNoticeViewport.tsx'
import { BatchNotices } from '../batch/BatchNotices.tsx'
import * as m from '#messages'

export function AccessSyncNotice({
  pendingTotal,
  lapsedTotal,
  onOpen,
}: {
  pendingTotal: number
  lapsedTotal: number
  onOpen: () => void
}) {
  const decide = pendingTotal > 0
  if (pendingTotal === 0 && lapsedTotal === 0) return null
  return (
    <BatchNoticeViewport>
      <BatchNotices
        notices={[
          {
            id: 'access',
            testId: 'access-sync-notice',
            tone: decide ? 'warning' : 'info',
            label: decide
              ? m.access_syncPendingCount({ count: pendingTotal })
              : m.access_syncLapsedCount({ count: lapsedTotal }),
            actionLabel: m.access_syncOpen(),
            onSelect: onOpen,
            attributes: {
              'data-kind': decide ? 'decide' : 'lapsed',
              'data-pending': pendingTotal,
              'data-lapsed': lapsedTotal,
            },
          },
        ]}
      />
    </BatchNoticeViewport>
  )
}
