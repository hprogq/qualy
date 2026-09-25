import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import * as stylex from '@stylexjs/stylex'
import { Portion } from '@qualy/ui/reveal'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AlignLeftIcon, BarChart3Icon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { isApiErrorCode, useI18n, useList } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../i18n.ts'
import { inZone, useBatchZone } from '../batch/zone.ts'
import {
  buildLedger,
  twoPlaces,
  type LedgerAdjustmentView,
  type LedgerEntry,
  type LedgerGroupView,
  type LedgerItem,
  type LedgerItemView,
  type LedgerLineView,
  type LedgerModel,
  type LedgerResult,
  type LedgerSection,
} from './ledger.ts'

export type { LedgerEntry, LedgerItem, LedgerResult } from './ledger.ts'

// One ledger the algorithm can be read off, whoever is reading it.
//
// A single column, read like a statement: every top group is a band that
// holds to the top of the window while its rows pass under it, a group
// inside it is a lighter heading, and every question is a two-line row -
// what it is and what it came to, then where that came from and the rule
// behind it. A question with several claims opens in place to list them; a
// limit that bit is its own dashed line with the difference written out,
// never a silent clamp. Questions that came to nothing stay where they are
// at 0.00 with the reason beside them.
//
// Beside it, where the width allows and there is more than one group to
// move between, an outline of the top groups follows the reading and jumps
// on a press; narrow, the same outline is a row of chips pinned over the
// bands. Zero groups, one, or dozens all draw with the same parts.
//
// It is presentation and nothing else. It does not know which api answered
// or where a claim opens - the page hands it `onEntryOpen` and `onItemOpen`
// for that - which is the point: a participant reading their own standing
// and staff checking it are looking at one explanation of one number.

/** below this much room the outline folds into chips over the ledger */
const OUTLINE_AT = 880
/** the outline's own column */
const OUTLINE_WIDTH = 232
/** the ledger never reads wider than a statement does */
const LEDGER_WIDTH = 820
/** the chip row's height, which the bands stick under */
const STRIP_HEIGHT = 44
/** a question lists this many claims before pointing to the rest */
const LINES_SHOWN = 6

const INDENT = 14
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const two = twoPlaces

/** a configured amount as a rule says it: 6, not 6.0000 */
const plain = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value

const styles = stylex.create({
  root: {
    // the bands and the chip row stack among themselves, not against
    // whatever the page around them pins
    isolation: 'isolate',
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  measure: { width: '100%', marginInline: 'auto' },
  // inside a page that lines its own content up at the start
  measureStart: { marginInlineStart: 0 },
  measureWide: { maxWidth: OUTLINE_WIDTH + 24 + LEDGER_WIDTH },
  measureNarrow: { maxWidth: LEDGER_WIDTH },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: 40,
    rowGap: 14,
    paddingBottom: { default: 20, [breakpoints.phone]: 14 },
  },
  headMain: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  title: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  totalLabel: { margin: 0, fontSize: 13, fontWeight: 500, color: tokens.mutedForeground },
  mode: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 22,
    paddingInline: 8,
    borderRadius: 6,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
  },
  modeDot: { width: 6, height: 6, borderRadius: 9999, backgroundColor: tokens.warning },
  totalRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontVariantNumeric: 'tabular-nums',
  },
  total: {
    fontSize: { default: 40, [breakpoints.phone]: 36 },
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.035em',
  },
  negative: { color: tokens.danger },
  outOf: { fontSize: 15, whiteSpace: 'nowrap', color: tokens.mutedForeground },
  note: {
    margin: 0,
    maxWidth: '56ch',
    fontSize: 13.5,
    lineHeight: 1.6,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  shares: {
    display: 'flex',
    minWidth: { default: 420, [breakpoints.phone]: '100%' },
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: 'column',
    gap: 9,
  },
  bar: {
    display: 'flex',
    height: 10,
    gap: 2,
    overflow: 'hidden',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
  },
  segment: { flexShrink: 0 },
  legend: { display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  legendItem: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  swatch: { width: 8, height: 8, flexShrink: 0, borderRadius: 2 },
  legendValue: { color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  // narrow: the outline as a row of chips, pinned over the bands
  strip: {
    position: 'sticky',
    zIndex: 6,
    display: 'flex',
    height: STRIP_HEIGHT,
    boxSizing: 'border-box',
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    paddingInline: 4,
    marginBottom: 12,
    borderBlockWidth: 1,
    borderBlockStyle: 'solid',
    borderBlockColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surface} 94%, transparent)`,
    backdropFilter: 'blur(6px)',
  },
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, ${tokens.surface})`,
    fontSize: 12.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    outline: { default: null, ':focus-visible': `2px solid ${tokens.focusRing}` },
    outlineOffset: -2,
  },
  chipOn: { backgroundColor: tokens.surfaceMuted, fontWeight: 600, color: tokens.foreground },
  chipScore: { color: tokens.mutedForeground },
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
  bodyWide: {
    display: 'grid',
    gridTemplateColumns: `${String(OUTLINE_WIDTH)}px minmax(0, 1fr)`,
    alignItems: 'start',
    gap: 24,
  },
  outline: {
    position: 'sticky',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
    overscrollBehaviorY: 'contain',
    scrollbarWidth: 'thin',
  },
  outlineHeading: {
    margin: 0,
    paddingInline: 10,
    paddingBottom: 6,
    fontSize: 11.5,
    fontWeight: 500,
    letterSpacing: '0.06em',
    color: tokens.mutedForeground,
  },
  outlineItem: {
    display: 'flex',
    flexShrink: 0,
    width: '100%',
    flexDirection: 'column',
    gap: 5,
    paddingInline: 10,
    paddingBlock: 7,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: { default: '120ms', [REDUCE]: '0s' },
    outline: { default: null, ':focus-visible': `2px solid ${tokens.focusRing}` },
    outlineOffset: -2,
  },
  outlineItemOn: { backgroundColor: tokens.surfaceMuted },
  outlineRow: { display: 'flex', width: '100%', alignItems: 'baseline', gap: 8, fontSize: 13 },
  outlineNo: {
    flexShrink: 0,
    fontSize: 11,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  outlineName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
    color: tokens.surfaceMutedForeground,
  },
  outlineNameOn: { fontWeight: 600, color: tokens.foreground },
  outlineScore: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  meter: {
    display: 'block',
    width: '100%',
    height: 3,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: tokens.surfaceMuted,
  },
  meterFill: {
    display: 'block',
    height: '100%',
    borderRadius: 2,
    backgroundColor: tokens.foreground,
  },
  meterFull: { backgroundColor: tokens.success },
  // the statement itself; no clipping, or the bands could not hold
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  band: {
    position: 'sticky',
    zIndex: 4,
    display: 'flex',
    minHeight: 42,
    alignItems: 'center',
    gap: 8,
    paddingInline: { default: 16, [breakpoints.phone]: 12 },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 70%, ${tokens.surface})`,
    outline: 'none',
  },
  first: {
    borderTopWidth: 0,
    borderTopLeftRadius: tokens.radiusLg,
    borderTopRightRadius: tokens.radiusLg,
  },
  bandNo: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.03em',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  bandName: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  fullMark: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 17,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    fontSize: 10.5,
    fontWeight: 500,
    color: tokens.successForeground,
  },
  bandNote: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: { flexGrow: 1, minWidth: 8 },
  figure: { flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  bandValue: { fontSize: 15, fontWeight: 600 },
  subValue: { fontSize: 12.5, fontWeight: 600 },
  zero: { color: tokens.mutedForeground },
  cap: { fontSize: 12, color: tokens.mutedForeground },
  subBand: {
    display: 'flex',
    minHeight: 32,
    alignItems: 'center',
    gap: 8,
    paddingInlineEnd: { default: 16, [breakpoints.phone]: 12 },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, ${tokens.surface})`,
  },
  subName: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  itemFirst: { borderTopWidth: 0 },
  // what a row is and what it came to, then where that came from and the rule
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    // each figure on the line of the words it belongs to, however many
    // lines a long title takes
    alignItems: 'baseline',
    columnGap: 14,
    rowGap: 4,
    paddingBlock: 10,
    paddingInlineEnd: { default: 16, [breakpoints.phone]: 12 },
    borderWidth: 0,
    backgroundColor: 'transparent',
    textAlign: 'start',
    color: 'inherit',
    font: 'inherit',
  },
  pressable: {
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 35%, transparent)`,
    },
    transitionProperty: 'background-color',
    transitionDuration: { default: '120ms', [REDUCE]: '0s' },
    outline: { default: null, ':focus-visible': `2px solid ${tokens.focusRing}` },
    outlineOffset: -2,
  },
  // the title and its mark flow as words do: a long title wraps and the mark
  // follows its last word rather than squeezing it into a column
  titleCell: { display: 'block', minWidth: 0 },
  itemTitle: {
    overflowWrap: 'anywhere',
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 500,
  },
  quiet: { color: tokens.surfaceMutedForeground },
  struck: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    verticalAlign: 'middle',
    alignItems: 'center',
    height: 18,
    paddingInline: 6,
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  titleTag: { marginInlineStart: 8 },
  tagNeutral: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
  tagAttention: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 18%, transparent)`,
    color: tokens.warningForeground,
  },
  value: {
    textAlign: 'end',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  valueZero: { fontWeight: 400, color: tokens.mutedForeground },
  // one line at a desk, cut short if it must; on a phone it wraps, and the
  // chevron follows the last word
  madeCell: {
    display: { default: 'flex', [breakpoints.phone]: 'block' },
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  made: {
    display: { default: 'block', [breakpoints.phone]: 'inline' },
    minWidth: 0,
    overflow: { default: 'hidden', [breakpoints.phone]: 'visible' },
    textOverflow: 'ellipsis',
    whiteSpace: { default: 'nowrap', [breakpoints.phone]: 'normal' },
  },
  chevron: {
    display: 'inline-block',
    width: 12,
    height: 12,
    flexShrink: 0,
    marginInlineStart: { default: 0, [breakpoints.phone]: 4 },
    verticalAlign: 'middle',
    color: tokens.mutedForeground,
    transitionProperty: 'transform',
    transitionDuration: { default: '200ms', [REDUCE]: '0s' },
  },
  chevronOpen: { transform: 'rotate(180deg)' },
  rule: {
    textAlign: 'end',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the claims under a question, opened in place
  fold: {
    display: 'grid',
    gridTemplateRows: '0fr',
    transitionProperty: 'grid-template-rows',
    transitionDuration: { default: '200ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  foldOpen: { gridTemplateRows: '1fr' },
  foldInner: { minHeight: 0, overflow: 'hidden' },
  foldSeat: { paddingBottom: 12, paddingInlineEnd: { default: 16, [breakpoints.phone]: 12 } },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.surface})`,
  },
  line: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: 12,
    minHeight: 34,
    paddingBlock: 6,
    paddingInline: 12,
    borderWidth: 0,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: 'transparent',
    textAlign: 'start',
    fontSize: 12.5,
    color: 'inherit',
  },
  lineMain: {
    display: 'flex',
    minWidth: 0,
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 2,
  },
  lineLead: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.foreground,
  },
  lineSub: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  lineWhen: {
    flexShrink: 0,
    fontSize: 11.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  lineValue: { textAlign: 'end', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  more: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: 'transparent',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.surfaceMutedForeground,
  },
  moreIcon: { width: 12, height: 12 },
  trim: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    paddingBlock: 9,
    paddingInlineEnd: { default: 16, [breakpoints.phone]: 12 },
    borderTopWidth: 1,
    borderTopStyle: 'dashed',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
  },
  trimIcon: { width: 14, height: 14, flexShrink: 0, marginTop: 2, color: tokens.mutedForeground },
  trimText: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    textWrap: 'pretty',
    color: tokens.surfaceMutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  trimValue: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 500,
    color: tokens.surfaceMutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingInline: { default: 16, [breakpoints.phone]: 12 },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    borderBottomLeftRadius: tokens.radiusLg,
    borderBottomRightRadius: tokens.radiusLg,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.surface})`,
  },
  footLabel: { fontSize: 14, fontWeight: 600 },
  footValue: { fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    paddingBlock: 56,
    paddingInline: 16,
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.elevation1,
    backgroundColor: tokens.surface,
    textAlign: 'center',
  },
  emptyMark: { width: 22, height: 22, color: tokens.mutedForeground },
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  unavailable: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
    maxWidth: LEDGER_WIDTH,
    marginInline: 'auto',
    padding: 20,
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.elevation1,
    backgroundColor: tokens.surface,
  },
  unavailableTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  unavailableHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  unavailableActions: { display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
})

const inks = stylex.create({
  first: { backgroundColor: tokens.foreground },
  second: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 72%, ${tokens.surface})` },
  third: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 50%, ${tokens.surface})` },
  fourth: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 32%, ${tokens.surface})` },
})
const SHARE_INKS = [inks.first, inks.second, inks.third, inks.fourth] as const
const inkAt = (index: number) => SHARE_INKS[index % SHARE_INKS.length]

/** the nearest ancestor that scrolls, or null when the window does */
const scrollerOf = (from: HTMLElement | null): HTMLElement | null => {
  for (let at = from?.parentElement ?? null; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

const stillMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** how wide the ledger's own seat is: its layout follows the room it has, not the window */
function useSeatWidth(seat: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = seat.current
    if (element === null) return
    setWidth(element.getBoundingClientRect().width)
    const watch = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width))
    watch.observe(element)
    return () => watch.disconnect()
  }, [seat])
  return width
}

/** how tall the window the ledger scrolls in is, for an outline that must fit inside it */
function useViewportHeight(seat: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const box = scrollerOf(seat.current)
    const measure = () => setHeight(box === null ? window.innerHeight : box.clientHeight)
    measure()
    if (box === null) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const watch = new ResizeObserver(measure)
    watch.observe(box)
    return () => watch.disconnect()
  }, [seat])
  return height
}

/**
 * The account: the total, how it divides, and every line behind it.
 *
 * `onEntryOpen` turns a number back into the claim it came from, and
 * `onItemOpen` leads to all of one question's claims where a question holds
 * more than the ledger lists; a reader with nowhere to be taken passes
 * neither and the lines stay plain text. `heading` names the page when the
 * ledger is the page; without it the head says only "total score".
 */
export function ResultLedger({
  result,
  items,
  entries,
  emptyAction,
  onEntryOpen,
  onItemOpen,
  heading,
  reader = 'owner',
  stickyTop = 0,
  align = 'center',
}: {
  result: LedgerResult
  items: readonly LedgerItem[]
  entries: readonly LedgerEntry[]
  /** what the empty state offers; the page decides where that leads */
  emptyAction?: ReactNode
  onEntryOpen?: (entryId: string) => void
  /** all of one question's claims, where the ledger lists only the first few */
  onItemOpen?: (itemId: string) => void
  /** the page's own name, when the ledger is the page */
  heading?: ReactNode
  /** whose account this is to the person reading it */
  reader?: 'owner' | 'staff'
  /** how far down the scroller something of the page's own is already pinned */
  stickyTop?: number
  /** centred when the ledger is the page; at the start inside a page that lines up there */
  align?: 'center' | 'start'
}) {
  const model = useMemo(() => buildLedger({ result, items, entries }), [result, items, entries])
  const seat = useRef<HTMLDivElement>(null)
  const width = useSeatWidth(seat)
  const viewport = useViewportHeight(seat)
  const wide = width === null || width >= OUTLINE_AT
  const moving = model.tops.length >= 2
  const outline = wide && moving
  const strip = !wide && moving
  const bandTop = stickyTop + (strip ? STRIP_HEIGHT : 0)

  const sections = useRef(new Map<string, HTMLElement>())
  const bands = useRef(new Map<string, HTMLElement>())
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const topIds = model.tops.map((top) => top.id).join(' ')

  // A group the reader jumped to stays the one being read until they take
  // the scroll back themselves: the last groups of a short page cannot come
  // to the top, and the outline must not then name a group they did not ask
  // for.
  const pinned = useRef<string | null>(null)

  // Which top group is being read: the last one whose section has reached
  // the line under the pinned band. At the very end of the page the last
  // group is the one being read, however short it is.
  useEffect(() => {
    if (!moving) return
    const box = scrollerOf(seat.current)
    const ids = topIds.split(' ')
    let frame = 0
    const read = () => {
      frame = 0
      if (pinned.current !== null) {
        setActive(pinned.current)
        return
      }
      const edge = (box?.getBoundingClientRect().top ?? 0) + bandTop + 8
      let current = ids[0] ?? null
      for (const id of ids) {
        const section = sections.current.get(id)
        if (section !== undefined && section.getBoundingClientRect().top <= edge) current = id
      }
      const end =
        box === null
          ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
          : box.scrollTop + box.clientHeight >= box.scrollHeight - 2
      const scrolled = box === null ? window.scrollY > 0 : box.scrollTop > 0
      if (end && scrolled) current = ids.at(-1) ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // the reader scrolling for themselves, by any hand
    const release = () => {
      pinned.current = null
    }
    const target: HTMLElement | Window = box ?? window
    const intents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    read()
    target.addEventListener('scroll', onScroll, { passive: true })
    for (const intent of intents) target.addEventListener(intent, release, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      for (const intent of intents) target.removeEventListener(intent, release)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [moving, topIds, bandTop])

  const jump = (id: string) => {
    const section = sections.current.get(id)
    if (section === undefined) return
    const box = scrollerOf(seat.current)
    const behavior: ScrollBehavior = stillMotion() ? 'auto' : 'smooth'
    const offset = section.getBoundingClientRect().top - (box?.getBoundingClientRect().top ?? 0)
    pinned.current = id
    if (box === null) {
      window.scrollTo({ top: Math.max(0, window.scrollY + offset - bandTop), behavior })
    } else {
      box.scrollTo({ top: Math.max(0, box.scrollTop + offset - bandTop), behavior })
    }
    setActive(id)
    // the reader's place moves to the group, not only their eyes
    bands.current.get(id)?.focus({ preventScroll: true })
  }

  const current = active ?? model.tops[0]?.id ?? null
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      ref={seat}
      data-testid="result-ledger"
      data-layout={outline ? 'outline' : strip ? 'strip' : 'single'}
      {...stylex.props(styles.root)}
    >
      <div
        {...stylex.props(
          styles.measure,
          outline ? styles.measureWide : styles.measureNarrow,
          align === 'start' && styles.measureStart,
        )}
      >
        <Head model={model} mode={result.mode} heading={heading} />
      </div>
      {/* a direct child of the whole ledger, so it holds for all of it */}
      {strip && (
        <Strip
          model={model}
          active={current}
          top={stickyTop}
          start={align === 'start'}
          onJump={jump}
        />
      )}
      <div
        {...stylex.props(
          styles.measure,
          outline ? styles.measureWide : styles.measureNarrow,
          align === 'start' && styles.measureStart,
          styles.body,
          outline && styles.bodyWide,
        )}
      >
        {outline && (
          <Outline
            model={model}
            active={current}
            top={stickyTop + 16}
            room={viewport === null ? null : viewport - stickyTop - 32}
            onJump={jump}
          />
        )}
        {model.empty ? (
          <Nothing action={emptyAction} />
        ) : (
          <div {...stylex.props(styles.card)}>
            {model.sections.map((section, index) => (
              <Section
                key={section.group?.id ?? 'ungrouped'}
                section={section}
                first={index === 0}
                titled={model.tops.length > 0}
                bandTop={bandTop}
                reader={reader}
                open={open}
                onToggle={toggle}
                onEntryOpen={onEntryOpen}
                onItemOpen={onItemOpen}
                holdSection={(element) => {
                  if (section.group === null) return
                  if (element === null) sections.current.delete(section.group.id)
                  else sections.current.set(section.group.id, element)
                }}
                holdBand={(element) => {
                  if (section.group === null) return
                  if (element === null) bands.current.delete(section.group.id)
                  else bands.current.set(section.group.id, element)
                }}
              />
            ))}
            <Foot total={model.totalCents} />
          </div>
        )}
      </div>
    </div>
  )
}

type Format = ReturnType<typeof useI18n>['format']

/** the day something happened, on the batch's clock, the way a ledger dates a line */
const dayOf = (at: string | null, locale: string, zone: string | undefined): string | null => {
  const moment = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(moment)
    ? null
    : new Date(moment).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        ...inZone(zone),
      })
}

/** a group's figure as its band says it: what it came to, over its limit */
const scoreOf = (group: LedgerGroupView): string =>
  group.capCents === null ? two(group.cents) : `${two(group.cents)} / ${plain(two(group.capCents))}`

/** the page's first line: the total, what it is out of, and how it will move */
function Head({
  model,
  mode,
  heading,
}: {
  model: LedgerModel
  mode: string
  heading: ReactNode | undefined
}) {
  const { format } = useI18n()
  return (
    <header {...stylex.props(styles.head)}>
      <div {...stylex.props(styles.headMain)}>
        <div {...stylex.props(styles.titleRow)}>
          {heading === undefined ? (
            <p {...stylex.props(styles.totalLabel)}>{format(m.resultGrandTotal)}</p>
          ) : (
            <h1 {...stylex.props(styles.title)}>{heading}</h1>
          )}
          <span data-testid="result-mode" data-mode={mode} {...stylex.props(styles.mode)}>
            <span aria-hidden {...stylex.props(styles.modeDot)} />
            {format(m.resultProvisionalMark)}
          </span>
        </div>
        <div {...stylex.props(styles.totalRow)}>
          <span
            data-testid="result-total"
            {...stylex.props(styles.total, model.totalCents < 0 && styles.negative)}
          >
            {two(model.totalCents)}
          </span>
          {model.fullCents !== null && (
            <span {...stylex.props(styles.outOf)}>
              {format(m.resultOutOf, { full: plain(two(model.fullCents)) })}
            </span>
          )}
        </div>
        <p
          data-testid="result-moving"
          data-pending={model.pending}
          data-drafts={model.drafts}
          data-trimmed={two(model.trimmedCents)}
          {...stylex.props(styles.note)}
        >
          {format(m.resultHeadNote, {
            pending: model.pending,
            drafts: model.drafts,
            trimmed: model.trimmedCents > 0 ? two(model.trimmedCents) : 'none',
          })}
        </p>
      </div>
      {model.shares !== null && model.shares.length > 0 && (
        <div
          data-testid="result-shares"
          data-count={model.shares.length}
          {...stylex.props(styles.shares)}
        >
          <div {...stylex.props(styles.bar)}>
            {model.shares.map((share, index) => (
              <Portion
                key={share.id}
                share={share.pct}
                className={stylex.props(styles.segment, inkAt(index)).className}
              />
            ))}
          </div>
          <div {...stylex.props(styles.legend)}>
            {model.shares.map((share, index) => (
              <span key={share.id} {...stylex.props(styles.legendItem)}>
                <span aria-hidden {...stylex.props(styles.swatch, inkAt(index))} />
                {share.name}
                <span {...stylex.props(styles.legendValue)}>{two(share.cents)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

/** narrow: the top groups as chips, pinned over the bands, following the reading */
function Strip({
  model,
  active,
  top,
  start,
  onJump,
}: {
  model: LedgerModel
  active: string | null
  top: number
  start: boolean
  onJump: (id: string) => void
}) {
  const { format } = useI18n()
  const row = useRef<HTMLElement>(null)
  // the chip being read stays in sight as the reading moves past the edge
  useEffect(() => {
    const nav = row.current
    if (nav === null || active === null) return
    const chip = [...nav.querySelectorAll<HTMLElement>('[data-group]')].find(
      (one) => one.dataset['group'] === active,
    )
    if (chip === undefined) return
    const left = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2
    nav.scrollTo({ left: Math.max(0, left), behavior: stillMotion() ? 'auto' : 'smooth' })
  }, [active])
  return (
    <nav
      ref={row}
      aria-label={format(m.resultOutlineLabel)}
      data-testid="result-strip"
      {...stylex.props(
        styles.measure,
        styles.measureNarrow,
        start && styles.measureStart,
        styles.strip,
      )}
      style={{ top }}
    >
      {model.tops.map((group) => {
        const on = group.id === active
        return (
          <button
            key={group.id}
            type="button"
            data-testid="strip-group"
            data-group={group.id}
            aria-current={on ? 'true' : undefined}
            onClick={() => onJump(group.id)}
            {...stylex.props(styles.chip, on && styles.chipOn)}
          >
            {group.name}
            <span {...stylex.props(styles.chipScore)}>{scoreOf(group)}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** wide: the top groups in a column beside the ledger, following the reading */
function Outline({
  model,
  active,
  top,
  room,
  onJump,
}: {
  model: LedgerModel
  active: string | null
  top: number
  /** how tall it may be before it scrolls on its own */
  room: number | null
  onJump: (id: string) => void
}) {
  const { format } = useI18n()
  const list = useRef<HTMLElement>(null)
  // dozens of groups scroll inside the outline; the one being read stays in it
  useEffect(() => {
    const nav = list.current
    if (nav === null || active === null) return
    const entry = [...nav.querySelectorAll<HTMLElement>('[data-group]')].find(
      (one) => one.dataset['group'] === active,
    )
    if (entry === undefined) return
    const above = entry.offsetTop < nav.scrollTop
    const below = entry.offsetTop + entry.offsetHeight > nav.scrollTop + nav.clientHeight
    if (!above && !below) return
    nav.scrollTo({
      top: above ? entry.offsetTop : entry.offsetTop + entry.offsetHeight - nav.clientHeight,
      behavior: stillMotion() ? 'auto' : 'smooth',
    })
  }, [active])
  return (
    <nav
      ref={list}
      aria-label={format(m.resultOutlineLabel)}
      data-testid="result-outline"
      {...stylex.props(styles.outline)}
      style={{ top, ...(room === null ? {} : { maxHeight: Math.max(160, room) }) }}
    >
      <p {...stylex.props(styles.outlineHeading)}>
        {format(m.resultOutlineHeading, { count: model.tops.length })}
      </p>
      {model.tops.map((group) => {
        const on = group.id === active
        const pct =
          group.capCents === null || group.capCents <= 0
            ? 0
            : Math.min(100, Math.max(0, (group.cents / group.capCents) * 100))
        return (
          <button
            key={group.id}
            type="button"
            data-testid="outline-group"
            data-group={group.id}
            aria-current={on ? 'true' : undefined}
            onClick={() => onJump(group.id)}
            {...stylex.props(styles.outlineItem, on && styles.outlineItemOn)}
          >
            <span {...stylex.props(styles.outlineRow)}>
              <span aria-hidden {...stylex.props(styles.outlineNo)}>
                {group.no}
              </span>
              <span
                title={group.name}
                {...stylex.props(styles.outlineName, on && styles.outlineNameOn)}
              >
                {group.name}
              </span>
              <span {...stylex.props(styles.outlineScore, group.cents < 0 && styles.negative)}>
                {scoreOf(group)}
              </span>
            </span>
            {group.capCents !== null && (
              <span aria-hidden {...stylex.props(styles.meter)}>
                <span
                  {...stylex.props(styles.meterFill, group.full && styles.meterFull)}
                  style={{ width: `${String(pct)}%` }}
                />
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

/** one top group - its band and everything under it - or the questions no group holds */
function Section({
  section,
  first,
  titled,
  bandTop,
  reader,
  open,
  onToggle,
  onEntryOpen,
  onItemOpen,
  holdSection,
  holdBand,
}: {
  section: LedgerSection
  first: boolean
  /** whether the ledger has top groups, so questions outside them need a band of their own */
  titled: boolean
  bandTop: number
  reader: 'owner' | 'staff'
  open: ReadonlySet<string>
  onToggle: (id: string) => void
  onEntryOpen: ((entryId: string) => void) | undefined
  onItemOpen: ((itemId: string) => void) | undefined
  holdSection: (element: HTMLElement | null) => void
  holdBand: (element: HTMLElement | null) => void
}) {
  const { format } = useI18n()
  const group = section.group
  const banded = group !== null || titled
  const looseCents = section.rows.reduce(
    (sum, row) => (row.kind === 'item' ? sum + row.cents : sum),
    0,
  )
  return (
    <section
      ref={holdSection}
      data-testid="ledger-group"
      data-group={group?.id ?? 'ungrouped'}
      data-full={group?.full === true ? 'true' : undefined}
      data-pending={group?.pending}
      data-left={group === null || group.leftCents === null ? undefined : two(group.leftCents)}
    >
      {banded && (
        <div
          ref={holdBand}
          tabIndex={-1}
          {...stylex.props(styles.band, first && styles.first)}
          style={{ top: bandTop }}
        >
          {group !== null && (
            <span aria-hidden {...stylex.props(styles.bandNo)}>
              {group.no}
            </span>
          )}
          <h2 title={group?.name} {...stylex.props(styles.bandName)}>
            {group?.name ?? format(m.resultUngrouped)}
          </h2>
          {group?.full === true && (
            <span {...stylex.props(styles.fullMark)}>{format(m.resultGroupFull)}</span>
          )}
          {group !== null && !group.full && (group.pending > 0 || group.leftCents !== null) && (
            <span {...stylex.props(styles.bandNote)}>
              {group.pending > 0
                ? format(m.resultGroupPending, { count: group.pending })
                : format(m.resultGroupLeft, { value: two(group.leftCents ?? 0) })}
            </span>
          )}
          <span {...stylex.props(styles.spacer)} />
          <Figure
            cents={group?.cents ?? looseCents}
            capCents={group?.capCents ?? null}
            size="band"
          />
        </div>
      )}
      {section.rows.map((row, index) => {
        if (row.kind === 'group') return <SubBand key={row.id} group={row} />
        if (row.kind === 'adjustment') {
          return <Trim key={`${row.groupId}:limit`} adjustment={row} />
        }
        return (
          <ItemRow
            key={row.id}
            item={row}
            first={!banded && first && index === 0}
            reader={reader}
            open={open.has(row.id)}
            onToggle={onToggle}
            onEntryOpen={onEntryOpen}
            onItemOpen={onItemOpen}
          />
        )
      })}
    </section>
  )
}

function Figure({
  cents,
  capCents,
  size,
}: {
  cents: number
  capCents: number | null
  size: 'band' | 'sub'
}) {
  return (
    <span {...stylex.props(styles.figure)}>
      <span
        {...stylex.props(
          size === 'band' ? styles.bandValue : styles.subValue,
          cents === 0 && styles.zero,
          cents < 0 && styles.negative,
        )}
      >
        {two(cents)}
      </span>
      {capCents !== null && (
        <span {...stylex.props(styles.cap)}>{` / ${plain(two(capCents))}`}</span>
      )}
    </span>
  )
}

/** a group inside a top group: a lighter heading, not a band that holds */
function SubBand({ group }: { group: LedgerGroupView }) {
  const { format } = useI18n()
  return (
    <div
      data-testid="ledger-subgroup"
      data-group={group.id}
      {...stylex.props(styles.subBand)}
      style={{ paddingInlineStart: 16 + group.depth * INDENT }}
    >
      <span aria-hidden {...stylex.props(styles.bandNo)}>
        {group.no}
      </span>
      <h3 title={group.name} {...stylex.props(styles.subName)}>
        {group.name}
      </h3>
      {group.full && <span {...stylex.props(styles.fullMark)}>{format(m.resultGroupFull)}</span>}
      <span {...stylex.props(styles.spacer)} />
      <Figure cents={group.cents} capCents={group.capCents} size="sub" />
    </div>
  )
}

const FACT_ORDER = [
  'approved',
  'recorded',
  'notCounted',
  'reconsidering',
  'pending',
  'asked',
  'returned',
  'refused',
  'abandoned',
  'revoked',
  'excluded',
  'drafts',
] as const

/** a line that is on the account and not counted, which says so beside its name */
const UNCOUNTED: ReadonlySet<LedgerLineView['standing']> = new Set([
  'notCounted',
  'refused',
  'abandoned',
  'revoked',
  'excluded',
])

/**
 * Where a question's figure came from, in one line: which claim it was when
 * there is one, how its claims stand when there are several, and why it is
 * nothing when it is nothing.
 */
const madeOf = (
  item: LedgerItemView,
  format: Format,
  list: (parts: readonly string[]) => string,
  dayOf: (at: string | null) => string | null,
): string => {
  if (item.voided) return format(m.resultMade, { kind: 'voided' })
  if (item.derived) return format(m.resultMade, { kind: 'derived' })
  const { facts } = item
  const moving = facts.pending + facts.asked + facts.returned + facts.drafts + facts.reconsidering
  const only = item.lines.length === 1 ? item.lines[0] : undefined
  if (only !== undefined && moving === 0) {
    // a record says when the office made it; a filing's own date is on the
    // filing page, one press away
    const day = only.recorded ? dayOf(only.at) : null
    const said = format(m.resultWord, { kind: only.standing })
    const word = day === null ? said : `${day} ${said}`
    const identity = [only.lead, only.sub].filter((part): part is string => part !== null).join(' ')
    return identity === '' ? word : `${word} · ${identity}`
  }
  const parts = FACT_ORDER.filter((kind) => facts[kind] > 0).map((kind) =>
    format(m.resultFact, { kind, count: facts[kind] }),
  )
  if (parts.length > 0) return list(parts)
  return format(m.resultMade, { kind: item.recordedOnly ? 'recorded' : 'none' })
}

/** the one thing about a question worth a mark beside its name */
const tagOf = (
  item: LedgerItemView,
): { kind: 'todo' | 'drafts' | 'pending'; count: number; attention: boolean } | null => {
  if (item.voided) return null
  const { facts } = item
  const todo = facts.asked + facts.returned
  if (todo > 0) return { kind: 'todo', count: todo, attention: true }
  const settled = facts.approved + facts.recorded
  if (facts.drafts > 0 && settled === 0) {
    return { kind: 'drafts', count: facts.drafts, attention: true }
  }
  const moving = facts.pending + facts.reconsidering
  if (moving > 0 && settled === 0) return { kind: 'pending', count: moving, attention: false }
  return null
}

/** the question's rule, as briefly as a column can say it */
const ruleOf = (item: LedgerItemView, format: Format): string | null => {
  if (item.voided) return null
  if (item.perPerson !== null) {
    return format(m.resultRule, { kind: 'person', value: plain(item.perPerson) })
  }
  if (item.each !== null) return format(m.resultRule, { kind: 'each', value: plain(item.each) })
  if (item.recordedOnly) return format(m.resultRule, { kind: 'recorded', value: '' })
  return null
}

/**
 * One question: what it is and what it came to, then where that came from.
 *
 * Several claims open in place under it; a single claim is the row itself,
 * and pressing it goes to that claim, since listing one claim under a row
 * that already names it would say the same thing twice.
 */
function ItemRow({
  item,
  first,
  reader,
  open,
  onToggle,
  onEntryOpen,
  onItemOpen,
}: {
  item: LedgerItemView
  first: boolean
  reader: 'owner' | 'staff'
  open: boolean
  onToggle: (id: string) => void
  onEntryOpen: ((entryId: string) => void) | undefined
  onItemOpen: ((itemId: string) => void) | undefined
}) {
  const { format, locale } = useI18n()
  const zone = useBatchZone()
  const list = useList()
  const panelId = useId()
  const expandable = item.lines.length >= 2
  const only = item.lines.length === 1 ? item.lines[0] : undefined
  const follow =
    !expandable && only !== undefined && only.entryId !== null && onEntryOpen !== undefined
      ? only.entryId
      : null
  const tag = tagOf(item)
  const rule = ruleOf(item, format)
  const nothing = item.lines.length === 0 && item.cents === 0
  const inset = { paddingInlineStart: 16 + item.depth * INDENT }
  const lineData =
    only === undefined
      ? {}
      : {
          'data-line-kind': only.kind,
          'data-standing': only.standing,
          'data-revoked': only.revoked ? 'true' : undefined,
          'data-entry': only.entryId ?? undefined,
        }
  const cells = (
    <>
      <span {...stylex.props(styles.titleCell)}>
        <span
          {...stylex.props(styles.itemTitle, nothing && styles.quiet, item.voided && styles.struck)}
        >
          {item.title}
        </span>
        {tag !== null && (
          <span
            data-tag={tag.kind}
            {...stylex.props(
              styles.tag,
              styles.titleTag,
              tag.attention ? styles.tagAttention : styles.tagNeutral,
            )}
          >
            {format(m.resultTag, { kind: tag.kind, count: tag.count, reader })}
          </span>
        )}
      </span>
      <span
        {...stylex.props(
          styles.value,
          item.cents === 0 && styles.valueZero,
          item.cents < 0 && styles.negative,
        )}
      >
        {two(item.cents)}
      </span>
      <span {...stylex.props(styles.madeCell)}>
        <span {...stylex.props(styles.made)}>
          {madeOf(item, format, list, (at) => dayOf(at, locale, zone))}
        </span>
        {expandable && (
          <ChevronDownIcon
            aria-hidden
            {...stylex.props(styles.chevron, open && styles.chevronOpen)}
          />
        )}
        {follow !== null && <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />}
      </span>
      <span {...stylex.props(styles.rule)}>{rule ?? ''}</span>
    </>
  )
  return (
    <div
      data-testid="ledger-item"
      data-item={item.id}
      data-value={two(item.cents)}
      data-lines={item.lines.length}
      data-voided={item.voided ? 'true' : undefined}
      {...stylex.props(styles.item, first && styles.itemFirst)}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(item.id)}
          {...stylex.props(styles.row, styles.pressable)}
          style={inset}
        >
          {cells}
        </button>
      ) : follow !== null ? (
        <button
          type="button"
          data-testid="ledger-line"
          {...lineData}
          onClick={() => onEntryOpen?.(follow)}
          {...stylex.props(styles.row, styles.pressable)}
          style={inset}
        >
          {cells}
        </button>
      ) : (
        <div {...lineData} {...stylex.props(styles.row)} style={inset}>
          {cells}
        </div>
      )}
      {expandable && (
        <Lines
          id={panelId}
          item={item}
          open={open}
          reader={reader}
          onEntryOpen={onEntryOpen}
          onItemOpen={onItemOpen}
        />
      )}
    </div>
  )
}

/** a question's claims, opened under it; the first few, and the way to the rest */
function Lines({
  id,
  item,
  open,
  reader,
  onEntryOpen,
  onItemOpen,
}: {
  id: string
  item: LedgerItemView
  open: boolean
  reader: 'owner' | 'staff'
  onEntryOpen: ((entryId: string) => void) | undefined
  onItemOpen: ((itemId: string) => void) | undefined
}) {
  const { format } = useI18n()
  const capped = onItemOpen !== undefined && item.lines.length > LINES_SHOWN
  const shown = capped ? item.lines.slice(0, LINES_SHOWN) : item.lines
  return (
    <div
      id={id}
      data-testid="ledger-lines"
      data-open={open}
      // folded, the claims are drawn but out of reach, so the fold can open
      // as a movement rather than an appearance
      inert={!open}
      {...stylex.props(styles.fold, open && styles.foldOpen)}
    >
      <div {...stylex.props(styles.foldInner)}>
        <div
          {...stylex.props(styles.foldSeat)}
          style={{ paddingInlineStart: 16 + item.depth * INDENT }}
        >
          <div {...stylex.props(styles.lines)}>
            {shown.map((line) => (
              <LineRow key={line.key} line={line} fallback={item.title} onEntryOpen={onEntryOpen} />
            ))}
            {capped && (
              <button
                type="button"
                data-testid="ledger-more"
                data-count={item.lines.length}
                onClick={() => onItemOpen(item.id)}
                {...stylex.props(styles.more, styles.pressable)}
              >
                {format(m.resultMore, { count: item.lines.length, reader })}
                <ChevronRightIcon aria-hidden {...stylex.props(styles.moreIcon)} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** one claim on the account: which it is, when, and what it came to */
function LineRow({
  line,
  fallback,
  onEntryOpen,
}: {
  line: LedgerLineView
  /** what to call a claim that says nothing of itself this reader can see */
  fallback: string
  onEntryOpen: ((entryId: string) => void) | undefined
}) {
  const { format, locale } = useI18n()
  const zone = useBatchZone()
  const tagKind = UNCOUNTED.has(line.standing) ? line.standing : null
  const when = dayOf(line.at, locale, zone)
  const data = {
    'data-line-kind': line.kind,
    'data-standing': line.standing,
    'data-revoked': line.revoked ? 'true' : undefined,
    'data-entry': line.entryId ?? undefined,
  }
  const cells = (
    <>
      <span {...stylex.props(styles.lineMain)}>
        <span {...stylex.props(styles.lineLead)}>{line.lead ?? fallback}</span>
        {line.sub !== null && <span {...stylex.props(styles.lineSub)}>{line.sub}</span>}
        {tagKind !== null && (
          <span {...stylex.props(styles.tag, styles.tagNeutral)}>
            {format(m.resultLineTag, { kind: tagKind })}
          </span>
        )}
        {when !== null && <span {...stylex.props(styles.lineWhen)}>{when}</span>}
      </span>
      <span
        {...stylex.props(
          styles.lineValue,
          (line.cents === 0 || tagKind !== null) && styles.zero,
          line.cents < 0 && styles.negative,
        )}
      >
        {two(line.cents)}
      </span>
    </>
  )
  const entryId = line.entryId
  return entryId !== null && onEntryOpen !== undefined ? (
    <button
      type="button"
      data-testid="ledger-line"
      {...data}
      onClick={() => onEntryOpen(entryId)}
      {...stylex.props(styles.line, styles.pressable)}
    >
      {cells}
    </button>
  ) : (
    <div {...data} {...stylex.props(styles.line)}>
      {cells}
    </div>
  )
}

/** a limit that bit, with what the group came to and the difference written out */
function Trim({ adjustment }: { adjustment: LedgerAdjustmentView }) {
  const { format } = useI18n()
  const delta = adjustment.deltaCents
  return (
    <div
      data-testid="group-adjustment"
      data-rule={adjustment.rule}
      data-delta={two(delta)}
      {...stylex.props(styles.trim)}
      style={{ paddingInlineStart: 16 + adjustment.depth * INDENT }}
    >
      <AlignLeftIcon aria-hidden {...stylex.props(styles.trimIcon)} />
      <span {...stylex.props(styles.trimText)}>
        {format(m.resultTrim, {
          rule: adjustment.rule,
          group: adjustment.name,
          raw: two(adjustment.rawCents),
          limit: two(adjustment.limitCents),
        })}
      </span>
      <span {...stylex.props(styles.trimValue)}>{delta < 0 ? two(delta) : `+${two(delta)}`}</span>
    </div>
  )
}

function Foot({ total }: { total: number }) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.foot)}>
      <span {...stylex.props(styles.footLabel)}>{format(m.resultGrandTotal)}</span>
      <span {...stylex.props(styles.spacer)} />
      <span {...stylex.props(styles.footValue, total < 0 && styles.negative)}>{two(total)}</span>
    </div>
  )
}

/** a round that asks nothing: the room the ledger would take says so */
function Nothing({ action }: { action: ReactNode }) {
  const { format } = useI18n()
  return (
    <div data-testid="result-empty" {...stylex.props(styles.empty)}>
      <BarChart3Icon aria-hidden {...stylex.props(styles.emptyMark)} />
      <p {...stylex.props(styles.emptyTitle)}>{format(m.resultNothingAsked)}</p>
      {action}
    </div>
  )
}

/**
 * The account could not be computed, and nothing on it is true until it is.
 *
 * Two answers read differently. The arithmetic out of reach is an outage and
 * asking again is the remedy; an account over the platform's ceiling will
 * not compute however often it is asked, so it says why and offers only
 * what the page hands it.
 */
export function ResultUnavailable({
  error,
  retrying,
  onRetry,
  action,
}: {
  error: unknown
  retrying: boolean
  onRetry: () => void
  action?: ReactNode
}) {
  const { format, formatError } = useI18n()
  const tooLarge = isApiErrorCode(error, 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE')
  return (
    <section
      data-testid="result-unavailable"
      data-reason={tooLarge ? 'too-large' : 'unavailable'}
      {...stylex.props(styles.unavailable)}
    >
      <p {...stylex.props(styles.unavailableTitle)}>
        {format(tooLarge ? m.resultTooLargeTitle : m.resultUnavailableTitle)}
      </p>
      <p {...stylex.props(styles.unavailableHint)}>
        {tooLarge ? formatError(error) : format(m.resultUnavailableHint)}
      </p>
      <div {...stylex.props(styles.unavailableActions)}>
        {!tooLarge && (
          <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
            {format(m.resultRecalculate)}
          </Button>
        )}
        {action}
      </div>
    </section>
  )
}
