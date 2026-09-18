import { DRAFTS, inStores } from './local-store.ts'

// Unsaved edits to a formula, kept in this browser.
//
// Not a save: nothing here reaches the server, and the server's draft stays
// the only one anyone else sees. It is what stands between a person and the
// half hour of edits a closed tab, a crashed browser or an in-app link would
// otherwise take with it. One row per formula, replaced whole - a draft has
// no history worth keeping locally, only its latest state.

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
  /** when the edits were last kept, epoch milliseconds */
  readonly keptAt: number
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
    typeof draft.keptAt === 'number'
  )
}

export const readLocalDraft = (functionId: string): Promise<LocalDraft | null> =>
  inStores(
    [DRAFTS],
    'readonly',
    (open) => {
      const request = open(DRAFTS).get(functionId)
      return () => {
        const value: unknown = request.result
        return isLocalDraft(value) ? value : null
      }
    },
    null,
  )

export const keepLocalDraft = (draft: LocalDraft): Promise<void> =>
  inStores(
    [DRAFTS],
    'readwrite',
    (open) => {
      open(DRAFTS).put(draft)
    },
    undefined,
  )

export const forgetLocalDraft = (functionId: string): Promise<void> =>
  inStores(
    [DRAFTS],
    'readwrite',
    (open) => {
      open(DRAFTS).delete(functionId)
    },
    undefined,
  )
