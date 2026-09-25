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
  /** the names from the top down, joined; '' where there is nothing to say */
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
  return {
    path: names.map((name) => name ?? UNNAMED).join(' / '),
    unknown: names.filter((name) => name === undefined).length,
  }
}
