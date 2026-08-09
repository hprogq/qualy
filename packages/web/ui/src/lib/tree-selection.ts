// Selection over a node hierarchy, kept as a minimal non-nested id set: no
// selected node is an ancestor of another. Ticking covers a subtree;
// unticking inside a covered subtree splits the cover into the siblings
// along the way down, so "the college minus two classes" is exactly the
// remaining classes - never a wholesale collapse.

export interface TreeSelectionNode {
  readonly id: string
  readonly name: string
  /** a dot-separated materialized path, e.g. r.college.class1 */
  readonly path: string
  readonly depth: number
}

export const parentPathOf = (path: string): string | null => {
  const at = path.lastIndexOf('.')
  return at === -1 ? null : path.slice(0, at)
}

export const isAncestorPath = (ancestor: string, descendant: string): boolean =>
  descendant.startsWith(`${ancestor}.`)

export interface TreeShape {
  readonly byId: ReadonlyMap<string, TreeSelectionNode>
  readonly byPath: ReadonlyMap<string, TreeSelectionNode>
  readonly childrenOf: ReadonlyMap<string, readonly TreeSelectionNode[]>
  readonly roots: readonly TreeSelectionNode[]
}

export const shapeOf = (nodes: readonly TreeSelectionNode[]): TreeShape => {
  const byPath = new Map(nodes.map((node) => [node.path, node]))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenOf = new Map<string, TreeSelectionNode[]>()
  const roots: TreeSelectionNode[] = []
  const sorted = [...nodes].sort((a, b) => a.path.localeCompare(b.path))
  for (const node of sorted) {
    const parentPath = parentPathOf(node.path)
    const parent = parentPath !== null ? byPath.get(parentPath) : undefined
    if (parent) {
      const siblings = childrenOf.get(parent.id) ?? []
      siblings.push(node)
      childrenOf.set(parent.id, siblings)
    } else {
      roots.push(node)
    }
  }
  return { byId, byPath, childrenOf, roots }
}

/** the selected node covering this one - itself or its nearest ticked ancestor */
export const coverOf = (
  shape: TreeShape,
  selection: ReadonlySet<string>,
  node: TreeSelectionNode,
): TreeSelectionNode | undefined => {
  if (selection.has(node.id)) return node
  let best: TreeSelectionNode | undefined
  for (const id of selection) {
    const candidate = shape.byId.get(id)
    if (
      candidate &&
      isAncestorPath(candidate.path, node.path) &&
      (best === undefined || candidate.depth > best.depth)
    ) {
      best = candidate
    }
  }
  return best
}

export const hasSelectedDescendant = (
  shape: TreeShape,
  selection: ReadonlySet<string>,
  node: TreeSelectionNode,
): boolean => {
  for (const id of selection) {
    const candidate = shape.byId.get(id)
    if (candidate && isAncestorPath(node.path, candidate.path)) return true
  }
  return false
}

export const toggleNode = (
  shape: TreeShape,
  selection: ReadonlySet<string>,
  node: TreeSelectionNode,
): Set<string> => {
  const next = new Set(selection)
  const cover = coverOf(shape, selection, node)
  if (cover === undefined) {
    // covering a node subsumes any explicitly selected descendants
    for (const id of [...next]) {
      const candidate = shape.byId.get(id)
      if (candidate && isAncestorPath(node.path, candidate.path)) next.delete(id)
    }
    next.add(node.id)
    return next
  }
  if (cover.id === node.id) {
    next.delete(node.id)
    return next
  }
  // unticking inside a covered subtree: walk from the node up to the cover,
  // keeping the siblings passed on the way; the unticked branch drops out
  next.delete(cover.id)
  let step = node
  while (step.id !== cover.id) {
    const parentPath = parentPathOf(step.path)
    const parent = parentPath !== null ? shape.byPath.get(parentPath) : undefined
    if (!parent) break
    for (const sibling of shape.childrenOf.get(parent.id) ?? []) {
      if (sibling.id !== step.id) next.add(sibling.id)
    }
    step = parent
  }
  return next
}
