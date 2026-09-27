import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { Input } from '@qualy/ui/input'
import { CursorPager } from '@qualy/ui/pager'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { DialogBlank } from '../DialogBlank.tsx'

// Deciding, person by person, whether the round follows the organization.
//
// Nothing is ticked to begin with and there is no way to sync everything at
// once: a page nobody opened is not a decision anybody made. Each row carries
// the fingerprint of what it showed, and a decision sends that back rather
// than a unit - the server reads where the person stands again and refuses
// if it is no longer what was shown.

/** one difference, as a page carries it */
export type PlacementDifference = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listParticipantPlacements'
>['items'][number]

/** what a decision about one member carries back */
export interface PlacementDecision {
  participantId: string
  observedFingerprint: string
  decision: 'sync' | 'keep'
}

const PAGE_SIZE = 20

const CHANGE_LABELS = {
  placement: m.placementChangePlacement,
  ancestry: m.placementChangeAncestry,
  'user-type': m.placementChangeUserType,
} as const

const UNAVAILABLE_LABELS = {
  gone: m.placementGone,
  disabled: m.placementDisabled,
  unplaced: m.placementUnplaced,
} as const

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // as tall as what it holds, up to a ceiling where the list scrolls
  panel: { maxHeight: 'min(90dvh, 52rem)' },
  body: { gap: 12 },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 88, width: '100%' },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  // a cost of the sync, in the colour of something to weigh
  cost: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    fontSize: 12.5,
    lineHeight: '1.125rem',
    color: tokens.warningForeground,
  },
  costMark: { width: 14, height: 14, flexShrink: 0, marginTop: 2, color: tokens.warning },
  // The differences' own box, laid out as the people pickers lay theirs: a
  // bar that takes the whole page in or out over the rows, and the rows
  // the one part that scrolls, so the bar and the way through the pages
  // below stay where they are.
  frame: {
    display: 'flex',
    minHeight: '12rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  pageBar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
    paddingInline: 16,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 -1px 0 ${tokens.divider}`,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  pageBarTake: { cursor: 'pointer' },
  pageBarWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pageBarTotal: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  list: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    listStyle: 'none',
  },
  // the box in a column of its own, so every row's words start at one edge
  row: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr)',
    columnGap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  rowChosen: { backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)` },
  tick: { display: 'flex', height: 20, alignItems: 'center' },
  main: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  who: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  name: { minWidth: 0, fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  number: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  sides: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: 12,
    rowGap: 4,
    margin: 0,
    fontSize: 13,
    lineHeight: '1.25rem',
  },
  side: { color: tokens.mutedForeground },
  where: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  whereNow: { color: tokens.foreground },
  // the kind of person after the way down to them: a hairline, not a dot
  rule: {
    display: 'inline-block',
    width: 1,
    height: '0.85em',
    marginInline: 8,
    verticalAlign: '-0.1em',
    backgroundColor: `color-mix(in oklab, ${QUIET} 40%, transparent)`,
  },
  actions: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  // how many are chosen and the way through the pages, under the list as
  // the pickers have them
  foot: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 6,
    minHeight: 32,
  },
  chosen: { fontSize: 13, color: tokens.foreground, fontVariantNumeric: 'tabular-nums' },
  chosenNone: { color: tokens.mutedForeground },
  clear: { height: 24, paddingInline: 6, fontSize: 12.5 },
  pages: { display: 'flex', minWidth: 0, flexGrow: 1, flexBasis: '10rem' },
})

export function PlacementDialog({
  batchId,
  open,
  pending,
  onDecide,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onDecide: (decisions: readonly PlacementDecision[], reason: string) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const failures = useLoadFailure()
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  // kept across pages: a row ticked on page one is still ticked from page three
  const [chosen, setChosen] = useState<ReadonlyMap<string, PlacementDifference>>(new Map())
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) return
    setCursors([undefined])
    setPageIndex(0)
    setChosen(new Map())
    setReason('')
  }, [open])

  const differences = useQuery({
    ...query.assessment.listParticipantPlacements.queryOptions({
      params: { batchId },
      query: {
        ...(cursors[pageIndex] !== undefined ? { cursor: cursors[pageIndex] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
    enabled: open,
  })

  const nextCursor = differences.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[pageIndex + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor])
  }, [nextCursor, pageIndex, cursors])

  // a decision that has been sent leaves the list; so does its tick
  const items = differences.data?.items ?? []
  // nothing left to decide, once the answer is in: somebody settled it
  // first, or the last decision here settled it
  const quiet = differences.data !== undefined && items.length === 0
  const decidable = items.filter((row) => row.observedFingerprint !== null)
  const selected = [...chosen.values()]
  const syncable = selected.length > 0 && selected.every((row) => row.canSync)

  const toggle = (row: PlacementDifference) =>
    setChosen((current) => {
      const next = new Map(current)
      if (next.has(row.participantId)) next.delete(row.participantId)
      else next.set(row.participantId, row)
      return next
    })

  // the page in or out as a whole: only the rows a decision can be made
  // about, and nothing chosen on another page is let go by it
  const takenHere = decidable.filter((row) => chosen.has(row.participantId)).length
  const pageState: boolean | 'indeterminate' =
    takenHere === 0 ? false : takenHere === decidable.length ? true : 'indeterminate'
  const takePage = (take: boolean) =>
    setChosen((current) => {
      const next = new Map(current)
      for (const row of decidable) {
        if (take) next.set(row.participantId, row)
        else next.delete(row.participantId)
      }
      return next
    })
  const total = (differences.data?.changedTotal ?? 0) + (differences.data?.unavailableTotal ?? 0)

  const decide = (rows: readonly PlacementDifference[], decision: 'sync' | 'keep') => {
    onDecide(
      rows.map((row) => ({
        participantId: row.participantId,
        observedFingerprint: row.observedFingerprint ?? '',
        decision,
      })),
      reason.trim(),
    )
    setChosen((current) => {
      const next = new Map(current)
      for (const row of rows) next.delete(row.participantId)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="placement-dialog" size="48rem" xstyle={styles.panel}>
        <DialogHeader>
          <DialogTitle>{format(m.placementTitle)}</DialogTitle>
          {!quiet && <DialogDescription>{format(m.placementHint)}</DialogDescription>}
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <AsyncSection
            pending={differences.isPending}
            error={differences.isError ? failures.of(differences.error) : null}
            retrying={differences.isFetching}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void differences.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
              </div>
            }
          >
            {quiet ? (
              <DialogBlank
                testId="placement-quiet"
                icon={<CircleCheckIcon />}
                title={format(m.placementQuiet)}
                description={format(m.placementQuietHint)}
              />
            ) : (
              <>
                {decidable.length > 0 && (
                  <Field label={format(m.placementReason)}>
                    {(id) => (
                      <Input
                        id={id}
                        value={reason}
                        maxLength={500}
                        placeholder={format(m.placementReasonPlaceholder)}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    )}
                  </Field>
                )}
                <div {...stylex.props(styles.frame)}>
                  {decidable.length > 0 ? (
                    <label {...stylex.props(styles.pageBar, styles.pageBarTake)}>
                      <Checkbox
                        checked={pageState}
                        disabled={pending}
                        aria-label={format(m.placementSelectPage)}
                        data-testid="placement-page"
                        onCheckedChange={takePage}
                      />
                      <span {...stylex.props(styles.pageBarWord)}>
                        {format(m.placementSelectPage)}
                      </span>
                      <span {...stylex.props(styles.pageBarTotal)}>
                        {format(m.placementTotal, { count: total })}
                      </span>
                    </label>
                  ) : (
                    <div {...stylex.props(styles.pageBar)}>
                      <span {...stylex.props(styles.pageBarTotal)}>
                        {format(m.placementTotal, { count: total })}
                      </span>
                    </div>
                  )}
                  <ul {...stylex.props(styles.list)} data-testid="placement-list">
                    {items.map((row) => (
                      <DifferenceRow
                        key={row.participantId}
                        row={row}
                        chosen={chosen.has(row.participantId)}
                        disabled={pending}
                        onToggle={() => toggle(row)}
                        onDecide={(decision) => decide([row], decision)}
                      />
                    ))}
                  </ul>
                </div>
              </>
            )}
          </AsyncSection>
          {(items.length > 0 || pageIndex > 0) && (
            <div {...stylex.props(styles.foot)}>
              <span
                {...stylex.props(styles.chosen, selected.length === 0 && styles.chosenNone)}
                data-testid="placement-selected"
                data-count={selected.length}
              >
                {format(m.placementSelected, { count: selected.length })}
              </span>
              {selected.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={stylex.props(styles.clear).className}
                  onClick={() => setChosen(new Map())}
                >
                  {format(m.placementClear)}
                </Button>
              )}
              <span {...stylex.props(styles.pages)}>
                <CursorPager
                  testId="placement-pager"
                  label={format(m.rosterPagerLabel)}
                  previousLabel={format(m.previousPage)}
                  nextLabel={format(m.nextPage)}
                  page={pageIndex + 1}
                  hasNext={nextCursor !== null}
                  disabled={differences.isFetching}
                  onPrevious={() => setPageIndex((at) => Math.max(0, at - 1))}
                  onNext={() => setPageIndex((at) => at + 1)}
                />
              </span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {quiet && pageIndex === 0 ? (
            // nothing to decide: the way out, not two choices about nobody
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.close)}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={pending || selected.length === 0}
                onClick={() => decide(selected, 'keep')}
              >
                {format(m.placementKeepSelected)}
              </Button>
              <Button disabled={pending || !syncable} onClick={() => decide(selected, 'sync')}>
                {format(m.placementSyncSelected)}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** the units from the top down, as far as this reader may see them */
const pathOf = (units: PlacementDifference['frozen']['units']) =>
  units
    .map((unit) => unit.name)
    .filter((name): name is string => name !== null)
    .join(' / ')

function DifferenceRow({
  row,
  chosen,
  disabled,
  onToggle,
  onDecide,
}: {
  row: PlacementDifference
  chosen: boolean
  disabled: boolean
  onToggle: () => void
  onDecide: (decision: 'sync' | 'keep') => void
}) {
  const { format } = useI18n()
  const typed = row.changes.includes('user-type')
  const decidable = row.observedFingerprint !== null
  // the way down to them, and their kind after it where the kind is what
  // changed
  const said = (view: PlacementDifference['frozen']) => (
    <>
      <span>{pathOf(view.units)}</span>
      {typed && view.userType.name !== null && (
        <>
          {' '}
          <span aria-hidden {...stylex.props(styles.rule)} />
          <span>{view.userType.name}</span>
        </>
      )}
    </>
  )

  return (
    <li
      data-testid="placement-difference"
      data-participant={row.participantId}
      data-standing={row.standing}
      data-changes={row.changes.join(',')}
      data-can-sync={String(row.canSync)}
      data-chosen={chosen}
      {...stylex.props(styles.row, chosen && styles.rowChosen)}
    >
      <span {...stylex.props(styles.tick)}>
        {decidable && (
          <Checkbox
            checked={chosen}
            disabled={disabled}
            aria-label={format(m.placementSelectOne, { name: row.displayName })}
            onCheckedChange={onToggle}
          />
        )}
      </span>
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.who)}>
          <span {...stylex.props(styles.name)}>{row.displayName}</span>
          {row.businessNo !== null && (
            <span {...stylex.props(styles.number)}>{row.businessNo}</span>
          )}
          {row.changes.map((change) => (
            <Badge key={change} variant="secondary">
              {format(CHANGE_LABELS[change])}
            </Badge>
          ))}
        </div>
        <dl {...stylex.props(styles.sides)}>
          <dt {...stylex.props(styles.side)}>{format(m.placementRound)}</dt>
          <dd {...stylex.props(styles.where)}>{said(row.frozen)}</dd>
          <dt {...stylex.props(styles.side)}>{format(m.placementCurrent)}</dt>
          <dd {...stylex.props(styles.where, styles.whereNow)}>
            {row.unavailable !== null
              ? format(UNAVAILABLE_LABELS[row.unavailable])
              : row.current !== null
                ? said(row.current)
                : format(m.placementBeyond)}
          </dd>
        </dl>
        {row.unavailable !== null && (
          <span {...stylex.props(styles.aside)}>{format(m.placementUnavailableHint)}</span>
        )}
        {row.currentBeyondReach && (
          <span {...stylex.props(styles.aside)}>{format(m.placementBeyondHint)}</span>
        )}
        {/* what syncing would cost them, said before anybody presses it */}
        {row.canSync && row.closedBySync !== null && row.closedBySync > 0 && (
          <span
            data-testid="placement-unfileable"
            data-count={row.closedBySync}
            {...stylex.props(styles.cost)}
          >
            <TriangleAlertIcon aria-hidden {...stylex.props(styles.costMark)} />
            {format(m.placementUnfileable, { count: row.closedBySync })}
          </span>
        )}
        {decidable && (
          <div {...stylex.props(styles.actions)}>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onDecide('keep')}
            >
              {format(m.placementKeep)}
            </Button>
            {row.canSync && (
              <Button size="sm" disabled={disabled} onClick={() => onDecide('sync')}>
                {format(m.placementSync)}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
