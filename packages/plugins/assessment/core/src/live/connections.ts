import { Effect, type Duration, type Scope } from 'effect'
import type { LiveQuotaReason } from '@qualy/api-kit/live-socket'

// How many live connections one process keeps open, and for how long.
//
// A batch's live channel is the one connection here that is meant to stay
// open, which makes it the cheapest way to hold a socket, a fiber and a bus
// subscription each: nothing would bound how many one session could open,
// and one opened before a sign-out would go on after it. Both bounds fall
// back on what a page already does without the channel - it polls - so a
// refusal costs a reader freshness, never function.

export interface ConnectionLimits {
  /** open connections one session may hold in this process */
  readonly perSession: number
  /** open connections this process holds in all */
  readonly total: number
  /**
   * How long one connection lives before it is renewed and the page dials
   * again. The dial goes through authentication, so a session that has
   * ended stops being served within this long, and whatever standing the
   * reader has is judged afresh.
   */
  readonly lifetime: Duration.Input
  /** how often an open connection asks again whether its listener may listen */
  readonly recheck: Duration.Input
}

export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = {
  perSession: 6,
  total: 2000,
  lifetime: '10 minutes',
  recheck: '2 minutes',
}

/** a seat, or why there was none */
export type Admission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: LiveQuotaReason }

export interface ConnectionLedger {
  /**
   * A seat for as long as the scope lives, if there is one. A refused
   * connection holds nothing and releases nothing; an admitted one releases
   * once, whichever way its scope ends.
   */
  readonly admit: (sessionId: string) => Effect.Effect<Admission, never, Scope.Scope>
  /** how many connections are open now, for this session or in all */
  readonly open: (sessionId?: string) => number
  /** the bounds it keeps, and how long a connection lives under them */
  readonly limits: ConnectionLimits
}

export const connectionLedger = (limits: ConnectionLimits): ConnectionLedger => {
  const bySession = new Map<string, number>()
  let total = 0

  return {
    admit: (sessionId) =>
      Effect.acquireRelease(
        Effect.sync((): Admission => {
          const held = bySession.get(sessionId) ?? 0
          if (held >= limits.perSession) return { admitted: false, reason: 'session' }
          if (total >= limits.total) return { admitted: false, reason: 'capacity' }
          bySession.set(sessionId, held + 1)
          total += 1
          return { admitted: true }
        }),
        (admission) =>
          admission.admitted
            ? Effect.sync(() => {
                total -= 1
                const held = (bySession.get(sessionId) ?? 1) - 1
                if (held <= 0) bySession.delete(sessionId)
                else bySession.set(sessionId, held)
              })
            : Effect.void,
      ),
    open: (sessionId) => (sessionId === undefined ? total : (bySession.get(sessionId) ?? 0)),
    limits,
  }
}
