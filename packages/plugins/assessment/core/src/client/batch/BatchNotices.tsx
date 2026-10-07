import { PageNotices, type PageNotice } from '@qualy/ui/page-notices'
import type { RefObject } from 'react'
import * as m from '#messages'

export function BatchNotices({
  notices,
  alignRef,
}: {
  notices: readonly PageNotice[]
  alignRef?: RefObject<HTMLElement | null>
}) {
  return (
    <PageNotices
      notices={notices}
      alignRef={alignRef}
      label={m.pageNotices_label()}
      expandLabel={m.pageNotices_expand()}
      collapseLabel={m.pageNotices_collapse()}
    />
  )
}
