import { useId, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, TriangleAlertIcon } from 'lucide-react'
import { PageLink, usePageHref } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'
import { Tag } from './editor/Rows.tsx'

// Review that has stopped for want of a reviewer, said in one line with the
// way to the details and the way to fix it. Amber and not red: nothing is
// wrong with how the round is set up, somebody is missing from a unit. The
// rows are a press away rather than laid out on arrival, because the page
// under this is the paper, and it has to start near the top.

const styles = stylex.create({
  // the triangle says "waiting", in the colour everything waiting is said in
  // centred on the line with the buttons, which is taller than the words
  icon: { marginTop: 6, color: tokens.warning },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
  },
  summary: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '16rem' },
  actions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
  chevron: { transitionProperty: 'transform', transitionDuration: '120ms' },
  chevronOpen: { transform: 'rotate(180deg)' },
  detail: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(8rem, 1fr) minmax(0, 1.4fr) auto',
      [breakpoints.phone]: 'minmax(0, 1fr) auto',
    },
    columnGap: 16,
    rowGap: 4,
    alignItems: 'center',
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
    color: tokens.foreground,
  },
  unit: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  unitName: { minWidth: 0, overflowWrap: 'anywhere' },
  unitNone: { color: tokens.mutedForeground },
  why: { fontSize: 12, color: tokens.mutedForeground },
  roles: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    gap: 4,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 2 },
  },
  count: {
    justifySelf: 'end',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    gridColumn: { default: null, [breakpoints.phone]: 2 },
    gridRow: { default: null, [breakpoints.phone]: 1 },
  },
  hint: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
})

export interface ReviewGap {
  readonly nodeId: string | null
  readonly nodeName: string | null
  readonly roleNames: readonly string[]
  readonly reason: 'no-assignee' | 'no-independent-reviewer' | 'panel-seat-unfilled'
  readonly waiting: number
}

export function ReviewGapNotice({
  batchId,
  groups,
  canAppoint,
}: {
  batchId: string
  /** where review waits, one row per unit, roles and reason */
  groups: readonly ReviewGap[]
  /** the reader may put people into the round's roles, so the way there is theirs */
  canAppoint: boolean
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const detailId = useId()
  // the roles are given out on the round's people page; a reader who cannot
  // reach it is not offered a way that ends at a closed door
  const appointHref = usePageHref('assessment/batch-access', { params: { batchId } })
  if (groups.length === 0) return null
  const waiting = groups.reduce((total, one) => total + one.waiting, 0)
  const units = new Set(groups.map((one) => one.nodeId ?? '')).size

  return (
    <Alert
      data-testid="review-gap-notice"
      data-waiting={waiting}
      data-groups={groups.length}
      data-open={open}
    >
      <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon)} />
      <AlertTitle>
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.summary)}>
            {format(m.itemsStuckSummary, { waiting, units })}
          </span>
          <span {...stylex.props(styles.actions)}>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={() => setOpen((was) => !was)}
            >
              {format(open ? m.itemsStuckHide : m.itemsStuckShow)}
              <ChevronDownIcon
                aria-hidden
                {...stylex.props(styles.chevron, open && styles.chevronOpen)}
              />
            </Button>
            {canAppoint && appointHref !== undefined && (
              <Button size="sm" variant="outline" asChild>
                <PageLink page="assessment/batch-access" params={{ batchId }}>
                  {format(m.itemsStuckAppoint)}
                </PageLink>
              </Button>
            )}
          </span>
        </div>
      </AlertTitle>
      {open && (
        <AlertDescription id={detailId}>
          <div {...stylex.props(styles.detail)}>
            <ul {...stylex.props(styles.rows)}>
              {groups.map((row) => (
                <li
                  key={`${row.nodeId ?? ''}:${row.roleNames.join(',')}:${row.reason}`}
                  {...stylex.props(styles.row)}
                  data-testid="review-gap-row"
                  data-node={row.nodeId ?? ''}
                  data-reason={row.reason}
                  data-count={row.waiting}
                >
                  <span {...stylex.props(styles.unit)}>
                    {/* a step can stop at no unit at all, when nobody anywhere
                        above the person holds the duty; that is said as what it
                        is rather than as an empty name */}
                    <span
                      {...stylex.props(styles.unitName, row.nodeName === null && styles.unitNone)}
                    >
                      {row.nodeName ?? format(m.itemsStuckNowhere)}
                    </span>
                    {/* a staffing gap and a recusal rule call for different
                        fixes, so the row says which one it is looking at */}
                    {row.reason !== 'no-assignee' && (
                      <span {...stylex.props(styles.why)}>
                        {format(
                          row.reason === 'panel-seat-unfilled'
                            ? m.itemsStuckSeat
                            : m.itemsStuckConflict,
                        )}
                      </span>
                    )}
                  </span>
                  <span {...stylex.props(styles.roles)}>
                    {row.roleNames.map((name) => (
                      <Tag key={name}>{name}</Tag>
                    ))}
                  </span>
                  <span {...stylex.props(styles.count)}>
                    {format(m.itemsStuckCount, { count: row.waiting })}
                  </span>
                </li>
              ))}
            </ul>
            <p {...stylex.props(styles.hint)}>{format(m.itemsStuckHint)}</p>
          </div>
        </AlertDescription>
      )}
    </Alert>
  )
}
