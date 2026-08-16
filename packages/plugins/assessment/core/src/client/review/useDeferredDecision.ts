import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'

// The five-second window between deciding and having decided.
//
// Letters only choose and ⌘↵ only stages: the decision leaves this machine
// five seconds later, and ⌘Z inside that window takes it back as if nothing
// happened - because nothing has. Leaving the page does not lose the
// decision: whatever is still waiting goes out immediately through
// sendBeacon, which is built to outlive the page that called it.

export interface StagedDecision {
  readonly instanceId: string
  readonly decision: 'approve' | 'reject' | 'escalate' | 'comment'
  readonly payload: {
    readonly decision: 'approve' | 'reject' | 'escalate' | 'comment'
    readonly reason?: string
    readonly comment?: string
    readonly suggestedPayload?: unknown
  }
  /** what the pill says while the window is open */
  readonly participantName: string
}

const WINDOW_MS = 5_000

/** the wire path of the decision endpoint, for the send that outlives the page */
const beaconPath = (instanceId: string) =>
  `/api/assessment/review/instances/${instanceId}/decisions`

export function useDeferredDecision({
  onCommitted,
  onFailed,
}: {
  /** the decision reached the server; refresh whatever shows it */
  onCommitted: (staged: StagedDecision) => void
  /** it did not go through - somebody else got there first, or the wire broke */
  onFailed: (staged: StagedDecision, error: unknown) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const [pending, setPending] = useState<StagedDecision | null>(null)
  const [deadline, setDeadline] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the callbacks live in refs so a staged decision from one render commits
  // through the handlers of the latest one
  const committed = useRef(onCommitted)
  const failed = useRef(onFailed)
  committed.current = onCommitted
  failed.current = onFailed

  const send = useCallback(
    (staged: StagedDecision) => {
      void run(
        api.assessment.decideReview({
          params: { instanceId: staged.instanceId },
          payload: staged.payload as never,
        }),
      ).then(
        () => committed.current(staged),
        (error: unknown) => failed.current(staged, error),
      )
    },
    [api, run],
  )

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  /** stage a decision; whatever was already waiting goes out right now */
  const stage = useCallback(
    (staged: StagedDecision) => {
      setPending((current) => {
        if (current !== null) {
          clearTimer()
          send(current)
        }
        return staged
      })
      setDeadline(Date.now() + WINDOW_MS)
      clearTimer()
      timer.current = setTimeout(() => {
        timer.current = null
        setPending((current) => {
          if (current !== null) send(current)
          return null
        })
      }, WINDOW_MS)
    },
    [send],
  )

  /** take the waiting decision back; returns it so the caller can go there */
  const undo = useCallback((): StagedDecision | null => {
    let taken: StagedDecision | null = null
    clearTimer()
    setPending((current) => {
      taken = current
      return null
    })
    return taken
  }, [])

  // a page being left is not a decision being lost: the beacon carries it
  // out even while the document is being torn down. The api answer is not
  // readable this way, which is the price of surviving the unload - the
  // next session's queue is the authority on what went through.
  const pendingRef = useRef<StagedDecision | null>(null)
  pendingRef.current = pending
  useEffect(() => {
    const flushOut = () => {
      const staged = pendingRef.current
      if (staged === null) return
      pendingRef.current = null
      clearTimer()
      setPending(null)
      navigator.sendBeacon(
        beaconPath(staged.instanceId),
        new Blob([JSON.stringify(staged.payload)], { type: 'application/json' }),
      )
    }
    window.addEventListener('pagehide', flushOut)
    return () => {
      window.removeEventListener('pagehide', flushOut)
      // unmounting inside the app is the same promise kept the same way
      flushOut()
    }
  }, [])

  return { pending, deadline, stage, undo }
}
