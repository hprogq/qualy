import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FilePlusIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Card, CardEmpty, CardHead, SearchField, Status } from '@qualy/ui/screen'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount } from '../entry/model.ts'
import { shownRows, type StructureRow } from './structure.ts'

// The whole paper, one row at a time, drawn the way every tree on an
// administration screen is drawn: a white card, a strip of grey column
// words, rows cut by the faintest rule, a level told by how far a name is
// set in, and a state told by a dot beside a word.
//
// A section folds, and what can be done to a row waits at its end until the
// row is pointed at or holds the focus - forty rows are not forty sets of
// buttons - and is always there on a screen with nothing to point with.
// Searching keeps the sections a match sits in, so a question found by name
// is still read where it counts.

// The table answers to its own width, not the window's: beside the batch's
// rail a laptop leaves it far less room than the screen suggests, and seven
// fixed columns there squeezed the names - the thing a reader is looking
// for - down to a character or two.
const STACKED = '@container (max-width: 619.98px)'
const MIDDLING = '@container (min-width: 620px) and (max-width: 899.98px)'

/** the columns every row lines up against, where there is room for all of them */
const COLUMNS = 'minmax(0, 1fr) 5.25rem 4.75rem 9rem 8rem 5.5rem 4.5rem'
/** less room: the way a question is filed goes first, since it is rarely what differs */
const COLUMNS_MIDDLING = 'minmax(0, 1fr) 5.25rem 4.5rem 7.5rem 5rem 4.5rem'
const INDENT = 20
const INDENT_NARROW = 12

const styles = stylex.create({
  menuColumn: { width: 176 },
  // Short of the room for every column, the head holds the paper's name and
  // what it is worth, then its tools on a line of their own, the search
  // taking what the line has to spare: beside the name they cut its limits
  // short and pushed the way to add something under the search. A search
  // field shares a phone's width with nothing.
  tools: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    flexBasis: { default: 'auto', [MIDDLING]: '100%', [STACKED]: '100%' },
    width: { default: null, [breakpoints.phone]: '100%' },
  },
  search: {
    width: { default: '14rem', [breakpoints.phone]: '100%' },
    minWidth: 0,
    flexGrow: { default: null, [MIDDLING]: 1 },
  },
  statusChoice: {
    width: { default: 112, [breakpoints.phone]: 'auto' },
    minWidth: 0,
    flexGrow: { default: null, [breakpoints.phone]: 1 },
  },
  chevronDim: { opacity: 0.7 },
  // on a phone the card is the page, edge to edge
  card: {
    containerType: 'inline-size',
    borderRadius: { default: 14, [breakpoints.phone]: 0 },
    boxShadow: {
      default: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
      [breakpoints.phone]: `0 -1px 0 0 ${tokens.border}, 0 1px 0 0 ${tokens.border}`,
    },
    marginInline: { default: null, [breakpoints.phone]: -16 },
  },
  head: {
    display: { default: 'grid', [STACKED]: 'none' },
    gridTemplateColumns: { default: COLUMNS, [MIDDLING]: COLUMNS_MIDDLING },
    alignItems: 'center',
    columnGap: 16,
    height: 32,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // a column's name stays on the strip's one line
  headWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  end: { textAlign: 'right' },
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: COLUMNS,
      [MIDDLING]: COLUMNS_MIDDLING,
      [STACKED]: 'minmax(0, 1fr) auto auto',
    },
    alignItems: 'center',
    columnGap: { default: 16, [STACKED]: 10 },
    rowGap: { default: null, [STACKED]: 3 },
    minHeight: { default: 42, [STACKED]: 48 },
    paddingInline: 16,
    paddingBlock: { default: 0, [STACKED]: 8 },
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    cursor: 'pointer',
    outlineOffset: -2,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  rowSelected: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  // a section shown only because something inside it was found
  rowContext: { opacity: 0.6 },
  markBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  markAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  markInto: { backgroundColor: `color-mix(in oklab, ${tokens.primary} 10%, transparent)` },
  lead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    gridColumn: { default: null, [STACKED]: 1 },
    gridRow: { default: null, [STACKED]: 1 },
  },
  // a section's name and what it says about itself take every column but the last
  leadSpan: { gridColumn: { default: '1 / 7', [MIDDLING]: '1 / 6', [STACKED]: 1 } },
  twistie: {
    display: 'flex',
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  seat: {
    display: 'flex',
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.mutedForeground,
  },
  // a row can be carried by a pointer; the grip says so where one rests
  grip: {
    width: 13,
    height: 13,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      '@media (hover: none)': 0,
    },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  glyph: { width: 13, height: 13 },
  depthWide: { display: { default: 'block', [STACKED]: 'none' }, flexShrink: 0 },
  depthNarrow: { display: { default: 'none', [STACKED]: 'block' }, flexShrink: 0 },
  ordinal: {
    flexShrink: 0,
    marginInlineEnd: 4,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
  },
  // The name is the way into the row: a real button, so the row's other
  // buttons stand beside it rather than inside something that is itself a
  // control. The rest of the row still answers a pointer.
  open: {
    display: 'block',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  groupName: { flexShrink: 1, fontWeight: 600 },
  nameVoided: { color: tokens.mutedForeground, textDecorationLine: 'line-through' },
  nameComposing: { color: tokens.mutedForeground },
  hit: { fontWeight: 600, color: tokens.foreground },
  // what a section says about itself, quietly, after its name
  groupFacts: {
    display: { default: 'inline-flex', [STACKED]: 'none' },
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    marginInlineStart: 10,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  factItem: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  factRule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  cell: {
    display: { default: 'block', [STACKED]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  cellSource: { display: { default: 'block', [MIDDLING]: 'none', [STACKED]: 'none' } },
  figure: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: tokens.foreground },
  // a route that finds some of the roster nowhere is what the column says
  // first: the steps are the question's own business, the people it
  // cannot reach are the round's
  reach: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 5,
    verticalAlign: 'middle',
    color: tokens.warningForeground,
  },
  reachIcon: { width: 12, height: 12, flexShrink: 0 },
  reachWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  none: { color: tokens.mutedForeground },
  status: {
    display: 'flex',
    minWidth: 0,
    gridColumn: { default: null, [STACKED]: 2 },
    gridRow: { default: null, [STACKED]: 1 },
  },
  // Narrow, what the columns would have said goes on a line under the name,
  // each fact carrying its column's word, since there is no head above it.
  facts: {
    display: { default: 'none', [STACKED]: 'flex' },
    gridColumn: '1 / -1',
    gridRow: 2,
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  acts: {
    display: 'inline-flex',
    justifySelf: 'end',
    alignItems: 'center',
    gap: 2,
    gridColumn: { default: null, [STACKED]: 3 },
    gridRow: { default: null, [STACKED]: 1 },
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
      '@media (hover: none)': 1,
    },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  // the two things a section can gain are one press away where there is a
  // pointer; on a phone they are in the row's menu, beside everything else
  actWide: { display: { default: 'inline-flex', [STACKED]: 'none' } },
  quietButton: { color: tokens.mutedForeground },
})

type StatusFilter = 'all' | 'draft' | 'active' | 'voided'

/** which sections this reader folded, remembered per round on this device */
const readFolded = (key: string): ReadonlySet<string> => {
  try {
    const held = window.localStorage.getItem(key)
    const ids: unknown = held === null ? [] : JSON.parse(held)
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

const writeFolded = (key: string, folded: ReadonlySet<string>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify([...folded]))
  } catch {
    // nowhere to remember it; the folds last as long as the page does
  }
}

export function StructureTable({
  batchId,
  title,
  note,
  summary,
  rows,
  unreachable,
  selectedKey,
  onOpen,
  onAddGroup,
  onAddItem,
  onMove,
  accepts = () => true,
  onPublish,
  onVoid,
  onRestore,
  onDelete,
}: {
  /** which round this is, so the folds a reader made are its own */
  batchId: string
  /** the paper's name, which is what the card is */
  title: ReactNode
  /** what the paper is worth, said quietly beside its name */
  note?: ReactNode
  /** a strip under the head: how much of the paper the sections have been given */
  summary?: ReactNode
  rows: readonly StructureRow[]
  /** the questions whose route finds some of the roster nowhere, by how many */
  unreachable?: ReadonlyMap<string, { route: 'normal' | 'escalation'; count: number }>
  selectedKey: string | null
  onOpen: (row: StructureRow) => void
  onAddGroup: (parentId: string | null) => void
  onAddItem: (groupId: string | null) => void
  /** the dragged row now belongs where the dropped row is */
  onMove: (dragged: StructureRow, target: StructureRow, edge: 'before' | 'after' | 'into') => void
  /** whether a drop there is one the page can carry out; no mark is drawn where it is not */
  accepts?: (
    dragged: StructureRow,
    target: StructureRow,
    edge: 'before' | 'after' | 'into',
  ) => boolean
  onPublish: (itemId: string) => void
  onVoid: (itemId: string) => void
  onRestore: (itemId: string) => void
  onDelete: (itemId: string) => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const foldKey = `qualy.assessment.structure-folded.${batchId}`
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => readFolded(foldKey))
  useEffect(() => writeFolded(foldKey, folded), [foldKey, folded])
  const [drop, setDrop] = useState<{ key: string; edge: 'before' | 'after' | 'into' } | null>(null)
  // the row on the move, read while it is dragged over others: the drag's
  // own data cannot be read until the drop
  const carried = useRef<StructureRow | null>(null)

  const term = search.trim()
  const filtering = term !== '' || status !== 'all'
  const shown = shownRows(rows, { term, status, folded })

  const fold = (id: string) =>
    setFolded((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const edgeOf = (event: React.DragEvent, row: StructureRow) => {
    const box = event.currentTarget.getBoundingClientRect()
    const at = (event.clientY - box.top) / box.height
    if (row.kind === 'group' && at > 0.3 && at < 0.7) return 'into' as const
    return at < 0.5 ? ('before' as const) : ('after' as const)
  }

  /** everything every row needs to answer a drag and a press; written once */
  const handling = (row: StructureRow) => ({
    draggable: row.kind !== 'draft',
    onDragStart: (event: React.DragEvent) => {
      carried.current = row
      event.dataTransfer.setData('qualy/row', row.key)
    },
    onDragEnd: () => {
      carried.current = null
    },
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('qualy/row')) return
      const edge = edgeOf(event, row)
      if (carried.current !== null && !accepts(carried.current, row, edge)) {
        setDrop((mark) => (mark?.key === row.key ? null : mark))
        return
      }
      event.preventDefault()
      setDrop({ key: row.key, edge })
    },
    onDragLeave: () => setDrop((mark) => (mark?.key === row.key ? null : mark)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      setDrop(null)
      carried.current = null
      const key = event.dataTransfer.getData('qualy/row')
      const dragged = rows.find((one) => one.key === key)
      const edge = edgeOf(event, row)
      if (dragged !== undefined && dragged.key !== row.key && accepts(dragged, row, edge)) {
        onMove(dragged, row, edge)
      }
    },
    onClick: (event: React.MouseEvent) => {
      // a control on the row, or a menu it opened, answered for itself
      if ((event.target as HTMLElement).closest('button, [role="menu"]') !== null) return
      onOpen(row)
    },
  })

  const markOf = (row: StructureRow) => {
    const marked = drop?.key === row.key ? drop.edge : null
    return marked === 'before'
      ? styles.markBefore
      : marked === 'after'
        ? styles.markAfter
        : marked === 'into'
          ? styles.markInto
          : null
  }

  /** the letters that were typed, wherever they fall in a name */
  const found = (name: string): ReactNode => {
    const lower = term.toLowerCase()
    if (lower === '') return name
    const parts: ReactNode[] = []
    let at = 0
    for (;;) {
      const hit = name.toLowerCase().indexOf(lower, at)
      if (hit === -1) break
      if (hit > at) parts.push(name.slice(at, hit))
      parts.push(
        <span key={hit} {...stylex.props(styles.hit)}>
          {name.slice(hit, hit + lower.length)}
        </span>,
      )
      at = hit + lower.length
    }
    if (parts.length === 0) return name
    if (at < name.length) parts.push(name.slice(at))
    return parts
  }

  return (
    <Card data-testid="structure-table" xstyle={styles.card}>
      <CardHead title={title} note={note} wrap>
        <span {...stylex.props(styles.tools)}>
          <SearchField
            name="structure-search"
            value={search}
            onChange={setSearch}
            label={format(m.structureSearch)}
            xstyle={styles.search}
          />
          <Choice
            aria-label={format(m.structureColStatus)}
            xstyle={styles.statusChoice}
            value={status}
            options={[
              { value: 'all', label: format(m.structureStatusAll) },
              { value: 'draft', label: format(m.itemsStatusDraft) },
              { value: 'active', label: format(m.structureStatusLive) },
              { value: 'voided', label: format(m.itemsStatusVoided) },
            ]}
            onChange={(next) => setStatus(next as StatusFilter)}
          />
          {/* One press to make something, one more to say what. Where it
              lands is settled in the form that opens - the paper to begin
              with, any section from there - or by starting from the
              section's own row. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <PlusIcon aria-hidden />
                {format(m.structureNew)}
                <ChevronDownIcon aria-hidden {...stylex.props(styles.chevronDim)} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={stylex.props(styles.menuColumn).className}>
              <DropdownMenuItem onSelect={() => onAddItem(null)}>
                <FilePlusIcon aria-hidden />
                {format(m.itemsNew)}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddGroup(null)}>
                <FolderPlusIcon aria-hidden />
                {format(m.itemsGroupNew)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </CardHead>
      {summary}

      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.headWord)}>{format(m.structureColName)}</span>
        <span {...stylex.props(styles.headWord, styles.end)}>{format(m.structureColEach)}</span>
        <span {...stylex.props(styles.headWord, styles.end)}>{format(m.structureColMost)}</span>
        <span {...stylex.props(styles.headWord, styles.cellSource)}>
          {format(m.structureColSource)}
        </span>
        <span {...stylex.props(styles.headWord)}>{format(m.structureColChain)}</span>
        <span {...stylex.props(styles.headWord)}>{format(m.structureColStatus)}</span>
        <span />
      </div>

      {shown.length === 0 ? (
        <CardEmpty>{format(filtering ? m.structureNoMatch : m.structureEmpty)}</CardEmpty>
      ) : (
        <div data-testid="structure-rows">
          {shown.map(({ row, context, folded: shut, holds }) =>
            row.kind === 'group' ? (
              <GroupRow
                key={row.key}
                row={row}
                context={context}
                folded={shut}
                folds={holds && !filtering}
                selected={selectedKey === row.key}
                mark={markOf(row)}
                handlers={handling(row)}
                name={found(row.name)}
                onFold={() => fold(row.id)}
                onAddGroup={() => onAddGroup(row.id)}
                onAddItem={() => onAddItem(row.id)}
                onOpen={() => onOpen(row)}
              />
            ) : (
              <ItemRow
                key={row.key}
                row={row}
                reach={row.kind === 'item' ? unreachable?.get(row.id) : undefined}
                selected={selectedKey === row.key}
                mark={markOf(row)}
                handlers={handling(row)}
                name={found(row.name)}
                onOpen={() => onOpen(row)}
                onPublish={() => onPublish(row.id)}
                onVoid={() => onVoid(row.id)}
                onRestore={() => onRestore(row.id)}
                onDelete={() => onDelete(row.id)}
              />
            ),
          )}
        </div>
      )}
    </Card>
  )
}

/** what a row spreads onto its own element so a drag lands where it was drawn */
interface RowHandlers {
  draggable: boolean
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
  onClick: (event: React.MouseEvent) => void
}

/** a section: its number and name, what it is worth, and what it can gain */
function GroupRow({
  row,
  context,
  folded,
  folds,
  selected,
  mark,
  handlers,
  name,
  onFold,
  onAddGroup,
  onAddItem,
  onOpen,
}: {
  row: StructureRow
  context: boolean
  folded: boolean
  /** whether a fold control belongs here: it holds something, and the table is not a search */
  folds: boolean
  selected: boolean
  mark: stylex.StyleXStyles | null
  handlers: RowHandlers
  name: ReactNode
  onFold: () => void
  onAddGroup: () => void
  onAddItem: () => void
  onOpen: () => void
}) {
  const { format } = useI18n()
  const label = row.name.trim() === '' ? format(m.itemsGroupUnnamed) : row.name
  const facts = [
    row.cap === null || row.cap === undefined
      ? format(m.structureUncapped)
      : format(m.itemsCapChip, { value: trimAmount(row.cap) }),
    row.subtotal === undefined ? null : format(m.structureSubtotal, { sum: row.subtotal }),
    row.count === undefined ? null : format(m.itemsTreeSummaryNoCap, { count: row.count }),
  ].filter((fact): fact is string => fact !== null)
  return (
    <div
      {...handlers}
      data-testid="structure-row"
      data-kind="group"
      data-depth={row.depth}
      data-context={context}
      data-folded={folded}
      data-subtotal={row.subtotal}
      {...stylex.props(
        styles.row,
        selected && styles.rowSelected,
        context && styles.rowContext,
        mark,
        stylex.defaultMarker(),
      )}
    >
      <span {...stylex.props(styles.lead, styles.leadSpan)}>
        <DepthSpacer depth={row.depth} />
        {folds ? (
          <button
            type="button"
            aria-expanded={!folded}
            aria-label={format(m.structureFold, { name: label })}
            {...stylex.props(styles.twistie)}
            onClick={(event) => {
              onFold()
              // a press made with a pointer gives the focus back, or the row
              // would keep its actions on show for good
              if (event.detail > 0) event.currentTarget.blur()
            }}
          >
            {folded ? (
              <ChevronRightIcon aria-hidden {...stylex.props(styles.glyph)} />
            ) : (
              <ChevronDownIcon aria-hidden {...stylex.props(styles.glyph)} />
            )}
          </button>
        ) : (
          <span aria-hidden {...stylex.props(styles.seat)} />
        )}
        <span {...stylex.props(styles.ordinal)}>{row.ordinal}</span>
        <button
          type="button"
          aria-current={selected || undefined}
          data-testid="structure-open"
          {...stylex.props(styles.open, styles.name, styles.groupName)}
          title={label}
          onClick={onOpen}
        >
          {row.name.trim() === '' ? label : name}
        </button>
        <span {...stylex.props(styles.groupFacts)}>
          <FactRun facts={facts} />
        </span>
      </span>
      <span {...stylex.props(styles.facts)} style={{ paddingLeft: row.depth * INDENT_NARROW + 26 }}>
        <FactRun facts={facts} />
      </span>
      <span {...stylex.props(styles.acts)}>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={format(m.structureAddItemIn, { name: label })}
          title={format(m.itemsOutlineAddItem)}
          className={stylex.props(styles.actWide, styles.quietButton).className}
          onClick={(event) => {
            onAddItem()
            if (event.detail > 0) event.currentTarget.blur()
          }}
        >
          <FilePlusIcon aria-hidden />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={format(m.structureAddGroupIn, { name: label })}
          title={format(m.itemsOutlineAddGroup)}
          className={stylex.props(styles.actWide, styles.quietButton).className}
          onClick={(event) => {
            onAddGroup()
            if (event.detail > 0) event.currentTarget.blur()
          }}
        >
          <FolderPlusIcon aria-hidden />
        </Button>
        <RowMenu name={label}>
          <DropdownMenuItem onSelect={onOpen}>{format(m.structureOpen)}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddItem}>{format(m.itemsOutlineAddItem)}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddGroup}>
            {format(m.itemsOutlineAddGroup)}
          </DropdownMenuItem>
        </RowMenu>
      </span>
    </div>
  )
}

/** the room a level takes: one step in per level, before the fold control's seat */
function DepthSpacer({ depth }: { depth: number }) {
  if (depth === 0) return null
  return (
    <>
      <span aria-hidden {...stylex.props(styles.depthWide)} style={{ width: depth * INDENT }} />
      <span
        aria-hidden
        {...stylex.props(styles.depthNarrow)}
        style={{ width: depth * INDENT_NARROW }}
      />
    </>
  )
}

/** a few quiet facts with a hairline between them */
function FactRun({ facts }: { facts: readonly string[] }) {
  return (
    <>
      {facts.map((fact, index) => (
        <span key={`${index}:${fact}`} {...stylex.props(styles.factItem)}>
          {index > 0 && <span aria-hidden {...stylex.props(styles.factRule)} />}
          {fact}
        </span>
      ))}
    </>
  )
}

/** a question, read across the columns it fills */
function ItemRow({
  row,
  reach,
  selected,
  mark,
  handlers,
  name,
  onOpen,
  onPublish,
  onVoid,
  onRestore,
  onDelete,
}: {
  row: StructureRow
  /** how many on the roster its route finds nowhere, and on which route */
  reach: { route: 'normal' | 'escalation'; count: number } | undefined
  selected: boolean
  mark: stylex.StyleXStyles | null
  handlers: RowHandlers
  name: ReactNode
  onOpen: () => void
  onPublish: () => void
  onVoid: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const { format } = useI18n()
  const composing = row.kind === 'draft'
  const label = row.name.trim() === '' ? format(m.itemsUntitled) : row.name
  const each = composing
    ? ''
    : row.byRule === true
      ? format(m.structureEachByRule)
      : row.each === undefined
        ? ''
        : trimAmount(row.each)
  const most = composing ? '' : row.most === undefined ? format(m.structureUnlimited) : row.most
  const source =
    row.channels === undefined || row.channels.length === 0
      ? ''
      : format(
          row.channels.includes('participant')
            ? row.channels.includes('administrative')
              ? m.itemsEntrySourceBoth
              : m.itemsEntrySourceStudent
            : m.itemsEntrySourceAdministrative,
        )
  const review =
    row.review === undefined
      ? ''
      : row.review.kind === 'automatic'
        ? format(m.itemsModeAutomatic)
        : row.review.kind === 'direct'
          ? format(m.itemsModeDirect)
          : row.review.escalation > 0
            ? format(m.structureStepsBoth, {
                count: row.review.normal,
                escalation: row.review.escalation,
              })
            : format(m.structureSteps, { count: row.review.normal })
  const standing =
    row.status === 'active' ? (
      <Status tone="ok">{format(m.structureStatusLive)}</Status>
    ) : row.status === 'draft' ? (
      <Status tone="warn">{format(m.itemsStatusDraft)}</Status>
    ) : row.status === 'voided' ? (
      <Status>{format(m.itemsStatusVoided)}</Status>
    ) : row.status === 'composing' ? (
      <Status>{format(m.itemsStatusComposing)}</Status>
    ) : null
  const reachWords =
    reach === undefined
      ? null
      : format(reach.route === 'normal' ? m.structureReachNormal : m.structureReachEscalation, {
          count: reach.count,
        })
  const reachMark =
    reachWords === null ? null : (
      <span
        {...stylex.props(styles.reach)}
        title={reachWords}
        data-testid="structure-reach"
        data-route={reach?.route}
        data-count={reach?.count}
      >
        <TriangleAlertIcon aria-hidden {...stylex.props(styles.reachIcon)} />
        <span {...stylex.props(styles.reachWords)}>{reachWords}</span>
      </span>
    )
  // stacked, the way a question is filed stays out: it is the same on most
  // rows and the longest of the four, and it pushed the rest onto a third line
  const facts = [
    each === '' ? '' : `${format(m.structureColEach)} ${each}`,
    most === '' ? '' : `${format(m.structureColMost)} ${most}`,
    review,
  ].filter((fact) => fact !== '')

  return (
    <div
      {...handlers}
      data-testid="structure-row"
      data-kind={row.kind}
      data-depth={row.depth}
      data-status={row.status}
      {...stylex.props(styles.row, selected && styles.rowSelected, mark, stylex.defaultMarker())}
    >
      <span {...stylex.props(styles.lead)}>
        <DepthSpacer depth={row.depth} />
        <span aria-hidden {...stylex.props(styles.seat)}>
          {!composing && <GripVerticalIcon {...stylex.props(styles.grip)} />}
        </span>
        <button
          type="button"
          aria-current={selected || undefined}
          data-testid="structure-open"
          {...stylex.props(
            styles.open,
            styles.name,
            row.status === 'voided' && styles.nameVoided,
            composing && styles.nameComposing,
          )}
          title={label}
          onClick={onOpen}
        >
          {row.name.trim() === '' ? label : name}
        </button>
      </span>
      <span
        {...stylex.props(styles.cell, styles.figure, row.byRule === true && styles.none)}
        data-testid="structure-each"
        data-each={row.byRule === true ? 'rule' : (row.each ?? '')}
      >
        {each}
      </span>
      <span {...stylex.props(styles.cell, styles.figure, row.most === undefined && styles.none)}>
        {most}
      </span>
      <span {...stylex.props(styles.cell, styles.cellSource)}>{source}</span>
      <span
        {...stylex.props(styles.cell)}
        data-testid="structure-review"
        data-review={
          row.review?.kind === 'steps'
            ? `${row.review.normal}+${row.review.escalation}`
            : row.review?.kind
        }
      >
        {reachMark ?? review}
      </span>
      <span {...stylex.props(styles.status)}>{standing}</span>
      <span {...stylex.props(styles.facts)} style={{ paddingLeft: row.depth * INDENT_NARROW + 26 }}>
        <FactRun facts={facts} />
        {reachMark}
      </span>
      <span {...stylex.props(styles.acts)}>
        {!composing && (
          <RowMenu name={label}>
            <DropdownMenuItem onSelect={onOpen}>{format(m.structureOpen)}</DropdownMenuItem>
            {row.status === 'draft' && (
              <DropdownMenuItem onSelect={onPublish}>{format(m.itemsPublish)}</DropdownMenuItem>
            )}
            {row.status === 'active' && (
              <DropdownMenuItem onSelect={onVoid}>{format(m.itemsVoid)}</DropdownMenuItem>
            )}
            {row.status === 'voided' && (
              <DropdownMenuItem onSelect={onRestore}>{format(m.itemsRestore)}</DropdownMenuItem>
            )}
            {row.status === 'draft' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  {format(m.itemsDelete)}
                </DropdownMenuItem>
              </>
            )}
          </RowMenu>
        )}
      </span>
    </div>
  )
}

function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  const { format } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={format(m.structureRowMenuOf, { name })}
          className={stylex.props(styles.quietButton).className}
        >
          <EllipsisIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* A portal's events travel up the React tree, not the DOM one, so a
          press in here reaches the row this menu was opened from - which
          opened the question every time somebody published one from the
          list. */}
      <DropdownMenuContent
        align="end"
        className={stylex.props(styles.menuColumn).className}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
