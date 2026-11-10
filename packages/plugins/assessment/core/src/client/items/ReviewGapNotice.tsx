import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApiQuery, useLoadFailure, usePageHref } from '@qualy/web-runtime'
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
import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { useQuery } from '@qualy/web-runtime/query'
import { assessmentApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'

import { Tag } from './editor/Rows.tsx'
import type { PageNotice } from '@qualy/ui/page-notices'
import { BatchNotices } from '../batch/BatchNotices.tsx'
import { BatchNoticeViewport } from '../batch/BatchNoticeViewport.tsx'
import { UnreachableDialog } from '../roster/UnreachableDialog.tsx'
import * as m from '#messages'

// Configuration and staffing warnings share the page dock; each opens its details.

const styles = stylex.create({
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
  blocked,
  canAppoint,
  cannotSubmit = 0,
  cannotAppeal = 0,
}: {
  batchId: string
  /** where review waits, one row per unit, roles and reason */
  groups: readonly ReviewGap[]
  blocked:
    | {
        readonly groupTotal: number
        readonly pageSize: number
        readonly waiting: number
        readonly units: number
      }
    | undefined
  /** the reader may put people into the round's roles, so the way there is theirs */
  canAppoint: boolean
  cannotSubmit?: number
  cannotAppeal?: number
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const query = useApiQuery(assessmentApi)
  const loadFailure = useLoadFailure()
  const detail = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({
      params: { batchId },
      query: { groupPage: String(page) },
    }),
    enabled: open && page > 1,
  })
  const changeOpen = (next: boolean) => {
    if (next) setPage(1)
    setOpen(next)
  }
  const [route, setRoute] = useState<'normal' | 'escalation' | null>(null)
  // the roles are given out on the round's people page; a reader who cannot
  // reach it is not offered a way that ends at a closed door
  const appointHref = usePageHref('assessment/batch-access', { params: { batchId } })
  const { waiting, units, groupTotal, pageSize } = blocked ?? {
    waiting: 0,
    units: 0,
    groupTotal: 0,
    pageSize: 20,
  }
  const rows = page === 1 ? groups : (detail.data?.groups ?? [])

  const notices: PageNotice[] = []
  if (cannotSubmit > 0)
    notices.push({
      id: 'cannot-submit',
      testId: 'items-unreachable-notice',
      tone: 'warning',
      label: m.roster_unreachablePrompt({ count: cannotSubmit }),
      actionLabel: m.roster_unreachableOpen(),
      onSelect: () => setRoute('normal'),
    })
  if (cannotAppeal > 0)
    notices.push({
      id: 'cannot-appeal',
      testId: 'items-unappealable-notice',
      tone: 'warning',
      label: m.roster_unreachableAppealPrompt({ count: cannotAppeal }),
      actionLabel: m.roster_unreachableOpen(),
      onSelect: () => setRoute('escalation'),
    })
  if (groupTotal > 0)
    notices.push({
      id: 'reviewers',
      testId: 'review-gap-notice',
      tone: 'warning',
      label: m.items_stuckShort({ count: waiting }),
      actionLabel: m.items_stuckShow(),
      onSelect: () => changeOpen(true),
      attributes: {
        'data-waiting': waiting,
        'data-units': units,
        'data-groups': groupTotal,
        'data-open': String(open),
      },
    })
  return (
    <>
      {notices.length > 0 && (
        <BatchNoticeViewport>
          <BatchNotices notices={notices} />
        </BatchNoticeViewport>
      )}
      <UnreachableDialog
        batchId={batchId}
        open={route !== null}
        route={route ?? 'normal'}
        onClose={() => setRoute(null)}
      />
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent size="48rem" data-testid="review-gap-details">
          <DialogHeader>
            <DialogTitle>{m.items_stuckSummary({ waiting, units })}</DialogTitle>
            <DialogDescription>{m.items_stuckHint()}</DialogDescription>
          </DialogHeader>
          <div {...stylex.props(styles.detail)}>
            <AsyncSection
              pending={page > 1 && detail.isPending}
              error={page > 1 && detail.data === undefined ? loadFailure.subject(detail) : null}
              retrying={detail.isFetching}
              onRetry={() => void detail.refetch()}
              retryLabel={commonMessages.action_retry()}
              loadingLabel={commonMessages.state_loading()}
            >
              <ul {...stylex.props(styles.rows)}>
                {rows.map((row) => {
                  const place = placeOf(row)
                  return (
                    <li
                      key={`${row.nodeId ?? ''}:${(row.roleIds ?? row.roleNames).join(',')}:${row.reason}`}
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
            </AsyncSection>
            {groupTotal > pageSize && (
              <Pager
                compact
                testId="review-gap-pager"
                label={m.items_stuckShow()}
                page={page === 1 ? 1 : (detail.data?.blocked.groupPage ?? page)}
                pageSize={pageSize}
                total={groupTotal}
                disabled={detail.isFetching}
                onPage={setPage}
              />
            )}
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
