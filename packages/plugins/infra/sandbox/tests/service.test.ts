import { layer } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import { Sandbox, type SandboxInvocation } from '../src/service.ts'
import { sandboxLocalLayer } from '../src/local.ts'

// The service half over a real engine: what the plugin adds on top of the
// pool — size refusals before any engine work, the artifact hash check,
// verdict-to-error mapping — while the engine's own fence suite lives with
// @qualy/sandbox-engine.
//
// The engine is built once for the file, by `layer`, which owns the scope
// and closes it when the suite ends. `excludeTestServices` keeps the real
// clock: a QuickJS deadline is wall time, and the timeout case below would
// assert nothing on a clock the test could move.

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

const run = (request: SandboxInvocation) =>
  Effect.flatMap(Sandbox, (sandbox) => Effect.result(sandbox.invoke(request)))

const failureOf = (request: SandboxInvocation) =>
  Effect.map(run(request), (outcome) => {
    if (!Result.isFailure(outcome)) throw new Error('expected a refusal')
    return outcome.failure
  })

layer(sandboxLocalLayer({ size: 1, variant: 'release' }), { excludeTestServices: true })(
  'the sandbox service',
  (it) => {
    it.effect('answers through the engine and reports its identity', () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          // generous limits on purpose: this proves the wiring, not the 25ms
          // default's adequacy, and ci runners are slow and cold
          invocation('globalThis.ok = () => "alive"', 'ok', {
            softDeadlineMs: 5_000,
            hardDeadlineMs: 10_000,
          }),
        )
        if (!Result.isSuccess(outcome)) throw new Error('expected an answer')
        expect(outcome.success.output).toBe('alive')
        // provenance rides the answer itself: the identity of the process that
        // actually executed this call, not a cached claim about a previous one
        expect(outcome.success.runtime.engineVersion).toMatch(
          /^@jitl\/quickjs-wasmfile-release-sync@/,
        )
        expect(outcome.success.runtime.runtimeBuildId).toMatch(/^[0-9a-f]{64}$/)
        expect(outcome.success.runtime.instanceId.length).toBeGreaterThan(0)
      }))

    it.effect('refuses an artifact whose hash does not match', () =>
      Effect.gen(function* () {
        const failure = yield* failureOf({
          artifact: 'globalThis.f = () => 1',
          artifactHash: hash('globalThis.f = () => 2'),
          entrypoint: 'f',
          arguments: [],
        })
        expect(failure._tag).toBe('SandboxArtifactMismatch')
      }))

    it.effect('refuses oversized artifacts and inputs before any engine work', () =>
      Effect.gen(function* () {
        const big = `globalThis.f = () => 1; // ${'x'.repeat(300 * 1024)}`
        expect((yield* failureOf(invocation(big, 'f')))._tag).toBe('SandboxArtifactTooLarge')
        const wide = 'y'.repeat(70 * 1024)
        const failure = yield* failureOf({
          artifact: 'globalThis.f = (s) => 1',
          artifactHash: hash('globalThis.f = (s) => 1'),
          entrypoint: 'f',
          arguments: [wide],
        })
        expect(failure._tag).toBe('SandboxInputTooLarge')
      }))

    it.effect('maps engine verdicts onto the typed error family', () =>
      Effect.gen(function* () {
        const timeout = yield* failureOf(
          invocation('globalThis.spin = () => { for (;;) {} }', 'spin'),
        )
        expect(timeout).toMatchObject({ _tag: 'SandboxTimeout', phase: 'soft' })
        const thrown = yield* failureOf(
          invocation('globalThis.f = () => { throw new RangeError("policy says no") }', 'f'),
        )
        expect(thrown).toMatchObject({
          _tag: 'SandboxEvalFailed',
          name: 'RangeError',
          message: 'policy says no',
        })
      }))

    it.effect('refuses a non-identifier entrypoint without reaching the engine', () =>
      Effect.gen(function* () {
        const failure = yield* failureOf(invocation('globalThis.f = () => 1', 'f(); spin'))
        expect(failure._tag).toBe('SandboxEvalFailed')
      }))
  },
)
