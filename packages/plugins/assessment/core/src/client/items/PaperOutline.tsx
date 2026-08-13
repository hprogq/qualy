import { ChevronRightIcon, FolderIcon, PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'

// The paper, seen whole.
//
// Whoever composes a round is doing what a teacher does with an exam: they
// look at the shape of the thing - what sections it has, what each is worth,
// which questions sit where - and then change one part at a time. So the
// structure stays on screen while a part is edited, rather than a dialog
// covering the paper every time somebody touches a question.

export interface OutlineGroup {
  id: string
  parentGroupId: string | null
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}

export type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'new-group'; parentId: string | null }
  | { kind: 'item'; id: string }
  | { kind: 'new-item'; groupId: string }

const amountOf = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

export function PaperOutline({
  groups,
  items,
  selection,
  onSelect,
}: {
  groups: readonly OutlineGroup[]
  items: readonly ItemDto[]
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const { format } = useI18n()

  const childrenOf = new Map<string | null, OutlineGroup[]>()
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bucket = childrenOf.get(group.parentGroupId)
    if (bucket === undefined) childrenOf.set(group.parentGroupId, [group])
    else bucket.push(group)
  }

  const rows: { depth: number; node: React.ReactNode; key: string }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const group of childrenOf.get(parent) ?? []) {
      const own = items.filter((item) => item.scoreGroupId === group.id)
      rows.push({
        key: `g:${group.id}`,
        depth,
        node: (
          <GroupRow
            group={group}
            depth={depth}
            selected={selection?.kind === 'group' && selection.id === group.id}
            onSelect={() => onSelect({ kind: 'group', id: group.id })}
            onAddItem={() => onSelect({ kind: 'new-item', groupId: group.id })}
            onAddGroup={() => onSelect({ kind: 'new-group', parentId: group.id })}
          />
        ),
      })
      for (const item of own) {
        rows.push({
          key: `i:${item.id}`,
          depth: depth + 1,
          node: (
            <ItemRow
              item={item}
              depth={depth + 1}
              selected={selection?.kind === 'item' && selection.id === item.id}
              onSelect={() => onSelect({ kind: 'item', id: item.id })}
            />
          ),
        })
      }
      walk(group.id, depth + 1)
    }
  }
  walk(null, 0)

  // questions whose group is gone are still somebody's history; they are
  // shown rather than quietly missing from the paper
  const orphans = items.filter((item) => !groups.some((group) => group.id === item.scoreGroupId))

  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          {format(m.itemsOutlineEmpty)}
        </p>
      )}
      {rows.map((row) => (
        <div key={row.key}>{row.node}</div>
      ))}
      {orphans.length > 0 && (
        <div className="pt-2">
          <p className="px-2 pb-1 text-xs text-muted-foreground">{format(m.itemsOutlineOrphans)}</p>
          {orphans.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              depth={0}
              selected={selection?.kind === 'item' && selection.id === item.id}
              onSelect={() => onSelect({ kind: 'item', id: item.id })}
            />
          ))}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 justify-start text-muted-foreground"
        onClick={() => onSelect({ kind: 'new-group', parentId: null })}
      >
        <PlusIcon aria-hidden className="size-3.5" />
        {format(m.itemsGroupAdd)}
      </Button>
    </div>
  )
}

function GroupRow({
  group,
  depth,
  selected,
  onSelect,
  onAddItem,
  onAddGroup,
}: {
  group: OutlineGroup
  depth: number
  selected: boolean
  onSelect: () => void
  onAddItem: () => void
  onAddGroup: () => void
}) {
  const { format } = useI18n()
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1 transition-colors',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
      )}
      style={{ paddingLeft: `${depth * 0.875 + 0.25}rem` }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
        onClick={onSelect}
      >
        <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">
          {group.name === '' ? format(m.itemsGroupUnnamed) : group.name}
        </span>
        {group.cap !== null && (
          <Badge variant="outline" className="shrink-0 font-normal tabular-nums">
            {format(m.itemsCapChip, { value: group.cap })}
          </Badge>
        )}
      </button>
      {/* the two things one does to a section, where the section is */}
      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={onAddItem}
          title={format(m.itemsNew)}
        >
          {format(m.itemsOutlineAddItem)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={onAddGroup}
          title={format(m.itemsGroupAddChild)}
        >
          {format(m.itemsOutlineAddGroup)}
        </Button>
      </span>
    </div>
  )
}

function ItemRow({
  item,
  depth,
  selected,
  onSelect,
}: {
  item: ItemDto
  depth: number
  selected: boolean
  onSelect: () => void
}) {
  const { format } = useI18n()
  const amount = amountOf(item)
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left transition-colors',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
      )}
      style={{ paddingLeft: `${depth * 0.875 + 0.5}rem` }}
      onClick={onSelect}
    >
      <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
      <span
        className={cn(
          'truncate text-sm',
          item.status === 'voided' && 'text-muted-foreground line-through',
        )}
      >
        {item.title}
      </span>
      {amount !== undefined && (
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {amount.startsWith('-') ? amount : `+${amount}`}
        </span>
      )}
      {item.currentRevision?.entrySource === 'administrative' && (
        <Badge variant="secondary" className="shrink-0 font-normal">
          {format(m.itemsChipRecorded)}
        </Badge>
      )}
    </button>
  )
}
