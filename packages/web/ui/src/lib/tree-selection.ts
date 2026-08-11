// Selection over a node hierarchy, kept as a minimal non-nested id set: no
// selected node is an ancestor of another. Ticking covers a subtree;
// unticking inside a covered subtree splits the cover into the siblings
// along the way down, so "the college minus two classes" is exactly the
// remaining classes - never a wholesale collapse.
//
// The shape arrives as parent references. A materialized path would say the
// same thing in fewer bytes, but it is the database's own addressing scheme
// for making subtree queries fast, and handing it to a browser publishes the
// shape of an organization to anyone holding a leaf of it.

export interface TreeSelectionNode {
  readonly id: string
  readonly name: string
  /** null for a root, and treated as one when the parent is not in the set */
  readonly parentId: string | null
}

export interface TreeShape {
  readonly byId: ReadonlyMap<string, TreeSelectionNode>
  readonly childrenOf: ReadonlyMap<string, readonly TreeSelectionNode[]>
  readonly roots: readonly TreeSelectionNode[]
  /** how deep a node sits inside this set, which is what indentation draws */
  readonly depthOf: ReadonlyMap<string, number>
}

export const shapeOf = (nodes: readonly TreeSelectionNode[]): TreeShape => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenOf = new Map<string, TreeSelectionNode[]>()
  const roots: TreeSelectionNode[] = []
  for (const node of nodes) {
    // a node whose parent is not in this set is a root here: the set a reader
    // may see often starts below the real top of the tree
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined
    if (parent) {
      childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), node])
    } else {
      roots.push(node)
    }
  }
  const depthOf = new Map<string, number>()
  const walk = (node: TreeSelectionNode, depth: number) => {
    depthOf.set(node.id, depth)
    for (const child of childrenOf.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return { byId, childrenOf, roots, depthOf }
}

/** every node from this one up to its root, nearest first */
const ancestorsOf = (shape: TreeShape, node: TreeSelectionNode): TreeSelectionNode[] => {
  const chain: TreeSelectionNode[] = []
  const seen = new Set<string>([node.id])
  let step = node.parentId !== null ? shape.byId.get(node.parentId) : undefined
  while (step !== undefined && !seen.has(step.id)) {
    chain.push(step)
    seen.add(step.id)
    step = step.parentId !== null ? shape.byId.get(step.parentId) : undefined
  }
  return chain
}

export const isAncestor = (
  shape: TreeShape,
  ancestor: TreeSelectionNode,
  descendant: TreeSelectionNode,
): boolean => ancestorsOf(shape, descendant).some((step) => step.id === ancestor.id)

/** the selected node covering this one - itself or its nearest ticked ancestor */
export const coverOf = (
  shape: TreeShape,
  selection: ReadonlySet<string>,
  node: TreeSelectionNode,
): TreeSelectionNode | undefined => {
  if (selection.has(node.id)) return node
  return ancestorsOf(shape, node).find((step) => selection.has(step.id))
}

export const hasSelectedDescendant = (
  shape: TreeShape,
  selection: ReadonlySet<string>,
  node: TreeSelectionNode,
): boolean => {
  for (const id of selection) {
    const candidate = shape.byId.get(id)
    if (candidate && candidate.id !== node.id && isAncestor(shape, node, candidate)) return true
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
      if (candidate && isAncestor(shape, node, candidate)) next.delete(id)
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
    const parent = step.parentId !== null ? shape.byId.get(step.parentId) : undefined
    if (!parent) break
    for (const sibling of shape.childrenOf.get(parent.id) ?? []) {
      if (sibling.id !== step.id) next.add(sibling.id)
    }
    step = parent
  }
  return next
}
