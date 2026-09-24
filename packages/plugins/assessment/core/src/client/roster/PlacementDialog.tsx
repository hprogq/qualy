import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
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
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

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

const styles = stylex.create({
  body: { gap: 20 },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 88, width: '100%' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  who: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  name: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
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
  actions: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  foot: {
    justifyContent: {
      default: null,
      [breakpoints.tablet]: 'space-between',
      [breakpoints.desktop]: 'space-between',
    },
  },
  footSide: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
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
  const { format, formatError } = useI18n()
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

  const takeWholePage = () =>
    setChosen((current) => {
      const next = new Map(current)
      for (const row of decidable) next.set(row.participantId, row)
      return next
    })

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
      <DialogContent data-testid="placement-dialog" size="48rem">
        <DialogHeader>
          <DialogTitle>{format(m.placementTitle)}</DialogTitle>
          <DialogDescription>{format(m.placementHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <AsyncSection
            pending={differences.isPending}
            error={differences.isError ? formatError(differences.error) : null}
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
            {items.length === 0 ? (
              <p {...stylex.props(styles.quiet)}>{format(m.placementQuiet)}</p>
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
                <ul {...stylex.props(styles.list)}>
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
              </>
            )}
          </AsyncSection>
        </DialogBody>
        <DialogFooter className={stylex.props(styles.foot).className}>
          <div {...stylex.props(styles.footSide)}>
            <Button
              size="sm"
              variant="ghost"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((at) => Math.max(0, at - 1))}
            >
              {format(m.previousPage)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={nextCursor === null}
              onClick={() => setPageIndex((at) => at + 1)}
            >
              {format(m.nextPage)}
            </Button>
            {decidable.length > 0 && (
              <Button size="sm" variant="ghost" onClick={takeWholePage}>
                {format(m.placementSelectPage)}
              </Button>
            )}
          </div>
          <div {...stylex.props(styles.footSide)}>
            <span {...stylex.props(styles.aside)}>
              {format(m.placementSelected, { count: selected.length })}
            </span>
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
          </div>
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
  const said = (view: PlacementDifference['frozen']) =>
    typed && view.userType.name !== null
      ? `${pathOf(view.units)} · ${view.userType.name}`
      : pathOf(view.units)

  return (
    <li
      data-testid="placement-difference"
      data-participant={row.participantId}
      data-standing={row.standing}
      data-changes={row.changes.join(',')}
      data-can-sync={String(row.canSync)}
      {...stylex.props(styles.row)}
    >
      <div {...stylex.props(styles.who)}>
        {decidable && (
          <Checkbox
            checked={chosen}
            disabled={disabled}
            aria-label={format(m.placementSelectOne, { name: row.displayName })}
            onCheckedChange={onToggle}
          />
        )}
        <span {...stylex.props(styles.name)}>{row.displayName}</span>
        {row.businessNo !== null && <span {...stylex.props(styles.aside)}>{row.businessNo}</span>}
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
      {decidable && (
        <div {...stylex.props(styles.actions)}>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide('keep')}>
            {format(m.placementKeep)}
          </Button>
          {row.canSync && (
            <Button size="sm" disabled={disabled} onClick={() => onDecide('sync')}>
              {format(m.placementSync)}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
