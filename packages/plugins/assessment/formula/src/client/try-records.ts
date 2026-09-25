import { useCallback, useEffect, useRef, useState } from 'react'
import { BY_FUNCTION, BY_SCOPE_AND_TIME, TRY_RECORDS, inStores } from './local-store.ts'
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
export const TRIES_PER_SOURCE = 20

/**
 * How many tries one formula keeps across all of its sources, oldest going
 * first. Saved revisions come and go on the server, so the sources a formula
 * was tried against are not a bounded set, and a ceiling per source alone
 * would still let one formula's tries grow without end - those of revisions
 * long gone among them.
 */
export const TRIES_PER_FORMULA = 100

/** one identity for "nothing", so a scope change does not rerender forever */
const EMPTY: readonly TryRecord[] = []

/** newest first, one row per id, and never more than the scope keeps */
const newestFirst = (records: readonly TryRecord[]): readonly TryRecord[] => {
  const byId = new Map<string, TryRecord>()
  for (const one of records) if (!byId.has(one.id)) byId.set(one.id, one)
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, TRIES_PER_SOURCE)
}

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
        if (at === null || found.length >= TRIES_PER_SOURCE) return
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
  // Held with the scope they belong to, and read back only when the two
  // agree. A plain list would still be the previous scope's on the render
  // that follows a switch - the effect below has not run yet - and that list
  // is in a drawer somebody may have open: they would see, and could load,
  // the tries of the source they just left.
  const [held, setHeld] = useState<{ scope: string; records: readonly TryRecord[] }>({
    scope: scopeKey,
    records: [],
  })
  const records = held.scope === scopeKey ? held.records : EMPTY

  /**
   * Which hydration is the current one, and what happened locally while it
   * was in flight.
   *
   * Storage answers asynchronously and a person can run a try inside that
   * window. Assigning the stored list on arrival would then take the record
   * they just watched appear back off the screen - it IS in the database, so
   * it returns on the next visit, which makes it look like the run was lost
   * and then found. What arrives is merged with what happened instead.
   */
  const load = useRef(0)
  const since = useRef<{ added: readonly TryRecord[]; cleared: boolean }>({
    added: [],
    cleared: false,
  })

  useEffect(() => {
    const mine = ++load.current
    since.current = { added: [], cleared: false }
    setHeld({ scope: scopeKey, records: [] })
    void read(scopeKey).then((found) => {
      // a later scope, or a later hydration of this one, owns the screen now
      if (load.current !== mine) return
      const happened = since.current
      since.current = { added: [], cleared: false }
      // emptied while this was in flight: the list the person asked for is
      // the empty one, not the one the read started before they pressed it
      if (happened.cleared) return
      setHeld({ scope: scopeKey, records: newestFirst([...happened.added, ...found]) })
    })
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
      since.current = { ...since.current, added: [stored, ...since.current.added] }
      // on screen at once; the write is this browser's own bookkeeping
      setHeld((was) => ({
        scope: scopeKey,
        records: newestFirst([stored, ...(was.scope === scopeKey ? was.records : [])]),
      }))
      void inStores(
        [TRY_RECORDS],
        'readwrite',
        (open) => {
          const store = open(TRY_RECORDS)
          store.put(stored)
          // The oldest past what one source keeps, and past what the whole
          // formula keeps, leave with the same transaction that brought this
          // one in - read after the put, so it counts itself - and neither
          // ever grows past its ceiling. Only this formula's rows are read.
          const held = store.index(BY_FUNCTION).getAll(IDBKeyRange.only(functionId))
          held.onsuccess = () => {
            const newest = (held.result as unknown[]).filter(isRecord).sort((a, b) => b.at - a.at)
            const perSource = new Map<string, number>()
            let kept = 0
            for (const one of newest) {
              const inSource = (perSource.get(one.scopeKey) ?? 0) + 1
              perSource.set(one.scopeKey, inSource)
              if (inSource > TRIES_PER_SOURCE || kept >= TRIES_PER_FORMULA) store.delete(one.id)
              else kept += 1
            }
          }
        },
        undefined,
      )
    },
    [functionId, scopeKey],
  )

  const clear = useCallback(() => {
    since.current = { added: [], cleared: true }
    setHeld({ scope: scopeKey, records: [] })
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
