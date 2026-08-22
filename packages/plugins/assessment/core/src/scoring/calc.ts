import type { AggregatorDriver, CalculatorDriver } from '../plugin.ts'
import { formatAmount, quantizeAmount, scaledAmount } from './builtins.ts'

// The one scorer (§8.1). Everything that shows a number - the provisional
// result now, previews and frozen runs later - calls this same pure
// function; a second "+3" computed anywhere else is the bug this file
// exists to make unwritable.
//
// Pure and total over its input: no clock, no queries, no floats. Sorting
// happens in here, not in the queries that feed it, so the same facts give
// the byte-identical breakdown whatever order they arrived in.

export interface ScoreInputGroup {
  readonly id: string
  /** the group this one adds up into; null is a top-level group */
  readonly parentGroupId: string | null
  readonly name: string
  /** decimal strings as the columns hold them; null means unlimited */
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder: number
}

export interface ScoreInputItem {
  readonly id: string
  readonly title: string
  readonly scoreGroupId: string
  readonly sortOrder: number
  readonly status: string
  readonly createdAt: number
  readonly calculator: { readonly ref: string; readonly config: unknown }
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  /** nobody files anything: the amount is the round's own rule (§32.65) */
  readonly derived?: boolean
}

export interface ScoreInputEntry {
  readonly id: string
  readonly itemId: string
  readonly status: string
  readonly revisionId: string | null
  readonly payload: unknown
  readonly createdAt: number
}

/** the effective facts one participant is scored from (§32.57: in M2, approved payloads verbatim) */
export interface ScoreInput {
  readonly groups: readonly ScoreInputGroup[]
  readonly items: readonly ScoreInputItem[]
  readonly entries: readonly ScoreInputEntry[]
}

export interface BreakdownLine {
  readonly lineId: string
  readonly kind:
    | 'entry'
    /** approved, but the item's rule counted other lines instead */
    | 'entry-not-counted'
    | 'excluded-evidence'
    | 'item-voided'
    | 'group-adjustment'
    /** nobody filed it: the round grants it to everybody on the roster */
    | 'derived'
  readonly label: string
  readonly value: string
  readonly itemId?: string
  readonly provenance?: {
    readonly entryId?: string
    readonly entryRevisionId?: string
    readonly calculatorRef?: string
  }
}

export interface BreakdownGroup {
  readonly groupId: string
  readonly parentGroupId: string | null
  /** how deep in the tree, so a reader can indent without walking it */
  readonly depth: number
  readonly name: string
  /** this group's own questions */
  readonly itemsTotal: string
  /** what the groups inside it came to, each already held to its own limits */
  readonly childrenTotal: string
  /** the two added, before this group's own ceiling or floor */
  readonly raw: string
  readonly final: string
  readonly cap: string | null
  readonly floor: string | null
}

export interface Breakdown {
  readonly total: string
  readonly groups: readonly BreakdownGroup[]
  readonly lines: readonly BreakdownLine[]
}

export interface ScoringCatalogs {
  readonly calculators: ReadonlyMap<string, { readonly kind: string }>
  readonly aggregators: ReadonlyMap<string, { readonly kind: string }>
}

const byGroup = (a: ScoreInputGroup, b: ScoreInputGroup) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
const byItem = (a: ScoreInputItem, b: ScoreInputItem) =>
  a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
const byEntry = (a: ScoreInputEntry, b: ScoreInputEntry) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/**
 * A missing driver is an assembly fault, not a data state: configurations
 * are validated against the installed catalog when saved, and the builtin
 * refs live in this very plugin. Thrown (a defect), never a refusal.
 */
const resolve = <T extends { kind: string }>(
  catalog: ReadonlyMap<string, T>,
  kind: string,
  ref: string,
): T => {
  const driver = catalog.get(ref)
  if (driver === undefined || driver.kind !== kind) {
    throw new Error(`scoring ${kind} "${ref}" is not installed in this assembly`)
  }
  return driver
}

export const calcParticipant = (catalogs: ScoringCatalogs, input: ScoreInput): Breakdown => {
  const groups = [...input.groups].sort(byGroup)
  const items = [...input.items].sort(byItem)
  const entriesByItem = new Map<string, ScoreInputEntry[]>()
  for (const entry of [...input.entries].sort(byEntry)) {
    const bucket = entriesByItem.get(entry.itemId)
    if (bucket === undefined) entriesByItem.set(entry.itemId, [entry])
    else bucket.push(entry)
  }

  // Depth first through the tree (§8.5 amended): a group is worth its own
  // items plus what its children came to after their own limits, and only
  // then does its own cap or floor apply. That order is the whole point -
  // a four-point cap on sport inside a ten-point cap on activities is two
  // limits, and applying them in the other order silently drops one.
  const childrenOf = new Map<string | null, ScoreInputGroup[]>()
  for (const group of groups) {
    const key = group.parentGroupId
    const bucket = childrenOf.get(key)
    if (bucket === undefined) childrenOf.set(key, [group])
    else bucket.push(group)
  }
  // a parent naming a group that is not here would strand its children; they
  // stand as roots rather than vanishing from the account
  const present = new Set(groups.map((group) => group.id))
  for (const group of groups) {
    if (group.parentGroupId !== null && !present.has(group.parentGroupId)) {
      const orphans = childrenOf.get(group.parentGroupId) ?? []
      childrenOf.set(null, [...(childrenOf.get(null) ?? []), ...orphans])
      childrenOf.delete(group.parentGroupId)
    }
  }

  const lines: BreakdownLine[] = []
  const groupViews: BreakdownGroup[] = []
  let total = 0n

  // a cycle cannot be scored - "what does this group add up to" has no
  // answer - and it cannot reach here through the api, which refuses one.
  // Thrown rather than refused: it means the rows themselves are wrong.
  const walking = new Set<string>()

  const walk = (group: ScoreInputGroup, depth: number): bigint => {
    if (walking.has(group.id)) {
      throw new Error(`score groups form a cycle at ${group.id}`)
    }
    walking.add(group.id)
    let itemsTotal = 0n
    for (const item of items) {
      if (item.scoreGroupId !== group.id) continue
      const entries = entriesByItem.get(item.id) ?? []
      // a question never published was never asked: it is absent from the
      // account entirely, not present at zero
      if (item.status === 'draft') continue
      if (item.status !== 'active') {
        // the question was withdrawn from scoring; whoever has history on
        // it sees that stated rather than silently missing
        if (entries.length > 0) {
          lines.push({
            lineId: `item:${item.id}:voided`,
            kind: 'item-voided',
            label: item.title,
            value: formatAmount(0n),
            itemId: item.id,
          })
        }
        continue
      }
      const calculator = resolve(
        catalogs.calculators as ReadonlyMap<string, CalculatorDriver>,
        'calculator',
        item.calculator.ref,
      )
      // a derived question grants its amount to everybody on the roster:
      // there is nothing to file, nothing to review, and the line says so
      if (item.derived === true) {
        const amount = quantizeAmount(
          calculator.amountOf(item.calculator.config, { payload: null }),
        )
        lines.push({
          lineId: `derived:${item.id}`,
          kind: 'derived',
          label: item.title,
          value: formatAmount(amount),
          itemId: item.id,
          provenance: { calculatorRef: item.calculator.ref },
        })
        itemsTotal += amount
        continue
      }
      const aggregator = resolve(
        catalogs.aggregators as ReadonlyMap<string, AggregatorDriver>,
        'aggregator',
        item.aggregator.ref,
      )
      const approved: { entry: ScoreInputEntry; amount: bigint }[] = []
      for (const entry of entries) {
        if (entry.status === 'approved') {
          approved.push({
            entry,
            amount: calculator.amountOf(item.calculator.config, { payload: entry.payload }),
          })
        } else if (entry.status === 'rejected') {
          // it was formally submitted and formally refused: the refusal is
          // part of the account, at zero, rather than an absence
          lines.push({
            lineId: `entry:${entry.id}`,
            kind: 'excluded-evidence',
            label: item.title,
            value: formatAmount(0n),
            itemId: item.id,
            provenance: {
              entryId: entry.id,
              ...(entry.revisionId !== null ? { entryRevisionId: entry.revisionId } : {}),
            },
          })
        }
        // draft, in_review, voided: no line - nothing has been decided
      }
      // The aggregator decides which approved lines count, and every line
      // says what it contributed: a rule like "only the highest office" must
      // be able to explain the offices it left at zero, or the account reads
      // as an addition that does not add up.
      const folded = aggregator.aggregate(
        item.aggregator.config,
        approved.map(({ entry, amount }) => ({ entryId: entry.id, amount })),
      )
      // The account is added up from the lines it prints, never beside them
      // (§16): each line's contribution is quantized to the hundredth it is
      // shown in and the group's own subtotal is the sum of those, so three
      // lines of 0.335 read as three times 0.34 above a subtotal of 1.02.
      // Adding the fold's own total instead would print a subtotal nobody
      // can reach by adding the lines above it.
      for (const [index, said] of folded.entries.entries()) {
        const { entry } = approved[index]!
        const amount = quantizeAmount(said.effectiveAmount)
        lines.push({
          lineId: `entry:${entry.id}`,
          kind: said.included ? 'entry' : 'entry-not-counted',
          label: item.title,
          value: formatAmount(amount),
          itemId: item.id,
          provenance: {
            entryId: entry.id,
            ...(entry.revisionId !== null ? { entryRevisionId: entry.revisionId } : {}),
            calculatorRef: item.calculator.ref,
          },
        })
        itemsTotal += amount
      }
    }

    // children after this group's own items, each already held to its own
    // limits, and their lines already written above this group's adjustment
    let childrenTotal = 0n
    for (const child of (childrenOf.get(group.id) ?? []).sort(byGroup)) {
      childrenTotal += walk(child, depth + 1)
    }
    walking.delete(group.id)
    const raw = itemsTotal + childrenTotal

    // A limit belongs to the same two-place arithmetic as the lines it holds
    // down: configuration admits four decimals, and a limit applied at four
    // would leave the adjustment line carrying a fraction of a cent the
    // account cannot print. The group says the limit it actually applied.
    const cap = group.cap === null ? null : quantizeAmount(scaledAmount(group.cap))
    const floor = group.floor === null ? null : quantizeAmount(scaledAmount(group.floor))
    let final = raw
    if (cap !== null && final > cap) {
      lines.push({
        lineId: `grp:${group.id}:cap`,
        kind: 'group-adjustment',
        label: group.name,
        value: formatAmount(cap - final),
      })
      final = cap
    }
    if (floor !== null && final < floor) {
      lines.push({
        lineId: `grp:${group.id}:floor`,
        kind: 'group-adjustment',
        label: group.name,
        value: formatAmount(floor - final),
      })
      final = floor
    }
    groupViews.push({
      groupId: group.id,
      parentGroupId: group.parentGroupId,
      depth,
      name: group.name,
      itemsTotal: formatAmount(itemsTotal),
      childrenTotal: formatAmount(childrenTotal),
      raw: formatAmount(raw),
      final: formatAmount(final),
      cap: cap === null ? null : formatAmount(cap),
      floor: floor === null ? null : formatAmount(floor),
    })
    return final
  }

  for (const root of (childrenOf.get(null) ?? []).sort(byGroup)) {
    total += walk(root, 0)
  }

  return { total: formatAmount(total), groups: groupViews, lines }
}
