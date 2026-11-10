import { useEffect, useRef, useState } from 'react'
import {
  compareDraft,
  draftRevision,
  draftVersionOf,
  forgetDraftRevision,
  forgetStaleDrafts,
  readDraft,
  watchDraft,
  type DraftRow,
  type DraftVersion,
} from '../local-store.ts'
import { useSignedInUserId } from '../signed-in.ts'

const SETTLE_MS = 500
const KEEP_DRAFTS_MS = 30 * 24 * 60 * 60 * 1000

/** Expire old copies without clearing another account's retained work. */
export function useDraftSweep(): void {
  const reader = useSignedInUserId()
  useEffect(() => {
    if (reader !== null) void forgetStaleDrafts(KEEP_DRAFTS_MS)
  }, [reader])
}

export interface DraftKeeper {
  readonly restored: boolean
  readonly at: number | null
  readonly discard: () => void
  readonly snapshot: () => Promise<DraftReceipt | null>
  /** Copies retained by another editor of this exact account, round and stage. */
  readonly conflicts: readonly { revision: string; at: number }[]
  readonly choose: (revision: string | null) => void
}

export interface DraftReceipt {
  readonly id: string
  readonly revision: string
}

export const stageDraftId = (
  instanceId: string,
  act: string,
  stage: { route: string; stageId: string },
) => `${instanceId}:${act}:${stage.route}:${encodeURIComponent(stage.stageId)}`

const copiesOf = (row: DraftRow): readonly DraftVersion[] => [
  draftVersionOf(row),
  ...(row.alternatives ?? []),
]

/** A panel owns its input; the shared browser store never silently replaces it. */
export function useLocalDraft<T>({
  id,
  value,
  empty,
  onRestore,
  enabled = true,
}: {
  id: string | null
  value: T
  empty: (value: T) => boolean
  onRestore: (value: T) => void
  enabled?: boolean
}): DraftKeeper {
  const owner = useSignedInUserId()
  const key = id === null || owner === null ? null : `${owner}:${id}`
  const [restored, setRestored] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [conflict, setConflict] = useState<DraftRow | null>(null)
  const restore = useRef(onRestore)
  restore.current = onRestore
  const isEmpty = useRef(empty)
  isEmpty.current = empty
  const kept = useRef(value)
  kept.current = value
  const currentKey = useRef(key)
  currentKey.current = key
  const writer = useRef(draftRevision())
  const head = useRef<string | null>(null)
  const selected = useRef<string | null>(null)
  const lastValue = useRef('')
  const done = useRef(false)
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const save = (words: T, preserveCurrent = false): Promise<DraftReceipt | null> => {
    if (key === null || isEmpty.current(words)) return Promise.resolve(null)
    const revision = draftRevision()
    const editor = writer.current
    const next = queue.current.then(async () => {
      const result = await compareDraft(key, words, {
        expected: head.current,
        writer: editor,
        revision,
        preserveCurrent,
      })
      if (result.kind === 'unavailable') return null
      if (currentKey.current === key) {
        selected.current = revision
        lastValue.current = JSON.stringify(words)
        setAt(Date.now())
        if (result.kind === 'saved') {
          head.current = draftVersionOf(result.row).revision
          setConflict(null)
        } else setConflict(result.row)
      }
      return { id: key, revision }
    })
    queue.current = next
    return next
  }
  const saveNow = useRef(save)
  saveNow.current = save

  useEffect(() => {
    if (key === null || !enabled) return
    let left = false
    setLoaded(null)
    setRestored(false)
    setConflict(null)
    head.current = null
    selected.current = null
    lastValue.current = ''
    writer.current = draftRevision()
    done.current = false
    void readDraft(key).then((row) => {
      if (left) return
      if (row !== null) {
        const version = draftVersionOf(row)
        head.current = version.revision
        selected.current = version.revision
        // A user can type while IndexedDB is opening. Their input wins and
        // its eventual save still compares against the version actually read.
        if (isEmpty.current(kept.current)) {
          try {
            restore.current(row.value as T)
            lastValue.current = JSON.stringify(row.value)
            setRestored(true)
            setAt(row.at)
          } catch {}
        }
        if (row.conflicted === true) setConflict(row)
      }
      setLoaded(key)
    })
    return () => {
      left = true
    }
  }, [key, enabled])

  useEffect(() => {
    if (
      key === null ||
      !enabled ||
      loaded !== key ||
      done.current ||
      JSON.stringify(value) === lastValue.current
    )
      return
    if (isEmpty.current(value)) {
      const revision = selected.current
      selected.current = null
      lastValue.current = JSON.stringify(value)
      if (revision !== null)
        queue.current = queue.current.then(() => forgetDraftRevision(key, revision))
      return
    }
    const timer = setTimeout(() => {
      pendingWrite.current = null
      void saveNow.current(kept.current)
    }, SETTLE_MS)
    pendingWrite.current = timer
    return () => {
      clearTimeout(timer)
      if (pendingWrite.current === timer) pendingWrite.current = null
    }
  }, [key, enabled, loaded, value])

  useEffect(() => {
    if (key === null || !enabled || loaded !== key) return
    let active = true
    const check = () => {
      void readDraft(key).then((row) => {
        if (!active || done.current || row === null) return
        const current = draftVersionOf(row)
        const changedElsewhere =
          current.revision !== head.current && current.writer !== writer.current
        const otherCopies =
          row.conflicted === true &&
          (row.alternatives ?? []).some(
            (copy) => copy.writer !== writer.current && copy.at > (at ?? 0),
          )
        if (!changedElsewhere && !otherCopies) return
        if (isEmpty.current(kept.current)) {
          head.current = current.revision
          selected.current = current.revision
          restore.current(row.value as T)
          lastValue.current = JSON.stringify(row.value)
          setRestored(true)
          setAt(row.at)
        } else {
          setConflict(row)
          // The notification can precede this panel's debounce. Preserve its
          // current input immediately, in the same CAS path as an autosave.
          if (changedElsewhere && JSON.stringify(kept.current) !== lastValue.current)
            void saveNow.current(kept.current)
        }
      })
    }
    const stop = watchDraft(key, check)
    const leaving = () => {
      if (!done.current) void saveNow.current(kept.current)
    }
    window.addEventListener('pagehide', leaving)
    return () => {
      active = false
      stop()
      window.removeEventListener('pagehide', leaving)
    }
  }, [key, enabled, loaded, at])

  return {
    restored,
    at,
    conflicts:
      conflict === null
        ? []
        : copiesOf(conflict)
            .filter((copy) => copy.writer !== writer.current)
            .map(({ revision, at }) => ({ revision, at })),
    choose: (revision) => {
      if (conflict === null) return
      const chosen =
        revision === null
          ? kept.current
          : (copiesOf(conflict).find((copy) => copy.revision === revision)?.value as T | undefined)
      if (chosen === undefined) return
      // Retain the just-typed version before choosing a different copy.
      void saveNow.current(kept.current).then(async () => {
        if (currentKey.current !== key || key === null) return
        const latest = await readDraft(key)
        head.current = latest === null ? null : draftVersionOf(latest).revision
        writer.current = draftRevision()
        restore.current(chosen)
        kept.current = chosen
        await saveNow.current(chosen, true)
        setRestored(true)
      })
    },
    snapshot: () => {
      done.current = true
      if (pendingWrite.current !== null) clearTimeout(pendingWrite.current)
      pendingWrite.current = null
      return saveNow.current(kept.current)
    },
    discard: () => {
      if (pendingWrite.current !== null) clearTimeout(pendingWrite.current)
      pendingWrite.current = null
      setRestored(false)
      setAt(null)
      setConflict(null)
      lastValue.current = ''
      if (key !== null && selected.current !== null) void forgetDraftRevision(key, selected.current)
    },
  }
}
