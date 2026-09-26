import { useEffect, useId, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, RefreshCwIcon } from 'lucide-react'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { LiveMark, type LiveState } from '@qualy/ui/live-mark'
import { Appear, Portion } from '@qualy/ui/reveal'
import { Ticker } from '@qualy/ui/ticker'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { trimAmount } from '../model.ts'
import type { StructureRow } from '../standing.ts'
import { SectionFigure, UnreadCount, UnreadDot } from './marks.tsx'
import { meterStyles } from './meter.ts'
import {
  dotOf,
  handsOn,
  rowWordOf,
  two,
  urgentTag,
  type Dot,
  type HeadStat,
  type Outline,
} from './model.ts'

// The round's structure as the reader's index of it: how far the whole has
// got at the top, and every section and question below, each question with
// a dot for where it stands and what it has earned.
//
// The same column is the whole first screen on a phone and the left column
// everywhere else. Sections fold; a section at the top stays pinned while its
// questions scroll under it, so a long paper never loses its place.

const spin = stylex.keyframes({ '100%': { transform: 'rotate(360deg)' } })

const styles = stylex.create({
  root: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    backgroundColor: tokens.background,
  },
  column: {
    minHeight: 0,
    height: '100%',
    overflow: 'hidden',
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: { default: 20, [breakpoints.phone]: 16 },
    paddingTop: 18,
    paddingBottom: 12,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  title: {
    margin: 0,
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.015em',
  },
  spinning: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  totals: { display: 'flex', flexDirection: 'column', gap: 9 },
  totalLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontVariantNumeric: 'tabular-nums',
  },
  totalGot: {
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.03em',
  },
  totalMuted: { color: tokens.mutedForeground },
  quiet: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  totalLabel: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  segments: { display: 'flex', gap: 3 },
  segment: {
    height: 6,
    minWidth: 6,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: tokens.surfaceMuted,
  },
  segmentFill: {
    display: 'block',
    height: '100%',
    borderRadius: 3,
  },
  metaRow: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 },
  meta: { minWidth: 0, fontSize: 11.5, color: tokens.mutedForeground },
  // a quiet word at the end of the line, the way to put the figures away
  // and bring them back
  statsKey: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 2,
    height: 22,
    marginRight: -6,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
    paddingInline: 6,
    fontSize: 11.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  statsKeyIcon: { width: 12, height: 12 },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
  },
  stat: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 70%, ${tokens.background})`,
    paddingInline: 12,
    paddingBlock: 10,
    fontVariantNumeric: 'tabular-nums',
  },
  statCount: { fontSize: 17, lineHeight: 1.2, fontWeight: 600 },
  statWaits: { color: tokens.warningForeground },
  statLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    padding: 3,
  },
  tab: {
    display: 'inline-flex',
    flexGrow: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 28,
    borderWidth: 0,
    borderRadius: 9999,
    backgroundColor: 'transparent',
    fontSize: 13,
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  tabOn: {
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px color-mix(in oklab, black 8%, transparent)',
    fontWeight: 500,
    color: tokens.foreground,
  },
  tabCount: { fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  tabCountWaits: { fontWeight: 600, color: tokens.warningForeground },
  // the tree scrolls inside the column; on a phone it is the page
  treeScroll: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingBottom: 28,
  },
  treeFlow: { paddingBottom: 24 },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  empty: {
    margin: 12,
    borderRadius: tokens.radiusLg,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    paddingInline: 12,
    paddingBlock: 16,
    fontSize: 13.5,
    color: tokens.mutedForeground,
  },
  // one row of the tree: a section's head or a question
  row: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, ${tokens.background})`,
    },
    paddingRight: 20,
    textAlign: 'left',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  rowTall: { minHeight: 44 },
  // a section's head: its fold key and the way to the section, side by side
  groupRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'stretch',
    gap: 4,
    backgroundColor: tokens.background,
    paddingLeft: 10,
  },
  groupMain: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingRight: 20,
    textAlign: 'left',
    cursor: 'pointer',
  },
  topGroup: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    minHeight: 36,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.background})`,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 90%, ${tokens.background})`,
    },
  },
  subGroup: {
    minHeight: 32,
    paddingLeft: 0,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, ${tokens.background})`,
    },
  },
  item: { minHeight: 36 },
  rowOn: {
    backgroundColor: tokens.surfaceMuted,
    boxShadow: `inset 2px 0 0 ${tokens.foreground}`,
  },
  fold: {
    display: 'inline-flex',
    width: 18,
    height: 18,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.foreground} 7%, transparent)`,
    },
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  foldIcon: { width: 11, height: 11 },
  number: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.03em',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  square: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  name: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  nameTop: { fontSize: 13, fontWeight: 600 },
  nameSub: { fontSize: 12.5, fontWeight: 500, color: tokens.surfaceMutedForeground },
  nameOn: { fontWeight: 600 },
  nameGone: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  foldNote: { flexShrink: 0, fontSize: 11, color: tokens.mutedForeground },
  word: {
    // next to nothing, so it keeps its room while the name gives up its own,
    // and gives it up once the name is down to its floor
    flexShrink: 0.01,
    minWidth: 0,
    maxWidth: 88,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  wordUrgent: { fontWeight: 500, color: tokens.warningForeground },
  // drawn only where there is a figure, set against the row's right edge so
  // every figure ends in the same place; an empty column would take the
  // room a question's name needs on a narrow rail
  score: {
    flexShrink: 0,
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  scoreNegative: { color: tokens.danger },
  guide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: tokens.divider,
  },
  dot: { width: 7, height: 7, flexShrink: 0, borderRadius: 9999 },
  chevron: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
})

/**
 * The dot beside a question (§32.72, amended): amber where the round waits
 * on the reader, dark green for what counts, grey for what is moving or
 * kept, hollow where it ended without counting or nothing is claimed yet.
 * News the reader has not seen is the mark after the name, not a colour here.
 */
const dotStyles = stylex.create({
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

const DOT: Record<Dot, stylex.StyleXStyles> = dotStyles

const INDENT = 16
const GUTTER = 20

/** how many characters of a question's name stay in sight however narrow its row */
const NAME_FLOOR = 5

const WIDE_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u

/**
 * The room the first few characters of a name take, in ems of its own type:
 * a wide character (Chinese, Japanese, Korean, full-width forms) about one,
 * anything else a little over half. A floor that overshoots a short name by
 * a hair only moves what follows it by that hair.
 */
const nameFloor = (name: string): string => {
  let ems = 0
  for (const character of [...name].slice(0, NAME_FLOOR)) {
    ems += WIDE_CHARACTER.test(character) ? 1 : 0.6
  }
  return `${String(ems)}em`
}

export function StructureRail({
  heading,
  headingLevel = 1,
  totalLabel,
  stream = null,
  outline,
  total,
  scored,
  stats,
  statsShown,
  onStatsShown,
  selectedId,
  onSelect,
  todoOnly,
  onTodoOnly,
  isTodo,
  todoLabel,
  todoEmpty,
  refreshing,
  onRefresh,
  layout,
}: {
  /** what the column is called: the reader's own filings, or somebody's account */
  heading: string
  /** 1 where the column's name is the page's own; 2 under a page that has one */
  headingLevel?: 1 | 2
  /** what the big figure is: the owner's counted so far, or somebody's current total */
  totalLabel: string
  /** whether the page keeps the account current as the round moves; null where it does not say */
  stream?: LiveState | null
  outline: Outline
  total: { readonly got: string | null; readonly cap: number | null }
  /** false while the score could not be read: every figure is unknown, not zero */
  scored: boolean
  stats: readonly HeadStat[]
  /** whether the figures under the total are out; the reader may put them away */
  statsShown: boolean
  onStatsShown: (shown: boolean) => void
  selectedId: string | null
  onSelect: (id: string) => void
  todoOnly: boolean
  onTodoOnly: (next: boolean) => void
  /** whether a question counts for the narrower view */
  isTodo: (row: StructureRow) => boolean
  todoLabel: MessageDescriptor
  /** what the narrower view says when nothing is left in it */
  todoEmpty: MessageDescriptor
  refreshing: boolean
  onRefresh: () => void
  /** a column that scrolls itself, or the whole of a phone's first screen */
  layout: 'column' | 'screen'
}) {
  const { format } = useI18n()
  const statsId = useId()
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const scroller = useRef<HTMLDivElement | null>(null)

  // the chosen row stays in view when it was chosen from somewhere else: the
  // next and previous keys, a crumb, a deep link
  useEffect(() => {
    if (selectedId === null || layout !== 'column') return
    const viewport = scroller.current
    const row = viewport?.querySelector(`[data-rail-row="${CSS.escape(selectedId)}"]`)
    if (viewport === null || viewport === undefined || !(row instanceof HTMLElement)) return
    const port = viewport.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    // clear of the pinned section head above it
    const pinned = 40
    if (at.top < port.top + pinned) viewport.scrollTop += at.top - port.top - pinned
    else if (at.bottom > port.bottom - 8) viewport.scrollTop += at.bottom - port.bottom + 8
  }, [selectedId, layout])

  const rows = outline.rows
  const items = outline.items
  const todoCount = items.filter(isTodo).length
  // news on a question the narrower view leaves out is said on the key back
  // to all of them, as a filter says the news it holds
  const newsLeftOut = todoOnly && items.some((row) => row.unread > 0 && !isTodo(row))
  const endOf = (index: number) => {
    let end = index + 1
    while (end < rows.length && rows[end]!.depth > rows[index]!.depth) end += 1
    return end
  }
  const holdsTodo = (index: number) =>
    rows.slice(index + 1, endOf(index)).some((row) => row.kind === 'item' && isTodo(row))
  /** the claims with news inside a section, said on its head while it is folded */
  const unreadInside = (index: number) =>
    rows.slice(index + 1, endOf(index)).reduce((sum, row) => sum + row.unread, 0)

  // what the tree lists: everything, or only what is left to do and the
  // sections holding it; folded sections keep their head and hide the rest
  const listed: { row: StructureRow; index: number; inside: number }[] = []
  let foldedAt: number | null = null
  rows.forEach((row, index) => {
    if (foldedAt !== null) {
      if (row.depth > foldedAt) return
      foldedAt = null
    }
    if (todoOnly) {
      if (row.kind === 'group' && !holdsTodo(index)) return
      if (row.kind === 'item' && !isTodo(row)) return
    }
    const inside = rows.slice(index + 1, endOf(index)).filter((one) => one.kind === 'item').length
    listed.push({ row, index, inside })
    if (row.kind === 'group' && folded.has(row.id)) foldedAt = row.depth
  })

  const capOf = (row: StructureRow) =>
    row.cap === null || row.cap === undefined || row.cap === '' ? null : Number(row.cap)
  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, level) => (
      <span
        key={level}
        aria-hidden
        {...stylex.props(styles.guide)}
        style={{ left: `${GUTTER + level * INDENT + 3}px` }}
      />
    ))

  const tree =
    listed.length === 0 ? (
      <p {...stylex.props(styles.empty)} data-testid="rail-empty">
        {format(todoEmpty)}
      </p>
    ) : (
      <ul {...stylex.props(styles.list)}>
        {listed.map(({ row, index, inside }) => {
          const no = outline.numbers.get(row.id) ?? ''
          const on = selectedId === row.id
          const indent = GUTTER + row.depth * INDENT
          if (row.kind === 'group') {
            const isFolded = folded.has(row.id)
            const top = row.depth === 0
            return (
              <li
                key={row.id}
                {...stylex.props(
                  styles.groupRow,
                  top ? styles.topGroup : styles.subGroup,
                  layout === 'screen' && styles.rowTall,
                  on && styles.rowOn,
                )}
              >
                {!top && guides(row.depth)}
                {top && (
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    aria-label={format(isFolded ? m.entriesUnfold : m.entriesFold, {
                      name: row.name,
                    })}
                    onClick={() =>
                      setFolded((now) => {
                        const next = new Set(now)
                        if (next.has(row.id)) next.delete(row.id)
                        else next.add(row.id)
                        return next
                      })
                    }
                    {...stylex.props(styles.fold)}
                  >
                    {isFolded ? (
                      <ChevronRightIcon aria-hidden {...stylex.props(styles.foldIcon)} />
                    ) : (
                      <ChevronDownIcon aria-hidden {...stylex.props(styles.foldIcon)} />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  data-rail-row={row.id}
                  data-kind="group"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onSelect(row.id)}
                  {...stylex.props(styles.groupMain)}
                  style={{ paddingLeft: top ? 0 : `${indent}px` }}
                >
                  {!top && <span aria-hidden {...stylex.props(styles.square)} />}
                  <span {...stylex.props(styles.number)}>{no}</span>
                  <span {...stylex.props(styles.name, top ? styles.nameTop : styles.nameSub)}>
                    {row.name}
                  </span>
                  {isFolded && (
                    <span {...stylex.props(styles.foldNote)}>
                      {format(m.entriesFoldedCount, { count: inside })}
                    </span>
                  )}
                  {/* folded away, the news under it is still said on its head */}
                  {isFolded && unreadInside(index) > 0 && (
                    <UnreadCount count={unreadInside(index)} />
                  )}
                  <span {...stylex.props(styles.spacer)} />
                  <SectionFigure got={row.right} cap={capOf(row)} scored={scored} />
                </button>
              </li>
            )
          }
          const word = rowWordOf(row)
          const gone = row.tag === 'voided'
          const score = row.right === '' ? 0 : Number(row.right)
          const figured = scored && score !== 0
          // the word is drawn only where the reader has something to do;
          // everything else the dot says, and the word is still read out
          const drawn = word !== null && handsOn(row)
          return (
            <li key={row.id}>
              <button
                type="button"
                title={[
                  row.name,
                  ...(word === null ? [] : [format(word)]),
                  ...(figured
                    ? [
                        format(score < 0 ? m.entriesDeductedFact : m.entriesCountedFact, {
                          value: two(Math.abs(score)),
                        }),
                      ]
                    : []),
                ].join(format(m.entriesListJoin))}
                data-rail-row={row.id}
                data-kind="item"
                data-tag={row.tag ?? ''}
                data-unread={row.unread > 0}
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(row.id)}
                {...stylex.props(
                  styles.row,
                  styles.item,
                  layout === 'screen' && styles.rowTall,
                  on && styles.rowOn,
                )}
                style={{ paddingLeft: `${indent}px` }}
              >
                {guides(row.depth)}
                <span
                  aria-hidden
                  data-dot={dotOf(row)}
                  {...stylex.props(styles.dot, DOT[dotOf(row)])}
                />
                <span
                  data-rail-name=""
                  {...stylex.props(styles.name, on && styles.nameOn, gone && styles.nameGone)}
                  // a question's name gives up its room first, down to its
                  // first few characters, and only then the word after it
                  style={{ minWidth: nameFloor(row.name) }}
                >
                  {row.name}
                </span>
                {row.unread > 0 && <UnreadCount count={row.unread} />}
                <span {...stylex.props(styles.spacer)} />
                {drawn ? (
                  <span
                    data-word=""
                    {...stylex.props(styles.word, urgentTag(row) && styles.wordUrgent)}
                  >
                    {format(word)}
                  </span>
                ) : (
                  word !== null && <VisuallyHidden>{format(word)}</VisuallyHidden>
                )}
                {figured && (
                  <span
                    data-amount={two(score)}
                    {...stylex.props(styles.score, score < 0 && styles.scoreNegative)}
                  >
                    {two(score)}
                  </span>
                )}
                {layout === 'screen' && (
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    )

  const got = total.got === null ? 0 : Number(total.got)
  const segments = outline.tops.flatMap((row) => {
    const cap = capOf(row)
    return cap === null || cap <= 0 ? [] : [{ row, cap }]
  })

  return (
    <div
      data-testid="structure-rail"
      {...stylex.props(styles.root, layout === 'column' && styles.column)}
    >
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titleRow)}>
          {headingLevel === 1 ? (
            <h1 {...stylex.props(styles.title)}>{heading}</h1>
          ) : (
            <h2 {...stylex.props(styles.title)}>{heading}</h2>
          )}
          {/* the page keeping time with the round, beside the way to ask
              again by hand; nothing where the round no longer moves */}
          {stream !== null && (
            <LiveMark state={stream} data-testid="entries-live">
              {format(m.resultLive, { state: stream })}
            </LiveMark>
          )}
          {/* the escape hatch, not the mechanism: state flows in on its own,
              and this is for the reader who wants to ask again anyway */}
          <Button variant="ghost" size="icon-sm" disabled={refreshing} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden {...stylex.props(refreshing && styles.spinning)} />
            <VisuallyHidden>{format(m.myEntriesRefresh)}</VisuallyHidden>
          </Button>
        </div>
        <div {...stylex.props(styles.totals)}>
          <div {...stylex.props(styles.totalLine)}>
            <span
              data-testid="entries-total"
              data-scored={scored}
              data-cap={total.cap === null ? '' : trimAmount(String(total.cap))}
              {...stylex.props(styles.totalGot, (!scored || got === 0) && styles.totalMuted)}
            >
              <Ticker value={scored && total.got !== null ? two(total.got) : '–'} />
            </span>
            {total.cap !== null && (
              <span {...stylex.props(styles.quiet)}>
                / {format(m.entriesPoints, { value: trimAmount(String(total.cap)) })}
              </span>
            )}
            <span {...stylex.props(styles.spacer)} />
            <span {...stylex.props(styles.totalLabel)}>{totalLabel}</span>
          </div>
          {segments.length > 1 && (
            <div {...stylex.props(styles.segments)} data-testid="entries-segments">
              {segments.map(({ row, cap }) => {
                const part = row.right === '' ? 0 : Number(row.right)
                const full = scored && part >= cap
                return (
                  <span
                    key={row.id}
                    title={`${row.name} ${two(row.right === '' ? '0' : row.right)} / ${trimAmount(String(cap))}`}
                    data-full={full}
                    {...stylex.props(styles.segment)}
                    style={{ flexGrow: cap, flexBasis: 0 }}
                  >
                    <Portion
                      share={scored ? Math.max(0, Math.min(100, (part / cap) * 100)) : 0}
                      className={
                        stylex.props(styles.segmentFill, full ? meterStyles.full : meterStyles.fill)
                          .className
                      }
                    />
                  </span>
                )
              })}
            </div>
          )}
          <div {...stylex.props(styles.metaRow)}>
            <span {...stylex.props(styles.meta)}>
              {outline.tops.length === 0
                ? format(m.myEntriesQuestions, { count: items.length })
                : format(m.myEntriesPaperMeta, {
                    groups: outline.tops.length,
                    items: items.length,
                  })}
            </span>
            <span {...stylex.props(styles.spacer)} />
            {stats.length > 0 && (
              <button
                type="button"
                data-testid="stats-toggle"
                aria-expanded={statsShown}
                aria-controls={statsShown ? statsId : undefined}
                onClick={() => onStatsShown(!statsShown)}
                {...stylex.props(styles.statsKey)}
              >
                {format(statsShown ? m.entriesStatsHide : m.entriesStatsShow)}
                {statsShown ? (
                  <ChevronUpIcon aria-hidden {...stylex.props(styles.statsKeyIcon)} />
                ) : (
                  <ChevronDownIcon aria-hidden {...stylex.props(styles.statsKeyIcon)} />
                )}
              </button>
            )}
          </div>
        </div>
        {/* put away, nothing is lost: what waits on the reader is still
            counted on the "to do" key below */}
        <Appear show={stats.length > 0 && statsShown} collapse>
          <div id={statsId} data-testid="entries-stats" {...stylex.props(styles.stats)}>
            {stats.map((stat) => (
              <span
                key={stat.key}
                data-stat={stat.key}
                data-count={stat.count}
                {...stylex.props(styles.stat)}
              >
                <b
                  {...stylex.props(
                    styles.statCount,
                    stat.waits && stat.count > 0 && styles.statWaits,
                  )}
                >
                  <Ticker value={String(stat.count)} />
                </b>
                <span {...stylex.props(styles.statLabel)}>{format(stat.label)}</span>
              </span>
            ))}
          </div>
        </Appear>
        <div {...stylex.props(styles.tabs)}>
          <button
            type="button"
            aria-pressed={!todoOnly}
            data-testid="rail-all"
            data-unread={newsLeftOut || undefined}
            onClick={() => onTodoOnly(false)}
            {...stylex.props(styles.tab, !todoOnly && styles.tabOn)}
          >
            {format(m.paperViewAll)}
            <span {...stylex.props(styles.tabCount)}>{items.length}</span>
            {newsLeftOut && (
              <>
                <UnreadDot />
                <VisuallyHidden>{format(m.holdsUnread)}</VisuallyHidden>
              </>
            )}
          </button>
          <button
            type="button"
            aria-pressed={todoOnly}
            data-testid="rail-todo"
            data-count={todoCount}
            onClick={() => onTodoOnly(true)}
            {...stylex.props(styles.tab, todoOnly && styles.tabOn)}
          >
            {format(todoLabel)}
            <span {...stylex.props(styles.tabCount, todoCount > 0 && styles.tabCountWaits)}>
              <Ticker value={String(todoCount)} />
            </span>
          </button>
        </div>
      </div>
      <nav
        ref={scroller}
        aria-label={format(m.paperStructure)}
        {...stylex.props(layout === 'column' ? styles.treeScroll : styles.treeFlow)}
      >
        {tree}
      </nav>
    </div>
  )
}
