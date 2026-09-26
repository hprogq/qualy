// Where somebody on a round stands, as one line of unit names.
//
// The round freezes each participant's lineage from their own unit up to the
// root, so it is read backwards to say it from the top down. The root is
// the same for everybody on the round and says nothing about this one
// person, so it is left off. Every screen that names somebody's unit - a
// roster row, the heading over their account - says it this way, so one
// person never reads as standing in two different places.

/** where a unit on the path stands whose name is not to hand */
export const UNNAMED = '…'

export interface UnitPath {
  /** the names from the top down, less the root; a nameless step keeps its place */
  readonly steps: readonly string[]
  /** the same names joined; '' where there is nothing to say */
  readonly path: string
  /** how many steps on it could not be named */
  readonly unknown: number
}

/**
 * A lineage as stored (the unit first, the root last) as a path read from
 * the top down, less the root. A unit that cannot be named keeps its place
 * rather than dropping out, so the path never reads as a shorter one.
 */
export const unitPathOf = (
  lineage: readonly { readonly nodeId: string }[],
  nameOf: (nodeId: string) => string | undefined,
): UnitPath => {
  const steps = [...lineage].reverse()
  const names = (steps.length > 1 ? steps.slice(1) : steps).map((step) => nameOf(step.nodeId))
  const said = names.map((name) => name ?? UNNAMED)
  return {
    steps: said,
    path: said.join(' / '),
    unknown: names.filter((name) => name === undefined).length,
  }
}

/**
 * The whole chain, root included, for the panel that shows every level: the
 * root is left off a line because everybody shares it, not because it is not
 * where they stand.
 */
export const unitChainOf = (
  lineage: readonly { readonly nodeId: string }[],
  nameOf: (nodeId: string) => string | undefined,
): readonly string[] => [...lineage].reverse().map((step) => nameOf(step.nodeId) ?? UNNAMED)

/**
 * A chain the server has already named from the root down, where a unit
 * that has since left the organization comes back as null.
 *
 * A level that is gone is said as gone, by the word the caller hands in,
 * and a run of them once: the mark a line puts in front of the levels it
 * left off must never also stand for a unit that no longer exists. `gone`
 * counts the levels the chain could not name.
 */
export const namedChainOf = (
  path: readonly (string | null)[],
  goneWord: string,
): { readonly levels: readonly string[]; readonly gone: number } => {
  const levels: string[] = []
  path.forEach((name, index) => {
    if (name !== null) levels.push(name)
    else if (index === 0 || path[index - 1] !== null) levels.push(goneWord)
  })
  return { levels, gone: path.filter((name) => name === null).length }
}
