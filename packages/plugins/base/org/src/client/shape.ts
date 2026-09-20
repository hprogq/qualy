import type { Effect } from 'effect'
import type { useApi } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { orgApi } from './api.ts'

// The organization as this screen holds it: the tree, the kinds a unit can
// be, and the rules saying which kind may stand under which.

export type OrgTreeNodeDto = ApiResult<typeof orgApi, 'org', 'getTree'>['nodes'][number]
export type OrgTypeDto = ApiResult<typeof orgApi, 'org', 'listTypes'>['types'][number]
export type OrgRuleDto = ApiResult<typeof orgApi, 'org', 'listRules'>['rules'][number]
export type Api = ReturnType<typeof useApi>
export type Run = (work: Effect.Effect<unknown, unknown>) => Promise<unknown>

export interface OrgShape {
  nodes: readonly OrgTreeNodeDto[]
  byId: ReadonlyMap<string, OrgTreeNodeDto>
  childrenOf: ReadonlyMap<string, readonly OrgTreeNodeDto[]>
  roots: readonly OrgTreeNodeDto[]
  types: readonly OrgTypeDto[]
  rules: readonly OrgRuleDto[]
  nodesOfType: ReadonlyMap<string, number>
}

export const shapeOf = (input: {
  nodes: readonly OrgTreeNodeDto[]
  rootIds: readonly string[]
  types: readonly OrgTypeDto[]
  rules: readonly OrgRuleDto[]
}): OrgShape => {
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  const rootSet = new Set(input.rootIds)
  const childrenOf = new Map<string, OrgTreeNodeDto[]>()
  for (const node of input.nodes) {
    // forest roots always render top-level, never nested under another
    // visible node (a bare self anchor can be the ancestor of a granted
    // subtree; both are roots of the forest)
    if (!node.parentId || rootSet.has(node.id) || !byId.has(node.parentId)) continue
    const siblings = childrenOf.get(node.parentId) ?? []
    siblings.push(node)
    childrenOf.set(node.parentId, siblings)
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }
  const roots = input.rootIds
    .map((id) => byId.get(id))
    .filter((node): node is OrgTreeNodeDto => node !== undefined)
  const nodesOfType = new Map<string, number>()
  for (const node of input.nodes) {
    nodesOfType.set(node.orgTypeId, (nodesOfType.get(node.orgTypeId) ?? 0) + 1)
  }
  return {
    nodes: input.nodes,
    byId,
    childrenOf,
    roots,
    types: input.types,
    rules: input.rules,
    nodesOfType,
  }
}

// ---- the rules as a picture ------------------------------------------------
//
// A kind may stand under several others, so the rules are a graph and not a
// tree, and drawing them as an indented list repeated a kind under every
// parent it has. Each kind is drawn once, in the column its longest way down
// from a top kind puts it in. A rule between neighbouring columns is a solid
// line; one that skips a column would run through whatever stands between,
// so it is dashed and taken over the top of the picture instead.

export const NODE_WIDTH = 176
export const NODE_HEIGHT = 46
const COLUMN_PITCH = 280
const ROW_PITCH = 104
const MARGIN_X = 20
const LANE_PITCH = 10

export interface GraphNode {
  readonly id: string
  readonly name: string
  readonly count: number
  readonly x: number
  readonly y: number
}

export interface GraphEdge {
  readonly key: string
  readonly parentId: string
  readonly childId: string
  /** skips at least one column */
  readonly cross: boolean
  readonly path: string
}

export interface RulesGraph {
  readonly width: number
  readonly height: number
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

export const rulesGraphOf = (shape: OrgShape): RulesGraph => {
  const known = new Set(shape.types.map((type) => type.id))
  const rules = shape.rules.filter(
    (rule) =>
      known.has(rule.parentTypeId) &&
      known.has(rule.childTypeId) &&
      rule.parentTypeId !== rule.childTypeId,
  )
  const parentsOf = new Map<string, string[]>()
  for (const rule of rules) {
    const held = parentsOf.get(rule.childTypeId) ?? []
    held.push(rule.parentTypeId)
    parentsOf.set(rule.childTypeId, held)
  }
  // the longest way down from a kind nothing stands over; the server keeps
  // the rules free of rings, and the guard is for a ring it let through
  const layerOf = new Map<string, number>()
  const depth = (id: string, walking: ReadonlySet<string>): number => {
    const known = layerOf.get(id)
    if (known !== undefined) return known
    if (walking.has(id)) return 0
    const next = new Set(walking).add(id)
    const layer =
      Math.max(-1, ...(parentsOf.get(id) ?? []).map((parent) => depth(parent, next))) + 1
    layerOf.set(id, layer)
    return layer
  }
  for (const type of shape.types) depth(type.id, new Set())

  const layers: OrgTypeDto[][] = []
  for (const type of shape.types) {
    const layer = layerOf.get(type.id) ?? 0
    ;(layers[layer] ??= []).push(type)
  }
  const tallest = Math.max(1, ...layers.map((layer) => layer?.length ?? 0))
  const cross = rules.filter(
    (rule) => (layerOf.get(rule.childTypeId) ?? 0) - (layerOf.get(rule.parentTypeId) ?? 0) > 1,
  )
  // a lane over the picture for each rule that has to go round
  const top = cross.length === 0 ? 16 : 14 + cross.length * LANE_PITCH + 10
  const band = (tallest - 1) * ROW_PITCH + NODE_HEIGHT
  const middle = top + band / 2

  const nodes: GraphNode[] = []
  const at = new Map<string, GraphNode>()
  layers.forEach((layer, column) => {
    const own = layer ?? []
    const height = (own.length - 1) * ROW_PITCH + NODE_HEIGHT
    own.forEach((type, row) => {
      const node: GraphNode = {
        id: type.id,
        name: type.name,
        count: shape.nodesOfType.get(type.id) ?? 0,
        x: MARGIN_X + column * COLUMN_PITCH,
        y: middle - height / 2 + row * ROW_PITCH,
      }
      nodes.push(node)
      at.set(type.id, node)
    })
  })

  // where each line leaves and arrives: spread along the edge of the box so
  // that two lines never share a point, going-round lines above the rest
  const isCross = (rule: OrgRuleDto) => cross.includes(rule)
  const port = (lines: readonly OrgRuleDto[], rule: OrgRuleDto, node: GraphNode, gap: number) => {
    const index = lines.indexOf(rule)
    return node.y + NODE_HEIGHT / 2 + (index - (lines.length - 1) / 2) * gap
  }
  const leaving = (id: string) =>
    rules
      .filter((rule) => rule.parentTypeId === id)
      .sort(
        (a, b) =>
          Number(isCross(b)) - Number(isCross(a)) ||
          (at.get(a.childTypeId)?.y ?? 0) - (at.get(b.childTypeId)?.y ?? 0),
      )
  const arriving = (id: string) =>
    rules
      .filter((rule) => rule.childTypeId === id)
      .sort(
        (a, b) =>
          Number(isCross(a)) - Number(isCross(b)) ||
          (at.get(a.parentTypeId)?.y ?? 0) - (at.get(b.parentTypeId)?.y ?? 0),
      )

  const edges: GraphEdge[] = []
  for (const rule of rules) {
    const from = at.get(rule.parentTypeId)
    const to = at.get(rule.childTypeId)
    if (from === undefined || to === undefined) continue
    const startX = from.x + NODE_WIDTH
    const startY = port(leaving(rule.parentTypeId), rule, from, 8)
    const endX = to.x - 6
    const endY = port(arriving(rule.childTypeId), rule, to, 14)
    if (!isCross(rule)) {
      const turn = startX + 52
      edges.push({
        key: `${rule.parentTypeId}:${rule.childTypeId}`,
        parentId: rule.parentTypeId,
        childId: rule.childTypeId,
        cross: false,
        path: `M ${startX} ${startY} H ${turn} V ${endY} H ${endX}`,
      })
      continue
    }
    const lane = 14 + cross.indexOf(rule) * LANE_PITCH
    const out = startX + 62 + cross.indexOf(rule) * 8
    const back = to.x - 42 + cross.indexOf(rule) * 8
    edges.push({
      key: `${rule.parentTypeId}:${rule.childTypeId}`,
      parentId: rule.parentTypeId,
      childId: rule.childTypeId,
      cross: true,
      path: `M ${startX} ${startY} H ${out} V ${lane} H ${back} V ${endY} H ${endX}`,
    })
  }

  return {
    width: Math.max(
      1056,
      MARGIN_X * 2 + NODE_WIDTH + (Math.max(1, layers.length) - 1) * COLUMN_PITCH,
    ),
    height: top + band + 16,
    nodes,
    edges,
  }
}
