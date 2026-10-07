import type { PageNotice } from '@qualy/ui/page-notices'
import { BatchNotices } from '../batch/BatchNotices.tsx'
import * as m from '#messages'

export function RosterNotices({
  placements,
  cannotSubmit,
  onPlacements,
  onUnreachable,
}: {
  placements: { readonly changedTotal: number; readonly unavailableTotal: number } | null
  cannotSubmit: number | null
  onPlacements: () => void
  onUnreachable: () => void
}) {
  const notices: PageNotice[] = []
  if (cannotSubmit !== null && cannotSubmit > 0)
    notices.push({
      id: 'unreachable',
      testId: 'unreachable-notice',
      tone: 'warning',
      label: m.roster_unreachablePrompt({ count: cannotSubmit }),
      actionLabel: m.roster_unreachableOpen(),
      onSelect: onUnreachable,
      attributes: { 'data-count': cannotSubmit },
    })
  if (placements !== null && (placements.changedTotal > 0 || placements.unavailableTotal > 0))
    notices.push({
      id: 'placements',
      testId: 'placement-notice',
      tone: placements.changedTotal > 0 ? 'warning' : 'info',
      label:
        placements.changedTotal > 0
          ? m.placement_prompt({ count: placements.changedTotal })
          : m.placement_unavailablePrompt({ count: placements.unavailableTotal }),
      actionLabel: m.placement_open(),
      onSelect: onPlacements,
      attributes: {
        'data-changed': placements.changedTotal,
        'data-unavailable': placements.unavailableTotal,
      },
    })
  return <BatchNotices notices={notices} />
}
