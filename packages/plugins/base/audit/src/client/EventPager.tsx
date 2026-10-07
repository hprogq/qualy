import { useRef } from 'react'
import { Pager } from '@qualy/ui/pager'
import { CardFoot } from '@qualy/ui/screen'
import { useIsBelow } from '@qualy/ui/use-mobile'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { auditApi } from './api.ts'
import * as m from '#messages'

export function EventPager({
  result,
  busy,
  onPage,
}: {
  result: ApiResult<typeof auditApi, 'audit', 'listAuditEvents'>
  busy: boolean
  onPage: (page: number) => void
}) {
  const seat = useRef<HTMLDivElement>(null)
  const compact = useIsBelow(480)
  const { page, pageSize, total, items } = result
  return (
    <div ref={seat}>
      <CardFoot>
        <Pager
          testId="audit-pager"
          label={m.events_pager()}
          previousLabel={m.events_previousPage()}
          nextLabel={m.events_nextPage()}
          page={page}
          pageSize={pageSize}
          total={total}
          disabled={busy}
          compact={compact}
          summary={m.events_pageSummary({
            from: total === 0 ? 0 : (page - 1) * pageSize + 1,
            to: (page - 1) * pageSize + items.length,
            total,
          })}
          onPage={(next) => {
            const results = seat.current?.closest<HTMLElement>('[data-testid="audit-results"]')
            results?.focus({ preventScroll: true })
            results?.scrollIntoView({ block: 'start' })
            onPage(next)
          }}
        />
      </CardFoot>
    </div>
  )
}
