// The chain of units an import materialises, decided from the mapping and
// the tenant's type grammar - and nothing else.
//
// Pure: the tree and the grammar arrive as values. What is decided here is
// whether the chosen types form one continuous chain below the anchor, each
// step a rule the grammar actually has. Nothing is inferred to fill a gap:
// a type the file does not carry is a level the import must not invent.

import type { OrgNodeRef, OrgTypeRef, OrgTypeRuleRef } from '@qualy/org-contract'

export interface OrgLevel {
  readonly orgTypeId: string
  readonly column: string
}

export interface ImportMapping {
  readonly displayName: { readonly column: string }
  readonly businessNo: { readonly column: string }
  readonly organization: {
    readonly anchorNodeId: string | null
    readonly levels: readonly OrgLevel[]
  }
}

export type MappingProblem =
  | { readonly reason: 'no-root'; readonly subject: null }
  | { readonly reason: 'anchor-missing'; readonly subject: string }
  | { readonly reason: 'type-missing'; readonly subject: string }
  | { readonly reason: 'type-repeated'; readonly subject: string }
  | { readonly reason: 'type-above-anchor'; readonly subject: string }
  | { readonly reason: 'chain-broken'; readonly subject: string }
  | { readonly reason: 'chain-ambiguous'; readonly subject: string }
  | { readonly reason: 'column-missing'; readonly subject: string }
  | { readonly reason: 'column-repeated'; readonly subject: string }

/** one level of the resolved chain, from the root down */
export interface ChainLevel {
  readonly orgTypeId: string
  readonly orgTypeName: string
  readonly source: 'root' | 'fixed-node' | 'column'
  /** the fixed unit, where the level is one */
  readonly node: OrgNodeRef | null
  /** the column letter, where the level is one */
  readonly column: string | null
}

export interface ResolvedChain {
  readonly levels: readonly ChainLevel[]
  /** the deepest unit every row stands under */
  readonly anchor: OrgNodeRef
  /** the levels read per row, in chain order */
  readonly columns: readonly ChainLevel[]
  /** the type a person ends up standing at */
  readonly leafTypeId: string
}

export const resolveChain = (input: {
  readonly root: OrgNodeRef | null
  readonly types: readonly OrgTypeRef[]
  readonly rules: readonly OrgTypeRuleRef[]
  /** the anchor and everything above it, root first */
  readonly ancestry: readonly OrgNodeRef[]
  readonly mapping: ImportMapping
  readonly headers: ReadonlySet<string>
}):
  | { readonly ok: true; readonly chain: ResolvedChain }
  | { readonly ok: false; readonly problem: MappingProblem } => {
  const refuse = (problem: MappingProblem) => ({ ok: false as const, problem })
  if (input.root === null) return refuse({ reason: 'no-root', subject: null })
  const typeById = new Map(input.types.map((type) => [type.id, type]))
  const edges = new Set(input.rules.map((rule) => `${rule.parentTypeId}>${rule.childTypeId}`))
  const anchorId = input.mapping.organization.anchorNodeId ?? input.root.id
  const anchor = input.ancestry.at(-1)
  if (anchor === undefined || anchor.id !== anchorId || input.ancestry[0]?.id !== input.root.id) {
    return refuse({ reason: 'anchor-missing', subject: anchorId })
  }

  // the columns the mapping names all have to be there, and no two fields
  // may read the same one
  const used = new Set<string>()
  const columnOf = (column: string): MappingProblem | null => {
    if (!input.headers.has(column)) return { reason: 'column-missing', subject: column }
    if (used.has(column)) return { reason: 'column-repeated', subject: column }
    used.add(column)
    return null
  }
  for (const column of [input.mapping.displayName.column, input.mapping.businessNo.column]) {
    const problem = columnOf(column)
    if (problem !== null) return refuse(problem)
  }

  const aboveAnchor = new Set(input.ancestry.map((node) => node.orgTypeId))
  const byType = new Map<string, OrgLevel>()
  for (const level of input.mapping.organization.levels) {
    if (!typeById.has(level.orgTypeId)) {
      return refuse({ reason: 'type-missing', subject: level.orgTypeId })
    }
    if (aboveAnchor.has(level.orgTypeId)) {
      return refuse({ reason: 'type-above-anchor', subject: level.orgTypeId })
    }
    if (byType.has(level.orgTypeId)) {
      return refuse({ reason: 'type-repeated', subject: level.orgTypeId })
    }
    byType.set(level.orgTypeId, level)
    const problem = columnOf(level.column)
    if (problem !== null) return refuse(problem)
  }

  // The one order the grammar admits: at each step, the chosen type nothing
  // else chosen may still parent - and it has to be one the current type
  // parents directly. Two such types is a fork the file cannot settle; none
  // is a gap the import must not fill with a type the file does not carry.
  const remaining = new Set(byType.keys())
  const ordered: OrgLevel[] = []
  let current = anchor.orgTypeId
  while (remaining.size > 0) {
    const heads = [...remaining].filter(
      (typeId) => ![...remaining].some((other) => other !== typeId && edges.has(`${other}>${typeId}`)),
    )
    const nexts = heads.filter((typeId) => edges.has(`${current}>${typeId}`))
    if (nexts.length === 0) return refuse({ reason: 'chain-broken', subject: current })
    if (nexts.length > 1) return refuse({ reason: 'chain-ambiguous', subject: current })
    const next = nexts[0]!
    ordered.push(byType.get(next)!)
    remaining.delete(next)
    current = next
  }

  const levels: ChainLevel[] = input.ancestry.map((node, at) => ({
    orgTypeId: node.orgTypeId,
    orgTypeName: typeById.get(node.orgTypeId)?.name ?? '',
    source: at === 0 ? 'root' : 'fixed-node',
    node,
    column: null,
  }))
  for (const level of ordered) {
    levels.push({
      orgTypeId: level.orgTypeId,
      orgTypeName: typeById.get(level.orgTypeId)?.name ?? '',
      source: 'column',
      node: null,
      column: level.column,
    })
  }
  const columns = levels.filter((level) => level.source === 'column')
  return {
    ok: true,
    chain: { levels, anchor, columns, leafTypeId: levels[levels.length - 1]!.orgTypeId },
  }
}
