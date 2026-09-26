import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { trimAmount, type EntryDto } from '../model.ts'
import type { StructureRow } from '../standing.ts'
import { useCalcLine } from './calc.ts'
import { meterStyles, SectionMeter, UnreadMark } from './marks.tsx'
import {
  chainOf,
  dotOf,
  insideOf,
  rowWordOf,
  short,
  two,
  urgentTag,
  type Outline,
  type Viewer,
} from './model.ts'

// One section, opened: how far it has got against its limit, and every
// question and section inside it, a row each - the way into any of them.

const PHONE = '@media (max-width: 767.98px)'
const BELOW_DESK = '@media (max-width: 1279.98px)'

const styles = stylex.create({
  root: { display: 'flex', minHeight: '100%', flexGrow: 1, flexDirection: 'column' },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingInline: { default: 28, [BELOW_DESK]: 22, [PHONE]: 16 },
    paddingTop: { default: 22, [PHONE]: 14 },
    paddingBottom: 18,
  },
  crumbs: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  crumbItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  crumb: {
    display: 'inline-flex',
    gap: 6,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  crumbRule: { color: `color-mix(in oklab, ${tokens.foreground} 20%, transparent)` },
  titleLine: { display: 'flex', alignItems: 'flex-end', gap: 16 },
  titleWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 6 },
  no: {
    fontSize: 13,
    fontWeight: 600,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  title: {
    margin: 0,
    fontSize: { default: 20, [PHONE]: 18 },
    lineHeight: 1.25,
    fontWeight: 600,
    letterSpacing: '-0.015em',
    overflowWrap: 'anywhere',
  },
  ledger: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 4,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  ledgerGot: { fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' },
  ledgerZero: { color: tokens.mutedForeground },
  ledgerCap: { fontSize: 13, color: tokens.mutedForeground },
  bar: {
    display: 'block',
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: tokens.surfaceMuted,
  },
  barFill: {
    display: 'block',
    height: '100%',
    borderRadius: 2,
  },
  facts: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  fact: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  factRule: { width: 1, height: 10, backgroundColor: tokens.border },
  factWaits: { color: tokens.warningForeground },
  card: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  sub: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingTop: 16,
    paddingBottom: 8,
    paddingRight: { default: 28, [PHONE]: 16 },
    textAlign: 'left',
    cursor: 'pointer',
  },
  subRuled: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  square: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  subNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  subName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  spacer: { flexGrow: 1 },
  subLedger: { flexShrink: 0, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' },
  muted: { color: tokens.mutedForeground },
  item: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 1fr) auto 14px',
    alignItems: 'center',
    columnGap: 14,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.background})`,
    },
    paddingBlock: 12,
    paddingRight: { default: 28, [PHONE]: 16 },
    textAlign: 'left',
    cursor: 'pointer',
  },
  itemWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  itemTop: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 9 },
  dot: { width: 7, height: 7, flexShrink: 0, borderRadius: 9999 },
  itemName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  itemGone: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
  },
  itemFacts: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  keep: { flexShrink: 0, whiteSpace: 'nowrap' },
  clip: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  wordUrgent: { fontWeight: 500, color: tokens.warningForeground },
  itemScore: {
    textAlign: 'right',
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  itemScoreZero: { color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)` },
  itemScoreNegative: { color: tokens.danger },
  chevron: { width: 14, height: 14, color: tokens.mutedForeground },
})

const dots = stylex.create({
  waits: { backgroundColor: tokens.warning },
  approved: { backgroundColor: tokens.success },
  moving: { backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 80%, transparent)` },
  draft: { backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)` },
  ring: {
    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)`,
  },
  open: {
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  quiet: { backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 35%, transparent)` },
})

export function GroupPane({
  viewer,
  outline,
  row,
  entriesByItem,
  scored,
  totalCap,
  isTodo,
  onGoto,
}: {
  viewer: Viewer
  outline: Outline
  row: StructureRow
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  scored: boolean
  /** the paper's whole, so a top section can say its share of it */
  totalCap: number | null
  isTodo: (row: StructureRow) => boolean
  onGoto: (id: string) => void
}) {
  const { format } = useI18n()
  const calc = useCalcLine()
  const chain = chainOf(outline, row)
  const inside = insideOf(outline, row)
  const items = inside.filter((one) => one.kind === 'item')
  const filed = items.reduce(
    (sum, one) =>
      sum + (entriesByItem.get(one.id) ?? []).filter((entry) => entry.status !== 'voided').length,
    0,
  )
  const todo = items.filter(isTodo).length
  const cap = row.cap === null || row.cap === undefined || row.cap === '' ? null : Number(row.cap)
  const got = row.right === '' ? 0 : Number(row.right)
  const full = scored && cap !== null && cap > 0 && got >= cap
  const facts: { key: string; text: string; waits?: boolean }[] = [
    {
      key: 'cap',
      text:
        row.depth === 0 && cap !== null && totalCap !== null && totalCap > 0
          ? format(m.paperBandShare, { pct: Math.round((cap / totalCap) * 100) })
          : cap !== null
            ? format(m.entriesSectionCap, { value: trimAmount(String(cap)) })
            : format(m.entriesSectionUncapped),
    },
    { key: 'items', text: format(m.myEntriesQuestions, { count: items.length }) },
    { key: 'filed', text: format(m.entriesFiledCount, { count: filed }) },
    ...(todo > 0
      ? [
          {
            key: 'todo',
            text: format(viewer === 'owner' ? m.entriesTodoCount : m.entriesMovingCount, {
              count: todo,
            }),
            waits: viewer === 'owner',
          },
        ]
      : []),
    ...(full ? [{ key: 'full', text: format(m.entriesSectionFull) }] : []),
  ]

  return (
    <div {...stylex.props(styles.root)} data-testid="group-pane" data-group={row.id}>
      <div {...stylex.props(styles.head)}>
        {chain.length > 0 && (
          <ol aria-label={format(m.entriesWhereLabel)} {...stylex.props(styles.crumbs)}>
            {chain.map((section) => (
              <li key={section.id} {...stylex.props(styles.crumbItem)}>
                <button
                  type="button"
                  onClick={() => onGoto(section.id)}
                  {...stylex.props(styles.crumb)}
                >
                  <span>{outline.numbers.get(section.id)}</span>
                  {section.name}
                </button>
                <span aria-hidden {...stylex.props(styles.crumbRule)}>
                  /
                </span>
              </li>
            ))}
          </ol>
        )}
        <div {...stylex.props(styles.titleLine)}>
          <div {...stylex.props(styles.titleWords)}>
            <span {...stylex.props(styles.no)}>{outline.numbers.get(row.id)}</span>
            <h2 tabIndex={-1} data-pane-title="" {...stylex.props(styles.title)}>
              {row.name}
            </h2>
          </div>
          <span {...stylex.props(styles.ledger)} data-scored={scored}>
            <span {...stylex.props(styles.ledgerGot, (!scored || got === 0) && styles.ledgerZero)}>
              {scored ? short(row.right === '' ? '0' : row.right) : '–'}
            </span>
            <span {...stylex.props(styles.ledgerCap)}>
              {cap === null
                ? format(m.myEntriesPaperUnit)
                : `/ ${format(m.entriesPoints, { value: trimAmount(String(cap)) })}`}
            </span>
          </span>
        </div>
        {cap !== null && cap > 0 && (
          <span {...stylex.props(styles.bar)} data-testid="section-bar" data-full={full}>
            <span
              {...stylex.props(styles.barFill, full ? meterStyles.full : meterStyles.fill)}
              style={{ width: `${scored ? Math.max(0, Math.min(100, (got / cap) * 100)) : 0}%` }}
            />
          </span>
        )}
        <div {...stylex.props(styles.facts)}>
          {facts.map((fact, index) => (
            <span
              key={fact.key}
              data-fact={fact.key}
              {...stylex.props(styles.fact, fact.waits === true && styles.factWaits)}
            >
              {index > 0 && <span aria-hidden {...stylex.props(styles.factRule)} />}
              {fact.text}
            </span>
          ))}
        </div>
      </div>
      <ul {...stylex.props(styles.card)}>
        {inside.map((one, index) => {
          const pad = 16 + (one.depth - row.depth - 1) * 16
          if (one.kind === 'group') {
            const subCap =
              one.cap === null || one.cap === undefined || one.cap === '' ? null : Number(one.cap)
            return (
              <li key={one.id}>
                <button
                  type="button"
                  onClick={() => onGoto(one.id)}
                  {...stylex.props(styles.sub, index > 0 && styles.subRuled)}
                  style={{ paddingLeft: `${pad + 12}px` }}
                >
                  <span aria-hidden {...stylex.props(styles.square)} />
                  <span {...stylex.props(styles.subNo)}>{outline.numbers.get(one.id)}</span>
                  <span {...stylex.props(styles.subName)}>{one.name}</span>
                  <span {...stylex.props(styles.spacer)} />
                  {scored && subCap !== null && subCap > 0 && (
                    <SectionMeter got={one.right === '' ? 0 : Number(one.right)} cap={subCap} />
                  )}
                  <span {...stylex.props(styles.subLedger)} data-scored={scored}>
                    <b>{scored ? short(one.right === '' ? '0' : one.right) : '–'}</b>
                    <span {...stylex.props(styles.muted)}>
                      {subCap === null
                        ? ` ${format(m.myEntriesPaperUnit)}`
                        : ` / ${format(m.entriesPoints, { value: trimAmount(String(subCap)) })}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          }
          const item = one.item
          const word = rowWordOf(one)
          const entries = (entriesByItem.get(one.id) ?? []).filter(
            (entry) => entry.status !== 'voided',
          )
          const score = one.right === '' ? 0 : Number(one.right)
          return (
            <li key={one.id}>
              <button
                type="button"
                data-group-item={one.id}
                data-unread={one.unread}
                onClick={() => onGoto(one.id)}
                {...stylex.props(styles.item)}
                style={{ paddingLeft: `${pad + 12}px` }}
              >
                <span {...stylex.props(styles.itemWords)}>
                  <span {...stylex.props(styles.itemTop)}>
                    <span
                      aria-hidden
                      data-dot={dotOf(one)}
                      {...stylex.props(styles.dot, dots[dotOf(one)])}
                    />
                    <span
                      {...stylex.props(styles.itemName, one.tag === 'voided' && styles.itemGone)}
                    >
                      {outline.numbers.get(one.id)}. {one.name}
                    </span>
                    {one.unread && <UnreadMark />}
                  </span>
                  <span {...stylex.props(styles.itemFacts)}>
                    {word !== null && (
                      <span {...stylex.props(styles.keep, urgentTag(one) && styles.wordUrgent)}>
                        {format(word)}
                      </span>
                    )}
                    <span {...stylex.props(styles.keep)}>
                      {item !== undefined && item.maxEntries !== null && entries.length > 0
                        ? format(m.entriesUsedOf, { used: entries.length, most: item.maxEntries })
                        : format(m.entriesFiledCount, { count: entries.length })}
                    </span>
                    {item !== undefined && <span {...stylex.props(styles.clip)}>{calc(item)}</span>}
                  </span>
                </span>
                <span
                  data-scored={scored}
                  {...stylex.props(
                    styles.itemScore,
                    (!scored || score === 0) && styles.itemScoreZero,
                    scored && score < 0 && styles.itemScoreNegative,
                  )}
                >
                  {scored ? two(score) : '–'}
                </span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
