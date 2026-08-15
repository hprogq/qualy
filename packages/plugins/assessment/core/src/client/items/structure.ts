import type { ItemDto } from '../entry/model.ts'
import type { TreeDraft, TreeGroup } from './paper.ts'

// The paper as rows: what the table draws, worked out away from the drawing.
//
// Kept out of the component file so that file exports components and nothing
// else - a module that mixes the two cannot be hot-replaced, and the editor
// reloads the whole page every time one of these is touched.

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
  /** what the questions inside a group add up to at most, for a group */
  subtotal?: string | undefined
  /** how many questions a group holds, at any depth */
  count?: number | undefined
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

/** what one question can contribute at most: its value times what one person may file */
export const itemCeiling = (item: ItemDto): number | null => {
  const each = amountOf(item)
  if (each === undefined || item.maxEntries === null) return null
  const value = Number(each)
  return Number.isFinite(value) ? value * item.maxEntries : null
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

  /** what a group holds, counting everything nested inside it */
  const held = (groupId: string): { count: number; ceiling: number | null } => {
    let count = 0
    let ceiling: number | null = 0
    for (const item of items.filter((one) => one.scoreGroupId === groupId)) {
      count += 1
      const most = itemCeiling(item)
      if (most === null) ceiling = null
      else if (ceiling !== null) ceiling += most
    }
    for (const child of childrenOf.get(groupId) ?? []) {
      const inside = held(child.id)
      count += inside.count
      if (inside.ceiling === null) ceiling = null
      else if (ceiling !== null) ceiling += inside.ceiling
    }
    return { count, ceiling }
  }

  // Only sections are numbered, so only sections count. A question sharing a
  // level with them used to take a number nothing showed, and the section
  // after it appeared to start at two.
  // Only sections are numbered, so only sections count. A question sharing a
  // level with them used to take a number nothing showed, and the section
  // after it appeared to start at two.
  const walk = (parentId: string, prefix: string, depth: number) => {
    let counter = 0
    for (const item of items.filter((one) => one.scoreGroupId === parentId)) {
      rows.push({
        key: `i:${item.id}`,
        depth,
        ordinal: '',
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
    for (const draft of drafts.filter((one) => one.groupId === parentId)) {
      rows.push({
        key: `d:${draft.localId}`,
        depth,
        ordinal: '',
        kind: 'draft',
        id: draft.localId,
        name: draft.title,
        status: 'composing',
      })
    }
    for (const group of childrenOf.get(parentId) ?? []) {
      counter += 1
      const ordinal = prefix === '' ? String(counter) : `${prefix}.${counter}`
      const inside = held(group.id)
      rows.push({
        key: `g:${group.id}`,
        depth,
        ordinal,
        kind: 'group',
        id: group.id,
        name: group.name,
        cap: group.cap,
        subtotal: inside.ceiling === null ? undefined : String(inside.ceiling),
        count: inside.count,
      })
      walk(group.id, ordinal, depth + 1)
    }
  }

  if (paperId !== null) walk(paperId, '', 0)
  return rows
}
