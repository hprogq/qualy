import { amountOf, unitsOf, type ItemDto } from '../entry/model.ts'
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
  /** the doors open on a question: who files it */
  channels?: readonly ('participant' | 'administrative')[] | undefined
  /** how a question's records are settled: its two routes' lengths, or no review at all */
  review?: ReviewShape | undefined
  /** a question scored by a rule rather than a fixed amount per entry */
  byRule?: boolean | undefined
  status?: 'draft' | 'active' | 'voided' | 'composing' | undefined
  cap?: string | null
  /** what the questions inside a group add up to at most, for a group */
  subtotal?: string | undefined
  /** how many questions a group holds, at any depth */
  count?: number | undefined
}

const eachOf = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      | { calculator?: { config?: { value?: string } } }
      | undefined
  )?.calculator?.config?.value

/** how a question's records are settled, read off its stored policy */
export type ReviewShape =
  | { kind: 'steps'; normal: number; escalation: number }
  | { kind: 'direct' }
  | { kind: 'automatic' }

// The stored policy holds two routes. This once read a single list off it,
// which no policy has had since the routes were split, so the column that
// says how a question is reviewed stood empty on every row.
const reviewOf = (item: ItemDto): ReviewShape | undefined => {
  if (item.itemType === 'constant') return { kind: 'automatic' }
  const policy = item.currentRevision?.reviewPolicy as
    | {
        mode?: string
        normal?: { stages?: unknown[] }
        escalation?: { stages?: unknown[] }
        stages?: unknown[]
      }
    | undefined
  if (policy === undefined || policy === null) return undefined
  if (policy.mode === 'none') return { kind: 'direct' }
  if (Array.isArray(policy.normal?.stages) || Array.isArray(policy.escalation?.stages)) {
    return {
      kind: 'steps',
      normal: policy.normal?.stages?.length ?? 0,
      escalation: policy.escalation?.stages?.length ?? 0,
    }
  }
  // a policy written as one list before the routes were split
  return Array.isArray(policy.stages)
    ? { kind: 'steps', normal: policy.stages.length, escalation: 0 }
    : undefined
}

const byRuleOf = (item: ItemDto): boolean => {
  const ref = (item.currentRevision?.scoringConfig as { calculator?: { ref?: string } } | undefined)
    ?.calculator?.ref
  return ref !== undefined && ref !== 'fixed@1'
}

/** which of a person's entries a question's rule can ever count */
export type Folding = { rule: 'sum' } | { rule: 'max' } | { rule: 'top-n'; n: number }

/**
 * How many entries the folding rule counts: everything a person may file for
 * 'sum', the highest one alone for 'max', the best n for 'top-n'. Null is a
 * count nothing bounds.
 *
 * Filing five and counting one is the ordinary shape of an office question,
 * so multiplying by the filing limit answers five times the amount the
 * scorer can ever grant, and a section cap sized against it is five times
 * too generous.
 */
export const countedEntries = (folding: Folding, maxEntries: number | null): number | null => {
  if (folding.rule === 'max') return 1
  if (folding.rule === 'top-n')
    return maxEntries === null ? folding.n : Math.min(folding.n, maxEntries)
  return maxEntries
}

const foldingOf = (item: ItemDto): Folding => {
  const aggregator = (
    item.currentRevision?.scoringConfig as
      | { aggregator?: { ref?: string; config?: { n?: number } } }
      | undefined
  )?.aggregator
  if (aggregator?.ref === 'max@1') return { rule: 'max' }
  if (aggregator?.ref === 'top-n-sum@1') return { rule: 'top-n', n: aggregator.config?.n ?? 1 }
  return { rule: 'sum' }
}

/**
 * What one question can contribute at most, in whole ten-thousandths: its
 * value times the number of entries its folding rule counts. Counted rather
 * than floated, because 0.1 three times is not 0.3 in a float and this
 * number is printed.
 */
export const itemCeiling = (item: ItemDto): number | null => {
  const each = eachOf(item)
  if (each === undefined) return null
  const counted = countedEntries(foldingOf(item), item.maxEntries)
  if (counted === null) return null
  return unitsOf(each) * counted
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
        each: eachOf(item),
        most: item.maxEntries === null ? undefined : String(item.maxEntries),
        channels: item.currentRevision?.entryChannels,
        review: reviewOf(item),
        byRule: byRuleOf(item),
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
        subtotal: inside.ceiling === null ? undefined : amountOf(inside.ceiling),
        count: inside.count,
      })
      walk(group.id, ordinal, depth + 1)
    }
  }

  if (paperId !== null) walk(paperId, '', 0)
  return rows
}

/** a row as the table shows it, and whether it is there only to hold a match */
export interface ShownRow {
  readonly row: StructureRow
  /** a group shown because something inside it matched, not because it did */
  readonly context: boolean
  /** a group whose rows are folded away */
  readonly folded: boolean
  /** a group with anything under it, which is what a fold control is for */
  readonly holds: boolean
}

/**
 * The rows the table draws: what matches, every group a match sits in, and
 * nothing under a folded group.
 *
 * A match keeps the groups above it, so a question found by name is still
 * read where it lives; lifted out of its group it was a name with nothing to
 * say which section it counts in. A group found by name brings what is in
 * it, still held to the state filter: shown alone, it was a heading with its
 * questions out of reach, and a search leaves no way to unfold one. A search
 * or a filter shows everything it found, folded or not.
 */
export const shownRows = (
  rows: readonly StructureRow[],
  filter: {
    term: string
    status: 'all' | 'draft' | 'active' | 'voided'
    folded: ReadonlySet<string>
  },
): readonly ShownRow[] => {
  const term = filter.term.trim().toLowerCase()
  const filtering = term !== '' || filter.status !== 'all'
  const holds = new Set<string>()
  rows.forEach((row, index) => {
    const next = rows[index + 1]
    if (row.kind === 'group' && next !== undefined && next.depth > row.depth) holds.add(row.key)
  })
  const named = (row: StructureRow) => term === '' || row.name.toLowerCase().includes(term)
  const stands = (row: StructureRow) =>
    filter.status === 'all' || (row.kind === 'item' && row.status === filter.status)
  const shown: ShownRow[] = []
  // the groups above the row being read, outermost first, and whether the
  // search found each by its own name
  const above: { row: StructureRow; placed: boolean; found: boolean }[] = []
  let foldedAt: number | null = null
  for (const row of rows) {
    while (above.length > 0 && above[above.length - 1]!.row.depth >= row.depth) above.pop()
    if (!filtering) {
      if (foldedAt !== null && row.depth > foldedAt) continue
      foldedAt = null
      const folded = row.kind === 'group' && filter.folded.has(row.id) && holds.has(row.key)
      if (folded) foldedAt = row.depth
      shown.push({ row, context: false, folded, holds: holds.has(row.key) })
      continue
    }
    const inFound = term !== '' && above.some((group) => group.found)
    const hit = stands(row) && (named(row) || inFound)
    if (hit) {
      for (const group of above) {
        if (group.placed) continue
        group.placed = true
        shown.push({ row: group.row, context: true, folded: false, holds: true })
      }
    }
    if (row.kind === 'group') {
      above.push({ row, placed: hit, found: term !== '' && named(row) })
    }
    if (hit) shown.push({ row, context: false, folded: false, holds: holds.has(row.key) })
  }
  return shown
}

/**
 * The places a group's questions take after a drop, as sort orders.
 *
 * `sequence` is the group in its new order. A voided question keeps the
 * place it had - nothing about it may be written, its sort order included -
 * so the live ones are numbered around it: each run of live questions
 * between two voided ones takes values strictly between theirs, and a run
 * whose values already read in order stays as it is. Numbering by position
 * instead gave a question dropped beside a voided one the voided one's own
 * value, and the tie went to whichever was older, so the drop did not take.
 *
 * Where two voided questions stand closer than the questions dropped
 * between them need, nothing that may be written can say the order; those
 * take the nearest values there are.
 */
export const sortOrdersAfterDrop = (
  sequence: readonly { id: string; sortOrder: number; voided: boolean }[],
): ReadonlyMap<string, number> => {
  const placed = new Map<string, number>()
  let run: { id: string; sortOrder: number }[] = []
  let below: number | null = null
  const settle = (above: number | null) => {
    const count = run.length
    if (count === 0) return
    const inOrder = run.every(
      (one, index) =>
        (index === 0 || one.sortOrder > run[index - 1]!.sortOrder) &&
        (below === null || one.sortOrder > below) &&
        (above === null || one.sortOrder < above),
    )
    const start = inOrder
      ? null
      : below !== null
        ? below + 1
        : above === null || above >= count
          ? 0
          : above - count
    run.forEach((one, index) => placed.set(one.id, start === null ? one.sortOrder : start + index))
    run = []
  }
  for (const one of sequence) {
    if (!one.voided) {
      run.push(one)
      continue
    }
    settle(one.sortOrder)
    below = below === null ? one.sortOrder : Math.max(below, one.sortOrder)
  }
  settle(null)
  return placed
}
