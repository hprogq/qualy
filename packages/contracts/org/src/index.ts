// The organization domain's contract: the shapes a neighbour may read about
// a unit without reaching into org's own modules. The Effect side sits
// behind ./effect, like every other contract's.

/** one unit, as a neighbour is told about it */
export interface OrgNodeRef {
  readonly id: string
  readonly parentId: string | null
  readonly orgTypeId: string
  readonly name: string
  /** the ltree path, as text */
  readonly path: string
  readonly depth: number
}

export interface OrgTypeRef {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
}

/** one allowed parent-to-child edge of the type grammar */
export interface OrgTypeRuleRef {
  readonly parentTypeId: string
  readonly childTypeId: string
}
