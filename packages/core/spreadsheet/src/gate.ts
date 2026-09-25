import { Effect, Semaphore } from 'effect'

// One workbook in memory at a time, for the whole process.
//
// The widest workbook the parser accepts costs about a hundred and fifty
// megabytes of heap while the reader builds it, and every importer shares the
// one heap. The ceilings in contents.ts bound what a single workbook may
// cost; this bounds how many are paid for at once, so a handful of concurrent
// previews is a queue rather than an out-of-memory exit.

const workbooks = Semaphore.makeUnsafe(1)

/**
 * A workbook's bytes, fetched and read under the process's one permit.
 *
 * The bytes are fetched under the permit too, so a request waiting its turn
 * holds its place and nothing else. The reading cannot be interrupted: the
 * reader's work is a promise nobody can cancel, and handing the permit on
 * when a client hangs up would start the next workbook while the abandoned
 * one is still being built.
 */
export const readWorkbook = <A, E, R, F>(options: {
  readonly bytes: Effect.Effect<Uint8Array, E, R>
  readonly read: (bytes: Uint8Array) => Promise<A>
  readonly refused: (error: unknown) => F
}): Effect.Effect<A, E | F, R> =>
  workbooks.withPermits(1)(
    Effect.flatMap(options.bytes, (bytes) =>
      Effect.uninterruptible(
        Effect.tryPromise({ try: () => options.read(bytes), catch: options.refused }),
      ),
    ),
  )
