import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
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
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { inCatalogOrder, permissionLabel } from './permissions.ts'
import type { AccessChange, AccessSelection } from './model.ts'

// Choosing what to take from the organization, one capability at a time.
//
// Nothing is ticked to begin with, and only what is ticked is merged. The
// alternative - everything ticked by default - would promise to merge pages
// the reader never opened, and a page they never saw is not a decision they
// made.
//
// Withdrawals are listed without a checkbox: they took effect when the
// organization made them, and offering to approve what already happened would
// be a lie about who is in control.

const PAGE_SIZE = 20

/** the identity of one change, which is what a selection is keyed by */
const keyOf = (change: AccessChange) => `${change.kind}/${change.id}`

const styles = stylex.create({
  body: { gap: 36 },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 56, width: '100%' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  list: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  foot: { justifyContent: { default: null, '@media (min-width: 640px)': 'space-between' } },
  footSide: { display: 'flex', alignItems: 'center', gap: 8 },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  who: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  name: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
  permissions: { display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  struck: {
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
  },
  choice: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '1.25rem' },
})

export function AccessSyncDialog({
  batchId,
  open,
  pending,
  onMerge,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onMerge: (selection: AccessSelection) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()

  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  // kept across pages: a change ticked on page one is still ticked when the
  // merge is sent from page three
  const [chosen, setChosen] = useState<ReadonlyMap<string, readonly string[]>>(new Map())

  useEffect(() => {
    if (open) return
    setCursors([undefined])
    setPageIndex(0)
    setChosen(new Map())
  }, [open])

  const changes = useQuery({
    ...query.assessment.previewAccessSync.queryOptions({
      params: { batchId },
      query: {
        ...(cursors[pageIndex] !== undefined ? { cursor: cursors[pageIndex] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
    enabled: open,
  })

  const nextCursor = changes.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[pageIndex + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor])
  }, [nextCursor, pageIndex, cursors])

  const items = changes.data?.items ?? []
  const decidable = items.filter((change) => change.kind !== 'lapsed')
  const selectedCount = [...chosen.values()].filter((codes) => codes.length > 0).length
  // Nothing here needs deciding, so the button is not an approval: it puts the
  // withdrawal down. Sending it with nothing ticked is what clears the record
  // the organization has already made obsolete.
  const onlyWithdrawals =
    (changes.data?.pendingTotal ?? 0) === 0 && (changes.data?.lapsedTotal ?? 0) > 0

  const toggle = (change: AccessChange, code: string) => {
    setChosen((current) => {
      const next = new Map(current)
      const held = new Set(next.get(keyOf(change)) ?? [])
      if (held.has(code)) held.delete(code)
      else held.add(code)
      if (held.size === 0) next.delete(keyOf(change))
      else next.set(keyOf(change), [...held])
      return next
    })
  }

  const takeWholePage = () => {
    setChosen((current) => {
      const next = new Map(current)
      for (const change of decidable) next.set(keyOf(change), [...change.permissions])
      return next
    })
  }

  const merge = () =>
    onMerge({
      accept: [...chosen.entries()].flatMap(([key, permissions]) => {
        const [kind, id] = key.split('/')
        return kind === 'new' || kind === 'widened' ? [{ kind, id: id ?? '', permissions }] : []
      }),
    })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="access-sync" size="48rem">
        <DialogHeader>
          <DialogTitle>{format(m.accessSyncTitle)}</DialogTitle>
          <DialogDescription>{format(m.accessSyncHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          <AsyncSection
            pending={changes.isPending}
            error={changes.isError ? formatError(changes.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void changes.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <Skeleton className={stylex.props(styles.waitingRow).className} />
                <Skeleton className={stylex.props(styles.waitingRow).className} />
              </div>
            }
          >
            {items.length === 0 ? (
              <p {...stylex.props(styles.quiet)}>{format(m.accessSyncQuiet)}</p>
            ) : (
              <ul {...stylex.props(styles.list)}>
                {items.map((change) => (
                  <ChangeRow
                    key={keyOf(change)}
                    change={change}
                    chosen={chosen.get(keyOf(change)) ?? []}
                    disabled={pending}
                    onToggle={(code) => toggle(change, code)}
                  />
                ))}
              </ul>
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
                {format(m.accessSyncSelectPage)}
              </Button>
            )}
          </div>
          <div {...stylex.props(styles.footSide)}>
            {!onlyWithdrawals && (
              <span {...stylex.props(styles.aside)}>
                {format(m.accessSyncSelected, { count: selectedCount })}
              </span>
            )}
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button disabled={pending || (selectedCount === 0 && !onlyWithdrawals)} onClick={merge}>
              {format(onlyWithdrawals ? m.accessSyncClear : m.accessSyncApply)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const KIND_LABELS = {
  new: m.accessSyncNew,
  widened: m.accessSyncWidened,
  lapsed: m.accessSyncLapsed,
} as const

function ChangeRow({
  change,
  chosen,
  disabled,
  onToggle,
}: {
  change: AccessChange
  chosen: readonly string[]
  disabled: boolean
  onToggle: (code: string) => void
}) {
  const { format } = useI18n()
  const held = new Set(chosen)
  const settled = change.kind === 'lapsed'

  return (
    <li {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.who)}>
        <span {...stylex.props(styles.name)}>{change.displayName}</span>
        {change.businessNo !== null && (
          <span {...stylex.props(styles.aside)}>{change.businessNo}</span>
        )}
        {change.roleName !== '' && (
          <span {...stylex.props(styles.aside)}>
            {format(m.accessRoleAt, { role: change.roleName })}
          </span>
        )}
        <Badge variant={settled ? 'outline' : 'secondary'}>
          {format(KIND_LABELS[change.kind])}
        </Badge>
        {settled && <span {...stylex.props(styles.aside)}>{format(m.accessSyncLapsedHint)}</span>}
      </div>
      <div {...stylex.props(styles.permissions)}>
        {inCatalogOrder(change.permissions).map((code) =>
          settled ? (
            <span key={code} {...stylex.props(styles.struck)}>
              {format(permissionLabel(code))}
            </span>
          ) : (
            <label key={code} {...stylex.props(styles.choice)}>
              <Checkbox
                data-testid={`access-permission-${code}`}
                checked={held.has(code)}
                disabled={disabled}
                onCheckedChange={() => onToggle(code)}
              />
              {format(permissionLabel(code))}
            </label>
          ),
        )}
      </div>
    </li>
  )
}
