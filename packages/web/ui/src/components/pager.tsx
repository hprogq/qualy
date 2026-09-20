'use client'

import { Pagination } from '@mantine/core'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'

// Pages by number, at the foot of a list somebody walks around in: first,
// last, the ones either side of here. It draws nothing for a list that fits
// on one page - a lone "1" is a control that does nothing.
//
// The words are the caller's: this is a primitive, and it carries no copy.

const styles = stylex.create({
  seat: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  summary: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  spacer: { flexGrow: 1 },
})

export function Pager({
  page,
  pageSize,
  total,
  onPage,
  summary,
  label,
  disabled = false,
  testId,
}: {
  /** counted from one */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  /** said at the start of the strip: how many there are, which of them are shown */
  summary?: string
  /** spoken name of the navigation */
  label: string
  disabled?: boolean
  testId?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div
      {...stylex.props(styles.seat)}
      data-testid={testId}
      data-page={page}
      data-pages={pages}
      data-total={total}
    >
      {summary !== undefined && <span {...stylex.props(styles.summary)}>{summary}</span>}
      <span {...stylex.props(styles.spacer)} />
      {pages > 1 && (
        <Pagination
          aria-label={label}
          size="sm"
          radius="md"
          siblings={1}
          boundaries={1}
          total={pages}
          value={Math.min(page, pages)}
          onChange={onPage}
          disabled={disabled}
          withEdges={false}
        />
      )}
    </div>
  )
}
