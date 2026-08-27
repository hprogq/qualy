import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { BarChart3Icon } from 'lucide-react'
import { useApiQuery, usePageNavigate, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
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
const styles = stylex.create({
  // the ledger's four columns: what it is, and three figures that line up
  cols: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 7rem 7rem 7rem',
    alignItems: 'center',
    gap: 16,
    paddingInline: 16,
  },
  waiting: { height: 160, width: '100%' },
  page: { display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: '0%', flexDirection: 'column' },
  standing: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 18,
  },
  // the total, how it divides, and what is not in it - one band
  band: {
    display: 'flex',
    flexDirection: { default: 'column', '@media (min-width: 640px)': 'row' },
    alignItems: { default: null, '@media (min-width: 640px)': 'stretch' },
    gap: 20,
    borderRadius: `calc(${tokens.radiusLg} * 1.8)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 20,
  },
  totalSide: { display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 6 },
  totalHead: { display: 'flex', alignItems: 'center', gap: 8 },
  totalLabel: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  mode: { fontWeight: 400, color: tokens.mutedForeground },
  total: {
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    fontVariantNumeric: 'tabular-nums',
  },
  full: {
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the band's parts stand apart only where there is room for a rule
  rule: {
    display: { default: 'none', '@media (min-width: 640px)': 'block' },
    width: 1,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  barSide: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 10,
  },
  bar: {
    display: 'flex',
    height: 8,
    gap: 2,
    overflow: 'hidden',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
  },
  segment: { flexShrink: 0 },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  legendItem: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
  },
  swatch: { width: 8, height: 8, flexShrink: 0, borderRadius: 2 },
  legendValue: { color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  summarySide: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 8,
  },
  // the room the ledger would take says what will fill it
  empty: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingBlock: 56,
  },
  emptyMark: {
    display: 'flex',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  emptyIcon: { width: 22, height: 22 },
  emptyWords: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    gap: 8,
    textAlign: 'center',
  },
  emptyTitle: { fontSize: 18, lineHeight: '1.75rem', fontWeight: 600, letterSpacing: '-0.025em' },
  emptyHint: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  ledger: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} * 1.8)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  ledgerHead: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingBlock: 8,
    fontSize: 12,
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  figure: { textAlign: 'right' },
  ledgerFoot: {
    height: 44,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
  },
  footLabel: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 600 },
  footValue: {
    textAlign: 'right',
    fontSize: 15,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    fontSize: 13,
  },
  summaryLabel: { whiteSpace: 'nowrap', color: tokens.mutedForeground },
  summaryValue: { fontVariantNumeric: 'tabular-nums' },
  summaryQuiet: { color: tokens.mutedForeground },
  // every group but the last is closed by a rule
  group: {
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  groupRow: { height: 40 },
  groupRowTop: { backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 75%, transparent)` },
  groupRowNested: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
  },
  rowName: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  groupName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  capChip: {
    flexShrink: 0,
    backgroundColor: tokens.background,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
  },
  groupFigure: {
    textAlign: 'right',
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  groupTotal: {
    textAlign: 'right',
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  line: { height: 38 },
  lineRule: { height: 20, width: 1, flexShrink: 0, backgroundColor: tokens.border },
  lineLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  spent: { color: tokens.mutedForeground },
  voided: {
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  lineNote: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  lineValue: {
    textAlign: 'right',
    fontSize: 14,
    lineHeight: '1.25rem',
    fontVariantNumeric: 'tabular-nums',
  },
  adjustment: {
    minWidth: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  goRow: { display: 'flex', alignItems: 'center', gap: 10 },
  goCounts: {
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
})

/** the shades the top groups wear in the bar and its legend, in turn */
const inks = stylex.create({
  first: { backgroundColor: tokens.foreground },
  second: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 60%, transparent)` },
  third: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 35%, transparent)` },
})
const SEGMENT_INKS = [inks.first, inks.second, inks.third] as const

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
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
      xstyle={styles.page}
    >
      {data !== undefined && (
        <div {...stylex.props(styles.standing)}>
          {/* the total, how it divides, and what is not in it - one band */}
          <section {...stylex.props(styles.band)}>
            <div {...stylex.props(styles.totalSide)}>
              <div {...stylex.props(styles.totalHead)}>
                <p {...stylex.props(styles.totalLabel)}>{format(m.resultTotal)}</p>
                <Badge
                  data-testid="result-mode"
                  data-mode={data.mode}
                  variant="outline"
                  className={stylex.props(styles.mode).className}
                >
                  {format(m.resultProvisional)}
                </Badge>
              </div>
              <p data-testid="result-total" {...stylex.props(styles.total)}>
                {two(data.total)}
              </p>
              {full !== null && (
                <p {...stylex.props(styles.full)}>{format(m.resultFull, { value: two(full) })}</p>
              )}
            </div>
            <span aria-hidden {...stylex.props(styles.rule)} />
            <div {...stylex.props(styles.barSide)}>
              <div {...stylex.props(styles.bar)}>
                {top.map((group, index) => (
                  <span
                    key={group.groupId}
                    {...stylex.props(styles.segment, SEGMENT_INKS[index % SEGMENT_INKS.length])}
                    style={{
                      width: `${Math.min(100, (Number(group.final) / denominator) * 100)}%`,
                    }}
                  />
                ))}
              </div>
              <div {...stylex.props(styles.legend)}>
                {top.map((group, index) => (
                  <span key={group.groupId} {...stylex.props(styles.legendItem)}>
                    <span
                      aria-hidden
                      {...stylex.props(styles.swatch, SEGMENT_INKS[index % SEGMENT_INKS.length])}
                    />
                    {group.name}
                    <span {...stylex.props(styles.legendValue)}>{two(group.final)}</span>
                  </span>
                ))}
              </div>
            </div>
            <span aria-hidden {...stylex.props(styles.rule)} />
            <div {...stylex.props(styles.summarySide)}>
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
            <div {...stylex.props(styles.empty)}>
              <span {...stylex.props(styles.emptyMark)}>
                <BarChart3Icon aria-hidden {...stylex.props(styles.emptyIcon)} />
              </span>
              <div {...stylex.props(styles.emptyWords)}>
                <h2 {...stylex.props(styles.emptyTitle)}>{format(m.resultEmptyTitle)}</h2>
                <p {...stylex.props(styles.emptyHint)}>{format(m.resultEmptyBody)}</p>
              </div>
              <GoToEntries pending={pendingCount} drafts={draftCount} />
            </div>
          ) : (
            <>
              <div {...stylex.props(styles.ledger)}>
                <div {...stylex.props(styles.cols, styles.ledgerHead)}>
                  <span>{format(m.resultTableHead)}</span>
                  <span {...stylex.props(styles.figure)}>{format(m.resultGroupItems)}</span>
                  <span {...stylex.props(styles.figure)}>{format(m.resultGroupChildren)}</span>
                  <span {...stylex.props(styles.figure)}>{format(m.resultGroupFinal)}</span>
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
                <div {...stylex.props(styles.cols, styles.ledgerFoot)}>
                  <span {...stylex.props(styles.footLabel)}>{format(m.resultTotal)}</span>
                  <span />
                  <span />
                  <span {...stylex.props(styles.footValue)}>{two(data.total)}</span>
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
    <div {...stylex.props(styles.summaryRow)}>
      <span {...stylex.props(styles.summaryLabel)}>{label}</span>
      <span {...stylex.props(styles.summaryValue, !strong && styles.summaryQuiet)}>{value}</span>
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
    <div {...stylex.props(styles.group)}>
      <div
        {...stylex.props(
          styles.cols,
          styles.groupRow,
          group.depth === 0 ? styles.groupRowTop : styles.groupRowNested,
        )}
      >
        <span {...stylex.props(styles.rowName)} style={pad}>
          <span {...stylex.props(styles.groupName)}>{group.name}</span>
          <Badge variant="outline" className={stylex.props(styles.capChip).className}>
            {group.cap === null
              ? format(m.resultNoCap)
              : format(m.resultCapChip, { value: two(group.cap) })}
          </Badge>
        </span>
        <span {...stylex.props(styles.groupFigure)}>{two(group.itemsTotal)}</span>
        <span {...stylex.props(styles.groupFigure)}>
          {hasChildren ? two(group.childrenTotal) : '—'}
        </span>
        <span {...stylex.props(styles.groupTotal)}>{two(group.final)}</span>
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
          <div key={line.lineId} {...stylex.props(styles.cols, styles.line)}>
            <span {...stylex.props(styles.rowName)} style={linePad}>
              <span aria-hidden {...stylex.props(styles.lineRule)} />
              <span {...stylex.props(styles.lineLabel, spent && styles.spent)}>{line.label}</span>
              {note !== null && <span {...stylex.props(styles.lineNote)}>{format(note)}</span>}
            </span>
            <span />
            <span />
            <span {...stylex.props(styles.lineValue, spent && styles.spent)}>
              {two(line.value)}
            </span>
          </div>
        )
      })}
      {silent.map((item) => (
        <div key={item.id} {...stylex.props(styles.cols, styles.line)}>
          <span {...stylex.props(styles.rowName)} style={linePad}>
            <span aria-hidden {...stylex.props(styles.lineRule)} />
            <span
              {...stylex.props(
                styles.lineLabel,
                styles.spent,
                item.status === 'voided' && styles.voided,
              )}
            >
              {item.title}
            </span>
            <span {...stylex.props(styles.lineNote)}>
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
          <span {...stylex.props(styles.lineValue, styles.spent)}>{two(0)}</span>
        </div>
      ))}
      {(capped || floored) && (
        <div data-testid="group-adjustment" {...stylex.props(styles.cols, styles.line)}>
          <span {...stylex.props(styles.rowName)} style={linePad}>
            <span aria-hidden {...stylex.props(styles.lineRule)} />
            <span {...stylex.props(styles.adjustment)}>
              {format(m.resultLineAdjustment)}　
              {capped
                ? format(m.resultGroupCapped, { raw: two(group.raw), cap: two(group.cap!) })
                : format(m.resultGroupFloored, { raw: two(group.raw), floor: two(group.floor!) })}
            </span>
          </span>
          <span />
          <span />
          <span {...stylex.props(styles.lineValue, styles.spent)}>
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
    <div {...stylex.props(styles.goRow)}>
      <Button onClick={() => navigate('assessment/batch-my-entries', { params: { batchId } })}>
        {format(m.resultGoEntries)}
      </Button>
      {(pending > 0 || drafts > 0) && (
        <p {...stylex.props(styles.goCounts)}>{format(m.resultEmptyCounts, { pending, drafts })}</p>
      )}
    </div>
  )
}
