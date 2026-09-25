import { DRAFTS, DRAFTS_BY_FUNCTION, EARLIER_KEEPER, inStores } from './local-store.ts'

// Unsaved edits to a formula, kept in this browser.
//
// Not a save: nothing here reaches the server, and the server's draft stays
// the only one anyone else sees. It is what stands between a person and the
// half hour of edits a closed tab, a crashed browser or an in-app link would
// otherwise take with it. One row per formula and page, replaced whole - a
// draft has no history worth keeping locally, only its latest state. Two
// tabs on one formula each keep their own row, and a page lets go only of
// the row it kept itself.

export interface LocalDraftTest {
  readonly name: string
  readonly inputText: string
  readonly expected: string
}

export interface LocalDraft {
  readonly functionId: string
  readonly name: string
  readonly source: string
  readonly tests: readonly LocalDraftTest[]
  /** the server draft revision the edits were made on */
  readonly baseRevision: number
  /**
   * What that revision held (draftFingerprint). A revision number repeats
   * once a database is put back from a copy, so the same number can name a
   * draft somebody else saved since; absent on rows kept before it was.
   */
  readonly baseFingerprint?: string
  /** the page that kept it; a row kept before pages were told apart has none */
  readonly keptBy?: string
  /** when the edits were last kept, epoch milliseconds */
  readonly keptAt: number
}

/**
 * A short fingerprint of a draft's text, to tell two drafts apart that carry
 * the same revision number. Not a security boundary: a collision only costs
 * the warning that the draft moved.
 */
export const draftFingerprint = (text: string): string => {
  // two 32-bit multiplicative hashes over the UTF-16 units, 53 bits together
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ unit, 2654435761)
    h2 = Math.imul(h2 ^ unit, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const isLocalDraft = (value: unknown): value is LocalDraft => {
  const draft = value as Partial<LocalDraft> | null
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.functionId === 'string' &&
    typeof draft.name === 'string' &&
    typeof draft.source === 'string' &&
    Array.isArray(draft.tests) &&
    typeof draft.baseRevision === 'number' &&
    (draft.baseFingerprint === undefined || typeof draft.baseFingerprint === 'string') &&
    (draft.keptBy === undefined || typeof draft.keptBy === 'string') &&
    typeof draft.keptAt === 'number'
  )
}

/** every page's kept edits to one formula, the newest first */
export const readLocalDrafts = (functionId: string): Promise<readonly LocalDraft[]> =>
  inStores(
    [DRAFTS],
    'readonly',
    (open) => {
      const request = open(DRAFTS).index(DRAFTS_BY_FUNCTION).getAll(IDBKeyRange.only(functionId))
      return () =>
        ((request.result ?? []) as unknown[])
          .filter(isLocalDraft)
          .sort((one, other) => other.keptAt - one.keptAt)
    },
    [] as readonly LocalDraft[],
  )

/** the newest edits any page kept of one formula */
export const readLocalDraft = (functionId: string): Promise<LocalDraft | null> =>
  readLocalDrafts(functionId).then((kept) => kept[0] ?? null)

export const keepLocalDraft = (draft: LocalDraft): Promise<void> =>
  inStores(
    [DRAFTS],
    'readwrite',
    (open) => {
      open(DRAFTS).put({ ...draft, keptBy: draft.keptBy ?? EARLIER_KEEPER })
    },
    undefined,
  )

/**
 * Lets go of a formula's kept edits: every page's, or - given the page that
 * asks - only the row that page kept, so a tab whose work is saved does not
 * take away another tab's unsaved work.
 */
export const forgetLocalDraft = (functionId: string, keptBy?: string): Promise<void> =>
  inStores(
    [DRAFTS],
    'readwrite',
    (open) => {
      const drafts = open(DRAFTS)
      if (keptBy !== undefined) {
        drafts.delete([functionId, keptBy])
        return
      }
      const cursor = drafts.index(DRAFTS_BY_FUNCTION).openCursor(IDBKeyRange.only(functionId))
      cursor.onsuccess = () => {
        const at = cursor.result
        if (at === null) return
        at.delete()
        at.continue()
      }
    },
    undefined,
  )
