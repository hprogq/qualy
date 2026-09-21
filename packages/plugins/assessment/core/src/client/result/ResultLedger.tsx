import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Portion } from '@qualy/ui/reveal'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { BarChart3Icon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { assessmentMessages as m } from '../i18n.ts'

// One ledger the algorithm can be read off, whoever is reading it.
//
// The same table holds groups as tinted rows and questions as ruled lines,
// indent standing for nesting, every amount right-aligned in tabular
// figures so a column adds up by eye. A group row answers three ways at
// once - its own items, its subgroups, and what actually counts - and a
// limit that bites gets its own line with the difference written as a
// negative, never a silent clamp. Lines that score nothing stay where they
// are at 0 with the reason beside them: a page that dropped them would be
// shorter than the paper the reader filed.
//
// It is presentation and nothing else. It does not know whose account this
// is, whether the reader owns it or administers it, or which api answered -
// which is the point: a participant reading their own standing and an
// administrator checking it are looking at one explanation of one number,
// not two pieces of arithmetic that happen to agree today.

/** what the ledger needs of a claim, to count what is still moving */
export interface LedgerEntry {
  readonly status: string
}

/** what the ledger needs of a question that scored nothing */
export type LedgerItem = {
  id: string
  title: string
  scoreGroupId: string
  sortOrder: number
  status: string
  currentRevision: { entryChannels: readonly ('participant' | 'administrative')[] } | null
}

type ResultGroup = {
  groupId: string
  parentGroupId: string | null
  depth: number
  name: string
  itemsTotal: string
  childrenTotal: string
  raw: string
  final: string
  cap: string | null
  floor: string | null
}

type ResultLine = {
  lineId: string
  kind: string
  label: string
  value: string
  itemId?: string
  provenance?: { entryId?: string } | undefined
}

/** the account as the scorer answered it, either door */
export interface LedgerResult {
  readonly mode: string
  readonly total: string
  readonly groups: readonly ResultGroup[]
  readonly lines: readonly ResultLine[]
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

const styles = stylex.create({
  // the ledger's four columns: what it is, and three figures that line up
  cols: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 7rem 7rem 7rem',
    alignItems: 'center',
    gap: 16,
    paddingInline: 16,
  },
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
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    alignItems: {
      default: null,
      [breakpoints.tablet]: 'stretch',
      [breakpoints.desktop]: 'stretch',
    },
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
    display: { default: 'block', [breakpoints.phone]: 'none' },
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
  // a line that leads somewhere says so on approach rather than by looking
  // like a link: the ledger is a table of figures, and an underline in a
  // column of numbers reads as a rule
  followable: {
    cursor: 'pointer',
    backgroundColor: { default: null, ':hover': tokens.surfaceMuted },
    outlineOffset: -2,
  },
  followMark: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
    opacity: { default: 0, ':is([role=button]:hover *)': 1 },
  },
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
})

const inks = stylex.create({
  first: { backgroundColor: tokens.foreground },
  second: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 60%, transparent)` },
  third: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 35%, transparent)` },
})
const SEGMENT_INKS = [inks.first, inks.second, inks.third] as const

/**
 * The account: the total, how it divides, and every line behind it.
 *
 * `onEntryOpen` is what turns a number back into the thing it came from. A
 * line carries the claim it was computed from - the scorer has always said
 * so - so a reader who wants to know why 1.00 appeared can be taken to the
 * filing that earned it rather than told to go and find it. A reader with
 * nowhere to be taken (the owner's own page, where the claim is one tab
 * away anyway) passes nothing and the lines stay plain text.
 */
export function ResultLedger({
  result,
  items,
  entries,
  emptyAction,
  onEntryOpen,
}: {
  result: LedgerResult
  items: readonly LedgerItem[]
  entries: readonly LedgerEntry[]
  /** what the empty state offers; the page decides where that leads */
  emptyAction?: ReactNode
  onEntryOpen?: (entryId: string) => void
}) {
  const { format } = useI18n()
  // a line names its item; which group that item adds up in is the item's
  // own configuration, so no line can be placed until both have landed
  const groupOfItem = new Map(items.map((item) => [item.id, item.scoreGroupId]))
  // Every question of the round stands in the ledger, not only the ones that
  // came to something: a page listing three of a reader's twenty questions
  // reads as a page that lost the other seventeen, and "nothing yet" is an
  // answer they need as much as an amount.
  const askedOf = new Map<string, LedgerItem[]>()
  for (const item of items) {
    if (item.status === 'draft') continue
    const bucket = askedOf.get(item.scoreGroupId)
    if (bucket === undefined) askedOf.set(item.scoreGroupId, [item])
    else bucket.push(item)
  }
  for (const bucket of askedOf.values()) bucket.sort((a, b) => a.sortOrder - b.sortOrder)
  const groups = inTreeOrder(result.groups)
  const parents = new Set(
    groups.flatMap((group) => (group.parentGroupId === null ? [] : [group.parentGroupId])),
  )
  const pendingCount = entries.filter((entry) => entry.status === 'in_review').length

  const top = groups.filter((group) => group.depth === 0)
  // the round's full marks, when every top group declares a cap; a round
  // with an uncapped top group has no honest full to print
  const full =
    top.length > 0 && top.every((group) => group.cap !== null)
      ? top.reduce((sum, group) => sum + Number(group.cap), 0)
      : null
  const total = Number(result.total)
  // what limits held back, summed over every group whose cap bit
  const trimmed = groups.reduce((sum, group) => {
    const raw = Number(group.raw)
    const final = Number(group.final)
    return sum + (raw > final ? raw - final : 0)
  }, 0)
  // the bar shares one denominator so the segments mean what they show
  const denominator = full ?? (total > 0 ? total : 1)
  // What the bar actually divides the total into.
  //
  // A top group that holds other groups is not a division of the total, it
  // is the container of one: drawn whole, a round with a single top group
  // gets a bar with one block in it, which says nothing the number above it
  // did not. So a container hands the bar the groups inside it, plus - where
  // it also carries questions of its own - one part for those.
  //
  // Scaled to what the container actually contributed, because its own cap
  // may have bitten: the parts of a bar have to add up to the figure the bar
  // stands under, and a child's untrimmed value would make them add up to
  // more. Each part still says its own real number beside it.
  const shares = top.flatMap((group) => {
    const inside = groups.filter((one) => one.parentGroupId === group.groupId)
    if (inside.length === 0) {
      return [{ id: group.groupId, name: group.name, part: Number(group.final), said: group.final }]
    }
    const own = Number(group.itemsTotal)
    const parts = [
      ...inside.map((one) => ({
        id: one.groupId,
        name: one.name,
        part: Number(one.final),
        said: one.final,
      })),
      // the container's own questions, where it asks any: without this the
      // parts would silently leave them out of a bar that claims to be whole
      ...(own > 0
        ? [{ id: `${group.groupId}:own`, name: group.name, part: own, said: group.itemsTotal }]
        : []),
    ]
    const sum = parts.reduce((into, one) => into + one.part, 0)
    const scale = sum > 0 ? Number(group.final) / sum : 0
    return parts.map((one) => ({ ...one, part: one.part * scale }))
  })
  // A division that contributed nothing is not a slice of the bar.
  //
  // Drawn anyway it is a segment of no width - but the bar sets its
  // segments apart with a gap, and a gap is spent on a segment whether or
  // not there is anything in it. Three empty divisions before a full one
  // therefore opened a space to the left of the only slice there was, which
  // reads as the bar starting somewhere other than its own beginning. They
  // are in the table below, where an empty division says so in words.
  const drawn = shares.filter((share) => share.part > 0)

  return (
    <div {...stylex.props(styles.standing)}>
      {/* the total, how it divides, and what is not in it - one band */}
      <section {...stylex.props(styles.band)}>
        <div {...stylex.props(styles.totalSide)}>
          <div {...stylex.props(styles.totalHead)}>
            <p {...stylex.props(styles.totalLabel)}>{format(m.resultTotal)}</p>
            <Badge
              data-testid="result-mode"
              data-mode={result.mode}
              variant="outline"
              className={stylex.props(styles.mode).className}
            >
              {format(m.resultProvisional)}
            </Badge>
          </div>
          <p data-testid="result-total" {...stylex.props(styles.total)}>
            {two(result.total)}
          </p>
          {full !== null && (
            <p {...stylex.props(styles.full)}>{format(m.resultFull, { value: two(full) })}</p>
          )}
        </div>
        <span aria-hidden {...stylex.props(styles.rule)} />
        <div {...stylex.props(styles.barSide)}>
          <div {...stylex.props(styles.bar)}>
            {drawn.map((share, index) => (
              // the total said a second way, counted out rather than simply
              // standing there beside the number it divides
              <Portion
                key={share.id}
                share={Math.min(100, (share.part / denominator) * 100)}
                className={
                  stylex.props(styles.segment, SEGMENT_INKS[index % SEGMENT_INKS.length])
                    .className
                }
              />
            ))}
          </div>
          <div {...stylex.props(styles.legend)}>
            {/* the same parts, in the same order and the same inks: a
                swatch beside a name that has no slice in the bar above
                leaves the reader hunting for a colour that is not there */}
            {drawn.map((share, index) => (
              <span key={share.id} {...stylex.props(styles.legendItem)}>
                <span
                  aria-hidden
                  {...stylex.props(styles.swatch, SEGMENT_INKS[index % SEGMENT_INKS.length])}
                />
                {share.name}
                <span {...stylex.props(styles.legendValue)}>{two(share.said)}</span>
              </span>
            ))}
          </div>
        </div>
        <span aria-hidden {...stylex.props(styles.rule)} />
        <div {...stylex.props(styles.summarySide)}>
          <SummaryRow label={format(m.resultCountedIn)} value={two(result.total)} strong />
          {/* a count, not an amount: what review will grant is not decided,
              and a number shaped like the granted one reads as a promise */}
          <SummaryRow
            label={format(m.resultPendingLabel)}
            value={format(m.resultPendingCount, { count: pendingCount })}
          />
          <SummaryRow label={format(m.resultTrimmed)} value={two(trimmed)} />
        </div>
      </section>

      {result.lines.length === 0 ? (
        // nothing counted yet: the room the ledger would take says what will
        // fill it and where the moving parts are
        <div {...stylex.props(styles.empty)}>
          <span {...stylex.props(styles.emptyMark)}>
            <BarChart3Icon aria-hidden {...stylex.props(styles.emptyIcon)} />
          </span>
          <div {...stylex.props(styles.emptyWords)}>
            <h2 {...stylex.props(styles.emptyTitle)}>{format(m.resultEmptyTitle)}</h2>
            <p {...stylex.props(styles.emptyHint)}>{format(m.resultEmptyBody)}</p>
          </div>
          {emptyAction}
        </div>
      ) : (
        <div {...stylex.props(styles.ledger)}>
          <div {...stylex.props(styles.cols, styles.ledgerHead)}>
            <span>{format(m.resultTableHead)}</span>
            <span {...stylex.props(styles.figure)}>{format(m.resultGroupItems)}</span>
            <span {...stylex.props(styles.figure)}>{format(m.resultGroupChildren)}</span>
            <span {...stylex.props(styles.figure)}>{format(m.resultGroupFinal)}</span>
          </div>
          {groups.map((group) => {
            const lines = result.lines.filter(
              (line) =>
                // the group's own adjustment is spoken by the group row's
                // limit line below, from the same figures
                line.kind !== 'group-adjustment' &&
                (line.lineId.startsWith(`grp:${group.groupId}:`) ||
                  (line.itemId !== undefined && groupOfItem.get(line.itemId) === group.groupId)),
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
                {...(onEntryOpen === undefined ? {} : { onEntryOpen })}
              />
            )
          })}
          <div {...stylex.props(styles.cols, styles.ledgerFoot)}>
            <span {...stylex.props(styles.footLabel)}>{format(m.resultTotal)}</span>
            <span />
            <span />
            <span {...stylex.props(styles.footValue)}>{two(result.total)}</span>
          </div>
        </div>
      )}
    </div>
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

/** one group's tinted row, then its lines, then the limit if it bit */
function GroupRows({
  group,
  lines,
  silent,
  hasChildren,
  onEntryOpen,
}: {
  group: ResultGroup
  lines: readonly ResultLine[]
  /** the group's questions that came to nothing, listed at 0 with the reason */
  silent: readonly LedgerItem[]
  hasChildren: boolean
  onEntryOpen?: (entryId: string) => void
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
          {hasChildren ? two(group.childrenTotal) : '–'}
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
        // an amount that came from a claim can be followed back to it; the
        // whole row is the target, because the thing being pointed at is the
        // line rather than any word in it
        const opens = line.provenance?.entryId
        const followable = opens !== undefined && onEntryOpen !== undefined
        return (
          <div
            key={line.lineId}
            {...stylex.props(styles.cols, styles.line, followable && styles.followable)}
            {...(followable
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'data-testid': 'ledger-line',
                  'data-entry': opens,
                  onClick: () => onEntryOpen(opens),
                  onKeyDown: (event: import('react').KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onEntryOpen(opens)
                  },
                }
              : {})}
          >
            <span {...stylex.props(styles.rowName)} style={linePad}>
              <span aria-hidden {...stylex.props(styles.lineRule)} />
              <span {...stylex.props(styles.lineLabel, spent && styles.spent)}>{line.label}</span>
              {note !== null && <span {...stylex.props(styles.lineNote)}>{format(note)}</span>}
              {followable && <ChevronRightIcon aria-hidden {...stylex.props(styles.followMark)} />}
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
                  : item.currentRevision?.entryChannels.includes('administrative') === true &&
                      !item.currentRevision.entryChannels.includes('participant')
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
