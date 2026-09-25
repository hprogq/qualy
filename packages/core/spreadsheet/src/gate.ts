import { Clock, Duration, Effect, Option, Semaphore } from 'effect'

// One workbook in memory at a time, for the whole process.
//
// The widest workbook the parser accepts costs about a hundred and fifty
// megabytes of heap while the reader builds it, and every importer shares the
// one heap. The ceilings in contents.ts bound what a single workbook may
// cost; this bounds how many are paid for at once, so a handful of concurrent
// previews is a short queue rather than an out-of-memory exit.
//
// The queue is short on purpose. Every request in it holds its file's bytes,
// and a request that waits behind a slow read holds a person's screen: past
// a few in line, or past a wait nobody would sit through, a request is turned
// away with a refusal the caller can say as "try again", rather than joining
// a line that only grows.

const workbooks = Semaphore.makeUnsafe(1)

/** requests reading or waiting to read, beyond which the next is turned away */
export const WORKBOOKS_IN_LINE_MOST = 4

/** how long a request waits for its turn before it is turned away */
export const WORKBOOK_WAIT_MOST: Duration.Input = '20 seconds'

/** how often a waiting request looks for its turn */
const LOOK_AGAIN = '100 millis'

let inLine = 0

/**
 * A workbook's bytes, fetched, then read under the process's one permit.
 *
 * The bytes are fetched before the turn is waited for: a slow store read is
 * the caller's own time, not everybody's. The reading cannot be interrupted:
 * the reader's work is a promise nobody can cancel, and handing the permit on
 * when a client hangs up would start the next workbook while the abandoned
 * one is still being built. `busy` is what a request turned away fails with.
 */
export const readWorkbook = <A, E, R, F, B>(options: {
  readonly bytes: Effect.Effect<Uint8Array, E, R>
  readonly read: (bytes: Uint8Array) => Promise<A>
  readonly refused: (error: unknown) => F
  readonly busy: () => B
}): Effect.Effect<A, E | F | B, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      if (inLine >= WORKBOOKS_IN_LINE_MOST) return false
      inLine += 1
      return true
    }),
    (admitted): Effect.Effect<A, E | F | B, R> =>
      admitted
        ? Effect.flatMap(options.bytes, (bytes) =>
            Effect.gen(function* () {
              const deadline =
                (yield* Clock.currentTimeMillis) + Duration.toMillis(WORKBOOK_WAIT_MOST)
              for (;;) {
                const read = yield* workbooks.withPermitsIfAvailable(1)(
                  Effect.uninterruptible(
                    Effect.tryPromise({ try: () => options.read(bytes), catch: options.refused }),
                  ),
                )
                if (Option.isSome(read)) return read.value
                if ((yield* Clock.currentTimeMillis) >= deadline)
                  return yield* Effect.fail(options.busy())
                yield* Effect.sleep(LOOK_AGAIN)
              }
            }),
          )
        : Effect.fail(options.busy()),
    (admitted) =>
      admitted
        ? Effect.sync(() => {
            inLine -= 1
          })
        : Effect.void,
  )
