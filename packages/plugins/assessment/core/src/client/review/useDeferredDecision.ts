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
//
// What is waiting lives in a ref, not in state, and every path out of the
// window goes through `flush`, which takes it and clears it in one step.
// Sending from inside a `setState` updater instead sent every decision
// twice: React re-invokes updaters to surface impurity, so the first POST
// carried the decision and the second came back "somebody already handled
// this" - about the reviewer's own submission, a second earlier.

/**
 * What is waiting to go out.
 *
 * Asking for material is a disposition like any other - it ends the
 * reviewer's turn on this filing and moves them on - so it waits in the same
 * window rather than going out the moment the dialog closes. Getting the
 * wording wrong used to mean withdrawing a request the other person had
 * already been shown.
 */
export type StagedDecision =
  | {
      readonly kind: 'decision'
      readonly instanceId: string
      readonly decision: 'approve' | 'reject' | 'escalate'
      readonly payload: {
        readonly decision: 'approve' | 'reject' | 'escalate'
        readonly reason?: string
        readonly comment?: string
        readonly suggestedPayload?: unknown
      }
      /** what the pill says while the window is open */
      readonly participantName: string
    }
  | {
      readonly kind: 'supplement'
      readonly instanceId: string
      readonly payload: {
        readonly instructions: string
        readonly requirements: readonly {
          readonly label: string
          readonly kind: 'text' | 'file'
          readonly required: boolean
        }[]
      }
      readonly participantName: string
    }

const WINDOW_MS = 5_000

/** the wire path whatever is waiting goes out on, for the send that outlives the page */
const beaconPath = (staged: StagedDecision) =>
  staged.kind === 'supplement'
    ? `/api/assessment/review/instances/${staged.instanceId}/supplement-requests`
    : `/api/assessment/review/instances/${staged.instanceId}/decisions`

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
  const waiting = useRef<StagedDecision | null>(null)
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
        staged.kind === 'supplement'
          ? api.assessment.requestSupplement({
              params: { instanceId: staged.instanceId },
              payload: staged.payload as never,
            })
          : api.assessment.decideReview({
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

  const stopTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  /**
   * Take whatever is waiting and send it, exactly once.
   *
   * The ref is cleared before the send, so a second call - a re-invoked
   * updater, a timer racing an unmount - finds nothing and does nothing.
   */
  const flush = useCallback(() => {
    const staged = waiting.current
    waiting.current = null
    stopTimer()
    if (staged === null) return
    setPending(null)
    send(staged)
  }, [send])

  /** stage a decision; whatever was already waiting goes out right now */
  const stage = useCallback(
    (staged: StagedDecision) => {
      flush()
      waiting.current = staged
      setPending(staged)
      setDeadline(Date.now() + WINDOW_MS)
      timer.current = setTimeout(flush, WINDOW_MS)
    },
    [flush],
  )

  /** take the waiting decision back; returns it so the caller can go there */
  const undo = useCallback((): StagedDecision | null => {
    const taken = waiting.current
    waiting.current = null
    stopTimer()
    setPending(null)
    return taken
  }, [])

  // A page being left is not a decision being lost: the beacon carries it
  // out even while the document is being torn down. The api answer is not
  // readable this way, which is the price of surviving the unload - the
  // next session's queue is the authority on what went through.
  useEffect(() => {
    const carryOut = () => {
      const staged = waiting.current
      waiting.current = null
      stopTimer()
      if (staged === null) return
      navigator.sendBeacon(
        beaconPath(staged),
        new Blob([JSON.stringify(staged.payload)], { type: 'application/json' }),
      )
    }
    window.addEventListener('pagehide', carryOut)
    return () => {
      window.removeEventListener('pagehide', carryOut)
      // unmounting inside the app is the same promise kept the same way
      carryOut()
    }
  }, [])

  return { pending, deadline, stage, undo }
}
