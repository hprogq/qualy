import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkerPool } from '@qualy/sandbox-engine'
import { DEFAULT_LIMITS, RPC_API_VERSION, SANDBOX_ABI_VERSION } from '@qualy/sandbox-rpc'
import { invoke } from '../src/invoke.ts'

// What the runtime tells its caller about the time inside a call. The caller
// has no other way to see it - the runtime is on no network - so the answer
// says how long the call waited for a worker and how long it ran there.

const artifact =
  'globalThis.score = (input) => JSON.stringify({ doubled: JSON.parse(input).n * 2 })'

let pool: WorkerPool
beforeAll(() => {
  pool = new WorkerPool({ size: 1, variant: 'release' })
})
afterAll(() => pool.shutdown())

describe('an invocation’s answer', () => {
  it('says how long it waited for a worker and how long it ran', async () => {
    const answer = await Effect.runPromise(
      invoke(pool, {
        artifact,
        artifactSha256: createHash('sha256').update(artifact, 'utf8').digest('hex'),
        entrypoint: 'score',
        argumentsJson: JSON.stringify(['{"n":21}']),
        limits: { ...DEFAULT_LIMITS, softDeadlineMs: 5_000, hardDeadlineMs: 15_000 },
        rpcApiVersion: RPC_API_VERSION,
        sandboxAbiVersion: SANDBOX_ABI_VERSION,
      }),
    )
    expect(JSON.parse(answer.output)).toEqual({ doubled: 42 })
    // a cold pool: the wait includes the worker coming up, and it ran after
    expect(answer.timings.queueMs).toBeGreaterThan(0)
    expect(answer.timings.executeMs).toBeGreaterThan(0)
  }, 30_000)
})
