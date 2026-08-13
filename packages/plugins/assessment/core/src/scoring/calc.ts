import type { AggregatorDriver, CalculatorDriver } from '../plugin.ts'
import { formatAmount, scaledAmount } from './builtins.ts'

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
  readonly kind: 'entry' | 'excluded-evidence' | 'item-voided' | 'group-adjustment'
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
  readonly name: string
  /** what the items added up to, before the group's own limits */
  readonly itemsTotal: string
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

  // the frozen order (§8.6): group, then the group's items, then each
  // item's entries; a group's own adjustment closes its run
  const lines: BreakdownLine[] = []
  const groupViews: BreakdownGroup[] = []
  let total = 0n

  for (const group of groups) {
    let itemsTotal = 0n
    for (const item of items) {
      if (item.scoreGroupId !== group.id) continue
      const entries = entriesByItem.get(item.id) ?? []
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
      const aggregator = resolve(
        catalogs.aggregators as ReadonlyMap<string, AggregatorDriver>,
        'aggregator',
        item.aggregator.ref,
      )
      const approved: bigint[] = []
      for (const entry of entries) {
        if (entry.status === 'approved') {
          const amount = calculator.amountOf(item.calculator.config, { payload: entry.payload })
          approved.push(amount)
          lines.push({
            lineId: `entry:${entry.id}`,
            kind: 'entry',
            label: item.title,
            value: formatAmount(amount),
            itemId: item.id,
            provenance: {
              entryId: entry.id,
              ...(entry.revisionId !== null ? { entryRevisionId: entry.revisionId } : {}),
              calculatorRef: item.calculator.ref,
            },
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
      itemsTotal += aggregator.fold(item.aggregator.config, approved)
    }

    let final = itemsTotal
    if (group.cap !== null) {
      const cap = scaledAmount(group.cap)
      if (final > cap) {
        lines.push({
          lineId: `grp:${group.id}:cap`,
          kind: 'group-adjustment',
          label: group.name,
          value: formatAmount(cap - final),
        })
        final = cap
      }
    }
    if (group.floor !== null) {
      const floor = scaledAmount(group.floor)
      if (final < floor) {
        lines.push({
          lineId: `grp:${group.id}:floor`,
          kind: 'group-adjustment',
          label: group.name,
          value: formatAmount(floor - final),
        })
        final = floor
      }
    }
    groupViews.push({
      groupId: group.id,
      name: group.name,
      itemsTotal: formatAmount(itemsTotal),
      final: formatAmount(final),
      cap: group.cap,
      floor: group.floor,
    })
    total += final
  }

  return { total: formatAmount(total), groups: groupViews, lines }
}
