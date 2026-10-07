import type { PageNotice } from '@qualy/ui/page-notices'
import type { RefObject } from 'react'
import { BatchNotices } from '../batch/BatchNotices.tsx'
import * as m from '#messages'

export function RosterNotices({
  placements,
  onPlacements,
  alignRef,
}: {
  placements: { readonly changedTotal: number; readonly unavailableTotal: number } | null
  onPlacements: () => void
  alignRef?: RefObject<HTMLElement | null>
}) {
  const notices: PageNotice[] = []
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
  return <BatchNotices notices={notices} alignRef={alignRef} />
}
