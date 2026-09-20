import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Who the chosen units come to, before anybody confirms them.
//
// Choosing a class is choosing the people in it today (§32.78), and until
// this list was here the only place those people appeared was the step after
// the act had already been composed - so "the 2 年级" was confirmed by
// somebody who had never seen that it meant a hundred and forty names.
//
// Read through the same door the by-name picker reads: this round's
// participants, narrowed in sql to the reader's own reach. Nothing here
// authorizes anything - the write proves every id again.

const PAGE = 20

const styles = stylex.create({
  frame: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 10,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
  },
  head: { display: 'flex', alignItems: 'baseline', gap: 8 },
  title: { margin: 0, fontSize: 13, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  note: { fontSize: 12, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  list: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    alignContent: 'start',
    gap: 2,
    gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    listStyleType: 'none',
  },
  row: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8, paddingBlock: 3 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
  },
  no: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  quiet: { fontSize: 13, color: tokens.mutedForeground },
  bones: { display: 'flex', flexDirection: 'column', gap: 8 },
})

export function UnitRoster({
  batchId,
  orgNodeIds,
  userTypeIds,
}: {
  batchId: string
  orgNodeIds: readonly string[]
  userTypeIds: readonly string[]
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const question = `${[...orgNodeIds].sort().join(',')}:${[...userTypeIds].sort().join(',')}`
  // the cursor stack carries the question it belongs to: a cursor from one
  // selection applied to another silently skips or repeats people
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question, cursors: [undefined], at: 0 })
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page

  const people = useQuery({
    ...query.assessment.listParticipants.queryOptions({
      params: { batchId },
      query: {
        status: 'active',
        orgNodeIds: [...orgNodeIds],
        orgScope: 'subtree',
        // one kind at a time is all the door takes; the act holds to every
        // kind chosen, and the office is shown the wider set here
        ...(userTypeIds.length === 1 ? { userTypeId: userTypeIds[0]! } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE),
      },
    }),
    enabled: orgNodeIds.length > 0,
  })
  const nextCursor = people.data?.nextCursor ?? null

  if (orgNodeIds.length === 0) return null
  const rows = people.data?.items ?? []
  return (
    <div {...stylex.props(styles.frame)} data-testid="unit-roster">
      <div {...stylex.props(styles.head)}>
        <p {...stylex.props(styles.title)}>{format(m.recordUnitRosterTitle)}</p>
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.note)}>{format(m.recordUnitRosterNote)}</span>
      </div>
      {people.isPending ? (
        <div {...stylex.props(styles.bones)}>
          <Skeleton height={14} width="70%" radius={4} />
          <Skeleton height={14} width="55%" radius={4} />
          <Skeleton height={14} width="62%" radius={4} />
        </div>
      ) : people.isError ? (
        <p {...stylex.props(styles.quiet)}>{formatError(people.error)}</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(styles.quiet)}>{format(m.recordUnitRosterEmpty)}</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {rows.map((row) => (
            <li key={row.id} {...stylex.props(styles.row)} data-testid="unit-roster-row">
              <span {...stylex.props(styles.name)}>{row.displayName}</span>
              {row.businessNo !== null && (
                <span {...stylex.props(styles.no)}>{row.businessNo}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(at > 0 || nextCursor !== null) && (
        <span {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.note)}>
            {format(m.recordUnitRosterPage, { page: at + 1 })}
          </span>
          <span {...stylex.props(styles.spacer)} />
          <Button
            size="sm"
            variant="outline"
            disabled={at === 0}
            onClick={() => setPaging({ question, cursors, at: Math.max(0, at - 1) })}
          >
            {format(m.previousPage)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={nextCursor === null}
            onClick={() => {
              if (nextCursor === null) return
              setPaging({
                question,
                cursors: [...cursors.slice(0, at + 1), nextCursor],
                at: at + 1,
              })
            }}
          >
            {format(m.nextPage)}
          </Button>
        </span>
      )}
    </div>
  )
}
