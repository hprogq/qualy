import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Sandbox, type SandboxInvocation } from '../src/service.ts'
import { sandboxLocalLayer } from '../src/local.ts'
import type { SandboxError } from '../src/errors.ts'

// The service half over a real engine: what the plugin adds on top of the
// pool — size refusals before any engine work, the artifact hash check,
// verdict-to-error mapping — while the engine's own fence suite lives with
// @qualy/sandbox-engine.

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
    Layer.buildWithScope(sandboxLocalLayer({ size: 1, variant: 'release' }), scope),
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

describe('the sandbox service', () => {
  it('answers through the engine and reports its identity', async () => {
    const outcome = await run(
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
    expect(outcome.success.runtime.engineVersion).toMatch(/^@jitl\/quickjs-wasmfile-release-sync@/)
    expect(outcome.success.runtime.runtimeBuildId).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.success.runtime.instanceId.length).toBeGreaterThan(0)
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
    const failure = await failureOf({
      artifact: 'globalThis.f = (s) => 1',
      artifactHash: hash('globalThis.f = (s) => 1'),
      entrypoint: 'f',
      arguments: [wide],
    })
    expect(failure._tag).toBe('SandboxInputTooLarge')
  })

  it('maps engine verdicts onto the typed error family', async () => {
    const timeout = await failureOf(invocation('globalThis.spin = () => { for (;;) {} }', 'spin'))
    expect(timeout).toMatchObject({ _tag: 'SandboxTimeout', phase: 'soft' })
    const thrown = await failureOf(
      invocation('globalThis.f = () => { throw new RangeError("policy says no") }', 'f'),
    )
    expect(thrown).toMatchObject({
      _tag: 'SandboxEvalFailed',
      name: 'RangeError',
      message: 'policy says no',
    })
  })

  it('refuses a non-identifier entrypoint without reaching the engine', async () => {
    const failure = await failureOf(invocation('globalThis.f = () => 1', 'f(); spin'))
    expect(failure._tag).toBe('SandboxEvalFailed')
  })
})
