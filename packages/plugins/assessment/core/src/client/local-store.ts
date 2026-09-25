// What a reviewer's own browser keeps of work they have not sent yet.
//
// One database, one store. Nothing here is authoritative - the server holds
// every decision anybody else can see - so every operation is best effort:
// private windows, blocked site data and quota refusals all read as "nothing
// kept", never as an error on screen. A preference the first paint needs (the
// workbench's column widths) stays in localStorage, which answers
// synchronously; this is for what somebody typed.

const DATABASE = 'qualy-assessment-local'
const VERSION = 1

/** unsent words, one row per (person, round, act) */
export const DRAFTS = 'drafts'

export interface DraftRow {
  /**
   * `<userId>:<instanceId>:<act>`: whose words, then where. The act names the
   * dialog, never the screen.
   */
  readonly id: string
  readonly at: number
  readonly value: unknown
}

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
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' })
      }
      // Blocked means another tab still holds an older version open. That
      // request is not over - it succeeds once the other tab lets go - so
      // answering the caller now is right, but the connection arriving later
      // has to be closed rather than left open with nobody holding it.
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
        db.onversionchange = () => {
          db.close()
          opening = null
        }
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

const inDrafts = <T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => (() => T) | void,
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
          const transaction = db.transaction([DRAFTS], mode)
          const answer = act(transaction.objectStore(DRAFTS))
          transaction.oncomplete = () => resolve(answer === undefined ? fallback : answer())
          transaction.onerror = () => resolve(fallback)
          transaction.onabort = () => resolve(fallback)
        } catch {
          resolve(fallback)
        }
      }),
  )

export const readDraft = (id: string): Promise<DraftRow | null> =>
  inDrafts(
    'readonly',
    (store) => {
      const request = store.get(id)
      return () => (request.result as DraftRow | undefined) ?? null
    },
    null,
  )

export const writeDraft = (id: string, value: unknown): Promise<void> =>
  inDrafts(
    'readwrite',
    (store) => {
      // structuredClone is what IndexedDB does to the value anyway; doing it
      // here turns a value it could not store into nothing kept rather than
      // an aborted transaction
      try {
        store.put({ id, at: Date.now(), value: structuredClone(value) } satisfies DraftRow)
      } catch {
        // not storable: there is nothing to keep and nothing to say
      }
    },
    undefined,
  )

/**
 * Drops what nobody came back for, and what somebody else left here.
 *
 * A draft is kept until its act is sent, and some acts never are: a colleague
 * takes the round, the filing is withdrawn, the reviewer changes their mind
 * and closes the tab. Nothing else would ever delete those rows, so the store
 * would only grow. And a browser can be shared: whoever signed in before
 * left their unsent words behind, which are not the next person's to read.
 * Swept when the review screens open, best effort like the rest - a sweep that
 * does not happen costs a few kilobytes.
 */
export const forgetStaleDrafts = (olderThanMs: number, owner: string): Promise<void> =>
  inDrafts(
    'readwrite',
    (store) => {
      const before = Date.now() - olderThanMs
      const mine = `${owner}:`
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const at = cursor.result
        if (at === null) return
        const row = at.value as DraftRow
        if ((row.at ?? 0) < before || !String(row.id).startsWith(mine)) at.delete()
        at.continue()
      }
    },
    undefined,
  )

/**
 * Drops every unsent draft this browser holds, whoever wrote it.
 *
 * Signing out is the moment a shared browser passes to the next person, and
 * a draft that waits for the next review screen to sweep it is readable in
 * the browser's own storage until then.
 */
export const forgetEveryDraft = (): Promise<void> =>
  inDrafts(
    'readwrite',
    (store) => {
      store.clear()
    },
    undefined,
  )

export const forgetDraft = (id: string): Promise<void> =>
  inDrafts(
    'readwrite',
    (store) => {
      store.delete(id)
    },
    undefined,
  )
