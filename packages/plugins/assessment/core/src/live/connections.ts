import { Duration, Effect, Stream } from 'effect'

// How many live streams one process keeps open, and for how long.
//
// A batch's event stream is the one request here that is meant to stay open,
// which made it the cheapest way to hold a socket, a fiber and a bus
// subscription each: nothing bounded how many one session could open, and a
// stream opened before a sign-out went on after it. Both bounds fall back on
// what a page already does without the stream - it polls - so a refusal
// costs a reader freshness, never function.

export interface ConnectionLimits {
  /** open streams one session may hold in this process */
  readonly perSession: number
  /** open streams this process holds in all */
  readonly total: number
  /**
   * How long one stream lives before it ends and the page dials again. The
   * dial goes through authentication, so a session that has ended stops
   * being served within this long, and whatever standing the reader has is
   * judged afresh.
   */
  readonly lifetime: Duration.Input
}

export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = {
  perSession: 6,
  total: 2000,
  lifetime: '10 minutes',
}

export interface ConnectionLedger {
  /**
   * The stream if there is room for it, counted from when it starts until it
   * ends, and ended once its lifetime is up; `refused` otherwise.
   */
  readonly admit: <A, E, R>(
    sessionId: string,
    stream: Stream.Stream<A, E, R>,
    refused: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E, R>
  /** how many streams are open now, for this session or in all */
  readonly open: (sessionId?: string) => number
}

export const connectionLedger = (limits: ConnectionLimits): ConnectionLedger => {
  const bySession = new Map<string, number>()
  let total = 0

  const release = (sessionId: string) =>
    Effect.sync(() => {
      total -= 1
      const held = (bySession.get(sessionId) ?? 1) - 1
      if (held <= 0) bySession.delete(sessionId)
      else bySession.set(sessionId, held)
    })

  return {
    admit: (sessionId, stream, refused) =>
      Stream.unwrap(
        Effect.sync(() => {
          const held = bySession.get(sessionId) ?? 0
          if (held >= limits.perSession || total >= limits.total) return refused
          bySession.set(sessionId, held + 1)
          total += 1
          return stream.pipe(
            Stream.interruptWhen(Effect.sleep(limits.lifetime)),
            Stream.ensuring(release(sessionId)),
          )
        }),
      ),
    open: (sessionId) => (sessionId === undefined ? total : (bySession.get(sessionId) ?? 0)),
  }
}
