import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'

// The paper's structure, always on screen while one part of it is edited.
// Sections numbered the way an exam numbers them, each question a line with
// its score at the margin; what is selected opens in the pane beside this
// one. Rows drag: a question to another place or another group, a group
// among its siblings. The drop is persisted by the page - this component
// only says what should now come where.

export interface TreeGroup {
  id: string
  parentGroupId: string | null
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}

export type TreeSelection =
  | { kind: 'group'; id: string }
  | { kind: 'new-group'; parentId: string | null }
  | { kind: 'item'; id: string }
  | { kind: 'new-item'; groupId: string }

/** a drop about to happen, so the row can draw the line where it would land */
interface DropMark {
  key: string
  edge: 'before' | 'after' | 'into'
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const numeral = (index: number) => NUMERALS[index] ?? String(index + 1)

const amountOf = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

export function PaperTree({
  groups,
  items,
  selection,
  onSelect,
  onMoveItem,
  onReorderGroups,
}: {
  groups: readonly TreeGroup[]
  items: readonly ItemDto[]
  selection: TreeSelection | null
  onSelect: (next: TreeSelection) => void
  /** the question now belongs to this group, its siblings in this order */
  onMoveItem: (itemId: string, groupId: string, orderedItemIds: readonly string[]) => void
  /** this parent's groups now come in this order */
  onReorderGroups: (parentId: string | null, orderedGroupIds: readonly string[]) => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<DropMark | null>(null)

  const childrenOf = new Map<string | null, TreeGroup[]>()
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bucket = childrenOf.get(group.parentGroupId)
    if (bucket === undefined) childrenOf.set(group.parentGroupId, [group])
    else bucket.push(group)
  }
  const itemsOf = (groupId: string) => items.filter((item) => item.scoreGroupId === groupId)
  const orphans = items.filter((item) => !groups.some((group) => group.id === item.scoreGroupId))

  // -- what a finished drag means ------------------------------------------

  const dropItem = (dragged: string, target: ItemDto, edge: 'before' | 'after') => {
    const siblings = itemsOf(target.scoreGroupId)
      .map((one) => one.id)
      .filter((id) => id !== dragged)
    const at = siblings.indexOf(target.id)
    siblings.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onMoveItem(dragged, target.scoreGroupId, siblings)
  }

  const dropItemIntoGroup = (dragged: string, groupId: string) => {
    const siblings = itemsOf(groupId)
      .map((one) => one.id)
      .filter((id) => id !== dragged)
    onMoveItem(dragged, groupId, [...siblings, dragged])
  }

  const dropGroup = (dragged: string, target: TreeGroup, edge: 'before' | 'after') => {
    const draggedGroup = groups.find((group) => group.id === dragged)
    // reorder is among siblings; nesting stays an explicit action
    if (draggedGroup === undefined || draggedGroup.parentGroupId !== target.parentGroupId) return
    const siblings = (childrenOf.get(target.parentGroupId) ?? [])
      .map((group) => group.id)
      .filter((id) => id !== dragged)
    const at = siblings.indexOf(target.id)
    siblings.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onReorderGroups(target.parentGroupId, siblings)
  }

  const readDrag = (event: React.DragEvent): { kind: 'item' | 'group'; id: string } | null => {
    for (const kind of ['item', 'group'] as const) {
      const id = event.dataTransfer.getData(`qualy/${kind}`)
      if (id !== '') return { kind, id }
    }
    return null
  }

  const edgeOf = (event: React.DragEvent): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
  }

  // -- rendering ------------------------------------------------------------

  const renderQuestion = (item: ItemDto, number: number) => {
    const selected = selection?.kind === 'item' && selection.id === item.id
    const amount = amountOf(item)
    const negative = amount !== undefined && amount.startsWith('-')
    const marked = drop?.key === `i:${item.id}` ? drop.edge : null
    return (
      <button
        key={item.id}
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('qualy/item', item.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('qualy/item')) {
            event.preventDefault()
            setDrop({ key: `i:${item.id}`, edge: edgeOf(event) })
          }
        }}
        onDragLeave={() => setDrop((mark) => (mark?.key === `i:${item.id}` ? null : mark))}
        onDrop={(event) => {
          event.preventDefault()
          setDrop(null)
          const drag = readDrag(event)
          if (drag?.kind === 'item' && drag.id !== item.id) dropItem(drag.id, item, edgeOf(event))
        }}
        onClick={() => onSelect({ kind: 'item', id: item.id })}
        className={cn(
          'flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60',
          marked === 'before' && 'shadow-[0_-2px_0_0_var(--primary)]',
          marked === 'after' && 'shadow-[0_2px_0_0_var(--primary)]',
        )}
      >
        <span
          className={cn(
            'w-4 shrink-0 text-right text-xs tabular-nums',
            selected ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        >
          {number}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            item.status === 'voided' && 'line-through opacity-60',
          )}
        >
          {item.title}
        </span>
        {item.currentRevision?.entrySource === 'administrative' && (
          <span
            className={cn(
              'shrink-0 rounded px-1 py-px text-[11px]',
              selected ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground',
            )}
          >
            {format(m.itemsChipRecorded)}
          </span>
        )}
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            selected
              ? 'text-primary-foreground/80'
              : negative
                ? 'text-destructive'
                : 'text-muted-foreground',
          )}
        >
          {amount === undefined ? '—' : negative ? amount : `+${amount}`}
        </span>
      </button>
    )
  }

  const renderGroup = (group: TreeGroup, index: number, depth: number) => {
    const own = itemsOf(group.id)
    const children = childrenOf.get(group.id) ?? []
    const selected = selection?.kind === 'group' && selection.id === group.id
    const marked = drop?.key === `g:${group.id}` ? drop.edge : null
    return (
      <section key={group.id} className={cn(depth === 0 ? 'pt-5 first:pt-0' : 'pt-2')}>
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('qualy/group', group.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            const types = event.dataTransfer.types
            if (types.includes('qualy/item')) {
              event.preventDefault()
              setDrop({ key: `g:${group.id}`, edge: 'into' })
            } else if (types.includes('qualy/group')) {
              event.preventDefault()
              setDrop({ key: `g:${group.id}`, edge: edgeOf(event) })
            }
          }}
          onDragLeave={() => setDrop((mark) => (mark?.key === `g:${group.id}` ? null : mark))}
          onDrop={(event) => {
            event.preventDefault()
            setDrop(null)
            const drag = readDrag(event)
            if (drag === null) return
            if (drag.kind === 'item') dropItemIntoGroup(drag.id, group.id)
            else if (drag.id !== group.id) dropGroup(drag.id, group, edgeOf(event))
          }}
          className={cn(
            'group/heading flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5',
            selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60',
            marked === 'into' && 'ring-2 ring-primary/50',
            marked === 'before' && 'shadow-[0_-2px_0_0_var(--primary)]',
            marked === 'after' && 'shadow-[0_2px_0_0_var(--primary)]',
          )}
          onClick={() => onSelect({ kind: 'group', id: group.id })}
        >
          <span
            className={cn(
              'min-w-0 truncate',
              depth === 0 ? 'text-sm font-semibold' : 'text-sm font-medium',
            )}
          >
            {depth === 0 && `${numeral(index)}、`}
            {group.name === '' ? format(m.itemsGroupUnnamed) : group.name}
          </span>
          {group.cap !== null && (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
              )}
            >
              {format(m.itemsCapChip, { value: group.cap })}
            </span>
          )}
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/heading:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-5 px-1 text-[11px]', selected && 'hover:bg-primary-foreground/15')}
              onClick={(event) => {
                event.stopPropagation()
                onSelect({ kind: 'new-item', groupId: group.id })
              }}
            >
              {format(m.itemsOutlineAddItem)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-5 px-1 text-[11px]', selected && 'hover:bg-primary-foreground/15')}
              onClick={(event) => {
                event.stopPropagation()
                onSelect({ kind: 'new-group', parentId: group.id })
              }}
            >
              {format(m.itemsOutlineAddGroup)}
            </Button>
          </span>
        </div>
        {(own.length > 0 || children.length > 0) && (
          <div className={cn(depth > 0 && 'border-l border-border/60', 'ml-2 pl-2')}>
            {own.map((item, at) => renderQuestion(item, at + 1))}
            {children.map((child, at) => renderGroup(child, at, depth + 1))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col">
      {groups.length === 0 && orphans.length === 0 && (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          {format(m.itemsSheetEmpty)}
        </p>
      )}
      {(childrenOf.get(null) ?? []).map((group, index) => renderGroup(group, index, 0))}
      {orphans.length > 0 && (
        <section className="pt-5">
          <p className="px-2 pb-1 text-xs text-muted-foreground">{format(m.itemsOutlineOrphans)}</p>
          {orphans.map((item, at) => renderQuestion(item, at + 1))}
        </section>
      )}
      <div className="pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onSelect({ kind: 'new-group', parentId: null })}
        >
          <PlusIcon aria-hidden className="size-3.5" />
          {format(m.itemsGroupAdd)}
        </Button>
      </div>
    </div>
  )
}
