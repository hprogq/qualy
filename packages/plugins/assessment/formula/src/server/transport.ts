/**
 * The one shared answer to rc.111's transport edges, extracted from the
 * authoring adapter so the language bridge cannot re-learn A-E's lessons
 * the hard way: a client-side transport failure is a typed error, and a
 * mid-call socket failure arrives as a DELIBERATE upstream defect
 * (vendored RpcClient.ts:1156 `Effect.orDie(write(...))`) - exactly that
 * defect is tamed back into the caller's outage error, real defects fly.
 */

import { Cause, Effect, Predicate, Result } from 'effect'

export const tameTransport =
  <EOut>(unavailable: () => EOut) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E | EOut> =>
    effect.pipe(
      Effect.catchCause((cause): Effect.Effect<never, E | EOut> => {
        const failure = Cause.findError(cause)
        if (Result.isSuccess(failure)) {
          return Predicate.isTagged(failure.success, 'RpcClientError')
            ? Effect.fail(unavailable())
            : Effect.failCause(cause as Cause.Cause<E>)
        }
        return Predicate.isTagged(Cause.squash(cause), 'SocketError')
          ? Effect.fail(unavailable())
          : Effect.failCause(cause as Cause.Cause<E>)
      }),
    )
