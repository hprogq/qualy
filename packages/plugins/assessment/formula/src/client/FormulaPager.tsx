import { useRef } from 'react'
import { Pager } from '@qualy/ui/pager'
import { CardFoot } from '@qualy/ui/screen'
import { useIsBelow } from '@qualy/ui/use-mobile'
import * as m from '#messages'

export function FormulaPager({
  result,
  busy,
  onPage,
  testId = 'formula-pager',
}: {
  result: { page: number; pageSize: number; total: number }
  busy: boolean
  onPage: (page: number) => void
  testId?: string
}) {
  const seat = useRef<HTMLDivElement>(null)
  const compact = useIsBelow(600)
  const { page, pageSize, total } = result
  if (total === 0) return null

  return (
    <div ref={seat}>
      <CardFoot>
        <Pager
          testId={testId}
          label={m.pagination_label()}
          previousLabel={m.pagination_previous()}
          nextLabel={m.pagination_next()}
          page={page}
          pageSize={pageSize}
          total={total}
          disabled={busy}
          compact={compact}
          summary={m.pagination_summary({ total })}
          onPage={(next) => {
            const results = seat.current?.closest<HTMLElement>('[data-formula-results]')
            results?.focus({ preventScroll: true })
            results?.querySelector('[data-history-list]')?.scrollTo({ top: 0 })
            results?.scrollIntoView({ block: 'nearest' })
            onPage(next)
          }}
        />
      </CardFoot>
    </div>
  )
}
