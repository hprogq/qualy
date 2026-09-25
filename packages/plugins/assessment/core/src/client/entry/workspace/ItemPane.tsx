import { useMemo, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import { recordedOnly, type EntryDto, type ItemDto } from '../model.ts'
import type { Standing, StructureRow } from '../standing.ts'
import { useWidthOf, type WorkspaceMode } from './layout.ts'
import { EntryRow } from './EntryRow.tsx'
import { useCalcLine } from './calc.ts'
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

/** the pane width from which the toolbar and the rows take their desk shape */
const ROOMY = 720

const PHONE = '@media (max-width: 767.98px)'
const BELOW_DESK = '@media (max-width: 1279.98px)'

const styles = stylex.create({
  root: { display: 'flex', minHeight: '100%', flexDirection: 'column' },
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
  held: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: 0,
    fontSize: 12.5,
    color: tokens.warningForeground,
  },
  heldIcon: { width: 13, height: 13, flexShrink: 0 },
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
    flexGrow: 0,
    flexWrap: 'nowrap',
    gap: 2,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    padding: 3,
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
  chipDesk: { backgroundColor: 'transparent' },
  chipOn: {
    backgroundColor: tokens.background,
    boxShadow: '0 1px 2px color-mix(in oklab, black 8%, transparent)',
    fontWeight: 500,
    color: tokens.foreground,
  },
  chipOnCompact: {
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 9%, ${tokens.background})`,
    boxShadow: 'none',
  },
  chipCount: { fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  chipCountWaits: { color: tokens.warningForeground },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
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
  sortIcon: { width: 14, height: 14 },
  rows: { display: 'flex', flexDirection: 'column' },
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
  addRowShut: { cursor: 'not-allowed', color: tokens.mutedForeground },
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
  noPointer: { pointerEvents: 'none' },
})

/** a control the phase has shut, wearing its reason on hover and on focus */
export function Held({
  why,
  children,
  xstyle,
}: {
  why: string | null
  children: ReactNode
  xstyle?: stylex.StyleXStyles
}) {
  if (why === null) return <>{children}</>
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* a disabled button fires no pointer events, so the focusable
              wrapper is what anchors the reason */}
          <span tabIndex={0} {...stylex.props(xstyle)}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** the key that starts a claim, in whatever state the round allows it */
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
  const key = (
    <Button
      data-testid="file-claim"
      data-gate={filing.gate}
      size={size}
      disabled={busy || filing.shut}
      {...stylex.props(filing.shut && styles.noPointer)}
      onClick={onPress}
    >
      <PlusIcon aria-hidden />
      {format(filing.declared ? m.entryDeclare : m.entryNew)}
    </Button>
  )
  return <Held why={filing.why === null ? null : format(filing.why)}>{key}</Held>
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
  // the toolbar and the rows lay out by the room the pane is given, not by
  // the window: at a desk inside a narrower page the pane is narrow too
  const [paneRef, paneWidth] = useWidthOf()
  const roomy = paneWidth === null ? mode === 'desk' : paneWidth >= ROOMY
  const compact = !roomy
  const chips = useMemo(() => chipsFor(viewer), [viewer])
  const [chip, setChip] = useState<ChipKey>('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const lines = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entryLineOf(entry, item, standing)] as const)),
    [entries, item, standing],
  )
  const counts = new Map(
    chips.map((one) => [one.key, entries.filter((entry) => one.test(entry)).length] as const),
  )
  // a chosen filter that has nothing left under it gives way to all
  const active = chip !== 'all' && (counts.get(chip) ?? 0) === 0 ? 'all' : chip
  const test = chips.find((one) => one.key === active)?.test ?? (() => true)
  const needle = search.trim().toLowerCase()
  const filtered = entries
    .filter(test)
    .filter((entry) => needle === '' || (lines.get(entry.id)?.words.includes(needle) ?? false))
    .sort((a, b) => {
      const at = (entry: EntryDto) => Date.parse(lines.get(entry.id)?.at ?? entry.createdAt)
      const order = at(b) - at(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      return oldestFirst ? -order : order
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
      {...stylex.props(
        styles.toolbar,
        compact ? styles.toolbarCompact : styles.toolbarDesk,
        mode === 'phone' && styles.toolbarPhone,
      )}
    >
      <div
        role="group"
        aria-label={format(m.entriesFilterLabel)}
        {...stylex.props(styles.chips, !compact && styles.chipsDesk)}
      >
        {chips
          .filter((one) => one.key === 'all' || (counts.get(one.key) ?? 0) > 0)
          .map((one) => {
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
                  !compact && styles.chipDesk,
                  on && styles.chipOn,
                  on && compact && styles.chipOnCompact,
                )}
              >
                {format(one.label)}
                <span {...stylex.props(styles.chipCount, one.urgent && styles.chipCountWaits)}>
                  {count}
                </span>
              </button>
            )
          })}
      </div>
      {!compact && <span {...stylex.props(styles.spacer)} />}
      {searchOpen || search !== '' || roomy ? (
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
          {!roomy && (
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
      <Button
        variant="ghost"
        size={roomy ? 'sm' : 'icon-sm'}
        aria-label={format(oldestFirst ? m.entriesSortOldest : m.entriesSortNewest)}
        data-testid="entries-sort"
        data-order={oldestFirst ? 'oldest' : 'newest'}
        onClick={() => setOldestFirst((now) => !now)}
      >
        <ArrowDownUpIcon aria-hidden {...stylex.props(styles.sortIcon)} />
        {roomy && format(oldestFirst ? m.entriesSortOldest : m.entriesSortNewest)}
      </Button>
    </div>
  )

  const addLabel = format(filing?.declared === true ? m.entryDeclare : m.entryNew)
  const addRow =
    filing !== null && filing.mayAdd && listed.length > 0 ? (
      <Held why={filing.why === null ? null : format(filing.why)} xstyle={styles.rows}>
        <button
          type="button"
          data-testid="file-claim"
          data-gate={filing.gate}
          disabled={busy || filing.shut}
          onClick={onFile}
          {...stylex.props(
            styles.addRow,
            styles.inset,
            filing.shut && styles.addRowShut,
            filing.shut && styles.noPointer,
          )}
        >
          <span aria-hidden {...stylex.props(styles.addMark)}>
            <PlusIcon {...stylex.props(styles.addIcon)} />
          </span>
          <span {...stylex.props(styles.addWord)}>
            {filing.shut ? format(m.entriesAddHeld) : addLabel}
          </span>
          <span {...stylex.props(styles.spacer)} />
          {filing.room !== null && !filing.shut && (
            <span {...stylex.props(styles.addRoom)}>
              {format(m.entriesRoomLeft, { count: filing.room })}
            </span>
          )}
        </button>
      </Held>
    ) : null

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
          <h2 {...stylex.props(styles.title, voided && styles.titleGone)}>{item.title}</h2>
          {/* on a phone the owner's key stands in the bar at the foot, where
              the thumb is; everything else keeps its seat beside the title */}
          {headerAction ??
            (filing !== null && filing.mayAdd ? (
              mode === 'phone' ? null : (
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
        {filing !== null && filing.shut && filing.why !== null && (
          <p {...stylex.props(styles.held)} data-testid="filing-held">
            <ClockIcon aria-hidden {...stylex.props(styles.heldIcon)} />
            {format(filing.why)}
          </p>
        )}
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
        {shown.length > 0 && (
          <div {...stylex.props(styles.rows)}>
            {shown.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                line={lines.get(entry.id)!}
                compact={compact}
                selected={entry.id === selectedEntryId}
                awaitingMe={awaitingMe?.has(entry.id) ?? false}
                onOpen={() => onEntry(entry)}
              />
            ))}
          </div>
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
          <div {...stylex.props(styles.more, styles.inset)} data-testid="entries-more">
            <span>{format(m.entriesShownOf, { shown: shown.length, total: filtered.length })}</span>
            <span {...stylex.props(styles.spacer)} />
            <Button variant="outline" size="sm" onClick={() => setLimit((now) => now + PAGE)}>
              {format(m.entriesShowMore, { count: Math.min(PAGE, filtered.length - limit) })}
            </Button>
          </div>
        )}
        {addRow}
        {filing !== null && filing.full && listed.length > 0 && (
          <div {...stylex.props(styles.note)} data-testid="entries-full">
            {format(m.myEntriesAddFull)}
            {item.maxEntries !== null && (
              <b {...stylex.props(styles.noteStrong)}>
                {listed.length} / {item.maxEntries}
              </b>
            )}
          </div>
        )}
        {filtered.length === 0 && !narrowed && (
          <Tray
            viewer={viewer}
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

/** why a question's list stands empty, and the way in where there is one */
function Tray({
  viewer,
  item,
  filing,
  busy,
  label,
  onFile,
}: {
  viewer: Viewer
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
          : filing?.shut === true
            ? m.entriesHeldHint
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
      <p {...stylex.props(styles.trayHint)}>{format(hint)}</p>
      {filing !== null && filing.mayAdd && (
        <Held why={filing.why === null ? null : format(filing.why)}>
          <Button
            data-testid="file-claim"
            data-gate={filing.gate}
            size="sm"
            disabled={busy || filing.shut}
            {...stylex.props(filing.shut && styles.noPointer)}
            onClick={onFile}
          >
            <PlusIcon aria-hidden />
            {label}
          </Button>
        </Held>
      )}
    </div>
  )
}
