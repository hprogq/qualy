import { gateAllows } from '../../phase/gate.ts'
import type { ItemDto } from '../entry/model.ts'
import type { TreeGroup } from '../items/paper.ts'
import { structureRows } from '../items/structure.ts'

// What a stage's item allowance is chosen from, and what it does.
//
// Kept out of the panel so the panel's file exports components and nothing
// else, and so the one question worth asking the gate - which of these
// actions would an allowance narrow - is asked of the gate itself rather than
// of a second copy of its families.

export interface ScopeItem {
  readonly id: string
  readonly title: string
  readonly status: 'draft' | 'active' | 'voided'
}

/** one section of the paper and the questions directly inside it */
export interface ScopeSection {
  readonly id: string
  readonly title: string
  readonly items: readonly ScopeItem[]
}

const statusOf = (item: ItemDto): ScopeItem['status'] =>
  item.status === 'draft' || item.status === 'voided' ? item.status : 'active'

/**
 * The paper as the allowance picker lists it: each section with the questions
 * directly inside it, numbered and in the order the paper reads.
 *
 * A withdrawn question is listed only while the allowance still names it, so
 * it can be taken out; nobody files on it any more, so nobody adds it.
 */
export const scopeSections = (
  groups: readonly TreeGroup[],
  items: readonly ItemDto[],
  chosen: readonly string[],
): readonly ScopeSection[] => {
  const listed = items.filter((item) => item.status !== 'voided' || chosen.includes(item.id))
  const paper = groups.find((group) => group.parentGroupId === null)
  const inside = (groupId: string): readonly ScopeItem[] =>
    listed
      .filter((item) => item.scoreGroupId === groupId)
      .map((item) => ({ id: item.id, title: item.title, status: statusOf(item) }))
  const sections: ScopeSection[] = []
  if (paper !== undefined && inside(paper.id).length > 0) {
    sections.push({ id: paper.id, title: paper.name, items: inside(paper.id) })
  }
  for (const row of structureRows(groups, listed, [], paper?.id ?? null)) {
    if (row.kind !== 'group') continue
    const held = inside(row.id)
    if (held.length > 0)
      sections.push({ id: row.id, title: `${row.ordinal} ${row.name}`, items: held })
  }
  return sections
}

/**
 * Every question's id in the order the paper reads: section by section down
 * the tree, as the picker lists them. The list the server hands out is in
 * each section's own order, so two sections' first questions come before
 * either's second.
 */
export const paperOrderOf = (
  groups: readonly TreeGroup[],
  items: readonly ItemDto[],
): readonly string[] => {
  const walked = scopeSections(
    groups,
    items,
    items.map((item) => item.id),
  ).flatMap((section) => section.items.map((item) => item.id))
  const seen = new Set(walked)
  // a question under no section the tree reaches still has a name to give
  return [...walked, ...items.flatMap((item) => (seen.has(item.id) ? [] : [item.id]))]
}

/** every question's title by id, for a row that only holds ids */
export const titlesOf = (items: readonly ItemDto[]): ReadonlyMap<string, string> =>
  new Map(items.map((item) => [item.id, item.title]))

const SOME_ITEM: ReadonlySet<string> = new Set([''])
const NOBODY: ReadonlySet<string> = new Set()

/**
 * Whether an item allowance would change anything this stage opens.
 *
 * Asked of the gate: an allowance that names some other item refuses exactly
 * the actions it narrows, and reviewing is never among them. A stage that
 * opens none of those has nothing for an allowance to narrow.
 */
export const narrowsByItem = (profile: readonly string[]): boolean =>
  profile.some((code) => {
    const decision = gateAllows({ code, profile, itemScope: SOME_ITEM, participantScope: NOBODY })
    return !decision.allowed && decision.reason === 'item-out-of-scope'
  })
