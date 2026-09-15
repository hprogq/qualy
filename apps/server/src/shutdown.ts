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
 * What a first signal says, which differs only in who is listening.
 *
 * The hint is an instruction, and an instruction is only worth printing to
 * somebody who can follow it: a person at a terminal, holding the key that
 * sent this. Production's SIGINT comes from a supervisor, a container stop or
 * a one-off `kill`, and telling a log file to press Ctrl+C again is advice
 * nobody in the room can take.
 *
 * Only the sentence changes. A second, distinct signal still gives up on the
 * graceful shutdown in either mode, and still says so when it happens - that
 * line reports an operator's decision rather than offering them one.
 */
export const shutdownStartMessage = (
  mode: 'development' | 'production',
  signal: 'SIGINT' | 'SIGTERM',
): string =>
  mode === 'development' && signal === 'SIGINT'
    ? 'shutting down; press Ctrl+C again to give up waiting'
    : `${signal}: shutting down`

/**
 * Completes when a stop has been asked for.
 *
 * Raced against the launched application in the entry point, so that the
 * request interrupts the root fiber exactly the way a signal does - the same
 * scope closes and the same finalizers run. It never completes on its own,
 * which is why that race has to be one decided by the first COMPLETION: a
 * race for the first success would wait here forever after the application
 * had already failed.
 */
export const shutdownRequested: Effect.Effect<void> = Deferred.await(stopping)
