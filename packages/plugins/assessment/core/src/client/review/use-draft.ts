import { useEffect, useRef, useState } from 'react'
import { forgetDraft, forgetStaleDrafts, readDraft, writeDraft } from '../local-store.ts'
import { useSignedInUserId } from '../signed-in.ts'

// Keeping what a reviewer has typed but not sent.
//
// A decision panel is closed for ordinary reasons - to read the filing behind
// it on a narrow screen, to look something up, because the tab was reloaded -
// and losing three paragraphs of a refusal to any of those is the kind of
// loss that teaches people to write somewhere else first. So every panel that
// takes words keeps them in this browser until the act is sent.
//
// It is this browser's copy and nothing more: it is never read by the server,
// and dropped the moment the act goes through. A browser can be shared, so a
// draft belongs to whoever typed it: it is kept under their id, put back only
// for them, and nothing is kept until the page knows who that is.

/** how long the typing rests before it is written down */
const SETTLE_MS = 500

/** how long an unsent draft is worth keeping: a month of ordinary interruptions */
const KEEP_DRAFTS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Sweeps the unsent words nobody came back for, and any somebody else left
 * in this browser, once it is known who is reading.
 */
export function useDraftSweep(): void {
  const reader = useSignedInUserId()
  useEffect(() => {
    if (reader !== null) void forgetStaleDrafts(KEEP_DRAFTS_MS, reader)
  }, [reader])
}

export interface DraftKeeper {
  /** something typed earlier was put back, and the screen should say so */
  readonly restored: boolean
  /** when it was last written, for saying how old it is */
  readonly at: number | null
  /** throw it away and start again: the caller clears its own state */
  readonly discard: () => void
  /** the act went through; there is nothing left to keep */
  readonly forget: () => void
}

/**
 * Keeps one panel's unsent words, and puts them back when it reopens.
 *
 * `onRestore` is called at most once, with what was kept, before anybody has
 * typed - the caller applies it to its own state, because only the caller
 * knows what its state is. Writing waits for the read to finish: otherwise
 * the blank state a panel opens with would be written over the very draft
 * being loaded.
 */
export function useLocalDraft<T>({
  id,
  value,
  empty,
  onRestore,
  enabled = true,
}: {
  /** null keeps nothing: a panel with no round to hang a draft on */
  id: string | null
  value: T
  /** whether this value is worth keeping; an untouched panel is not */
  empty: (value: T) => boolean
  onRestore: (value: T) => void
  enabled?: boolean
}): DraftKeeper {
  const owner = useSignedInUserId()
  const key = id === null || owner === null ? null : `${owner}:${id}`
  const [restored, setRestored] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  // the callback is read at the moment the row arrives, never subscribed to:
  // a caller that rebuilds it every render must not re-run the read
  const restore = useRef(onRestore)
  restore.current = onRestore
  const kept = useRef(value)
  kept.current = value
  const done = useRef(false)

  useEffect(() => {
    if (key === null || !enabled) return
    let left = false
    setLoaded(false)
    setRestored(false)
    done.current = false
    void readDraft(key).then((row) => {
      if (left) return
      // somebody who started typing while the read was in flight has already
      // said more than the row does
      if (row !== null && empty(kept.current)) {
        restore.current(row.value as T)
        setRestored(true)
        setAt(row.at)
      }
      setLoaded(true)
    })
    return () => {
      left = true
    }
    // `empty` is a predicate over the shape, not state; re-reading on a new
    // closure identity would restore twice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  useEffect(() => {
    if (key === null || !enabled || !loaded || done.current) return
    const timer = setTimeout(() => {
      void (empty(value) ? forgetDraft(key) : writeDraft(key, value))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, loaded, value])

  return {
    restored,
    at,
    discard: () => {
      setRestored(false)
      setAt(null)
      if (key !== null) void forgetDraft(key)
    },
    forget: () => {
      done.current = true
      setRestored(false)
      if (key !== null) void forgetDraft(key)
    },
  }
}
