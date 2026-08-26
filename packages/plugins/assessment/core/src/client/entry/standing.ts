import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'
import { amountOf, fieldsOf, trimAmount, unitsOf, type EntryDto, type ItemDto } from './model.ts'

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
export type RowTag =
  | 'voided'
  | 'supplement'
  | 'needs_revision'
  | 'draft'
  | 'in_review'
  | 'rejected'
  | 'partial'
  | 'approved'
  | 'recorded'
  | 'granted'
  | 'open'

export const ROW_TAG: Record<RowTag, MessageDescriptor> = {
  voided: m.itemsStatusVoided,
  supplement: m.entryStatusAwaitingSupplement,
  needs_revision: m.entryStatusNeedsRevision,
  draft: m.entryStatusDraft,
  in_review: m.entryStatusInReview,
  rejected: m.entryStatusRejected,
  partial: m.rowPartialApproved,
  approved: m.entryStatusApproved,
  recorded: m.myEntriesRecorded,
  granted: m.rowGranted,
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
  /**
   * Whether something here is genuinely unfinished BY the reader: an open
   * ask, a return mark, or their own draft. "This question could be filed"
   * is not on anybody's plate and deliberately does not count (§32.72).
   */
  todo: boolean
  /** a change the reader has not looked at yet - the dot, and only the dot */
  unread: boolean
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
/**
 * The two review routes as the participant may know them: step names and
 * nothing else. Who each step lands on - levels, roles, people - is the
 * round's business; a name like "班委初审" is the whole of what this reader
 * is owed. Unnamed steps come back null and the caller numbers them.
 */
export const chainNamesOf = (
  item: ItemDto,
): { normal: readonly (string | null)[]; escalation: readonly (string | null)[] } => {
  const stored = item.currentRevision?.reviewPolicy as
    | ({
        mode?: unknown
        normal?: { stages?: unknown }
        escalation?: { stages?: unknown }
        /** the one list with a marker in it, before the routes were two */
        stages?: unknown
        normalTerminal?: number
      } | null)
    | undefined
  if (stored == null || stored.mode === 'none') return { normal: [], escalation: [] }
  const nameOf = (stage: unknown): string | null => {
    const label = (stage as { label?: unknown } | null)?.label
    return typeof label === 'string' && label.trim() !== '' ? label.trim() : null
  }
  const listOf = (held: unknown): readonly (string | null)[] =>
    Array.isArray(held) ? held.map(nameOf) : []
  if (stored.normal !== undefined || stored.escalation !== undefined) {
    return {
      normal: listOf(stored.normal?.stages),
      escalation: listOf(stored.escalation?.stages),
    }
  }
  const flat = Array.isArray(stored.stages) ? stored.stages.map(nameOf) : []
  const terminal = typeof stored.normalTerminal === 'number' ? stored.normalTerminal : 0
  return { normal: flat.slice(0, terminal + 1), escalation: flat.slice(terminal + 1) }
}

export const standingRows = ({
  groups,
  items,
  entriesByItem,
  standing,
  unreadItems = new Set<string>(),
}: {
  groups: readonly { id: string; parentGroupId: string | null; name: string }[]
  items: readonly ItemDto[]
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  standing: Standing | null
  /** questions holding changes the reader has not looked at (§32.72) */
  unreadItems?: ReadonlySet<string>
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
        unread: false,
        trail,
        cap: score?.cap ?? null,
        floor: score?.floor ?? null,
        parentId,
      })
      const inside = [...trail, group.name]
      for (const item of items.filter((one) => one.scoreGroupId === group.id)) {
        rows.push(
          itemRow(item, entriesByItem.get(item.id) ?? [], standing, depth + 1, inside, unreadItems),
        )
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
      rows.unshift(itemRow(item, entriesByItem.get(item.id) ?? [], standing, 0, [], unreadItems))
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
  unreadItems: ReadonlySet<string>,
): StructureRow => {
  const granted = itemScore(standing, item.id)
  // a constant lands by itself: before the scorer has spoken, its terms
  // already say what it is worth, and the row should too
  const constantWorth = item.itemType === 'constant' ? eachWorth(item) : undefined
  const live = entries.filter((entry) => entry.status !== 'voided')
  const asked = live.filter((entry) => entry.supplement !== null).length
  const sentBack = live.filter((entry) => entry.status === 'needs_revision').length
  const drafts = live.filter((entry) => entry.status === 'draft').length
  const pending = live.filter((entry) => entry.status === 'in_review').length
  const rejected = live.filter((entry) => entry.status === 'rejected').length
  const approved = live.filter((entry) => entry.status === 'approved').length
  return {
    id: item.id,
    kind: 'item',
    depth,
    name: item.title,
    item,
    right: granted ?? constantWorth ?? '',
    // One word about where this row stands (§32.72), in the order it
    // matters: what the round is waiting on the reader for, then the
    // reader's own unfinished work, then what is out with somebody else,
    // then how it ended. A question with both a yes and a no is "partly
    // refused", never just its worst claim.
    tag:
      item.status === 'voided'
        ? 'voided'
        : asked > 0
          ? 'supplement'
          : sentBack > 0
            ? 'needs_revision'
            : drafts > 0
              ? 'draft'
              : pending > 0
                ? 'in_review'
                : rejected > 0
                  ? approved > 0
                    ? 'partial'
                    : 'rejected'
                  : approved > 0
                    ? 'approved'
                    : item.itemType === 'constant'
                      ? 'granted'
                      : item.currentRevision?.entrySource === 'administrative'
                        ? 'recorded'
                        : mayFile(item, entries)
                          ? 'open'
                          : null,
    // unfinished BY the reader; "could still file" is not a duty
    todo: item.status !== 'voided' && (asked > 0 || sentBack > 0 || drafts > 0),
    unread: item.status !== 'voided' && unreadItems.has(item.id),
    trail,
    parentId: item.scoreGroupId,
  }
}

/**
 * The answers so far, read against the question as it now stands.
 *
 * A field is the same field across versions when it keeps its identity - its
 * own id, or, for forms written before ids, the key it has always been known
 * by - so a renamed key carries its answer with it. Anything whose type
 * changed is left behind rather than reinterpreted: the same characters mean
 * one thing in a date and another in a sentence, and guessing which is not
 * this screen's to do. Fields the new form does not ask for simply stop being
 * asked; new ones arrive empty, which is what a new question deserves.
 */
export const carryPayload = (
  from: ItemDto,
  to: ItemDto,
  payload: Record<string, string | readonly string[]>,
): Record<string, string | readonly string[]> => {
  const was = fieldsOf(from.currentRevision?.formConfig)
  const now = fieldsOf(to.currentRevision?.formConfig)
  const identity = (field: { id?: string; key: string }) => field.id ?? field.key
  const held = new Map(was.map((field) => [identity(field), field] as const))
  const carried: Record<string, string | readonly string[]> = {}
  for (const field of now) {
    const before = held.get(identity(field))
    if (before === undefined || before.type !== field.type) continue
    const value = payload[before.key]
    if (value !== undefined) carried[field.key] = value
  }
  return carried
}
