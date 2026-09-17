// Unsaved edits to a formula, kept in this browser.
//
// Not a save: nothing here reaches the server, and the server's draft stays
// the only one anyone else sees. It is what stands between a person and the
// half hour of edits a closed tab, a crashed browser or an in-app link would
// otherwise take with it. IndexedDB rather than localStorage because a
// formula's source is allowed to be larger than localStorage comfortably
// holds, and because writing it does not block the page.
//
// Every operation is best effort: private windows, blocked site data and
// quota refusals all read as "nothing kept", never as an error on screen.

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

const DATABASE = 'qualy-formula-drafts'
const STORE = 'drafts'

let opening: Promise<IDBDatabase | null> | null = null

const database = (): Promise<IDBDatabase | null> => {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: 'functionId' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

const inStore = <T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest | null,
  read: (request: IDBRequest | null) => T,
  fallback: T,
): Promise<T> =>
  database().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (db === null) {
          resolve(fallback)
          return
        }
        try {
          const transaction = db.transaction(STORE, mode)
          const request = act(transaction.objectStore(STORE))
          transaction.oncomplete = () => resolve(read(request))
          transaction.onerror = () => resolve(fallback)
          transaction.onabort = () => resolve(fallback)
        } catch {
          resolve(fallback)
        }
      }),
  )

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
  inStore(
    'readonly',
    (store) => store.get(functionId),
    (request) => {
      const value: unknown = request?.result
      return isLocalDraft(value) ? value : null
    },
    null,
  )

export const keepLocalDraft = (draft: LocalDraft): Promise<void> =>
  inStore(
    'readwrite',
    (store) => store.put(draft),
    () => undefined,
    undefined,
  )

export const forgetLocalDraft = (functionId: string): Promise<void> =>
  inStore(
    'readwrite',
    (store) => store.delete(functionId),
    () => undefined,
    undefined,
  )
