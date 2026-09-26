import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { TriangleAlertIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Pager } from '@qualy/ui/pager'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { UnitPath } from '@qualy/ui/unit-path'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'

// A route that finds some of the roster nowhere, said under the route while
// it is being composed (§32.93).
//
// Every step asks for a kind of unit, and some people on the roster sit
// under none of them: their submission - or their appeal, on the escalation
// route - would be refused, and no appointment mends it. Said in amber and
// not as a fault that holds the save: the route may be right and the roster
// the thing to change, and the two are changed in either order. Who they
// are is a press away, a page at a time.

const styles = stylex.create({
  notice: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
    paddingInline: 12,
    paddingBlock: 8,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 10%, transparent)`,
  },
  words: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '16rem',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.warningForeground,
  },
  icon: { width: 14, height: 14, flexShrink: 0, marginTop: 2 },
  list: {
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
      default: 'minmax(0, 1fr) minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
    alignItems: 'center',
    columnGap: 16,
    rowGap: 4,
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  place: {
    color: tokens.mutedForeground,
    paddingInlineStart: { default: 0, [breakpoints.phone]: 42 },
  },
  waiting: { display: 'flex', flexDirection: 'column', gap: 10 },
  waitingRow: { height: 36, borderRadius: 8 },
  foot: { paddingTop: 4 },
})

/** the unit kinds a route asks for, and the round they are asked of */
interface Asked {
  readonly batchId: string
  readonly chain: 'normal' | 'escalation'
  readonly levels: readonly string[]
}

const queryFor = (asked: Asked, page: number) => ({
  params: { batchId: asked.batchId },
  query: { nodeTypeIds: [...asked.levels], page: String(page) },
})

export function RouteReach(asked: Asked) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  const [open, setOpen] = useState(false)
  const shown = useLingering(open ? asked : null)
  // The first page, which is also what the notice counts: one read for
  // both. A reader who may not manage the roster is refused, and is told
  // nothing rather than something went wrong.
  const first = useQuery({
    ...query.assessment.listUnreachableParticipants.queryOptions(queryFor(asked, 1)),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const total = first.isError ? 0 : (first.data?.total ?? 0)
  if (total === 0) return null

  return (
    <>
      <div
        {...stylex.props(styles.notice)}
        data-testid="route-reach"
        data-route={asked.chain}
        data-count={total}
      >
        <p {...stylex.props(styles.words)}>
          <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon)} />
          <span>
            {format(asked.chain === 'normal' ? m.itemsReachNormal : m.itemsReachEscalation, {
              count: total,
            })}
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {format(m.itemsReachView)}
        </Button>
      </div>
      {shown !== null && (
        <UnreachableDialog asked={shown} open={open} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function UnreachableDialog({
  asked,
  open,
  onClose,
}: {
  asked: Asked
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  onClose: () => void
}) {
  const { format, formatError } = useI18n()
  const query = useApiQuery(assessmentApi)
  const [page, setPage] = useState(1)
  const people = useQuery({
    ...query.assessment.listUnreachableParticipants.queryOptions(queryFor(asked, page)),
    placeholderData: keepPreviousData,
  })
  const rows = people.data?.items ?? []
  const total = people.data?.total ?? 0
  const size = people.data?.pageSize ?? 10
  const at = people.data?.page ?? page

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="route-reach-dialog" size="40rem">
        <DialogHeader>
          <DialogTitle>
            {format(
              asked.chain === 'normal' ? m.itemsReachTitleNormal : m.itemsReachTitleEscalation,
            )}
          </DialogTitle>
          <DialogDescription>{format(m.itemsReachHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AsyncSection
            pending={people.isPending}
            error={people.isError ? formatError(people.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void people.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
              </div>
            }
          >
            <ul {...stylex.props(styles.list)} data-testid="route-reach-list">
              {rows.map((row) => {
                // the root every one of them shares says nothing about any
                const units = row.unitPath.filter((name): name is string => name !== null)
                const place = units.length > 1 ? units.slice(1) : units
                return (
                  <li
                    key={row.participantId}
                    {...stylex.props(styles.row)}
                    data-testid="route-reach-person"
                    data-participant={row.participantId}
                  >
                    <PersonCell name={row.displayName} secondary={row.businessNo ?? undefined} />
                    {place.length > 0 && <UnitPath steps={place} xstyle={styles.place} />}
                  </li>
                )
              })}
            </ul>
            {total > size && (
              <div {...stylex.props(styles.foot)}>
                <Pager
                  testId="route-reach-pager"
                  label={format(m.rosterPagerLabel)}
                  previousLabel={format(m.previousPage)}
                  nextLabel={format(m.nextPage)}
                  page={at}
                  pageSize={size}
                  total={total}
                  compact
                  disabled={people.isFetching}
                  summary={format(m.rosterPageSummary, {
                    from: (at - 1) * size + 1,
                    to: (at - 1) * size + rows.length,
                    total,
                  })}
                  onPage={setPage}
                />
              </div>
            )}
          </AsyncSection>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
