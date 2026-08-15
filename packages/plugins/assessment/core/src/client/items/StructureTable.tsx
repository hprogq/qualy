import { useState } from 'react'
import { FolderPlusIcon, PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount, type ItemDto } from '../entry/model.ts'
import type { TreeDraft, TreeGroup } from './paper.ts'

// The whole paper, one row at a time.
//
// Nothing here is a special kind of thing: a section is a group, a section
// inside it is the same group one level down, and the numbering (1, 1.1,
// 2.2.1) plus the indent is what tells a reader how deep they are. Any depth
// reads, because no depth is drawn differently from another.

export interface StructureRow {
  key: string
  depth: number
  ordinal: string
  kind: 'group' | 'item' | 'draft'
  id: string
  name: string
  /** what one approved entry is worth, for a question */
  each?: string | undefined
  /** how many entries one person may file, for a question */
  most?: string | undefined
  source?: 'student' | 'administrative' | undefined
  steps?: number | undefined
  status?: 'draft' | 'active' | 'voided' | 'composing' | undefined
  cap?: string | null
}

const amountOf = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

const stepsOf = (item: ItemDto): number | undefined => {
  const policy = item.currentRevision?.reviewPolicy as { stages?: unknown[] } | undefined
  return Array.isArray(policy?.stages) ? policy.stages.length : undefined
}

/** the paper walked into rows, numbered the way a reader would number it */
export const structureRows = (
  groups: readonly TreeGroup[],
  items: readonly ItemDto[],
  drafts: readonly TreeDraft[],
  paperId: string | null,
): readonly StructureRow[] => {
  const childrenOf = new Map<string | null, TreeGroup[]>()
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bucket = childrenOf.get(group.parentGroupId)
    if (bucket === undefined) childrenOf.set(group.parentGroupId, [group])
    else bucket.push(group)
  }
  const rows: StructureRow[] = []

  const walk = (parentId: string, prefix: string, depth: number) => {
    let counter = 0
    for (const item of items.filter((one) => one.scoreGroupId === parentId)) {
      counter += 1
      const ordinal = prefix === '' ? String(counter) : `${prefix}.${counter}`
      rows.push({
        key: `i:${item.id}`,
        depth,
        ordinal,
        kind: 'item',
        id: item.id,
        name: item.title,
        each: amountOf(item),
        most: item.maxEntries === null ? undefined : String(item.maxEntries),
        source: item.currentRevision?.entrySource,
        steps: stepsOf(item),
        status: item.status as StructureRow['status'],
      })
    }
    for (const draft of drafts.filter(
      (one) => (one.kind === 'item' ? one.groupId : one.parentId) === parentId,
    )) {
      counter += 1
      rows.push({
        key: `d:${draft.localId}`,
        depth,
        ordinal: prefix === '' ? String(counter) : `${prefix}.${counter}`,
        kind: 'draft',
        id: draft.localId,
        name: draft.title,
        status: 'composing',
      })
    }
    for (const group of childrenOf.get(parentId) ?? []) {
      counter += 1
      const ordinal = prefix === '' ? String(counter) : `${prefix}.${counter}`
      rows.push({
        key: `g:${group.id}`,
        depth,
        ordinal,
        kind: 'group',
        id: group.id,
        name: group.name,
        cap: group.cap,
      })
      walk(group.id, ordinal, depth + 1)
    }
  }

  if (paperId !== null) walk(paperId, '', 0)
  return rows
}

export function StructureTable({
  rows,
  selectedKey,
  onOpen,
  onAddGroup,
  onAddItem,
  onMove,
}: {
  rows: readonly StructureRow[]
  selectedKey: string | null
  onOpen: (row: StructureRow) => void
  onAddGroup: (parentId: string | null) => void
  onAddItem: (groupId: string | null) => void
  /** the dragged row now belongs where the dropped row is */
  onMove: (dragged: StructureRow, target: StructureRow, edge: 'before' | 'after' | 'into') => void
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{format(m.itemsTreeTitle)}</p>
        <p className="text-xs text-muted-foreground">{format(m.structureDragHint)}</p>
        <span className="flex-1" />
        <Input
          className="h-8 w-44"
          value={search}
          placeholder={format(m.structureSearch)}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
          className="h-8 w-28"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="all">{format(m.structureStatusAll)}</option>
          <option value="draft">{format(m.itemsStatusDraft)}</option>
          <option value="active">{format(m.structureStatusLive)}</option>
          <option value="voided">{format(m.itemsStatusVoided)}</option>
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => onAddGroup(null)}>
          <FolderPlusIcon aria-hidden className="size-3.5" />
          {format(m.structureNewGroup)}
        </Button>
        <Button size="sm" onClick={() => onAddItem(null)}>
          <PlusIcon aria-hidden className="size-3.5" />
          {format(m.structureNewItem)}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-16 px-3 py-2 font-medium">{format(m.structureColOrdinal)}</th>
              <th className="px-3 py-2 font-medium">{format(m.structureColName)}</th>
              <th className="w-24 px-3 py-2 text-right font-medium">
                {format(m.structureColEach)}
              </th>
              <th className="w-24 px-3 py-2 text-right font-medium">
                {format(m.structureColMost)}
              </th>
              <th className="w-28 px-3 py-2 font-medium">{format(m.structureColSource)}</th>
              <th className="w-24 px-3 py-2 font-medium">{format(m.structureColChain)}</th>
              <th className="w-24 px-3 py-2 font-medium">{format(m.structureColStatus)}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {format(m.structureNoMatch)}
                </td>
              </tr>
            )}
            {shown.map((row) => {
              const marked = drop?.key === row.key ? drop.edge : null
              return (
                <tr
                  key={row.key}
                  draggable={row.kind !== 'draft'}
                  onDragStart={(event) => event.dataTransfer.setData('qualy/row', row.key)}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('qualy/row')) return
                    event.preventDefault()
                    setDrop({ key: row.key, edge: edgeOf(event, row) })
                  }}
                  onDragLeave={() => setDrop((mark) => (mark?.key === row.key ? null : mark))}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDrop(null)
                    const key = event.dataTransfer.getData('qualy/row')
                    const dragged = rows.find((one) => one.key === key)
                    if (dragged !== undefined && dragged.key !== row.key) {
                      onMove(dragged, row, edgeOf(event, row))
                    }
                  }}
                  onClick={() => onOpen(row)}
                  className={cn(
                    'cursor-pointer border-b last:border-b-0 transition-colors',
                    selectedKey === row.key ? 'bg-primary/5' : 'hover:bg-accent/40',
                    marked === 'before' && 'shadow-[inset_0_2px_0_0_var(--primary)]',
                    marked === 'after' && 'shadow-[inset_0_-2px_0_0_var(--primary)]',
                    marked === 'into' && 'bg-primary/10',
                  )}
                >
                  <td className="px-3 py-2 align-top text-xs tabular-nums text-muted-foreground">
                    {row.ordinal}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="flex min-w-0 items-center gap-2"
                      style={{ paddingLeft: `${row.depth * 1.25}rem` }}
                    >
                      {/* the guide line is what makes the fourth level readable */}
                      {row.depth > 0 && (
                        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
                      )}
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          row.kind === 'group' && 'font-medium',
                          row.status === 'voided' && 'text-muted-foreground line-through',
                          row.kind === 'draft' && 'text-muted-foreground',
                        )}
                      >
                        {row.name.trim() === ''
                          ? format(row.kind === 'group' ? m.itemsGroupUnnamed : m.itemsUntitled)
                          : row.name}
                      </span>
                      {row.kind === 'group' && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {row.cap === null || row.cap === undefined
                            ? format(m.structureUncapped)
                            : format(m.itemsCapChip, { value: trimAmount(row.cap) })}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {row.each === undefined ? '' : trimAmount(row.each)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {row.kind !== 'item'
                      ? ''
                      : row.most === undefined
                        ? format(m.structureUnlimited)
                        : row.most}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.source === undefined
                      ? ''
                      : format(
                          row.source === 'student'
                            ? m.itemsEntrySourceStudent
                            : m.itemsEntrySourceAdministrative,
                        )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.steps === undefined ? '' : format(m.structureSteps, { count: row.steps })}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.status === undefined || row.kind === 'group' ? null : (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[11px]',
                          row.status === 'active'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {format(
                          row.status === 'active'
                            ? m.structureStatusLive
                            : row.status === 'voided'
                              ? m.itemsStatusVoided
                              : row.status === 'composing'
                                ? m.itemsStatusComposing
                                : m.itemsStatusDraft,
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
