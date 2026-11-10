import { isUseCaseApiFailure, type UseCaseApiFailure } from '@qualy/web-i18n'
import { QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import {
  CURRENT_CLIENT_PROTOCOL,
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
} from '@qualy/release-contract'
import { documentIdentity, ExpectedIdentity } from '@qualy/web-runtime/document-identity'
import { Effect } from 'effect'
import { type ApiError } from '@qualy/web-runtime/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi, useApiMutation } from '@qualy/web-runtime'
import { assessmentApi, assessmentUrls } from '../api.ts'
import { forgetDraftRevision } from '../local-store.ts'
import type { DraftReceipt } from './use-draft.ts'

// The five-second window between deciding and having decided.
//
// Letters only choose and ⌘↵ only stages: the decision leaves this machine
// five seconds later, and ⌘Z inside that window takes it back as if nothing
// happened - because nothing has. On leaving, whatever is still waiting
// goes out through a keepalive request carrying the document's identity.
// An unload cannot guarantee that the server receives it or replies.
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
        readonly expectedStage: {
          readonly route: 'normal' | 'escalation'
          readonly stageId: string
        }
        readonly reason?: string
        readonly comment?: string
        readonly suggestedPayload?: unknown
        /** the determination staged with an approval; the leave request carries it too */
        readonly recognition?: {
          readonly values: Record<string, unknown>
          readonly reason?: string
        }
      }
      /** what the pill says while the window is open */
      readonly participantName: string
    }
  | {
      readonly kind: 'supplement'
      readonly instanceId: string
      readonly payload: {
        readonly instructions: string
        readonly expectedStage: {
          readonly route: 'normal' | 'escalation'
          readonly stageId: string
        }
        readonly requirements: readonly {
          readonly label: string
          readonly kind: 'text' | 'file'
          readonly required: boolean
        }[]
      }
      readonly participantName: string
    }

export type DeferredDecisionFailure =
  | ApiError<typeof assessmentApi, 'assessment', 'decideReview'>
  | ApiError<typeof assessmentApi, 'assessment', 'requestSupplement'>

interface WaitingDecision {
  readonly staged: StagedDecision
  readonly identity: string | undefined
  readonly receipt?: Promise<DraftReceipt | null>
}

const WINDOW_MS = 5_000

/** The contract supplies the path for the send that outlives the page. */
const leavePath = (staged: StagedDecision) =>
  staged.kind === 'supplement'
    ? assessmentUrls.assessment.requestSupplement({ params: { instanceId: staged.instanceId } })
    : assessmentUrls.assessment.decideReview({ params: { instanceId: staged.instanceId } })

export function useDeferredDecision({
  onCommitted,
  onFailed,
  onRejected,
}: {
  /** the decision reached the server; refresh whatever shows it */
  onCommitted: (staged: StagedDecision) => void
  /** The endpoint refused the decision; the review use case explains why. */
  onFailed: (staged: StagedDecision, error: UseCaseApiFailure<DeferredDecisionFailure>) => void
  /** Platform policy presents the failure; restore the staged review locally. */
  onRejected: (staged: StagedDecision) => void
}) {
  const api = useApi(assessmentApi)
  const [pending, setPending] = useState<StagedDecision | null>(null)
  const [deadline, setDeadline] = useState(0)
  const waiting = useRef<WaitingDecision | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the callbacks live in refs so a staged decision from one render commits
  // through the handlers of the latest one
  const committed = useRef(onCommitted)
  const rejected = useRef(onRejected)
  rejected.current = onRejected
  const failed = useRef(onFailed)
  committed.current = onCommitted
  failed.current = onFailed

  const { mutate: sendDecision, isPending: sending } = useApiMutation({
    mutationFn: ({
      staged,
      identity,
    }: WaitingDecision): Effect.Effect<void, DeferredDecisionFailure> =>
      (staged.kind === 'supplement'
        ? api.assessment.requestSupplement({
            params: { instanceId: staged.instanceId },
            payload: staged.payload,
          })
        : api.assessment.decideReview({
            params: { instanceId: staged.instanceId },
            payload: staged.payload,
          })
      ).pipe(Effect.asVoid, Effect.provideService(ExpectedIdentity, identity)),
    onSuccess: (_answer, held) => {
      if (held.receipt !== undefined)
        void held.receipt.then((row) => {
          if (row !== null) void forgetDraftRevision(row.id, row.revision)
        })
      committed.current(held.staged)
    },
    onError: (error, held) => failed.current(held.staged, error),
    onSettled: (_answer, error, held) => {
      if (error !== null && !isUseCaseApiFailure(error)) rejected.current(held.staged)
    },
  })
  const send = useCallback(
    (held: WaitingDecision) => {
      if (held.identity === undefined) rejected.current(held.staged)
      else sendDecision(held)
    },
    [sendDecision],
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
    const held = waiting.current
    waiting.current = null
    stopTimer()
    if (held === null) return
    setPending(null)
    send(held)
  }, [send])

  /** stage a decision; whatever was already waiting goes out right now */
  const stage = useCallback(
    (staged: StagedDecision, receipt?: Promise<DraftReceipt | null>) => {
      flush()
      waiting.current = { staged, identity: documentIdentity(), receipt }
      setPending(staged)
      setDeadline(Date.now() + WINDOW_MS)
      timer.current = setTimeout(flush, WINDOW_MS)
    },
    [flush],
  )

  /** take the waiting decision back; returns it so the caller can go there */
  const undo = useCallback((): StagedDecision | null => {
    const taken = waiting.current?.staged ?? null
    waiting.current = null
    stopTimer()
    setPending(null)
    return taken
  }, [])

  // An unload cannot deliver a receipt. Warn while a decision has not yet
  // been acknowledged, including a send held by session recovery.
  useEffect(() => {
    if (pending === null && !sending) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending, sending])

  // sendBeacon cannot carry the identity and protocol headers, so the
  // server would accept the shared cookie as whoever signed in most recently.
  // Keep the declaration fixed to the person who staged the decision.
  // A keepalive request is best effort: once the document is gone, its
  // response cannot be shown and the queue remains the authority.
  useEffect(() => {
    const carryOut = () => {
      const held = waiting.current
      waiting.current = null
      stopTimer()
      if (held === null) return
      const { staged, identity } = held
      if (identity === undefined) {
        rejected.current(staged)
        return
      }
      const release = document.documentElement.dataset['release']
      void fetch(leavePath(staged), {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          [QUALY_IDENTITY_HEADER]: identity,
          [QUALY_CLIENT_PROTOCOL_HEADER]: String(CURRENT_CLIENT_PROTOCOL),
          ...(release === undefined ? {} : { [QUALY_CLIENT_RELEASE_HEADER]: release }),
        },
        body: JSON.stringify(staged.payload),
      })
        .then((response) => {
          setPending((current) => (current === staged ? null : current))
          if (response.ok) {
            if (held.receipt !== undefined)
              void held.receipt.then((row) => {
                if (row !== null) void forgetDraftRevision(row.id, row.revision)
              })
            committed.current(staged)
          } else rejected.current(staged)
        })
        .catch(() => {
          setPending((current) => (current === staged ? null : current))
          rejected.current(staged)
        })
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
