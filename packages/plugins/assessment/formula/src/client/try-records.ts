import { useCallback, useEffect, useState } from 'react'
import { BY_SCOPE_AND_TIME, TRY_RECORDS, inStores } from './local-store.ts'
import type { TryOutcome } from './TryRunPanel.tsx'

// The tries a person ran, kept in this browser.
//
// A try is a question asked of the formula; the list lets its author look
// back over what came of which inputs and ask one again without typing it
// out. It belongs to one viewer on one device, so it never leaves this
// browser, and every read and write may fail into "no records" without a word
// on screen.
//
// One row per try, and a compound index over (scope, time) - so running one
// more is a single put rather than reading a list back, prepending to it and
// writing the whole of it out again. The draft, each publication and each
// saved revision are their own scope, and the scope is what the index reads
// the newest tries of.

export interface TryRecord {
  readonly id: string
  /** epoch milliseconds */
  readonly at: number
  /** the input as it was run, already materialized against the contract */
  readonly input: unknown
  readonly outcome: TryOutcome
  /** the source it ran against, as a short mark; absent for frozen sources, which do not move */
  readonly mark?: string
}

/** a try as it is stored: the record, and which source of which formula it ran against */
interface StoredTryRecord extends TryRecord {
  readonly functionId: string
  readonly scopeKey: string
}

/** how many tries one scope keeps; older ones go as newer ones arrive */
const LIMIT = 20

const isRecord = (value: unknown): value is StoredTryRecord => {
  const one = value as Partial<StoredTryRecord> | null
  return (
    typeof one === 'object' &&
    one !== null &&
    typeof one.id === 'string' &&
    typeof one.at === 'number' &&
    typeof one.scopeKey === 'string' &&
    typeof one.outcome === 'object'
  )
}

const scopeRange = (scopeKey: string): IDBKeyRange =>
  IDBKeyRange.bound([scopeKey, -Infinity], [scopeKey, Infinity])

/** the newest tries of one scope, newest first */
const read = (scopeKey: string): Promise<readonly TryRecord[]> =>
  inStores<readonly TryRecord[]>(
    [TRY_RECORDS],
    'readonly',
    (open) => {
      const found: TryRecord[] = []
      const cursor = open(TRY_RECORDS)
        .index(BY_SCOPE_AND_TIME)
        .openCursor(scopeRange(scopeKey), 'prev')
      cursor.onsuccess = () => {
        const at = cursor.result
        if (at === null || found.length >= LIMIT) return
        if (isRecord(at.value)) found.push(at.value)
        at.continue()
      }
      return () => found
    },
    [],
  )

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** a short, stable mark of a source text, to tell whether a record ran against it */
export const sourceMark = (source: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The tries of one source, newest first, with a way to add one and to clear
 * them.
 *
 * The scope is the source being tried: `draft`, `release/5`, `revision/18`.
 * Storage answers asynchronously, so the list starts empty and arrives - a
 * panel that has not read it yet shows no tries, which is also what a browser
 * that keeps none shows.
 */
export const useTryRecords = (functionId: string, scope: string) => {
  const scopeKey = `${functionId}/${scope}`
  const [records, setRecords] = useState<readonly TryRecord[]>([])

  useEffect(() => {
    let live = true
    void read(scopeKey).then((found) => {
      if (live) setRecords(found)
    })
    return () => {
      live = false
    }
  }, [scopeKey])

  const add = useCallback(
    (record: Omit<TryRecord, 'id' | 'at'>) => {
      const stored: StoredTryRecord = {
        ...record,
        id: newId(),
        at: Date.now(),
        functionId,
        scopeKey,
      }
      // on screen at once; the write is this browser's own bookkeeping
      setRecords((held) => [stored, ...held].slice(0, LIMIT))
      void inStores(
        [TRY_RECORDS],
        'readwrite',
        (open) => {
          const store = open(TRY_RECORDS)
          store.put(stored)
          // the oldest beyond the limit leave with the same transaction that
          // brought this one in, so the scope never grows past what it keeps
          let seen = 0
          const cursor = store.index(BY_SCOPE_AND_TIME).openCursor(scopeRange(scopeKey), 'prev')
          cursor.onsuccess = () => {
            const at = cursor.result
            if (at === null) return
            seen += 1
            if (seen > LIMIT) at.delete()
            at.continue()
          }
        },
        undefined,
      )
    },
    [functionId, scopeKey],
  )

  const clear = useCallback(() => {
    setRecords([])
    void inStores(
      [TRY_RECORDS],
      'readwrite',
      (open) => {
        const cursor = open(TRY_RECORDS).index(BY_SCOPE_AND_TIME).openCursor(scopeRange(scopeKey))
        cursor.onsuccess = () => {
          const at = cursor.result
          if (at === null) return
          at.delete()
          at.continue()
        }
      },
      undefined,
    )
  }, [scopeKey])

  return { records, add, clear }
}
