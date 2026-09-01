/**
 * The one shared answer to rc.111's transport edges, extracted from the
 * authoring adapter so the language bridge cannot re-learn A-E's lessons
 * the hard way.
 *
 * A client-side transport failure is a typed error. Two other things
 * arrive as DELIBERATE upstream defects, and neither is a bug on this side
 * of the boundary: a mid-call socket failure (vendored RpcClient.ts:1156
 * `Effect.orDie(write(...))`), and an answer this host cannot decode
 * (RpcClient.ts:748, `decodeExit(...).pipe(Effect.orDie)`) - which is what
 * a peer process left running across an upgrade produces. Exactly those two
 * are tamed back into the caller's outage error; real defects fly.
 */

import { Cause, Effect, Predicate, Result, Schema } from 'effect'

/** a defect that means the peer is unusable rather than that we are broken */
const peerIsUnusable = (defect: unknown): boolean =>
  Predicate.isTagged(defect, 'SocketError') || Schema.isSchemaError(defect)

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
        return peerIsUnusable(Cause.squash(cause))
          ? Effect.fail(unavailable())
          : Effect.failCause(cause as Cause.Cause<E>)
      }),
    )
