import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  FolderIcon,
  FolderPlusIcon,
  FilePlusIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Input } from '@qualy/ui/input'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount } from '../entry/model.ts'
import type { StructureRow } from './structure.ts'

// The whole paper, one row at a time.
//
// Nothing here is a special kind of thing: a section is a group, a section
// inside it is the same group one level down, and the numbering (1, 1.1,
// 2.2.1) plus the indent is what tells a reader how deep they are. Any depth
// reads, because no depth is drawn differently from another.
//
// Groups carry the numbering and their own two add buttons; questions are
// the columns. Only groups are numbered, because a number on every row makes
// the column noise rather than a map.

const sm = '@media (min-width: 640px)'
const maxSm = '@media (max-width: 639.98px)'
const md = '@media (min-width: 768px)'

/** the eight columns every row lines up against, groups included */
const COLUMNS = '3.5rem minmax(0, 1fr) 5.25rem 4.25rem 9.25rem 9.75rem 4rem 1.75rem'

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  toolbarTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  dragHint: {
    display: {
      default: 'none',
      [md]: 'block',
    },
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  searchSeat: {
    position: 'relative',
    width: {
      default: null,
      [maxSm]: '100%',
    },
  },
  searchIcon: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  searchInput: {
    paddingLeft: 32,
    width: {
      default: null,
      [maxSm]: '100%',
      [sm]: 224,
    },
  },
  chevronDim: {
    opacity: 0.7,
  },
  statusChoice: {
    width: 128,
  },
  tableFrame: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    overflowX: {
      default: null,
      [md]: 'auto',
    },
  },
  tableMin: {
    minWidth: {
      default: null,
      [md]: '48rem',
    },
  },
  headerRow: {
    display: {
      default: 'none',
      [md]: 'grid',
    },
    gridTemplateColumns: COLUMNS,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  cellRight: {
    textAlign: 'right',
  },
  noMatch: {
    paddingInline: 12,
    paddingBlock: 32,
    textAlign: 'center',
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  groupRow: {
    cursor: 'pointer',
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    transitionProperty: 'color, background-color, border-color',
    display: {
      default: 'flex',
      [md]: 'grid',
    },
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: {
      default: 8,
      [md]: 12,
    },
    // the same last column as a question row, so every menu down the
    // table sits on one line rather than wherever its row's words ended
    gridTemplateColumns: {
      default: null,
      [md]: '3.5rem minmax(0, 1fr) auto 1.75rem',
    },
  },
  groupIdle: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowSelected: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 10%, transparent)`,
  },
  ordinalWide: {
    display: {
      default: 'none',
      [md]: 'block',
    },
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  ordinalNarrow: {
    display: {
      default: null,
      [md]: 'none',
    },
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  groupMain: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
  },
  groupNameSeat: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  folderIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  groupTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  capChip: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 6,
    paddingBlock: 1,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  subtotal: {
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  countNote: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  groupActions: {
    display: {
      default: 'none',
      [md]: 'flex',
    },
    alignItems: 'center',
    gap: 8,
  },
  shrinkNone: {
    flexShrink: 0,
  },
  menuButton: {
    flexShrink: 0,
    justifySelf: 'center',
    color: tokens.mutedForeground,
  },
  itemNarrow: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    cursor: 'pointer',
    flexDirection: 'column',
    gap: 4,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    paddingBlock: 8,
    paddingRight: 8,
    fontSize: 14,
    transitionProperty: 'color, background-color, border-color',
  },
  itemWide: {
    display: {
      default: 'none',
      [md]: 'grid',
    },
    cursor: 'pointer',
    alignItems: 'center',
    gridTemplateColumns: COLUMNS,
    gap: 12,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: 14,
    transitionProperty: 'color, background-color, border-color',
  },
  edgeDraft: {
    borderLeftColor: `color-mix(in oklab, ${tokens.foreground} 35%, transparent)`,
  },
  edgeVoided: {
    borderLeftColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  edgeNone: {
    borderLeftColor: 'transparent',
  },
  itemHover: {
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
  },
  itemVoidedSurface: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 25%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
  },
  narrowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  indentGuide: {
    marginTop: '-0.35rem',
    marginRight: 8,
    width: 8,
    height: 8,
    flexShrink: 0,
    borderBottomLeftRadius: 3,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  nameText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nameVoided: {
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
  },
  nameComposing: {
    color: tokens.mutedForeground,
  },
  factsLine: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  wideName: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  numCell: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  numCellMuted: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  metaCell: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  pill: {
    display: 'inline-flex',
    width: 'fit-content',
    alignItems: 'center',
    gap: 6,
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 8,
    paddingBlock: 1,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
  },
  pillDotActive: {
    backgroundColor: tokens.foreground,
  },
  pillDotIdle: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  markBefore: {
    boxShadow: `inset 0 2px 0 0 ${tokens.primary}`,
  },
  markAfter: {
    boxShadow: `inset 0 -2px 0 0 ${tokens.primary}`,
  },
  markInto: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 10%, transparent)`,
  },
})

export function StructureTable({
  rows,
  selectedKey,
  onOpen,
  onAddGroup,
  onAddItem,
  onMove,
  onPublish,
  onVoid,
  onRestore,
  onDelete,
}: {
  rows: readonly StructureRow[]
  selectedKey: string | null
  onOpen: (row: StructureRow) => void
  onAddGroup: (parentId: string | null) => void
  onAddItem: (groupId: string | null) => void
  /** the dragged row now belongs where the dropped row is */
  onMove: (dragged: StructureRow, target: StructureRow, edge: 'before' | 'after' | 'into') => void
  onPublish: (itemId: string) => void
  onVoid: (itemId: string) => void
  onRestore: (itemId: string) => void
  onDelete: (itemId: string) => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'active' | 'voided'>('all')
  const [drop, setDrop] = useState<{ key: string; edge: 'before' | 'after' | 'into' } | null>(null)

  const matches = (row: StructureRow) => {
    const term = search.trim()
    if (term !== '' && !row.name.includes(term)) return false
    if (status !== 'all' && row.kind === 'item' && row.status !== status) return false
    if (status !== 'all' && row.kind !== 'item') return false
    return true
  }
  const shown = search.trim() === '' && status === 'all' ? rows : rows.filter(matches)

  const edgeOf = (event: React.DragEvent, row: StructureRow) => {
    const box = event.currentTarget.getBoundingClientRect()
    const at = (event.clientY - box.top) / box.height
    if (row.kind === 'group' && at > 0.3 && at < 0.7) return 'into' as const
    return at < 0.5 ? ('before' as const) : ('after' as const)
  }

  /** everything every row needs to answer a drag; written once */
  const dragging = (row: StructureRow) => ({
    draggable: row.kind !== 'draft',
    onDragStart: (event: React.DragEvent) => event.dataTransfer.setData('qualy/row', row.key),
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('qualy/row')) return
      event.preventDefault()
      setDrop({ key: row.key, edge: edgeOf(event, row) })
    },
    onDragLeave: () => setDrop((mark) => (mark?.key === row.key ? null : mark)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      setDrop(null)
      const key = event.dataTransfer.getData('qualy/row')
      const dragged = rows.find((one) => one.key === key)
      if (dragged !== undefined && dragged.key !== row.key) onMove(dragged, row, edgeOf(event, row))
    },
    onClick: () => onOpen(row),
  })

  const markOf = (row: StructureRow): stylex.StyleXStyles | null => {
    const marked = drop?.key === row.key ? drop.edge : null
    return marked === 'before'
      ? styles.markBefore
      : marked === 'after'
        ? styles.markAfter
        : marked === 'into'
          ? styles.markInto
          : null
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <h3 {...stylex.props(styles.toolbarTitle)}>{format(m.itemsTreeTitle)}</h3>
        {/* dragging is a pointer's trick, so the line about it is for pointers */}
        <p {...stylex.props(styles.dragHint)}>{format(m.structureDragHint)}</p>
        <span {...stylex.props(styles.spacer)} />
        <div {...stylex.props(styles.searchSeat)}>
          <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
          <Input
            name="structure-search"
            aria-label={format(m.structureSearch)}
            className={stylex.props(styles.searchInput).className}
            value={search}
            placeholder={format(m.structureSearch)}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Choice
          xstyle={styles.statusChoice}
          value={status}
          options={[
            { value: 'all', label: format(m.structureStatusAll) },
            { value: 'draft', label: format(m.itemsStatusDraft) },
            { value: 'active', label: format(m.structureStatusLive) },
            { value: 'voided', label: format(m.itemsStatusVoided) },
          ]}
          onChange={(next) => setStatus(next as typeof status)}
        />
        {/* One press to make something, one more to say what. Two buttons
            side by side made the reader choose between them before they had
            been told they were choosing at all. Where it lands is settled in
            the form that opens - the paper to begin with, and any section
            from there - because a menu of every section in the paper is not
            a menu anybody can read once the paper is deep. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <PlusIcon aria-hidden />
              {format(m.structureNew)}
              <ChevronDownIcon aria-hidden className={stylex.props(styles.chevronDim).className} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
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
      </div>

      {/* Columns need a screen wide enough to hold them. Narrower than that,
          the same rows read as lines - name and standing on top, everything
          the columns would have said underneath - because a table nobody can
          see the right-hand end of is worse than no table. */}
      <div {...stylex.props(styles.tableFrame)}>
        <div {...stylex.props(styles.tableMin)}>
          <div {...stylex.props(styles.headerRow)}>
            <span>{format(m.structureColOrdinal)}</span>
            <span>{format(m.structureColName)}</span>
            <span {...stylex.props(styles.cellRight)}>{format(m.structureColEach)}</span>
            <span {...stylex.props(styles.cellRight)}>{format(m.structureColMost)}</span>
            <span>{format(m.structureColSource)}</span>
            <span>{format(m.structureColChain)}</span>
            <span>{format(m.structureColStatus)}</span>
            <span />
          </div>

          {shown.length === 0 && (
            <p {...stylex.props(styles.noMatch)}>{format(m.structureNoMatch)}</p>
          )}

          {shown.map((row) =>
            row.kind === 'group' ? (
              <GroupRow
                key={row.key}
                row={row}
                selected={selectedKey === row.key}
                mark={markOf(row)}
                handlers={dragging(row)}
                onAddGroup={() => onAddGroup(row.id)}
                onAddItem={() => onAddItem(row.id)}
                onOpen={() => onOpen(row)}
              />
            ) : (
              <ItemRow
                key={row.key}
                row={row}
                selected={selectedKey === row.key}
                mark={markOf(row)}
                handlers={dragging(row)}
                onOpen={() => onOpen(row)}
                onPublish={() => onPublish(row.id)}
                onVoid={() => onVoid(row.id)}
                onRestore={() => onRestore(row.id)}
                onDelete={() => onDelete(row.id)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

/** what a row spreads onto its own element so a drag lands where it was drawn */
interface RowHandlers {
  draggable: boolean
  onDragStart: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
  onClick: () => void
}

/** a section: what it is worth, what it holds, and the two things it can gain */
function GroupRow({
  row,
  selected,
  mark,
  handlers,
  onAddGroup,
  onAddItem,
  onOpen,
}: {
  row: StructureRow
  selected: boolean
  mark: stylex.StyleXStyles | null
  handlers: RowHandlers
  onAddGroup: () => void
  onAddItem: () => void
  onOpen: () => void
}) {
  const { format } = useI18n()
  return (
    <div
      {...handlers}
      {...stylex.props(styles.groupRow, selected ? styles.rowSelected : styles.groupIdle, mark)}
      style={{ paddingLeft: `${row.depth * 1.25 + 0.75}rem` }}
    >
      <span {...stylex.props(styles.ordinalWide)}>{row.ordinal}</span>
      <span {...stylex.props(styles.groupMain)}>
        <span {...stylex.props(styles.groupNameSeat)}>
          <span {...stylex.props(styles.ordinalNarrow)}>{row.ordinal}</span>
          {/* what a section is, rather than a chevron promising a fold that
              these rows do not do */}
          <FolderIcon aria-hidden className={stylex.props(styles.folderIcon).className} />
          <span {...stylex.props(styles.groupTitle)}>
            {row.name.trim() === '' ? format(m.itemsGroupUnnamed) : row.name}
          </span>
        </span>
        <span {...stylex.props(styles.capChip)}>
          {row.cap === null || row.cap === undefined
            ? format(m.structureUncapped)
            : format(m.itemsCapChip, { value: trimAmount(row.cap) })}
        </span>
        {row.subtotal !== undefined && (
          <span
            {...stylex.props(styles.subtotal)}
            data-testid="group-subtotal"
            data-subtotal={row.subtotal}
          >
            {format(m.structureSubtotal, { sum: row.subtotal })}
          </span>
        )}
        {row.count !== undefined && (
          <span {...stylex.props(styles.countNote)}>
            {format(m.itemsTreeSummaryNoCap, { count: row.count })}
          </span>
        )}
      </span>
      {/* the two things a section can gain are one press away on a pointer
          and one more press away in the menu, which is where they live when
          there is no room for them */}
      <span {...stylex.props(styles.groupActions)}>
        <RowButton
          label={format(m.structureRowAddGroup)}
          onClick={(event) => {
            event.stopPropagation()
            onAddGroup()
          }}
        />
        <RowButton
          label={format(m.structureNewItem)}
          onClick={(event) => {
            event.stopPropagation()
            onAddItem()
          }}
        />
      </span>
      <RowMenu>
        <DropdownMenuItem onSelect={onOpen}>{format(m.structureOpen)}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddGroup}>{format(m.itemsOutlineAddGroup)}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddItem}>{format(m.itemsOutlineAddItem)}</DropdownMenuItem>
      </RowMenu>
    </div>
  )
}

/** a question, read across the columns it fills */
function ItemRow({
  row,
  selected,
  mark,
  handlers,
  onOpen,
  onPublish,
  onVoid,
  onRestore,
  onDelete,
}: {
  row: StructureRow
  selected: boolean
  mark: stylex.StyleXStyles | null
  handlers: RowHandlers
  onOpen: () => void
  onPublish: () => void
  onVoid: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const { format } = useI18n()
  const composing = row.kind === 'draft'
  const each = row.each === undefined ? '' : trimAmount(row.each)
  const most = composing ? '' : row.most === undefined ? format(m.structureUnlimited) : row.most
  const source =
    row.source === undefined
      ? ''
      : format(
          row.source === 'student' ? m.itemsEntrySourceStudent : m.itemsEntrySourceAdministrative,
        )
  const steps = row.steps === undefined ? '' : format(m.structureSteps, { count: row.steps })
  const name = (
    <span
      {...stylex.props(
        styles.nameText,
        row.status === 'voided' && styles.nameVoided,
        composing && styles.nameComposing,
      )}
    >
      {row.name.trim() === '' ? format(m.itemsUntitled) : row.name}
    </span>
  )
  const menu = composing ? null : (
    <RowMenu>
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
  )
  const standing = [
    row.status === 'draft' || composing
      ? styles.edgeDraft
      : row.status === 'voided'
        ? styles.edgeVoided
        : styles.edgeNone,
    selected
      ? styles.rowSelected
      : row.status === 'voided'
        ? styles.itemVoidedSurface
        : styles.itemHover,
  ]

  // Narrow: name and standing on one line, everything the columns would have
  // said on the next, each still carrying the column's own word so a number
  // on its own never has to be guessed at.
  const facts = [
    each === '' ? '' : `${format(m.structureColEach)} ${each}`,
    most === '' ? '' : `${format(m.structureColMost)} ${most}`,
    source,
    steps,
  ].filter((fact) => fact !== '')

  return (
    <>
      <div
        {...handlers}
        {...stylex.props(styles.itemNarrow, ...standing, mark)}
        style={{ paddingLeft: `${row.depth * 1.25 + 0.75}rem` }}
      >
        <span {...stylex.props(styles.narrowHead)}>
          {row.depth > 0 && <span aria-hidden {...stylex.props(styles.indentGuide)} />}
          {name}
          <span {...stylex.props(styles.spacer)} />
          <StatusPill status={row.status} />
          {menu}
        </span>
        {facts.length > 0 && (
          <span {...stylex.props(styles.factsLine)}>
            {facts.join(` ${format(m.listSeparator).trim()} `)}
          </span>
        )}
      </div>

      <div {...handlers} {...stylex.props(styles.itemWide, ...standing, mark)}>
        <span />
        <span {...stylex.props(styles.wideName)} style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
          {/* the guide is what tells a question inside a section from one
              sitting straight on the paper; indentation alone is a gap the
              eye has nothing to measure against */}
          {row.depth > 0 && <span aria-hidden {...stylex.props(styles.indentGuide)} />}
          {name}
        </span>
        <span {...stylex.props(styles.numCell)}>{each}</span>
        <span {...stylex.props(styles.numCellMuted)}>{most}</span>
        <span {...stylex.props(styles.metaCell)}>{source}</span>
        <span {...stylex.props(styles.metaCell)}>{steps}</span>
        <StatusPill status={row.status} />
        {menu ?? <span />}
      </div>
    </>
  )
}

function StatusPill({ status }: { status: StructureRow['status'] }) {
  const { format } = useI18n()
  if (status === undefined) return <span />
  return (
    <span {...stylex.props(styles.pill)}>
      <span
        aria-hidden
        {...stylex.props(
          styles.pillDot,
          status === 'active' ? styles.pillDotActive : styles.pillDotIdle,
        )}
      />
      {format(
        status === 'active'
          ? m.structureStatusLive
          : status === 'voided'
            ? m.itemsStatusVoided
            : status === 'composing'
              ? m.itemsStatusComposing
              : m.itemsStatusDraft,
      )}
    </span>
  )
}

/** the small outlined action a group row carries; it must not open the row */
function RowButton({
  label,
  onClick,
}: {
  label: string
  onClick: (event: React.MouseEvent) => void
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={stylex.props(styles.shrinkNone).className}
      onClick={onClick}
    >
      <PlusIcon aria-hidden />
      {label}
    </Button>
  )
}

function RowMenu({ children }: { children: React.ReactNode }) {
  const { format } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={format(m.structureRowMenu)}
          className={stylex.props(styles.menuButton).className}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisVerticalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* A portal's events travel up the React tree, not the DOM one, so a
          press in here reaches the row this menu was opened from - which
          opened the question every time somebody published one from the
          list. */}
      <DropdownMenuContent
        align="end"
        className="w-40"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
