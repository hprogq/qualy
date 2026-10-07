import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { TriangleAlertIcon } from 'lucide-react'
import { PageLink, usePageHref } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { UnitPath } from '@qualy/ui/unit-path'

import { Tag } from './editor/Rows.tsx'
import * as m from '#messages'

// Review that has stopped for want of a reviewer, said in one line with the
// way to the details in the page heading. Details open over the paper so
// neither their arrival nor opening them moves the configuration underneath.

const styles = stylex.create({
  notice: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    lineHeight: '1.25rem',
    color: tokens.foreground,
  },
  // the triangle says "waiting", in the colour everything waiting is said in,
  // centred on the line of words beside it
  icon: { flexShrink: 0, width: 16, height: 16, color: tokens.warning },
  summary: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    margin: 0,
    color: tokens.mutedForeground,
  },
  open: { flexShrink: 0 },
  detail: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
    paddingBottom: 4,
  },
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
      default: 'minmax(8rem, 1fr) minmax(0, 1.2fr) auto',
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
  unitPath: { fontSize: 13, color: tokens.foreground },
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
})

export interface ReviewGap {
  readonly nodeId: string | null
  readonly nodeName: string | null
  /** the unit from the root down; what tells two units of one name apart */
  readonly unitPath?: readonly string[]
  readonly roleIds?: readonly string[]
  readonly roleNames: readonly string[]
  readonly reason: 'no-assignee' | 'no-independent-reviewer' | 'panel-seat-unfilled'
  readonly waiting: number
}

/**
 * Where a unit sits, without the root every unit shares: the root only says
 * which organization this is, and on a narrow line it took the room of the
 * step that tells two classes of one name apart.
 */
const placeOf = (gap: ReviewGap): readonly string[] => {
  const path = gap.unitPath ?? []
  if (path.length > 1) return path.slice(1)
  if (path.length === 1) return path
  return gap.nodeName === null ? [] : [gap.nodeName]
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
  const [open, setOpen] = useState(false)
  // the roles are given out on the round's people page; a reader who cannot
  // reach it is not offered a way that ends at a closed door
  const appointHref = usePageHref('assessment/batch-access', { params: { batchId } })
  if (groups.length === 0) return null
  const waiting = groups.reduce((total, one) => total + one.waiting, 0)
  // a step that stopped at no unit is not a unit: it is said on its own row
  const units = new Set(groups.flatMap((one) => (one.nodeId === null ? [] : [one.nodeId]))).size

  return (
    <>
      <div
        {...stylex.props(styles.notice)}
        data-testid="review-gap-notice"
        data-waiting={waiting}
        data-units={units}
        data-groups={groups.length}
        data-open={open}
      >
        <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon)} />
        <p title={m.items_stuckSummary({ waiting, units })} {...stylex.props(styles.summary)}>
          {m.items_stuckShort({ count: waiting })}
        </p>
        <Button
          size="xs"
          variant="outline"
          aria-haspopup="dialog"
          className={stylex.props(styles.open).className}
          onClick={() => setOpen(true)}
        >
          {m.items_stuckShow()}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="48rem" data-testid="review-gap-details">
          <DialogHeader>
            <DialogTitle>{m.items_stuckSummary({ waiting, units })}</DialogTitle>
            <DialogDescription>{m.items_stuckHint()}</DialogDescription>
          </DialogHeader>
          <div {...stylex.props(styles.detail)}>
            <ul {...stylex.props(styles.rows)}>
              {groups.map((row) => {
                const place = placeOf(row)
                return (
                  <li
                    key={`${row.nodeId ?? ''}:${row.roleNames.join(',')}:${row.reason}`}
                    {...stylex.props(styles.row)}
                    data-testid="review-gap-row"
                    data-node={row.nodeId ?? ''}
                    data-place={place.join('/')}
                    data-reason={row.reason}
                    data-count={row.waiting}
                  >
                    <span {...stylex.props(styles.unit)}>
                      {/* a step can stop at no unit at all, when nobody anywhere
                        above the person holds the duty; that is said as what
                        it is rather than as an empty name */}
                      {row.nodeId === null || place.length === 0 ? (
                        <span {...stylex.props(styles.unitName, styles.unitNone)}>
                          {m.items_stuckNowhere()}
                        </span>
                      ) : (
                        <UnitPath steps={place} emphasis="last" xstyle={styles.unitPath} />
                      )}
                      {/* a staffing gap and a recusal rule call for different
                        fixes, so the row says which one it is looking at */}
                      {row.reason !== 'no-assignee' && (
                        <span {...stylex.props(styles.why)}>
                          {(row.reason === 'panel-seat-unfilled'
                            ? m.items_stuckSeat
                            : m.items_stuckConflict)()}
                        </span>
                      )}
                    </span>
                    <span {...stylex.props(styles.roles)}>
                      {row.roleNames.map((name) => (
                        <Tag key={name}>{name}</Tag>
                      ))}
                    </span>
                    <span {...stylex.props(styles.count)}>
                      {m.items_stuckCount({ count: row.waiting })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {m.items_stuckHide()}
            </Button>
            {canAppoint && appointHref !== undefined && (
              <Button asChild>
                <PageLink
                  page="assessment/batch-access"
                  params={{ batchId }}
                  data-testid="review-gap-appoint"
                >
                  {m.items_stuckAppoint()}
                </PageLink>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
