import { Effect, Semaphore } from 'effect'
import { CompileBusy } from '@qualy/sandbox-rpc'

/** A cancelled waiter leaves immediately; a running compiler keeps its slot
 * until its promise and workspace cleanup have actually settled. */
export const makeCompileQueue = (maxPending: number) => {
  const permits = Semaphore.makeUnsafe(1)
  let pending = 0
  return {
    run: <A, E, R>(work: (queuedAt: number) => Effect.Effect<A, E, R>) =>
      Effect.suspend((): Effect.Effect<A, E | CompileBusy, R> => {
        if (pending >= maxPending) return Effect.fail(new CompileBusy())
        pending += 1
        const queuedAt = performance.now()
        return permits
          .withPermits(1)(Effect.uninterruptible(Effect.suspend(() => work(queuedAt))))
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                pending -= 1
              }),
            ),
          )
      }),
  }
}
