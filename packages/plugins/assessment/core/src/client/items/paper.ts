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
 * Something composed and not yet saved.
 *
 * It stands in the structure before it stands in the round, so pressing add
 * twice reads as two waiting rather than as a button that did nothing the
 * second time. The title follows what is being typed.
 */
export interface TreeDraft {
  localId: string
  kind: 'item' | 'group'
  /** the group an unsaved question will file under */
  groupId?: string
  /** the parent an unsaved group will sit inside */
  parentId?: string | null
  title: string
}

export type TreeSelection =
  { kind: 'group'; id: string } | { kind: 'item'; id: string } | { kind: 'draft'; localId: string }
