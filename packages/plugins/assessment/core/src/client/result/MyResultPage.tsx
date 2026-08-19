import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'
import { useApiQuery, usePageNavigate, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { EntryDto } from '../entry/model.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'

// One ledger the algorithm can be read off.
//
// The same table holds groups as tinted rows and questions as ruled lines,
// indent standing for nesting, every amount right-aligned in tabular
// figures so a column adds up by eye. A group row answers three ways at
// once - its own items, its subgroups, and what actually counts - and a
// limit that bites gets its own line with the difference written as a
// negative, never a silent clamp. Lines that score nothing stay where they
// are at 0 with the reason beside them: a page that dropped them would be
// shorter than the paper the reader filed.

export default function MyResultPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.resultTab)} description={format(m.resultHint)}>
      {(batch) => <Standing batchId={batch.id} />}
    </BatchScreen>
  )
}

/** amounts on this page speak with two decimals, the way a ledger does */
const two = (value: string | number): string => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value)
}

/**
 * The scorer answers each group after the ones inside it, so it arrives
 * child first. Read top down here; a group naming a parent that is not in
 * the response stands as its own root rather than dropping out.
 */
const inTreeOrder = <Group extends { groupId: string; parentGroupId: string | null }>(
  groups: readonly Group[],
): Group[] => {
  const present = new Set(groups.map((group) => group.groupId))
  const childrenOf = new Map<string | null, Group[]>()
  for (const group of groups) {
    const parent =
      group.parentGroupId !== null && present.has(group.parentGroupId) ? group.parentGroupId : null
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [group])
    else bucket.push(group)
  }
  const out: Group[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const group of childrenOf.get(parent) ?? []) {
      if (seen.has(group.groupId)) continue
      seen.add(group.groupId)
      out.push(group)
      walk(group.groupId)
    }
  }
  walk(null)
  return out
}

/** the ledger's four columns, shared by header, rows and footer */
const COLS = 'grid grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] items-center gap-4 px-4'

/** the shades the top groups wear in the bar and its legend, in turn */
const SEGMENT_INKS = ['bg-foreground', 'bg-foreground/60', 'bg-foreground/35'] as const

function Standing({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const result = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  // for the two counts the empty state and the pending row speak in: what is
  // still moving is a fact about the filings, not about the score
  const mine = useQuery(
    query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
  )
  const data = result.data
  // a line names its item; which group that item adds up in is the item's
  // own configuration, so no line can be placed until both have landed
  const groupOfItem = new Map((items.data?.items ?? []).map((item) => [item.id, item.scoreGroupId]))
  // Every question of the round stands in the ledger, not only the ones that
  // came to something: a page listing three of a reader's twenty questions
  // reads as a page that lost the other seventeen, and "nothing yet" is an
  // answer they need as much as an amount.
  const askedOf = new Map<string, LedgerItem[]>()
  for (const item of (items.data?.items ?? []) as readonly LedgerItem[]) {
    if (item.status === 'draft') continue
    const bucket = askedOf.get(item.scoreGroupId)
    if (bucket === undefined) askedOf.set(item.scoreGroupId, [item])
    else bucket.push(item)
  }
  for (const bucket of askedOf.values()) bucket.sort((a, b) => a.sortOrder - b.sortOrder)
  const groups = data === undefined ? [] : inTreeOrder(data.groups)
  const parents = new Set(
    groups.flatMap((group) => (group.parentGroupId === null ? [] : [group.parentGroupId])),
  )
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
  const pendingCount = entries.filter((entry) => entry.status === 'in_review').length
  const draftCount = entries.filter((entry) => entry.status === 'draft').length

  const top = groups.filter((group) => group.depth === 0)
  // the round's full marks, when every top group declares a cap; a round
  // with an uncapped top group has no honest full to print
  const full =
    top.length > 0 && top.every((group) => group.cap !== null)
      ? top.reduce((sum, group) => sum + Number(group.cap), 0)
      : null
  const total = data === undefined ? 0 : Number(data.total)
  // what limits held back, summed over every group whose cap bit
  const trimmed = groups.reduce((sum, group) => {
    const raw = Number(group.raw)
    const final = Number(group.final)
    return sum + (raw > final ? raw - final : 0)
  }, 0)
  // the bar shares one denominator so the segments mean what they show
  const denominator = full ?? (total > 0 ? total : 1)

  return (
    <AsyncSection
      pending={result.isPending || items.isPending || mine.isPending}
      error={result.error ? formatError(result.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void result.refetch()
        void items.refetch()
        void mine.refetch()
      }}
      skeleton={<Skeleton className="h-40 w-full" />}
      className="flex flex-1 flex-col"
    >
      {data !== undefined && (
        <div className="flex flex-1 flex-col gap-4.5">
          {/* the total, how it divides, and what is not in it - one band */}
          <section className="flex flex-col gap-5 rounded-2xl border p-5 sm:flex-row sm:items-stretch">
            <div className="flex shrink-0 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                  {format(m.resultTotal)}
                </p>
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {format(m.resultProvisional)}
                </Badge>
              </div>
              <p className="text-[34px] leading-none font-semibold tracking-tight tabular-nums">
                {two(data.total)}
              </p>
              {full !== null && (
                <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {format(m.resultFull, { value: two(full) })}
                </p>
              )}
            </div>
            <span aria-hidden className="hidden w-px shrink-0 bg-border sm:block" />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
                {top.map((group, index) => (
                  <span
                    key={group.groupId}
                    className={cn('shrink-0', SEGMENT_INKS[index % SEGMENT_INKS.length])}
                    style={{
                      width: `${Math.min(100, (Number(group.final) / denominator) * 100)}%`,
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {top.map((group, index) => (
                  <span
                    key={group.groupId}
                    className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 shrink-0 rounded-[2px]',
                        SEGMENT_INKS[index % SEGMENT_INKS.length],
                      )}
                    />
                    {group.name}
                    <span className="text-muted-foreground tabular-nums">{two(group.final)}</span>
                  </span>
                ))}
              </div>
            </div>
            <span aria-hidden className="hidden w-px shrink-0 bg-border sm:block" />
            <div className="flex shrink-0 flex-col justify-center gap-2">
              <SummaryRow label={format(m.resultCountedIn)} value={two(data.total)} strong />
              {/* a count, not an amount: what review will grant is not
                  decided, and a number shaped like the granted one reads as
                  a promise */}
              <SummaryRow
                label={format(m.resultPendingLabel)}
                value={format(m.resultPendingCount, { count: pendingCount })}
              />
              <SummaryRow label={format(m.resultTrimmed)} value={two(trimmed)} />
            </div>
          </section>

          {data.lines.length === 0 ? (
            // nothing counted yet: the room the ledger would take says what
            // will fill it and where the moving parts are
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-14">
              <span className="flex size-13 items-center justify-center rounded-full border text-muted-foreground">
                <BarChart3Icon aria-hidden className="size-5.5" />
              </span>
              <div className="flex max-w-md flex-col gap-2 text-center">
                <h2 className="text-lg font-semibold tracking-tight">
                  {format(m.resultEmptyTitle)}
                </h2>
                <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                  {format(m.resultEmptyBody)}
                </p>
              </div>
              <GoToEntries pending={pendingCount} drafts={draftCount} />
            </div>
          ) : (
            <>
              <div className="flex flex-col overflow-hidden rounded-2xl border">
                <div
                  className={cn(
                    COLS,
                    'border-b bg-muted/60 py-2 text-xs font-medium text-muted-foreground',
                  )}
                >
                  <span>{format(m.resultTableHead)}</span>
                  <span className="text-right">{format(m.resultGroupItems)}</span>
                  <span className="text-right">{format(m.resultGroupChildren)}</span>
                  <span className="text-right">{format(m.resultGroupFinal)}</span>
                </div>
                {groups.map((group) => {
                  const lines = data.lines.filter(
                    (line) =>
                      // the group's own adjustment is spoken by the group
                      // row's limit line below, from the same figures
                      line.kind !== 'group-adjustment' &&
                      (line.lineId.startsWith(`grp:${group.groupId}:`) ||
                        (line.itemId !== undefined &&
                          groupOfItem.get(line.itemId) === group.groupId)),
                  )
                  const spokenFor = new Set(
                    lines.flatMap((line) => (line.itemId === undefined ? [] : [line.itemId])),
                  )
                  return (
                    <GroupRows
                      key={group.groupId}
                      group={group}
                      lines={lines}
                      silent={(askedOf.get(group.groupId) ?? []).filter(
                        (item) => !spokenFor.has(item.id),
                      )}
                      hasChildren={parents.has(group.groupId)}
                    />
                  )
                })}
                <div className={cn(COLS, 'h-11 bg-muted/60')}>
                  <span className="text-sm font-semibold">{format(m.resultTotal)}</span>
                  <span />
                  <span />
                  <span className="text-right text-[15px] font-semibold tabular-nums">
                    {two(data.total)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </AsyncSection>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', !strong && 'text-muted-foreground')}>{value}</span>
    </div>
  )
}

type ResultGroup = {
  groupId: string
  depth: number
  name: string
  itemsTotal: string
  childrenTotal: string
  raw: string
  final: string
  cap: string | null
  floor: string | null
}

/** what the ledger needs of a question that scored nothing */
type LedgerItem = {
  id: string
  title: string
  scoreGroupId: string
  sortOrder: number
  status: string
  currentRevision: { entrySource: 'student' | 'administrative' } | null
}

type ResultLine = {
  lineId: string
  kind: string
  label: string
  value: string
}

/** one group's tinted row, then its lines, then the limit if it bit */
function GroupRows({
  group,
  lines,
  silent,
  hasChildren,
}: {
  group: ResultGroup
  lines: readonly ResultLine[]
  /** the group's questions that came to nothing, listed at 0 with the reason */
  silent: readonly LedgerItem[]
  hasChildren: boolean
}) {
  const { format } = useI18n()
  const raw = Number(group.raw)
  const final = Number(group.final)
  const pad = { paddingLeft: `${group.depth * 1.25}rem` }
  const linePad = { paddingLeft: `${(group.depth + 1) * 1.25}rem` }
  // the adjustment as its own line under the lines it trimmed, the way the
  // design writes it: what it added up to, what counted, and the difference
  // as a negative rather than a quiet clamp
  const capped = group.cap !== null && final < raw
  const floored = group.floor !== null && final > raw
  return (
    <div className="border-b last:border-b-0">
      <div className={cn(COLS, 'h-10', group.depth === 0 ? 'bg-muted/75' : 'bg-muted/40')}>
        <span className="flex min-w-0 items-center gap-2" style={pad}>
          <span className="min-w-0 truncate text-sm font-semibold">{group.name}</span>
          <Badge variant="outline" className="shrink-0 bg-background font-normal tabular-nums">
            {group.cap === null
              ? format(m.resultNoCap)
              : format(m.resultCapChip, { value: two(group.cap) })}
          </Badge>
        </span>
        <span className="text-right text-sm text-muted-foreground tabular-nums">
          {two(group.itemsTotal)}
        </span>
        <span className="text-right text-sm text-muted-foreground tabular-nums">
          {hasChildren ? two(group.childrenTotal) : '—'}
        </span>
        <span className="text-right text-sm font-semibold tabular-nums">{two(group.final)}</span>
      </div>
      {lines.map((line) => {
        const spent = line.kind !== 'entry' && line.kind !== 'derived'
        const note =
          line.kind === 'excluded-evidence'
            ? m.resultLineExcluded
            : line.kind === 'derived'
              ? m.resultDerived
              : line.kind === 'entry-not-counted'
                ? m.resultNotCounted
                : line.kind === 'item-voided'
                  ? m.resultLineVoided
                  : null
        return (
          <div key={line.lineId} className={cn(COLS, 'h-9.5')}>
            <span className="flex min-w-0 items-center gap-2" style={linePad}>
              <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
              <span className={cn('min-w-0 truncate text-sm', spent && 'text-muted-foreground')}>
                {line.label}
              </span>
              {note !== null && (
                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                  {format(note)}
                </span>
              )}
            </span>
            <span />
            <span />
            <span
              className={cn('text-right text-sm tabular-nums', spent && 'text-muted-foreground')}
            >
              {two(line.value)}
            </span>
          </div>
        )
      })}
      {silent.map((item) => (
        <div key={item.id} className={cn(COLS, 'h-9.5')}>
          <span className="flex min-w-0 items-center gap-2" style={linePad}>
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
            <span
              className={cn(
                'min-w-0 truncate text-sm text-muted-foreground',
                item.status === 'voided' && 'line-through decoration-muted-foreground/40',
              )}
            >
              {item.title}
            </span>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {format(
                item.status === 'voided'
                  ? m.resultLineVoided
                  : item.currentRevision?.entrySource === 'administrative'
                    ? m.paperEmptyRecorded
                    : m.resultLineNone,
              )}
            </span>
          </span>
          <span />
          <span />
          <span className="text-right text-sm text-muted-foreground tabular-nums">{two(0)}</span>
        </div>
      ))}
      {(capped || floored) && (
        <div className={cn(COLS, 'h-9.5')}>
          <span className="flex min-w-0 items-center gap-2" style={linePad}>
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
            <span className="min-w-0 text-sm text-pretty text-muted-foreground">
              {format(m.resultLineAdjustment)}　
              {capped
                ? format(m.resultGroupCapped, { raw: two(group.raw), cap: two(group.cap!) })
                : format(m.resultGroupFloored, { raw: two(group.raw), floor: two(group.floor!) })}
            </span>
          </span>
          <span />
          <span />
          <span className="text-right text-sm text-muted-foreground tabular-nums">
            {capped ? `-${two(raw - final)}` : `+${two(final - raw)}`}
          </span>
        </div>
      )}
    </div>
  )
}

/** the way to where the moving parts are, with what is moving beside it */
function GoToEntries({ pending, drafts }: { pending: number; drafts: number }) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const { batchId } = usePageRouteParams('batchId')
  return (
    <div className="flex items-center gap-2.5">
      <Button onClick={() => navigate('assessment/batch-my-entries', { params: { batchId } })}>
        {format(m.resultGoEntries)}
      </Button>
      {(pending > 0 || drafts > 0) && (
        <p className="text-xs whitespace-nowrap text-muted-foreground">
          {format(m.resultEmptyCounts, { pending, drafts })}
        </p>
      )}
    </div>
  )
}
