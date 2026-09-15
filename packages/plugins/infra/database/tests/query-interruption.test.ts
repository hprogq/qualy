import { Effect, Fiber, Metric } from 'effect'
import { describe, expect, it } from 'vitest'
import { query } from '../src/server/orm.ts'

// What a fiber owes the query it started.
//
// `query` hands a promise to the Effect runtime. Interrupting the fiber that
// is waiting on one does not cancel the promise - nothing cancels a promise -
// so the only question is whether the fiber is allowed to declare itself
// finished while the work it started is still running. It is not, and the
// reason is a connection: the driver returns it to the pool in the `finally`
// of that same promise chain, so a fiber that outruns the promise leaves a
// checkout behind with no one left to attribute it to.
//
// That is not hypothetical. A shutdown then reaches the database layer, which
// closes the pool, and the pool waits for a connection whose owner has already
// been collected. What the log shows is a plugin that is "still releasing" and
// a backend PostgreSQL reports as idle - the server finished, the client never
// came back. It is rare because the window is normally microseconds wide, and
// it is reachable because a loaded machine widens it.
//
// No database here on purpose. The contract is about the bridge, and a real
// connection would only make the same assertion slower and less certain.

/** lets the test decide when the "query" finishes, and watch what it does next */
const gated = () => {
  const state = { started: false, released: false }
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const run = async () => {
    state.started = true
    try {
      await gate
      return 1
    } finally {
      // where the driver hands the connection back
      state.released = true
    }
  }
  return { state, open, run }
}

/** a turn of the event loop, so anything that was going to settle has */
const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('interrupting a query', () => {
  it('does not finish before the promise it started has released', async () => {
    const { state, open, run } = gated()
    const fiber = Effect.runFork(query(run))
    await settle()
    expect(state.started).toBe(true)

    let interrupted = false
    const interrupting = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interrupted = true
    })
    // two turns, so an interruption with nothing to wait for has every chance
    // to complete
    await settle()
    await settle()

    // the fiber asked the driver for a connection and the driver has not
    // given it back; the fiber does not get to be gone yet
    expect(state.released).toBe(false)
    expect(interrupted).toBe(false)

    open()
    await interrupting
    expect(state.released).toBe(true)
    expect(interrupted).toBe(true)
  })

  it('still answers normally when nothing interrupts it', async () => {
    const { state, open, run } = gated()
    const fiber = Effect.runFork(query(run))
    await settle()
    open()
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(1)
    expect(state.released).toBe(true)
  })

  it('carries a refusal into the error channel, as it always did', async () => {
    const exit = await Effect.runPromiseExit(
      query(() => Promise.reject(new Error('relation does not exist'))),
    )
    expect(exit._tag).toBe('Failure')
    const reason = (exit as Extract<typeof exit, { _tag: 'Failure' }>).cause.reasons[0]
    expect((reason as { error?: { _tag?: string } }).error?._tag).toBe('QueryFailed')
  })

  // A caller that was cancelled is not a database that refused. The statement
  // here succeeds; only the fiber waiting on it went away, so recording it as
  // a failed query would put every shutdown into the error rate of a server
  // that did nothing wrong.
  it('records a cancelled caller as interrupted, not as a query that failed', async () => {
    const { open, run } = gated()
    const registry = new Map()
    const fiber = Effect.runFork(
      query(run).pipe(Effect.provideService(Metric.MetricRegistry, registry)),
    )
    await settle()
    const interrupting = Effect.runPromise(Fiber.interrupt(fiber))
    await settle()
    open()
    await interrupting

    const snapshot = await Effect.runPromise(
      Metric.snapshot.pipe(Effect.provideService(Metric.MetricRegistry, registry)),
    )
    const kinds = snapshot
      .filter((state) => state.id === 'db.client.operation.duration')
      .map((state) => state.attributes?.['error.type'])
    expect(kinds).toEqual(['Interrupted'])
  })
})
