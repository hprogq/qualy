import { describe, expect, it, onTestFinished } from 'vitest'
import { DEFAULT_LIMITS, WorkerPool, type PoolProblem, type SandboxLimits } from '../src/index.ts'

// The pool as a resource: the hard watchdog replaces a wedged worker, load
// beyond the pool size queues rather than fails, and shutdown is the end —
// nothing accepts work afterwards.

const run = (
  pool: WorkerPool,
  artifact: string,
  entrypoint: string,
  limits?: Partial<SandboxLimits>,
) => {
  const all: SandboxLimits = { ...DEFAULT_LIMITS, ...limits }
  return pool.run(
    {
      id: pool.nextId(),
      artifact,
      entrypoint,
      arguments: [],
      softDeadlineMs: all.softDeadlineMs,
      memoryBytes: all.memoryBytes,
      stackBytes: all.stackBytes,
      outputBytes: all.outputBytes,
    },
    all.hardDeadlineMs,
  )
}

describe('the worker pool', () => {
  it('terminates a wedged worker at the hard deadline and heals', async () => {
    const pool = new WorkerPool({ size: 2, variant: 'release' })
    onTestFinished(() => pool.shutdown())
    // the engine interrupt is disarmed by a huge soft deadline, so only the
    // host-side watchdog can end this one
    const wedged = await run(pool, 'globalThis.wedge = () => { for (;;) {} }', 'wedge', {
      softDeadlineMs: 60_000,
      hardDeadlineMs: 250,
    }).then(
      () => undefined,
      (problem: PoolProblem) => problem,
    )
    expect(wedged).toEqual({ kind: 'hard-timeout', reason: 'watchdog' })
    const healed = await run(pool, 'globalThis.ok = () => "alive"', 'ok')
    expect(healed.verdict).toBe('completed')
    expect(healed.value).toBe('alive')
  }, 30_000)

  it('queues beyond the pool size and completes everything', async () => {
    const pool = new WorkerPool({ size: 2, variant: 'release' })
    onTestFinished(() => pool.shutdown())
    const artifact =
      'globalThis.spinFor = () => { let n = 0; for (let i = 0; i < 2_000_000; i++) n += i; return n > 0 ? "spun" : "idle" }'
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        run(pool, artifact, 'spinFor', { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 }),
      ),
    )
    for (const response of results) {
      expect(response.verdict).toBe('completed')
      expect(response.value).toBe('spun')
    }
  }, 30_000)

  it('refuses work after shutdown', async () => {
    const pool = new WorkerPool({ size: 1, variant: 'release' })
    const first = await run(pool, 'globalThis.ok = () => "one"', 'ok')
    expect(first.verdict).toBe('completed')
    await pool.shutdown()
    const afterClose = await run(pool, 'globalThis.ok = () => "one"', 'ok').then(
      () => undefined,
      (problem: PoolProblem) => problem,
    )
    expect(afterClose).toEqual({ kind: 'worker-lost', reason: 'pool is shut down' })
  }, 30_000)
})
