import { useState } from 'react'
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
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
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
import { trimAmount, type ItemDto } from '../entry/model.ts'
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

/** the eight columns every row lines up against, groups included */
const COLUMNS =
  'grid-cols-[3.5rem_minmax(0,1fr)_5.25rem_4.25rem_9.25rem_9.75rem_4rem_1.75rem] gap-3'

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

  const markOf = (row: StructureRow) => {
    const marked = drop?.key === row.key ? drop.edge : null
    return cn(
      marked === 'before' && 'shadow-[inset_0_2px_0_0_var(--primary)]',
      marked === 'after' && 'shadow-[inset_0_-2px_0_0_var(--primary)]',
      marked === 'into' && 'bg-primary/10',
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{format(m.itemsTreeTitle)}</h3>
        {/* dragging is a pointer's trick, so the line about it is for pointers */}
        <p className="hidden text-xs text-muted-foreground md:block">
          {format(m.structureDragHint)}
        </p>
        <span className="flex-1" />
        <div className="relative max-sm:w-full">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-8 max-sm:w-full sm:w-56"
            value={search}
            placeholder={format(m.structureSearch)}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Choice
          className="w-32"
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
              <ChevronDownIcon aria-hidden className="opacity-70" />
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
      <div className="rounded-lg border md:overflow-x-auto">
        <div className="md:min-w-3xl">
          <div
            className={cn(
              'hidden border-b bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground md:grid',
              COLUMNS,
            )}
          >
            <span>{format(m.structureColOrdinal)}</span>
            <span>{format(m.structureColName)}</span>
            <span className="text-right">{format(m.structureColEach)}</span>
            <span className="text-right">{format(m.structureColMost)}</span>
            <span>{format(m.structureColSource)}</span>
            <span>{format(m.structureColChain)}</span>
            <span>{format(m.structureColStatus)}</span>
            <span />
          </div>

          {shown.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {format(m.structureNoMatch)}
            </p>
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
  mark: string
  handlers: RowHandlers
  onAddGroup: () => void
  onAddItem: () => void
  onOpen: () => void
}) {
  const { format } = useI18n()
  return (
    <div
      {...handlers}
      className={cn(
        'cursor-pointer border-b bg-muted/50 px-3 py-2.5 transition-colors last:border-b-0',
        'flex flex-wrap items-center gap-2',
        // the same last column as a question row, so every menu down the
        // table sits on one line rather than wherever its row's words ended
        'md:grid md:grid-cols-[3.5rem_minmax(0,1fr)_auto_1.75rem] md:gap-3',
        selected ? 'bg-primary/10' : 'hover:bg-muted',
        mark,
      )}
      style={{ paddingLeft: `${row.depth * 1.25 + 0.75}rem` }}
    >
      <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
        {row.ordinal}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground md:hidden">
            {row.ordinal}
          </span>
          {/* what a section is, rather than a chevron promising a fold that
              these rows do not do */}
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-semibold">
            {row.name.trim() === '' ? format(m.itemsGroupUnnamed) : row.name}
          </span>
        </span>
        <span className="shrink-0 rounded-md border bg-background px-1.5 py-px text-xs tabular-nums">
          {row.cap === null || row.cap === undefined
            ? format(m.structureUncapped)
            : format(m.itemsCapChip, { value: trimAmount(row.cap) })}
        </span>
        {row.subtotal !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {format(m.structureSubtotal, { sum: trimAmount(row.subtotal) })}
          </span>
        )}
        {row.count !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(m.itemsTreeSummaryNoCap, { count: row.count })}
          </span>
        )}
      </span>
      {/* the two things a section can gain are one press away on a pointer
          and one more press away in the menu, which is where they live when
          there is no room for them */}
      <span className="hidden items-center gap-2 md:flex">
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
  mark: string
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
      className={cn(
        'min-w-0 truncate',
        row.status === 'voided' && 'text-muted-foreground line-through',
        composing && 'text-muted-foreground',
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
  const standing = cn(
    row.status === 'draft' || composing
      ? 'border-l-foreground/35'
      : row.status === 'voided'
        ? 'border-l-muted-foreground/30 bg-muted/25'
        : 'border-l-transparent',
    selected ? 'bg-primary/10' : 'hover:bg-accent/40',
  )

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
        className={cn(
          'flex cursor-pointer flex-col gap-1 border-b border-l-2 py-2 pr-2 text-sm transition-colors last:border-b-0 md:hidden',
          standing,
          mark,
        )}
        style={{ paddingLeft: `${row.depth * 1.25 + 0.75}rem` }}
      >
        <span className="flex items-center gap-2">
          {row.depth > 0 && (
            <span
              aria-hidden
              className="mt-[-0.35rem] mr-2 size-2 shrink-0 rounded-bl-[3px] border-b border-l"
            />
          )}
          {name}
          <span className="flex-1" />
          <StatusPill status={row.status} />
          {menu}
        </span>
        {facts.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {facts.join(` ${format(m.listSeparator).trim()} `)}
          </span>
        )}
      </div>

      <div
        {...handlers}
        className={cn(
          'hidden cursor-pointer items-center border-b border-l-2 px-3 py-2 text-sm transition-colors last:border-b-0 md:grid',
          COLUMNS,
          standing,
          mark,
        )}
      >
        <span />
        <span
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: `${row.depth * 1.25}rem` }}
        >
          {/* the guide is what tells a question inside a section from one
              sitting straight on the paper; indentation alone is a gap the
              eye has nothing to measure against */}
          {row.depth > 0 && (
            <span
              aria-hidden
              className="mt-[-0.35rem] mr-2 size-2 shrink-0 rounded-bl-[3px] border-b border-l"
            />
          )}
          {name}
        </span>
        <span className="text-right tabular-nums">{each}</span>
        <span className="text-right tabular-nums text-muted-foreground">{most}</span>
        <span className="truncate text-xs text-muted-foreground">{source}</span>
        <span className="truncate text-xs text-muted-foreground">{steps}</span>
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
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-px text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status === 'active' ? 'bg-foreground' : 'bg-muted-foreground/60',
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
    <Button variant="outline" size="xs" className="shrink-0" onClick={onClick}>
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
          className="shrink-0 justify-self-center text-muted-foreground"
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
