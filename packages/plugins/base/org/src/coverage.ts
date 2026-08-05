// How far a caller's authority reaches into the tree, decided once.
//
// This is the fifth place the coverage rule could have been written down, and
// CLAUDE.md names it the most likely thing to drift. rbac decides coverage in
// SQL with ltree containment for a single node; this decides it in TypeScript
// for a whole projection, because a forest is assembled from several anchors
// and the overlaps have to be resolved before any rows are read.
//
// It lives here, taking plain data and no database handle, so both runtimes
// project the same tree from the same scope rather than each keeping a copy.
//
// The separator in every path comparison is load-bearing. Without it an anchor
// at `r.a` starts covering a sibling at `r.ab`, which is a silent widening of
// authority rather than a crash.

/** an authorization anchor with its node's path resolved */
export interface AnchorPath {
  id: string
  path: string
  coverage: 'self' | 'subtree'
}

/**
 * How far the caller's grants for one permission reach.
 *
 * A tenant role reaches everything, which no anchor list can express, so it is
 * a separate flag rather than a synthetic anchor at the root.
 */
export interface ResolvedScope {
  tenantWide: boolean
  anchors: AnchorPath[]
}

const inside = (path: string, anchorPath: string) =>
  path === anchorPath || path.startsWith(`${anchorPath}.`)

/** the node itself is within the caller's authority */
export const coveredBy = (scope: ResolvedScope, node: { id: string; path: string }): boolean =>
  scope.tenantWide ||
  scope.anchors.some((anchor) =>
    anchor.coverage === 'self' ? anchor.id === node.id : inside(node.path, anchor.path),
  )

/**
 * The whole subtree below the node is within the caller's authority.
 *
 * Only a subtree anchor at or above it can promise that: a self anchor covers
 * one node and never its descendants. This is what a move needs, since
 * relocating a node relocates everything under it.
 */
export const subtreeCoveredBy = (scope: ResolvedScope, node: { path: string }): boolean =>
  scope.tenantWide ||
  scope.anchors.some((anchor) => anchor.coverage === 'subtree' && inside(node.path, anchor.path))

export interface ForestShape {
  /** subtree anchors to expand, already free of overlaps */
  subtrees: AnchorPath[]
  /** self anchors that no kept subtree already contains */
  selves: AnchorPath[]
}

/**
 * Which anchors actually need reading, with overlaps removed.
 *
 * Shallower subtree anchors swallow deeper ones, and a self anchor inside a
 * kept subtree contributes nothing, so the caller issues one query per
 * surviving anchor instead of one per grant.
 */
export const forestShape = (scope: ResolvedScope): ForestShape => {
  const covered = (path: string, keep: AnchorPath[]) =>
    keep.some((kept) => inside(path, kept.path))

  const subtrees: AnchorPath[] = []
  for (const anchor of [...scope.anchors]
    .filter((anchor) => anchor.coverage === 'subtree')
    .sort((a, b) => a.path.length - b.path.length)) {
    if (!covered(anchor.path, subtrees)) subtrees.push(anchor)
  }

  const selves = scope.anchors.filter(
    (anchor) => anchor.coverage === 'self' && !covered(anchor.path, subtrees),
  )
  return { subtrees, selves }
}

/** the roots of the projection, in the order a caller should render them */
export const forestRoots = (shape: ForestShape, present: (id: string) => boolean): string[] => [
  ...new Set([...shape.subtrees, ...shape.selves].map((anchor) => anchor.id)),
].filter(present)

/** paths sort the tree, so a parent always precedes its children */
export const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : 1)
