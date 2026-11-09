import { PageNotices, type PageNotice } from '@qualy/ui/page-notices'
import * as m from '#messages'

export function BatchNotices({ notices }: { notices: readonly PageNotice[] }) {
  return (
    <PageNotices
      notices={notices}
      label={m.pageNotices_label()}
      expandLabel={m.pageNotices_expand()}
      collapseLabel={m.pageNotices_collapse()}
    />
  )
}
