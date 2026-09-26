import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  ArrowDownUpIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  InfoIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { GlideAcross, Sift, SiftRow } from '@qualy/ui/reveal'
import { Ticker } from '@qualy/ui/ticker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { recordedOnly, type EntryDto, type ItemDto } from '../model.ts'
import type { Standing, StructureRow } from '../standing.ts'
import { useWidthOf, type WorkspaceMode } from './layout.ts'
import { EntryRow } from './EntryRow.tsx'
import { useCalcLine, useLineWords } from './calc.ts'
import {
  chainOf,
  chipsFor,
  entryLineOf,
  rowWordOf,
  two,
  badgeOf,
  type ChipKey,
  type Filing,
  type Outline,
  type Viewer,
} from './model.ts'

// One question, opened: where it sits, what it pays, the way to file into it,
// and every claim under it - filtered, searched and read a page at a time.
//
// Owner and staff read the same pane. What differs is the key in the header:
// the owner's "file one" where filing is open, somebody checking the account
// whatever the server offers them instead.

const PAGE = 20

/** the orders the claims can be read in */
type Order = 'newest' | 'oldest'

/** the pane width from which the rows take their desk shape, and the toolbar where its filters fit */
const ROOMY = 720

const PHONE = '@media (max-width: 767.98px)'
const BELOW_DESK = '@media (max-width: 1279.98px)'

const styles = stylex.create({
  root: { display: 'flex', minHeight: '100%', flexGrow: 1, flexDirection: 'column' },
  head: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
    paddingInline: { default: 28, [BELOW_DESK]: 22, [PHONE]: 16 },
    paddingTop: { default: 22, [PHONE]: 14 },
    paddingBottom: { default: 18, [PHONE]: 14 },
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
  crumb: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  crumbNo: { fontVariantNumeric: 'tabular-nums' },
  crumbRule: { color: `color-mix(in oklab, ${tokens.foreground} 20%, transparent)` },
  titleLine: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  titleNo: {
    flexShrink: 0,
    fontSize: { default: 20, [PHONE]: 18 },
    lineHeight: 1.3,
    fontWeight: 600,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  title: {
    margin: 0,
    minWidth: 0,
    flexGrow: 1,
    flexBasis: '0%',
    fontSize: { default: 20, [PHONE]: 18 },
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.015em',
    overflowWrap: 'anywhere',
  },
  titleGone: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  badge: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 30,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 10,
    fontSize: 12.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
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
  factNegative: { color: tokens.danger },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    borderRadius: 5,
    paddingInline: 7,
    fontSize: 12,
    fontWeight: 500,
  },
  tagWaits: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
    color: tokens.warningForeground,
  },
  tagCounts: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  tagMoving: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
  tagOpen: { boxShadow: `inset 0 0 0 1px ${tokens.border}`, color: tokens.mutedForeground },
  // why no claim can be started now, where the way to start one would be
  heldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingBlock: 14,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  heldIcon: { width: 14, height: 14, flexShrink: 0 },
  asideKey: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    height: 38,
    marginTop: 2,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    paddingLeft: 12,
    paddingRight: 10,
    textAlign: 'left',
    cursor: 'pointer',
  },
  asideKeyIcon: { width: 15, height: 15, flexShrink: 0, color: tokens.surfaceMutedForeground },
  asideKeyWord: { flexShrink: 0, fontSize: 13, fontWeight: 500 },
  asideKeySummary: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  asideKeyChevron: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  card: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.background,
  },
  // the filters ride at the top of the pane while the claims scroll under
  toolbar: {
    position: 'sticky',
    zIndex: 5,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 96%, transparent)`,
    backdropFilter: 'blur(6px)',
    paddingBlock: 10,
  },
  toolbarDesk: { top: 0, paddingInline: 28 },
  toolbarCompact: { top: 0, alignItems: 'flex-start', paddingInline: 16 },
  // under the phone's own bar, which is pinned above it
  toolbarPhone: { top: 44 },
  chips: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  chipsDesk: {
    position: 'relative',
    flexGrow: 0,
    // next to nothing: the search beside them gives up its room first, down
    // to its least; filters that still do not fit take the wrapping toolbar
    flexShrink: 0.01,
    flexWrap: 'nowrap',
    gap: 2,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    padding: 3,
  },
  // the chosen filter's face, one piece sliding from filter to filter
  chipMark: {
    top: 3,
    height: 26,
    borderRadius: 9999,
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px color-mix(in oklab, black 8%, transparent)',
  },
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 26,
    borderWidth: 0,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 70%, ${tokens.background})`,
    paddingInline: 11,
    fontSize: 13,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  // over the sliding face, which is what shows the chosen one
  chipDesk: { position: 'relative', backgroundColor: 'transparent' },
  chipOn: {
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px color-mix(in oklab, black 8%, transparent)',
    fontWeight: 500,
    color: tokens.foreground,
  },
  chipOnDesk: { backgroundColor: 'transparent', boxShadow: 'none' },
  chipOnCompact: {
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 9%, ${tokens.background})`,
    boxShadow: 'none',
  },
  chipCount: { fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  chipCountWaits: { color: tokens.warningForeground },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  // gives up its room before the filters do: a filter cut off at the edge
  // is a filter nobody finds
  search: {
    display: 'flex',
    minWidth: 128,
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 220,
    alignItems: 'center',
    gap: 6,
    height: 30,
    borderRadius: 8,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    paddingLeft: 9,
    paddingRight: 8,
    color: tokens.mutedForeground,
  },
  searchIcon: { width: 13, height: 13, flexShrink: 0 },
  searchInput: {
    minWidth: 0,
    flexGrow: 1,
    height: 28,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: 12.5,
    color: tokens.foreground,
  },
  searchClose: {
    display: 'inline-flex',
    width: 18,
    height: 18,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
  sortIcon: { width: 14, height: 14, flexShrink: 0 },
  sortSeat: { flexShrink: 0 },
  sortFace: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    verticalAlign: 'middle',
    // the filters' size, beside them in the same row
    fontSize: 13,
    color: tokens.surfaceMutedForeground,
  },
  // positioned, so a row on its way out can leave the flow and still be drawn
  rows: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  noMatch: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 32,
    fontSize: 13.5,
    color: tokens.mutedForeground,
  },
  more: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingBlock: 10,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  inset: { paddingInline: { default: 28, [BELOW_DESK]: 16 } },
  addRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.background})`,
    },
    paddingBlock: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
  addMark: {
    display: 'inline-flex',
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 14%, transparent)`,
  },
  addIcon: { width: 14, height: 14 },
  addWord: { fontSize: 14, fontWeight: 500 },
  addRoom: {
    flexShrink: 0,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  note: {
    display: 'flex',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingInline: 16,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  noteStrong: { fontWeight: 600, color: tokens.surfaceMutedForeground },
  tray: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingTop: { default: 88, [PHONE]: 56 },
    paddingBottom: 56,
    textAlign: 'center',
  },
  trayMark: {
    display: 'inline-flex',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
  },
  trayIcon: { width: 17, height: 17 },
  trayTitle: { margin: 0, fontSize: 14.5, fontWeight: 600 },
  trayHint: {
    margin: 0,
    maxWidth: '30em',
    fontSize: 13,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  trayHeld: { color: tokens.surfaceMutedForeground },
})

/**
 * The key that starts a claim. Only where the round allows one: while a
 * stage has shut filing, the question says why where the next claim would
 * start, and a greyed key beside the title would only say "not now".
 */
export function FileKey({
  filing,
  busy,
  size = 'default',
  onPress,
}: {
  filing: Filing
  busy: boolean
  size?: 'default' | 'lg'
  onPress: () => void
}) {
  const { format } = useI18n()
  return (
    <Button
      data-testid="file-claim"
      data-gate={filing.gate}
      size={size}
      disabled={busy}
      onClick={onPress}
    >
      <PlusIcon aria-hidden />
      {format(filing.declared ? m.entryDeclare : m.entryNew)}
    </Button>
  )
}

export function ItemPane({
  viewer,
  mode,
  outline,
  row,
  item,
  entries,
  standing,
  scored,
  filing,
  busy,
  selectedEntryId,
  awaitingMe,
  headerAction,
  onEntry,
  onFile,
  onGoto,
  onRequirements,
}: {
  viewer: Viewer
  mode: WorkspaceMode
  outline: Outline
  row: StructureRow
  item: ItemDto
  /** the claims under it this reader may read; the owner's abandoned ones are not among them */
  entries: readonly EntryDto[]
  standing: Standing | null
  scored: boolean
  /** the owner's way in, as the server and the question allow it */
  filing: Filing | null
  busy: boolean
  selectedEntryId: string
  /** claims whose open round waits on this staff reader's own decision */
  awaitingMe?: ReadonlySet<string>
  /** somebody else's key for this question, where the owner's is not the one */
  headerAction?: ReactNode
  onEntry: (entry: EntryDto) => void
  onFile: () => void
  onGoto: (id: string) => void
  /** opens the question's requirements where they are not a column of their own */
  onRequirements: () => void
}) {
  const { format } = useI18n()
  const calc = useCalcLine()
  const still = useReducedMotion() === true
  // the toolbar and the rows lay out by the room the pane is given, not by
  // the window: at a desk inside a narrower page the pane is narrow too
  const [paneRef, paneWidth] = useWidthOf()
  const roomy = paneWidth === null ? mode === 'desk' : paneWidth >= ROOMY
  const compact = !roomy
  const chips = useMemo(() => chipsFor(viewer), [viewer])
  const [chip, setChip] = useState<ChipKey>('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [order, setOrder] = useState<Order>('newest')
  const [limit, setLimit] = useState(PAGE)

  const lineWords = useLineWords()
  const lines = useMemo(
    () =>
      new Map(
        entries.map((entry) => [entry.id, entryLineOf(entry, item, standing, lineWords)] as const),
      ),
    [entries, item, standing, lineWords],
  )
  const counts = new Map(
    chips.map((one) => [one.key, entries.filter((entry) => one.test(entry)).length] as const),
  )
  // a chosen filter that has nothing left under it gives way to all
  const active = chip !== 'all' && (counts.get(chip) ?? 0) === 0 ? 'all' : chip
  const test = chips.find((one) => one.key === active)?.test ?? (() => true)
  const offered = chips.filter((one) => one.key === 'all' || (counts.get(one.key) ?? 0) > 0)

  // Where the chosen filter sits in its row, measured, so one face slides
  // between filters rather than one switching off and another on. Measured
  // again whenever the row is laid out anew: a count that gains a digit
  // widens its filter and moves every one after it.
  const chipRow = useRef<HTMLDivElement | null>(null)
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null)
  const offeredKey = offered
    .map((one) => `${format(one.label)}:${String(counts.get(one.key))}`)
    .join()

  // The toolbar stands in one row - the filters, a search field, the order -
  // only where the filters fit in it whole. A pane wide enough by its own
  // measure may still not hold them: a language whose words run long, a
  // reader with more filters. Then it takes the narrower toolbar, where the
  // filters wrap, and remembers the width the row needed, so a pane that
  // widens again gets the row back.
  const [rowNeeds, setRowNeeds] = useState<{ key: string; width: number } | null>(null)
  const cramped =
    rowNeeds !== null &&
    rowNeeds.key === offeredKey &&
    paneWidth !== null &&
    paneWidth < rowNeeds.width
  const wide = roomy && !cramped
  useLayoutEffect(() => {
    const row = chipRow.current
    if (!wide || row === null || paneWidth === null) return
    // the search has given up its room first, so what is still over is the
    // filters' own
    const over = row.scrollWidth - row.clientWidth
    if (over > 1) setRowNeeds({ key: offeredKey, width: paneWidth + over })
  }, [wide, offeredKey, paneWidth])

  useLayoutEffect(() => {
    const row = chipRow.current
    if (row === null || !wide) {
      setMark(null)
      return
    }
    const measure = () => {
      const on = row.querySelector(`[data-chip="${active}"]`)
      if (!(on instanceof HTMLElement)) return
      setMark((was) =>
        was !== null && was.left === on.offsetLeft && was.width === on.offsetWidth
          ? was
          : { left: on.offsetLeft, width: on.offsetWidth },
      )
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(row)
    return () => watch.disconnect()
  }, [active, wide, offeredKey])
  const needle = search.trim().toLowerCase()
  const filtered = entries
    .filter(test)
    .filter((entry) => needle === '' || (lines.get(entry.id)?.words.includes(needle) ?? false))
    .sort((a, b) => {
      const at = (entry: EntryDto) => Date.parse(lines.get(entry.id)?.at ?? entry.createdAt)
      const newer = at(b) - at(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      return order === 'oldest' ? -newer : newer
    })
  const shown = filtered.slice(0, limit)
  const listed = entries.filter((entry) => entry.status !== 'voided')
  // nothing shown because of a filter the reader chose, as against nothing
  // there to show: only a withdrawn record left under a question reads as
  // an empty question, with its own filter still offered above
  const narrowed = active !== 'all' || needle !== ''

  const counted = row.right === '' ? 0 : Number(row.right)
  const voided = item.status === 'voided'
  const chain = chainOf(outline, row)
  const word = rowWordOf(row)
  const badge = badgeOf(item, filing)
  const facts = [
    calc(item),
    item.itemType === 'constant' || recordedOnly(item)
      ? null
      : item.maxEntries !== null
        ? format(m.myEntriesHeadMost, { count: item.maxEntries })
        : format(m.entriesNoLimit),
    item.itemType === 'declaration' ? format(m.entriesNothingToFill) : null,
  ].filter((fact): fact is string => fact !== null)

  const tagTone =
    row.tag === 'supplement' || row.tag === 'needs_revision'
      ? styles.tagWaits
      : row.tag === 'approved' || row.tag === 'granted'
        ? styles.tagCounts
        : row.tag === 'open' || row.tag === 'rejected' || row.tag === 'voided' || row.tag === null
          ? styles.tagOpen
          : styles.tagMoving

  const toolbar = entries.length > 0 && (
    <div
      data-testid="entries-toolbar"
      data-shape={wide ? 'row' : 'wrap'}
      {...stylex.props(
        styles.toolbar,
        wide ? styles.toolbarDesk : styles.toolbarCompact,
        mode === 'phone' && styles.toolbarPhone,
      )}
    >
      <div
        ref={chipRow}
        role="group"
        aria-label={format(m.entriesFilterLabel)}
        {...stylex.props(styles.chips, wide && styles.chipsDesk)}
      >
        {wide && mark !== null && (
          <GlideAcross
            left={mark.left}
            width={mark.width}
            className={stylex.props(styles.chipMark).className}
          />
        )}
        {offered.map((one) => {
          const on = one.key === active
          const count = counts.get(one.key) ?? 0
          return (
            <button
              key={one.key}
              type="button"
              aria-pressed={on}
              data-chip={one.key}
              data-count={count}
              onClick={() => {
                setChip(one.key)
                setLimit(PAGE)
              }}
              {...stylex.props(
                styles.chip,
                wide && styles.chipDesk,
                on && styles.chipOn,
                on && !wide && styles.chipOnCompact,
                on && wide && mark !== null && styles.chipOnDesk,
              )}
            >
              {format(one.label)}
              <span {...stylex.props(styles.chipCount, one.urgent && styles.chipCountWaits)}>
                <Ticker value={String(count)} />
              </span>
            </button>
          )
        })}
      </div>
      {wide && <span {...stylex.props(styles.spacer)} />}
      {searchOpen || search !== '' || wide ? (
        <label {...stylex.props(styles.search)}>
          <SearchIcon aria-hidden {...stylex.props(styles.searchIcon)} />
          <input
            type="search"
            aria-label={format(m.entriesSearch)}
            placeholder={format(m.entriesSearch)}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setLimit(PAGE)
            }}
            {...stylex.props(styles.searchInput)}
          />
          {!wide && (
            <button
              type="button"
              aria-label={format(m.entriesSearchClose)}
              onClick={() => {
                setSearch('')
                setSearchOpen(false)
              }}
              {...stylex.props(styles.searchClose)}
            >
              <XIcon aria-hidden width={10} height={10} />
            </button>
          )}
        </label>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.entriesSearch)}
          onClick={() => setSearchOpen(true)}
        >
          <SearchIcon aria-hidden />
        </Button>
      )}
      {/* the order is chosen from a list that shows the one in force, and
          takes effect on the choice, not on a press that flips it unseen */}
      <Select value={order} onValueChange={(next) => setOrder(next as Order)}>
        <SelectTrigger
          size="sm"
          // a quiet key at every width: the order is a way of reading the
          // list, not a field of it, and it still says the order in force
          quiet
          aria-label={format(m.entriesSortLabel)}
          data-testid="entries-sort"
          data-order={order}
          xstyle={styles.sortSeat}
        >
          <span {...stylex.props(styles.sortFace)}>
            <ArrowDownUpIcon aria-hidden {...stylex.props(styles.sortIcon)} />
            {wide ? (
              <SelectValue />
            ) : (
              <>
                {/* in a word for the eye, and in full for a screen reader */}
                <span aria-hidden data-testid="entries-sort-word">
                  {format(order === 'oldest' ? m.entriesSortOldestShort : m.entriesSortNewestShort)}
                </span>
                <VisuallyHidden>
                  <SelectValue />
                </VisuallyHidden>
              </>
            )}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">{format(m.entriesSortNewest)}</SelectItem>
          <SelectItem value="oldest">{format(m.entriesSortOldest)}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )

  const addLabel = format(filing?.declared === true ? m.entryDeclare : m.entryNew)
  // Where another claim would start, the way in - or, while the stage has
  // shut it, why, in the words the way in would have had: a key that only
  // says it is unavailable sends the reader looking for the reason.
  const addRow =
    filing === null || !filing.mayAdd || listed.length === 0 ? null : filing.shut ? (
      <p
        data-testid="filing-held"
        data-reason={filing.reason ?? ''}
        data-said={filing.why?.message.id ?? ''}
        {...stylex.props(styles.heldRow, styles.inset)}
      >
        <ClockIcon aria-hidden {...stylex.props(styles.heldIcon)} />
        {filing.why === null ? null : format(filing.why.message, filing.why.values)}
      </p>
    ) : (
      <button
        type="button"
        data-testid="file-claim"
        data-gate={filing.gate}
        disabled={busy}
        onClick={onFile}
        {...stylex.props(styles.addRow, styles.inset)}
      >
        <span aria-hidden {...stylex.props(styles.addMark)}>
          <PlusIcon {...stylex.props(styles.addIcon)} />
        </span>
        <span {...stylex.props(styles.addWord)}>{addLabel}</span>
        <span {...stylex.props(styles.spacer)} />
        {filing.room !== null && (
          <span {...stylex.props(styles.addRoom)}>
            {format(m.entriesRoomLeft, { count: filing.room })}
          </span>
        )}
      </button>
    )

  return (
    <div
      ref={paneRef}
      {...stylex.props(styles.root)}
      data-testid="item-pane"
      data-item={item.id}
      data-roomy={roomy}
    >
      <div {...stylex.props(styles.head)}>
        {chain.length > 0 && (
          <ol aria-label={format(m.entriesWhereLabel)} {...stylex.props(styles.crumbs)}>
            {chain.map((section) => (
              <li key={section.id} {...stylex.props(styles.fact)}>
                <button
                  type="button"
                  onClick={() => onGoto(section.id)}
                  {...stylex.props(styles.crumb)}
                >
                  <span {...stylex.props(styles.crumbNo)}>{outline.numbers.get(section.id)}</span>
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
          <span aria-hidden {...stylex.props(styles.titleNo)}>
            {outline.numbers.get(row.id)}.
          </span>
          <h2
            tabIndex={-1}
            data-pane-title=""
            {...stylex.props(styles.title, voided && styles.titleGone)}
          >
            {item.title}
          </h2>
          {/* on a phone the owner's key stands in the bar at the foot, where
              the thumb is; everything else keeps its seat beside the title.
              While a stage has shut filing there is no key at all: why is
              said once, where the next claim would start */}
          {headerAction ??
            (filing !== null && filing.mayAdd ? (
              mode === 'phone' || filing.shut ? null : (
                <FileKey filing={filing} busy={busy} onPress={onFile} />
              )
            ) : badge !== null ? (
              <span data-testid="item-badge" {...stylex.props(styles.badge)}>
                {format(badge)}
              </span>
            ) : null)}
        </div>
        <div {...stylex.props(styles.facts)}>
          {word !== null && (
            <span
              data-testid="item-tag"
              data-tag={row.tag ?? ''}
              {...stylex.props(styles.tag, tagTone)}
            >
              {format(word)}
            </span>
          )}
          {facts.map((fact, index) => (
            <span key={fact} {...stylex.props(styles.fact)}>
              {(index > 0 || word !== null) && (
                <span aria-hidden {...stylex.props(styles.factRule)} />
              )}
              {fact}
            </span>
          ))}
          {scored && counted !== 0 && (
            <span {...stylex.props(styles.fact, counted < 0 && styles.factNegative)} data-scored>
              <span aria-hidden {...stylex.props(styles.factRule)} />
              {format(counted < 0 ? m.entriesDeductedFact : m.entriesCountedFact, {
                value: two(Math.abs(counted)),
              })}
            </span>
          )}
        </div>
        {/* the requirements have a column of their own only at a desk */}
        {mode !== 'desk' && (
          <button
            type="button"
            data-testid="requirements-key"
            onClick={onRequirements}
            {...stylex.props(styles.asideKey)}
          >
            <InfoIcon aria-hidden {...stylex.props(styles.asideKeyIcon)} />
            <span {...stylex.props(styles.asideKeyWord)}>{format(m.entriesRequirements)}</span>
            <span {...stylex.props(styles.asideKeySummary)}>
              {facts.join(format(m.entriesListJoin))}
            </span>
            <ChevronRightIcon aria-hidden {...stylex.props(styles.asideKeyChevron)} />
          </button>
        )}
      </div>

      <div {...stylex.props(styles.card)}>
        {toolbar}
        {/* A filter or a search narrows this list in place: rows that leave
            fade out of the way and the rest close up, and a claim that
            arrives fades in where it belongs, so the list reads as the same
            list changing rather than another one replacing it. What follows
            the list moves with it, or the rows closing up would slide over
            it on their way. */}
        <LayoutGroup>
          {shown.length > 0 && (
            <ul {...stylex.props(styles.rows)}>
              <Sift>
                {shown.map((entry) => (
                  <SiftRow key={entry.id}>
                    <EntryRow
                      entry={entry}
                      line={lines.get(entry.id)!}
                      compact={compact}
                      selected={entry.id === selectedEntryId}
                      awaitingMe={awaitingMe?.has(entry.id) ?? false}
                      onOpen={() => onEntry(entry)}
                    />
                  </SiftRow>
                ))}
              </Sift>
            </ul>
          )}
          {entries.length > 0 && filtered.length === 0 && narrowed && (
            <div {...stylex.props(styles.noMatch)} data-testid="entries-no-match">
              {format(m.entriesNoMatch)}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setChip('all')
                  setSearch('')
                }}
              >
                {format(m.entriesClearFilter)}
              </Button>
            </div>
          )}
          {filtered.length > limit && (
            <Trailing still={still}>
              <div {...stylex.props(styles.more, styles.inset)} data-testid="entries-more">
                <span>
                  {format(m.entriesShownOf, { shown: shown.length, total: filtered.length })}
                </span>
                <span {...stylex.props(styles.spacer)} />
                <Button variant="outline" size="sm" onClick={() => setLimit((now) => now + PAGE)}>
                  {format(m.entriesShowMore, { count: Math.min(PAGE, filtered.length - limit) })}
                </Button>
              </div>
            </Trailing>
          )}
          {addRow !== null && <Trailing still={still}>{addRow}</Trailing>}
          {filing !== null && filing.full && listed.length > 0 && (
            <Trailing still={still}>
              <div {...stylex.props(styles.note)} data-testid="entries-full">
                {format(m.myEntriesAddFull)}
                {item.maxEntries !== null && (
                  <b {...stylex.props(styles.noteStrong)}>
                    {listed.length} / {item.maxEntries}
                  </b>
                )}
              </div>
            </Trailing>
          )}
        </LayoutGroup>
        {filtered.length === 0 && !narrowed && (
          <Tray
            viewer={viewer}
            keyed={mode !== 'phone'}
            item={item}
            filing={filing}
            busy={busy}
            label={addLabel}
            onFile={onFile}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A row after the claims - the way to start another, why it cannot start,
 * the rest of a long list - moving to its new place in the same beat as the
 * claims closing up above it, where it would otherwise jump there at once
 * and have them slide over it.
 */
function Trailing({ still, children }: { still: boolean; children: ReactNode }) {
  return (
    <motion.div
      layout={still ? false : 'position'}
      // the beat of a sifted row, so the two arrive together
      transition={{ duration: still ? 0 : 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** why a question's list stands empty, and the way in where there is one */
function Tray({
  viewer,
  keyed,
  item,
  filing,
  busy,
  label,
  onFile,
}: {
  viewer: Viewer
  /** whether the way in is offered here; on a phone the bar at the foot has it */
  keyed: boolean
  item: ItemDto
  filing: Filing | null
  busy: boolean
  label: string
  onFile: () => void
}) {
  const { format } = useI18n()
  const granted = item.itemType === 'constant'
  const recorded = recordedOnly(item)
  const title = granted ? m.paperEmptyGranted : recorded ? m.paperEmptyRecorded : m.paperEmptyTitle
  // a stage that has shut filing is said as why, in place of the key
  const held = viewer === 'owner' && filing !== null && filing.mayAdd && filing.shut
  const hint = granted
    ? m.paperEmptyGrantedHint
    : recorded
      ? viewer === 'owner'
        ? m.entriesRecordedHint
        : m.paperEmptyRecordedHint
      : item.status === 'voided'
        ? m.itemVoided
        : viewer === 'staff'
          ? m.entriesStaffEmptyHint
          : filing !== null && !filing.mayAdd
            ? // nothing to press here, for now or for good: an empty list
              // must not invite a filing the page will not offer
              m.entriesNotOpen
            : filing?.declared === true
              ? m.entriesDeclareHint
              : m.paperEmptyHint
  const icon = stylex.props(styles.trayIcon)
  return (
    <div
      {...stylex.props(styles.tray)}
      data-testid="entries-tray"
      data-kind={granted ? 'granted' : recorded ? 'recorded' : 'filing'}
      data-reason={held ? (filing.reason ?? '') : undefined}
      data-said={held ? (filing.why?.message.id ?? '') : undefined}
    >
      <span {...stylex.props(styles.trayMark)}>
        {granted ? (
          <CheckIcon aria-hidden {...icon} />
        ) : recorded ? (
          <ClockIcon aria-hidden {...icon} />
        ) : (
          <FileTextIcon aria-hidden {...icon} />
        )}
      </span>
      <p {...stylex.props(styles.trayTitle)}>{format(title)}</p>
      <p {...stylex.props(styles.trayHint, held && styles.trayHeld)}>
        {held && filing.why !== null ? format(filing.why.message, filing.why.values) : format(hint)}
      </p>
      {keyed && filing !== null && filing.mayAdd && !filing.shut && (
        <Button
          data-testid="file-claim"
          data-gate={filing.gate}
          size="sm"
          disabled={busy}
          onClick={onFile}
        >
          <PlusIcon aria-hidden />
          {label}
        </Button>
      )}
    </div>
  )
}
