import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Sandbox, sandboxLayer, type SandboxInvocation } from '../src/service.ts'

// The pool as a resource: the hard watchdog replaces a wedged worker, load
// beyond the pool size queues rather than fails, and closing the scope is
// the end — nothing accepts work afterwards.

const hash = (artifact: string): string =>
  createHash('sha256').update(artifact, 'utf8').digest('hex')

const invocation = (
  artifact: string,
  entrypoint: string,
  limits?: SandboxInvocation['limits'],
): SandboxInvocation => ({
  artifact,
  artifactHash: hash(artifact),
  entrypoint,
  arguments: [],
  ...(limits === undefined ? {} : { limits }),
})

let scope: Scope.Scope
let context: Context.Context<Sandbox>

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  context = await Effect.runPromise(
    Layer.buildWithScope(sandboxLayer({ size: 2, variant: 'release' }), scope),
  )
})

afterAll(() => Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void)))

const run = (request: SandboxInvocation) =>
  Effect.runPromise(
    Effect.flatMap(Sandbox, (sandbox) => Effect.result(sandbox.invoke(request))).pipe(
      Effect.provide(context),
    ),
  )

describe('the worker pool', () => {
  it('terminates a wedged worker at the hard deadline and heals', async () => {
    // the engine interrupt is disarmed by a huge soft deadline, so only the
    // host-side watchdog can end this one
    const outcome = await run(
      invocation('globalThis.wedge = () => { for (;;) {} }', 'wedge', {
        softDeadlineMs: 60_000,
        hardDeadlineMs: 250,
      }),
    )
    if (!Result.isFailure(outcome)) throw new Error('expected the watchdog')
    expect(outcome.failure).toMatchObject({ _tag: 'SandboxTimeout', phase: 'hard' })
    const healed = await run(invocation('globalThis.ok = () => 1', 'ok'))
    expect(Result.isSuccess(healed) && healed.success).toBe(1)
  }, 30_000)

  it('queues beyond the pool size and completes everything', async () => {
    const artifact =
      'globalThis.spinFor = (ms) => { let n = 0; for (let i = 0; i < 2_000_000; i++) n += i; return n > 0 }'
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        run({
          artifact,
          artifactHash: hash(artifact),
          entrypoint: 'spinFor',
          arguments: [50],
          limits: { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
        }),
      ),
    )
    for (const outcome of results) {
      expect(Result.isSuccess(outcome) && outcome.success).toBe(true)
    }
  }, 30_000)

  it('refuses work after its scope closes', async () => {
    const ownScope = await Effect.runPromise(Scope.make())
    const ownContext = await Effect.runPromise(
      Layer.buildWithScope(sandboxLayer({ size: 1, variant: 'release' }), ownScope),
    )
    const first = await Effect.runPromise(
      Effect.flatMap(Sandbox, (sandbox) =>
        Effect.result(sandbox.invoke(invocation('globalThis.ok = () => 1', 'ok'))),
      ).pipe(Effect.provide(ownContext)),
    )
    expect(Result.isSuccess(first)).toBe(true)
    await Effect.runPromise(Scope.close(ownScope as Scope.Closeable, Exit.void))
    const afterClose = await Effect.runPromise(
      Effect.flatMap(Sandbox, (sandbox) =>
        Effect.result(sandbox.invoke(invocation('globalThis.ok = () => 1', 'ok'))),
      ).pipe(Effect.provide(ownContext)),
    )
    if (!Result.isFailure(afterClose)) throw new Error('expected a refusal after close')
    expect(afterClose.failure._tag).toBe('SandboxWorkerLost')
  }, 30_000)
})
