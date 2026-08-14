import { useState } from 'react'
import { ChevronDownIcon, FolderPlusIcon, PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount, type ItemDto } from '../entry/model.ts'

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

export type TreeSelection = { kind: 'group' | 'item'; id: string }

/** a drop about to happen, so the row can draw the line where it would land */
interface DropMark {
  key: string
  edge: 'before' | 'after' | 'into'
}

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
  onAddItem,
  onAddGroup,
  onMoveItem,
  onReorderGroups,
}: {
  groups: readonly TreeGroup[]
  items: readonly ItemDto[]
  selection: TreeSelection | null
  onSelect: (next: TreeSelection) => void
  /** pressing add creates the thing at once; the page owns that write */
  onAddItem: (groupId: string) => void
  onAddGroup: (parentId: string | null) => void
  /** the question now belongs to this group, its siblings in this order */
  onMoveItem: (itemId: string, groupId: string, orderedItemIds: readonly string[]) => void
  /** this parent's groups now come in this order */
  onReorderGroups: (parentId: string | null, orderedGroupIds: readonly string[]) => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<DropMark | null>(null)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())

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

  const renderQuestion = (item: ItemDto, depth: number) => {
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
          'flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent py-1.5 pr-2 text-left text-sm transition-colors',
          selected ? 'border-border bg-background shadow-sm' : 'hover:bg-accent/50',
          marked === 'before' && 'shadow-[0_-2px_0_0_var(--primary)]',
          marked === 'after' && 'shadow-[0_2px_0_0_var(--primary)]',
        )}
        style={{ paddingLeft: `${depth * 0.9 + 1.6}rem` }}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            item.status === 'voided' && 'line-through opacity-60',
          )}
        >
          {item.title}
        </span>
        {item.currentRevision?.entrySource === 'administrative' && (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[11px] text-muted-foreground">
            {format(m.itemsChipRecorded)}
          </span>
        )}
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            negative ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {amount === undefined ? '—' : negative ? trimAmount(amount) : `+${trimAmount(amount)}`}
        </span>
      </button>
    )
  }

  const renderGroup = (group: TreeGroup, depth: number) => {
    const own = itemsOf(group.id)
    const children = childrenOf.get(group.id) ?? []
    const selected = selection?.kind === 'group' && selection.id === group.id
    const marked = drop?.key === `g:${group.id}` ? drop.edge : null
    const isFolded = folded.has(group.id)
    return (
      <section key={group.id} className={cn(depth === 0 && 'pt-1.5 first:pt-0')}>
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
            'group/heading flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent py-1.5 pr-2',
            selected ? 'border-border bg-background shadow-sm' : 'hover:bg-accent/50',
            marked === 'into' && 'ring-2 ring-primary/50',
            marked === 'before' && 'shadow-[0_-2px_0_0_var(--primary)]',
            marked === 'after' && 'shadow-[0_2px_0_0_var(--primary)]',
          )}
          style={{ paddingLeft: `${depth * 0.9 + 0.25}rem` }}
          onClick={() => onSelect({ kind: 'group', id: group.id })}
        >
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
            aria-expanded={!isFolded}
            onClick={(event) => {
              event.stopPropagation()
              setFolded((previous) => {
                const next = new Set(previous)
                if (next.has(group.id)) next.delete(group.id)
                else next.add(group.id)
                return next
              })
            }}
          >
            <ChevronDownIcon
              aria-hidden
              className={cn('size-3 transition-transform', isFolded && '-rotate-90')}
            />
          </button>
          <span className="min-w-0 truncate text-sm font-medium">
            {group.name === '' ? format(m.itemsGroupUnnamed) : group.name}
          </span>
          {group.cap !== null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {format(m.itemsCapChip, { value: trimAmount(group.cap) })}
            </span>
          )}
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/heading:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-5 p-0"
                  aria-label={format(m.itemsOutlineAddItem)}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddItem(group.id)
                  }}
                >
                  <PlusIcon aria-hidden className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{format(m.itemsOutlineAddItem)}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-5 p-0"
                  aria-label={format(m.itemsOutlineAddGroup)}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddGroup(group.id)
                  }}
                >
                  <FolderPlusIcon aria-hidden className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{format(m.itemsOutlineAddGroup)}</TooltipContent>
            </Tooltip>
          </span>
        </div>
        {!isFolded && (own.length > 0 || children.length > 0) && (
          <div>
            {own.map((item) => renderQuestion(item, depth))}
            {children.map((child) => renderGroup(child, depth + 1))}
          </div>
        )}
      </section>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col">
        {groups.length === 0 && orphans.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {format(m.itemsSheetEmpty)}
          </p>
        )}
        {(childrenOf.get(null) ?? []).map((group) => renderGroup(group, 0))}
        {orphans.length > 0 && (
          <section className="pt-4">
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              {format(m.itemsOutlineOrphans)}
            </p>
            {orphans.map((item) => renderQuestion(item, 0))}
          </section>
        )}
      </div>
    </TooltipProvider>
  )
}
