import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Sandbox, sandboxLayer, type SandboxInvocation } from '../src/service.ts'
import type { SandboxError } from '../src/errors.ts'
import type { JsonValue } from '../src/protocol.ts'

// The stage-three gate, run against BOTH engine builds: the release variant
// that scores in production and the debug variant with the engine's own
// assertions on. Every case is about the fence, not the happy path — what a
// hostile or broken artifact can reach, exhaust or observe.

const variants = ['release', 'debug'] as const

const hash = (artifact: string): string =>
  createHash('sha256').update(artifact, 'utf8').digest('hex')

for (const variant of variants) {
  describe(`the ${variant} engine`, () => {
    // the debug build runs the engine's own assertions and is slower by more
    // than an order of magnitude; it verifies the fence's SEMANTICS, while
    // the 25ms default's adequacy is the release rows' business
    const slack = variant === 'debug' ? { softDeadlineMs: 2_000, hardDeadlineMs: 15_000 } : {}

    const invocation = (
      artifact: string,
      entrypoint: string,
      args: readonly JsonValue[] = [],
      limits?: SandboxInvocation['limits'],
    ): SandboxInvocation => ({
      artifact,
      artifactHash: hash(artifact),
      entrypoint,
      arguments: args,
      limits: { ...slack, ...limits },
    })
    let scope: Scope.Scope
    let context: Context.Context<Sandbox>
    beforeAll(async () => {
      scope = await Effect.runPromise(Scope.make())
      context = await Effect.runPromise(
        Layer.buildWithScope(sandboxLayer({ size: 1, variant }), scope),
      )
    })
    afterAll(() => Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void)))

    const run = (request: SandboxInvocation) =>
      Effect.runPromise(
        Effect.flatMap(Sandbox, (sandbox) => Effect.result(sandbox.invoke(request))).pipe(
          Effect.provide(context),
        ),
      )

    const failureOf = async (request: SandboxInvocation): Promise<SandboxError> => {
      const outcome = await run(request)
      if (!Result.isFailure(outcome)) throw new Error('expected a refusal')
      return outcome.failure
    }

    const valueOf = async (request: SandboxInvocation): Promise<JsonValue> => {
      const outcome = await run(request)
      if (!Result.isSuccess(outcome)) throw new Error(`refused: ${JSON.stringify(outcome)}`)
      return outcome.success
    }

    it('evaluates an entrypoint with json arguments and a json result', async () => {
      const value = await valueOf(
        invocation(
          'globalThis.score = (input) => JSON.stringify({ doubled: JSON.parse(input).n * 2 })',
          'score',
          ['{"n":21}'],
        ),
      )
      expect(JSON.parse(value as string)).toEqual({ doubled: 42 })
    })

    it('supports bigint arithmetic, which the decimal runtime rests on', async () => {
      const value = await valueOf(
        invocation('globalThis.big = () => (10n ** 20n + 1n).toString()', 'big'),
      )
      expect(value).toBe('100000000000000000001')
    })

    it('stops an infinite loop by the soft deadline', async () => {
      const failure = await failureOf(invocation('globalThis.spin = () => { for (;;) {} }', 'spin'))
      expect(failure).toMatchObject({ _tag: 'SandboxTimeout', phase: 'soft' })
    })

    it('stops an allocation bomb, and the pool heals afterwards', async () => {
      const failure = await failureOf(
        invocation(
          'globalThis.bomb = () => { const a = []; for (;;) a.push(new Array(65536).fill(1)) }',
          'bomb',
          [],
          { softDeadlineMs: 10_000, hardDeadlineMs: 30_000 },
        ),
      )
      if (variant === 'release') {
        expect(failure._tag).toBe('SandboxMemoryExceeded')
      } else {
        // the debug build's sanitizer allocator bypasses the engine's own
        // memory accounting: the bomb runs to the 2GiB WASM ceiling and the
        // worker aborts. The fence still holds — the attempt dies and the
        // worker is retired — but the verdict is coarser, which is one more
        // reason production only ever runs the release variant.
        expect(['SandboxEvalFailed', 'SandboxWorkerLost', 'SandboxTimeout']).toContain(failure._tag)
      }
      // whichever engine, the pool replaced the retired worker and serves on
      expect(await valueOf(invocation('globalThis.ok = () => "alive"', 'ok'))).toBe('alive')
    }, 60_000)

    it('stops unbounded recursion at the stack limit', async () => {
      const failure = await failureOf(
        invocation('globalThis.deep = function deep() { return deep() }', 'deep'),
      )
      expect(failure._tag).toBe('SandboxStackExceeded')
    })

    it('refuses an oversized result', async () => {
      const failure = await failureOf(
        invocation("globalThis.wide = () => 'x'.repeat(100000)", 'wide'),
      )
      expect(failure._tag).toBe('SandboxOutputTooLarge')
    })

    it('leaves no clock, no randomness, no host surface', async () => {
      const value = await valueOf(
        invocation(
          `globalThis.probe = () => [
            typeof Date, typeof fetch, typeof setTimeout, typeof setInterval,
            typeof process, typeof require, typeof WebAssembly, typeof eval, typeof Function,
          ].join()`,
          'probe',
        ),
      )
      expect(value).toBe(
        'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined',
      )
      const random = await failureOf(invocation('globalThis.r = () => Math.random()', 'r'))
      expect(random).toMatchObject({
        _tag: 'SandboxEvalFailed',
        message: 'Math.random is not available',
      })
    })

    it('carries no state from one evaluation to the next', async () => {
      const plant = 'globalThis.plant = () => { globalThis.leak = 42; return "planted" }'
      expect(await valueOf(invocation(plant, 'plant'))).toBe('planted')
      const observe = 'globalThis.observe = () => typeof globalThis.leak'
      expect(await valueOf(invocation(observe, 'observe'))).toBe('undefined')
    })

    it('never resolves an async result: pending jobs are not pumped', async () => {
      const value = await valueOf(
        invocation(
          'globalThis.later = () => { let seen = "never ran"; Promise.resolve().then(() => { seen = "ran" }); return seen }',
          'later',
        ),
      )
      expect(value).toBe('never ran')
    })

    it('refuses an artifact whose hash does not match', async () => {
      const failure = await failureOf({
        artifact: 'globalThis.f = () => 1',
        artifactHash: hash('globalThis.f = () => 2'),
        entrypoint: 'f',
        arguments: [],
      })
      expect(failure._tag).toBe('SandboxArtifactMismatch')
    })

    it('refuses oversized artifacts and inputs before any engine work', async () => {
      const big = `globalThis.f = () => 1; // ${'x'.repeat(300 * 1024)}`
      expect((await failureOf(invocation(big, 'f')))._tag).toBe('SandboxArtifactTooLarge')
      const wide = 'y'.repeat(70 * 1024)
      expect((await failureOf(invocation('globalThis.f = (s) => 1', 'f', [wide])))._tag).toBe(
        'SandboxInputTooLarge',
      )
    })

    it('reports a thrown evaluation with its name and message', async () => {
      const failure = await failureOf(
        invocation('globalThis.f = () => { throw new RangeError("policy says no") }', 'f'),
      )
      expect(failure).toMatchObject({
        _tag: 'SandboxEvalFailed',
        name: 'RangeError',
        message: 'policy says no',
      })
    })

    it('keeps the intrinsics the trusted wrapper relies on, whatever the guest does', async () => {
      // a formula's top-level code runs BEFORE the wrapper uses JSON, Math or
      // Object; without the bootstrap lockdown each of these lines would swap
      // the function the trusted side is about to call
      const value = await valueOf(
        invocation(
          `try { JSON.parse = () => { throw new Error('poisoned') } } catch {}
           try { JSON.stringify = () => '"poisoned"' } catch {}
           try { Math.max = () => 0 } catch {}
           try { Number.isSafeInteger = () => false } catch {}
           try { Object.freeze = (x) => x } catch {}
           try { String.prototype.padStart = () => 'poisoned' } catch {}
           globalThis.score = (input) => JSON.stringify({ n: JSON.parse(input).n * 2, m: Math.max(1, 5) })`,
          'score',
          ['{"n":21}'],
        ),
      )
      expect(JSON.parse(value as string)).toEqual({ n: 42, m: 5 })
    })

    it('refuses a non-string answer: the contract is one bounded string', async () => {
      const failure = await failureOf(invocation('globalThis.f = () => ({ big: true })', 'f'))
      expect(failure).toMatchObject({
        _tag: 'SandboxEvalFailed',
        message: 'the entrypoint must return a string',
      })
      const numeric = await failureOf(invocation('globalThis.g = () => 42', 'g'))
      expect(numeric._tag).toBe('SandboxEvalFailed')
    })

    it('refuses a non-identifier entrypoint outright', async () => {
      const failure = await failureOf(invocation('globalThis.f = () => 1', 'f(); spin'))
      expect(failure._tag).toBe('SandboxEvalFailed')
    })
  })
}
