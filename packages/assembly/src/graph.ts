// A generic topological sort, with no idea what the edges mean.
//
// Two capabilities need one: the database provider orders schema by declared
// dependencies, and the runtime module orders layers by declared runtime
// dependencies. Neither meaning lives here, only the ordering.
//
// Ordering has to be a property of the declared dependencies, never of the
// order somebody happened to type entries in. Two people whose manifests say
// the same thing must get the same lock, byte for byte.

export interface TopoResult {
  order: string[]
}

/**
 * Dependencies first, ties broken by name.
 *
 * `edges` maps a node to what it depends on. Nodes not in `nodes` are
 * ignored, so a graph can be built once and ordered over any subset.
 */
export function topoSort(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): TopoResult {
  const present = new Set(nodes)
  const sorted = [...present].sort()
  const order: string[] = []
  const done = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()

  const visit = (node: string) => {
    if (done.has(node)) return
    if (onStack.has(node)) {
      const from = stack.indexOf(node)
      throw new CycleError([...stack.slice(from), node])
    }
    onStack.add(node)
    stack.push(node)
    for (const next of [...(edges.get(node) ?? [])].filter((id) => present.has(id)).sort()) {
      visit(next)
    }
    stack.pop()
    onStack.delete(node)
    done.add(node)
    order.push(node)
  }

  for (const node of sorted) visit(node)
  return { order }
}

export class CycleError extends Error {
  // a plain field, not a parameter property: this package is loaded as
  // TypeScript source by plain node when the Vite config imports it, and
  // strip-only mode refuses syntax with runtime semantics
  readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(`dependency cycle: ${cycle.join(' -> ')}`)
    this.name = 'CycleError'
    this.cycle = cycle
  }
}
