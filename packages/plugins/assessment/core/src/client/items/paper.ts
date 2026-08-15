/** a score group as the paper's own screens read it */
export interface TreeGroup {
  id: string
  parentGroupId: string | null
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}

/**
 * A question composed and not yet saved.
 *
 * It stands in the structure before it stands in the round, so pressing add
 * twice reads as two waiting rather than as a button that did nothing the
 * second time. The title follows what is being typed. Groups have no
 * equivalent: theirs is a panel that is either open or closed.
 */
export interface TreeDraft {
  localId: string
  /** the group this question will file under once saved */
  groupId: string
  title: string
}

/**
 * Where one question's score ends up.
 *
 * A value on a question is never the whole story: the group it sits in has an
 * upper limit, so does the group above that, and the paper itself. This is
 * that run of limits, innermost first, so a screen can say what the question
 * can actually contribute rather than only what it is worth on paper.
 */
export interface Placement {
  /** the question's own group, then each group above it, short of the paper */
  sections: readonly { id: string; name: string; cap: string | null }[]
  /** what the questions in the innermost group add up to, null when unbounded */
  subtotal: string | null
  /** what the whole round is worth, null when the paper has no upper limit */
  total: string | null
}

/** which question is open: a saved one, or one still being composed */
export type TreeSelection = { kind: 'item'; id: string } | { kind: 'draft'; localId: string }

/** the group whose panel is open, and whether it exists yet */
export type GroupTarget =
  { kind: 'edit'; group: TreeGroup } | { kind: 'new'; parentId: string | null }
