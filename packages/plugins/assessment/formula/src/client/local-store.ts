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
const VERSION = 2

/**
 * Unsaved edits to a formula's draft, one row per formula and page.
 *
 * Keyed by the formula and the page that kept them: two tabs on one formula
 * each keep their own, where one row per formula went to whichever wrote
 * last and a tab that saved took the other's edits with it.
 */
export const DRAFTS = 'pageDrafts'
/** a formula's kept edits, whichever pages kept them */
export const DRAFTS_BY_FUNCTION = 'draftsByFunctionId'
/** the store the first version kept one row per formula in, carried over and dropped */
const FORMULA_DRAFTS = 'drafts'
/** who kept a row the first version wrote without saying */
export const EARLIER_KEEPER = 'an-earlier-visit'
/** one row per try somebody ran, against the draft or a frozen source */
export const TRY_RECORDS = 'tryRecords'
/** the tries of one source in the order they were run */
export const BY_SCOPE_AND_TIME = 'byScopeAndTime'
/** every try of one formula, whichever source it was run against */
export const BY_FUNCTION = 'byFunctionId'

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
        if (!db.objectStoreNames.contains(DRAFTS)) {
          const drafts = db.createObjectStore(DRAFTS, { keyPath: ['functionId', 'keptBy'] })
          drafts.createIndex(DRAFTS_BY_FUNCTION, 'functionId')
          // what the first version kept, one row per formula, is carried
          // into the page-keyed store before its own store goes
          const upgrade = request.transaction
          if (db.objectStoreNames.contains(FORMULA_DRAFTS) && upgrade !== null) {
            const earlier = upgrade.objectStore(FORMULA_DRAFTS).getAll()
            earlier.onsuccess = () => {
              for (const row of earlier.result as { keptBy?: unknown }[]) {
                drafts.put({
                  ...row,
                  keptBy: typeof row.keptBy === 'string' ? row.keptBy : EARLIER_KEEPER,
                })
              }
              db.deleteObjectStore(FORMULA_DRAFTS)
            }
          }
        }
        if (!db.objectStoreNames.contains(TRY_RECORDS)) {
          const store = db.createObjectStore(TRY_RECORDS, { keyPath: 'id' })
          store.createIndex(BY_SCOPE_AND_TIME, ['scopeKey', 'at'])
          // and by formula, so deleting one can take everything this browser
          // holds for it without knowing which sources were ever opened
          store.createIndex(BY_FUNCTION, 'functionId')
        }
      }
      // Blocked means another tab still holds an older version open. This
      // request is NOT over - it stays pending and succeeds once that tab
      // lets go - so answering the caller now is right, but the connection
      // that arrives later has to be closed rather than left open with
      // nobody holding it: an unclosed one goes on blocking the next upgrade
      // forever, which is the same deadlock from the other side.
      let abandoned = false
      request.onblocked = () => {
        abandoned = true
        opening = null
        resolve(null)
      }
      request.onsuccess = () => {
        const db = request.result
        if (abandoned) {
          db.close()
          return
        }
        // Another tab wants to upgrade: let go rather than block it. Holding
        // on is what makes one stale tab enough to stop every other tab's
        // upgrade, and there is nothing here worth that - the next call
        // reopens.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        // a connection closed under us (storage cleared, the tab evicted) is
        // not one to keep handing out
        db.onclose = () => {
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => {
        opening = null
        resolve(null)
      }
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

/**
 * Everything this browser holds for one formula, in one transaction.
 *
 * Called when the formula itself is deleted on the server, which is
 * permanent: leaving the kept source, the examples and the inputs somebody
 * tried behind would leave work on the device that nothing can reach any
 * more and that the person believes they deleted. Both stores go together -
 * the reason they share a database - so there is no state where the draft is
 * gone and its try records are not.
 *
 * Best effort, like everything else here, and deliberately AFTER the server
 * has agreed: clearing first would take a person's crash recovery away on a
 * deletion that then failed.
 */
export const forgetFormulaLocally = (functionId: string): Promise<void> =>
  inStores(
    [DRAFTS, TRY_RECORDS],
    'readwrite',
    (open) => {
      for (const [store, index] of [
        [DRAFTS, DRAFTS_BY_FUNCTION],
        [TRY_RECORDS, BY_FUNCTION],
      ] as const) {
        const cursor = open(store).index(index).openCursor(IDBKeyRange.only(functionId))
        cursor.onsuccess = () => {
          const at = cursor.result
          if (at === null) return
          at.delete()
          at.continue()
        }
      }
    },
    undefined,
  )
