/**
 * The draft contract preview: what the CURRENT editor buffer compiles to,
 * fetched through the same authoritative pipeline publication uses, at a
 * humane cadence - about a second of idle after an edit, one request in
 * flight at a time, and the newest source always wins (a completed answer
 * for an older buffer is applied only as history, never over a fresher
 * one).
 *
 * Freshness is two different questions, kept apart on purpose:
 *   - is THIS preview about the text on screen?   (forSource === source)
 *   - does the contract still admit my test data? (contractSha256)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  NormalizedAtomicSchema,
  NormalizedInputSchema,
} from '@qualy/value-schema'

export interface DraftContract {
  readonly sourceSha256: string
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

export interface DraftPreviewState {
  readonly status: 'idle' | 'loading' | 'ready' | 'refused'
  /** the latest successful contract, possibly for an older source */
  readonly contract: DraftContract | null
  /** the source the latest outcome (contract or refusal) speaks about */
  readonly forSource: string | null
  /** already-formatted words for a refusal */
  readonly refusal: string | null
}

const IDLE_MS = 900

export interface DraftPreviewHandle extends DraftPreviewState {
  /** compile the current buffer NOW (run buttons skip the idle wait) */
  readonly ensureFresh: () => Promise<DraftPreviewState>
}

export const useDraftPreview = (
  source: string | null,
  fetchPreview: (sourceTs: string) => Promise<DraftContract>,
  describeRefusal: (error: unknown) => string,
): DraftPreviewHandle => {
  const [state, setState] = useState<DraftPreviewState>({
    status: 'idle',
    contract: null,
    forSource: null,
    refusal: null,
  })
  const sourceRef = useRef(source)
  sourceRef.current = source
  const inFlight = useRef<Promise<DraftPreviewState> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposed = useRef(false)

  const runPreview = useCallback(
    (sourceTs: string): Promise<DraftPreviewState> => {
      const attempt = fetchPreview(sourceTs).then(
        (contract): DraftPreviewState => ({
          status: 'ready',
          contract,
          forSource: sourceTs,
          refusal: null,
        }),
        (error): DraftPreviewState => ({
          status: 'refused',
          // the last good contract stays around: test data compatibility is
          // keyed on it, and a typo in the code does not unmake the form
          contract: null,
          forSource: sourceTs,
          refusal: describeRefusal(error),
        }),
      )
      return attempt
    },
    [fetchPreview, describeRefusal],
  )

  const settle = useCallback(
    (outcome: DraftPreviewState): DraftPreviewState => {
      if (disposed.current) return outcome
      setState((previous) => ({
        ...outcome,
        contract: outcome.contract ?? previous.contract,
        status: outcome.status === 'refused' && previous.contract !== null ? 'refused' : outcome.status,
      }))
      return outcome
    },
    [],
  )

  const launch = useCallback((): Promise<DraftPreviewState> => {
    const wanted = sourceRef.current
    if (wanted === null) return Promise.resolve(state)
    if (inFlight.current !== null) return inFlight.current
    setState((previous) => ({ ...previous, status: 'loading' }))
    const flight = runPreview(wanted)
      .then((outcome) => {
        inFlight.current = null
        settle(outcome)
        // latest coalescing: while this ran, the buffer may have moved on -
        // one follow-up for the newest text, never a queue
        if (!disposed.current && sourceRef.current !== wanted) return launch()
        return outcome
      })
    inFlight.current = flight
    return flight
  }, [runPreview, settle, state])
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

  const ensureFresh = useCallback((): Promise<DraftPreviewState> => {
    const wanted = sourceRef.current
    if (wanted !== null && state.forSource === wanted && state.status !== 'loading')
      return Promise.resolve(state)
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    return launchRef.current().then((outcome) =>
      // the flight we joined may have been about an older buffer; the
      // coalescing follow-up inside launch() already covers the newer one
      outcome.forSource === sourceRef.current ? outcome : launchRef.current(),
    )
  }, [state])

  return { ...state, ensureFresh }
}
