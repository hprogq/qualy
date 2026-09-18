// What the formula subsystem keeps in THIS browser, and nothing else.
//
// One database, two stores. They are one bounded context - a person's local
// working data for formulas - and keeping them together buys a single
// connection, a single schema version, and the ability to clear one formula's
// local data in one transaction. Keeping them in separate STORES is what
// keeps their indexes, their shapes and their cleanup apart; a single
// all-purpose store keyed by a `type` field would blur exactly what the
// separation is for.
//
// Nothing here is authoritative: the server holds the draft everyone else
// sees, and a try is a question somebody asked their own browser. So every
// operation is best effort - private windows, blocked site data and quota
// refusals all read as "nothing kept", never as an error on screen. What does
// NOT belong here is a preference the first paint needs (the theme, the
// locale, the workbench's column widths): those stay in localStorage, which
// answers synchronously.

const DATABASE = 'qualy-formula-local'
const VERSION = 1

/** unsaved edits to a formula's draft, one row per formula */
export const DRAFTS = 'drafts'
/** one row per try somebody ran, against the draft or a frozen source */
export const TRY_RECORDS = 'tryRecords'
/** the tries of one source in the order they were run */
export const BY_SCOPE_AND_TIME = 'byScopeAndTime'

let opening: Promise<IDBDatabase | null> | null = null

const database = (): Promise<IDBDatabase | null> => {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const request = indexedDB.open(DATABASE, VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DRAFTS))
          db.createObjectStore(DRAFTS, { keyPath: 'functionId' })
        if (!db.objectStoreNames.contains(TRY_RECORDS)) {
          const store = db.createObjectStore(TRY_RECORDS, { keyPath: 'id' })
          store.createIndex(BY_SCOPE_AND_TIME, ['scopeKey', 'at'])
        }
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

/**
 * One transaction over the named stores, with an answer built as it runs.
 *
 * `act` fires the requests and returns a thunk read once the transaction has
 * committed - so a caller never reads a value the transaction went on to roll
 * back. A store that cannot be reached, or a transaction that aborts, answers
 * with `fallback`.
 */
export const inStores = <T>(
  stores: readonly string[],
  mode: IDBTransactionMode,
  act: (open: (name: string) => IDBObjectStore) => (() => T) | void,
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
          const transaction = db.transaction(stores as string[], mode)
          const answer = act((name) => transaction.objectStore(name))
          transaction.oncomplete = () => resolve(answer === undefined ? fallback : answer())
          transaction.onerror = () => resolve(fallback)
          transaction.onabort = () => resolve(fallback)
        } catch {
          resolve(fallback)
        }
      }),
  )
