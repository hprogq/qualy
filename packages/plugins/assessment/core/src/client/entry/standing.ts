import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'
import { amountOf, trimAmount, unitsOf, type EntryDto, type ItemDto } from './model.ts'

// The round as a participant reads it: one row per group and per question,
// each already carrying what its line has to say.
//
// Worked out away from the drawing so the list, the group pane and the
// question pane all read the same answer to "where does this stand" - three
// components each deciding it themselves is three chances to disagree.

/** what the round has granted so far, as the result endpoint reports it */
export interface Standing {
  total: string
  groups: readonly {
    groupId: string
    parentGroupId: string | null
    name: string
    itemsTotal: string
    childrenTotal: string
    raw: string
    final: string
    cap: string | null
    floor: string | null
  }[]
  lines: readonly {
    lineId: string
    kind:
      | 'entry'
      | 'entry-not-counted'
      | 'excluded-evidence'
      | 'item-voided'
      | 'group-adjustment'
      | 'derived'
    label: string
    value: string
    itemId?: string | undefined
    provenance?: { entryId?: string | undefined } | undefined
  }[]
}

/** the one word a row says about itself beside its name */
export type RowTag = 'voided' | 'needs_revision' | 'draft' | 'in_review' | 'recorded' | 'open'

export const ROW_TAG: Record<RowTag, MessageDescriptor> = {
  voided: m.itemsStatusVoided,
  needs_revision: m.entryStatusNeedsRevision,
  draft: m.entryStatusDraft,
  in_review: m.entryStatusInReview,
  recorded: m.myEntriesRecorded,
  open: m.myEntriesOpen,
}

export interface StructureRow {
  id: string
  kind: 'group' | 'item'
  depth: number
  name: string
  /** the question itself, for the pane that opens it */
  item?: ItemDto | undefined
  /** what this row is worth so far, or how far its group has got */
  right: string
  /** a word about the row that is not its name: who files it, where it stands */
  tag: RowTag | null
  /** whether the reader still has something to do here */
  todo: boolean
  /** the groups above it, outermost first, for a breadcrumb */
  trail: readonly string[]
  cap?: string | null
  floor?: string | null
  /** the group this row sits directly inside, for the pane that lists it */
  parentId: string | null
}

/** what one question has granted so far, from the lines the result carries */
export const itemScore = (standing: Standing | null, itemId: string): string | null => {
  if (standing === null) return null
  const lines = standing.lines.filter((line) => line.kind === 'entry' && line.itemId === itemId)
  if (lines.length === 0) return null
  return amountOf(lines.reduce((sum, line) => sum + unitsOf(line.value), 0))
}

/** what one filed claim was granted, when it was granted anything */
export const entryScore = (standing: Standing | null, entryId: string): string | null => {
  const line = standing?.lines.find(
    (one) => one.kind === 'entry' && one.provenance?.entryId === entryId,
  )
  return line === undefined ? null : trimAmount(line.value)
}

/** how many more claims this question will still take from one person */
export const roomLeft = (item: ItemDto, entries: readonly EntryDto[]): number | null => {
  if (item.maxEntries === null) return null
  const live = entries.filter((entry) => entry.status !== 'voided').length
  return Math.max(0, item.maxEntries - live)
}

/** whether this person may still put something into this question */
export const mayFile = (item: ItemDto, entries: readonly EntryDto[]): boolean =>
  item.status === 'active' &&
  item.currentRevision?.entrySource === 'student' &&
  (roomLeft(item, entries) ?? 1) > 0

/** what one approved claim is worth, when the question pays a flat amount */
export const eachWorth = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

/** how many people have to agree before a claim counts */
export const chainLength = (item: ItemDto): number => {
  const policy = item.currentRevision?.reviewPolicy as { stages?: unknown[] } | undefined
  return Array.isArray(policy?.stages) ? policy.stages.length : 0
}

export const standingRows = ({
  groups,
  items,
  entriesByItem,
  standing,
}: {
  groups: readonly { id: string; parentGroupId: string | null; name: string }[]
  items: readonly ItemDto[]
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  standing: Standing | null
}): readonly StructureRow[] => {
  const childrenOf = new Map<string | null, { id: string; name: string }[]>()
  for (const group of groups) {
    const bucket = childrenOf.get(group.parentGroupId)
    if (bucket === undefined) childrenOf.set(group.parentGroupId, [group])
    else bucket.push(group)
  }
  const scoreOf = (groupId: string) =>
    standing?.groups.find((group) => group.groupId === groupId) ?? null

  // a group earns a row by holding questions, or by holding a group that
  // does. The rest of the paper is structure this participant can put nothing
  // into, and their own filing screen is not the place to read it.
  const holding = new Set<string>()
  const parentOf = new Map(groups.map((group) => [group.id, group.parentGroupId]))
  for (const item of items) {
    let at: string | null = item.scoreGroupId
    while (at !== null && !holding.has(at)) {
      holding.add(at)
      at = parentOf.get(at) ?? null
    }
  }

  const rows: StructureRow[] = []

  const walk = (parentId: string | null, depth: number, trail: readonly string[]) => {
    for (const group of childrenOf.get(parentId) ?? []) {
      if (!holding.has(group.id)) continue
      const score = scoreOf(group.id)
      rows.push({
        id: group.id,
        kind: 'group',
        depth,
        name: group.name,
        right: score === null ? '' : trimAmount(score.final),
        tag: null,
        todo: false,
        trail,
        cap: score?.cap ?? null,
        floor: score?.floor ?? null,
        parentId,
      })
      const inside = [...trail, group.name]
      for (const item of items.filter((one) => one.scoreGroupId === group.id)) {
        rows.push(itemRow(item, entriesByItem.get(item.id) ?? [], standing, depth + 1, inside))
      }
      walk(group.id, depth + 1, inside)
    }
  }

  walk(null, 0, [])

  // a question whose group never arrived is still a question to answer; it
  // stands at the top rather than falling out of the list
  const placed = new Set(rows.map((row) => row.id))
  for (const item of items) {
    if (!placed.has(item.id)) {
      rows.unshift(itemRow(item, entriesByItem.get(item.id) ?? [], standing, 0, []))
    }
  }

  return rows
}

const itemRow = (
  item: ItemDto,
  entries: readonly EntryDto[],
  standing: Standing | null,
  depth: number,
  trail: readonly string[],
): StructureRow => {
  const granted = itemScore(standing, item.id)
  const drafts = entries.filter((entry) => entry.status === 'draft').length
  const sentBack = entries.filter((entry) => entry.status === 'needs_revision').length
  const pending = entries.filter((entry) => entry.status === 'in_review').length
  return {
    id: item.id,
    kind: 'item',
    depth,
    name: item.title,
    item,
    right: granted ?? '',
    // one word about where this row stands, in the order it matters: what is
    // waiting on the reader, then what is waiting on somebody else
    tag:
      item.status === 'voided'
        ? 'voided'
        : // what is waiting on the reader, hardest first: something sent
          // back is a thing they were told to do
          sentBack > 0
          ? 'needs_revision'
          : drafts > 0
            ? 'draft'
            : pending > 0
              ? 'in_review'
              : item.currentRevision?.entrySource === 'administrative'
                ? 'recorded'
                : mayFile(item, entries)
                  ? 'open'
                  : null,
    todo: item.status !== 'voided' && (sentBack > 0 || drafts > 0 || mayFile(item, entries)),
    trail,
    parentId: item.scoreGroupId,
  }
}
