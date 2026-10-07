import { useRef } from 'react'
import { Pager } from '@qualy/ui/pager'
import { CardFoot } from '@qualy/ui/screen'
import { useIsBelow } from '@qualy/ui/use-mobile'
import * as m from '#messages'

export function RecordPager({
  result,
  busy,
  target,
  onPage,
}: {
  result: { page: number; pageSize: number; total: number; items: readonly unknown[] }
  busy: boolean
  target: string
  onPage: (page: number) => void
}) {
  const seat = useRef<HTMLDivElement>(null)
  const compact = useIsBelow(480)
  const { page, pageSize, total, items } = result
  return (
    <div ref={seat}>
      <CardFoot>
        <Pager
          testId={`${target}-pager`}
          label={m.record_pages()}
          previousLabel={m.action_previousPage()}
          nextLabel={m.action_nextPage()}
          page={page}
          pageSize={pageSize}
          total={total}
          disabled={busy}
          compact={compact}
          summary={m.record_pageSummary({
            from: total === 0 ? 0 : (page - 1) * pageSize + 1,
            to: (page - 1) * pageSize + items.length,
            total,
          })}
          onPage={(next) => {
            const results = seat.current?.ownerDocument.querySelector<HTMLElement>(
              `[data-testid="${target}"]`,
            )
            results?.focus({ preventScroll: true })
            results?.scrollIntoView({ block: 'start' })
            onPage(next)
          }}
        />
      </CardFoot>
    </div>
  )
}
