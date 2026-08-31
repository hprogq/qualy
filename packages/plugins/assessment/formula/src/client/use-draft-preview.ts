/**
 * The draft contract preview: what the CURRENT editor buffer compiles to,
 * fetched through the same authoritative pipeline publication uses, at a
 * humane cadence - about a second of idle after an edit, one request in
 * flight at a time, and the newest source always winning.
 *
 * Two concepts, deliberately separate so they cannot be confused:
 *
 *   current   the verdict about ONE source: loading, ready(contract) or
 *             refused(words). The AUTHORITY - running cases and saving
 *             tests may only proceed on `ready` for the exact buffer.
 *   lastGood  the most recent source->contract pair that compiled. The
 *             CONVENIENCE - a typo mid-edit must not unmake the form, so
 *             screens keep rendering from here.
 *
 * `ensureFresh` retries a refusal for the same source on purpose: a 503
 * from the sandbox is not a property of the code, and an explicit Run
 * click deserves a fresh attempt. The idle loop does not loop on refusals.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'

export interface DraftContract {
  readonly sourceSha256: string
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

export type PreviewCurrent =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly source: string }
  | { readonly status: 'ready'; readonly source: string; readonly contract: DraftContract }
  | { readonly status: 'refused'; readonly source: string; readonly refusal: string }

export interface LastGoodContract {
  readonly source: string
  readonly contract: DraftContract
}

const IDLE_MS = 900

export interface DraftPreviewHandle {
  readonly current: PreviewCurrent
  readonly lastGood: LastGoodContract | null
  /** compile the current buffer NOW; retries an earlier refusal */
  readonly ensureFresh: () => Promise<PreviewCurrent>
}

export const useDraftPreview = (
  source: string | null,
  fetchPreview: (sourceTs: string) => Promise<DraftContract>,
  describeRefusal: (error: unknown) => string,
): DraftPreviewHandle => {
  const [current, setCurrent] = useState<PreviewCurrent>({ status: 'idle' })
  const [lastGood, setLastGood] = useState<LastGoodContract | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const inFlight = useRef<Promise<PreviewCurrent> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposed = useRef(false)

  const launch = useCallback((): Promise<PreviewCurrent> => {
    const wanted = sourceRef.current
    if (wanted === null) return Promise.resolve({ status: 'idle' })
    if (inFlight.current !== null) return inFlight.current
    if (!disposed.current) setCurrent({ status: 'loading', source: wanted })
    const flight = fetchPreview(wanted)
      .then(
        (contract): PreviewCurrent => ({ status: 'ready', source: wanted, contract }),
        (error): PreviewCurrent => ({
          status: 'refused',
          source: wanted,
          refusal: describeRefusal(error),
        }),
      )
      .then((outcome) => {
        inFlight.current = null
        if (!disposed.current) {
          setCurrent(outcome)
          if (outcome.status === 'ready')
            setLastGood({ source: outcome.source, contract: outcome.contract })
        }
        // latest coalescing: while this ran the buffer may have moved on -
        // one follow-up for the newest text, never a queue
        if (!disposed.current && sourceRef.current !== wanted) return launch()
        return outcome
      })
    inFlight.current = flight
    return flight
  }, [fetchPreview, describeRefusal])
  const launchRef = useRef(launch)
  launchRef.current = launch

  useEffect(() => {
    if (source === null) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void launchRef.current()
    }, IDLE_MS)
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [source])

  useEffect(() => {
    // StrictMode mounts, cleans up and mounts again over the SAME refs: the
    // flag must come back down or every settle after the rehearsal is lost
    disposed.current = false
    return () => {
      disposed.current = true
    }
  }, [])

  const currentRef = useRef(current)
  currentRef.current = current

  const ensureFresh = useCallback((): Promise<PreviewCurrent> => {
    const wanted = sourceRef.current
    const known = currentRef.current
    // only a READY verdict for the exact buffer short-circuits; a refusal
    // is retried - the code may be fine and the sandbox was not
    if (wanted !== null && known.status === 'ready' && known.source === wanted)
      return Promise.resolve(known)
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    return launchRef
      .current()
      .then((outcome) =>
        outcome.status !== 'idle' && outcome.source === sourceRef.current
          ? outcome
          : launchRef.current(),
      )
  }, [])

  return { current, lastGood, ensureFresh }
}
