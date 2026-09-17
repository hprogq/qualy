import { useCallback, useEffect, useState } from 'react'
import type { TryOutcome } from './TryRunPanel.tsx'

// The tries a person ran, kept in this browser.
//
// A try is a question asked of the formula; the list lets its author look
// back over what came of which inputs and ask one again without typing it
// out. It belongs to one viewer on one device, so localStorage holds it, and
// every read and write may fail into "no records" without a word on screen.
// The draft, each publication and each saved revision keep their own list.

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

const LIMIT = 20
const PREFIX = 'qualy.formula-try-records.'

const read = (key: string): readonly TryRecord[] => {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(
          (one): one is TryRecord =>
            typeof one === 'object' &&
            one !== null &&
            typeof (one as TryRecord).id === 'string' &&
            typeof (one as TryRecord).at === 'number' &&
            typeof (one as TryRecord).outcome === 'object',
        )
      : []
  } catch {
    return []
  }
}

const write = (key: string, records: readonly TryRecord[]): void => {
  try {
    if (records.length === 0) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(records))
  } catch {
    // kept for this visit only
  }
}

/** a short, stable mark of a source text, to tell whether a record ran against it */
export const sourceMark = (source: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** the records under a key, newest first, with a way to add one and to clear them */
export const useTryRecords = (key: string) => {
  const [records, setRecords] = useState<readonly TryRecord[]>(() => read(key))
  useEffect(() => {
    setRecords(read(key))
  }, [key])

  const add = useCallback(
    (record: Omit<TryRecord, 'id' | 'at'>) => {
      const next = [{ ...record, id: newId(), at: Date.now() }, ...read(key)].slice(0, LIMIT)
      write(key, next)
      setRecords(next)
    },
    [key],
  )
  const clear = useCallback(() => {
    write(key, [])
    setRecords([])
  }, [key])

  return { records, add, clear }
}
