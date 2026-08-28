import { Deferred, Effect } from 'effect'

// One way to ask this process to stop, whoever is asking.
//
// A signal is one way and it is the only one that existed: the http drain
// listened for SIGINT and SIGTERM directly, which worked because a signal was
// the only thing that ever ended this process. Under a supervisor it is not -
// the stop arrives over a channel, and a drain wired to signals would simply
// not run. The alternative, emitting a fake signal at ourselves, would have
// this process lie to every other listener about what happened.
//
// So the request is its own thing and the signal handlers are one caller of
// it. Everything registered here runs at most once, in registration order,
// and a second request is ignored rather than running the finalizers twice.

const drains: (() => void)[] = []
const stopping = Deferred.makeUnsafe<void>()

/**
 * Work to start the moment a stop is asked for, before the runtime unwinds.
 *
 * The http server's is the reason this exists: idle connections have to start
 * being swept while the application is still up, because the finalizer that
 * closes the server waits for them and a browser tab alone can hold one open
 * indefinitely.
 */
export const onShutdownRequested = (drain: () => void): void => {
  drains.push(drain)
}

/** whether this process has already been asked to stop */
export const isStopping = (): boolean => Deferred.isDoneUnsafe(stopping)

/** Ask this process to stop. Idempotent, and safe from any caller. */
export const requestShutdown = (): void => {
  if (Deferred.isDoneUnsafe(stopping)) return
  Deferred.doneUnsafe(stopping, Effect.void)
  for (const drain of drains) drain()
}

/**
 * Completes when a stop has been asked for.
 *
 * Raced against the launched application in the entry point, so that the
 * request interrupts the root fiber exactly the way a signal does - the same
 * scope closes and the same finalizers run.
 */
export const shutdownRequested: Effect.Effect<void> = Deferred.await(stopping)
