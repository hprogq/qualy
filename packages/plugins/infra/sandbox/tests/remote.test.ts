import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import {
  Sandbox,
  sandboxLayer,
  type SandboxAnswer,
  type SandboxInvocation,
} from '../src/service.ts'
import { sandboxLocalLayer } from '../src/local.ts'
import type { SandboxError } from '../src/errors.ts'

// Local and remote are the SAME service or the remote one does not ship:
// every invocation below runs through the in-process engine and through a
// real runtime process behind a unix socket, and the outcomes must match
// tag for tag, field for field. After parity, the socket's own failure
// modes: a peer that is absent, hostile or gone mid-call must end in a
// typed refusal on a live process - never a crash, never a hang.

const here = createRequire(import.meta.url)
const runtimeMain = path.join(
  path.dirname(here.resolve('@qualy/sandbox-runtime/package.json')),
  'src',
  'main.ts',
)

const hash = (artifact: string): string =>
  createHash('sha256').update(artifact, 'utf8').digest('hex')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-sandbox-rpc-'))
const socketPath = path.join(tempDir, 'runtime.sock')

const waitForSocket = async (file: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 20_000
  for (;;) {
    if (fs.existsSync(file)) return
    if (child.exitCode !== null)
      throw new Error(`the runtime process exited early with ${child.exitCode}`)
    if (Date.now() > deadline) throw new Error('the runtime socket never appeared')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

let child: ChildProcess
let scope: Scope.Scope
let local: Context.Context<Sandbox>
let remote: Context.Context<Sandbox>

beforeAll(async () => {
  child = spawn(process.execPath, [runtimeMain], {
    env: { ...process.env, QUALY_SANDBOX_RUNTIME_SOCKET: socketPath },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  await waitForSocket(socketPath, child)
  scope = await Effect.runPromise(Scope.make())
  local = await Effect.runPromise(
    Layer.buildWithScope(sandboxLocalLayer({ size: 1, variant: 'release' }), scope),
  )
  remote = await Effect.runPromise(Layer.buildWithScope(sandboxLayer({ socketPath }), scope))
}, 60_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void))
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(undefined)
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
  })
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const runWith = (context: Context.Context<Sandbox>, invocation: SandboxInvocation) =>
  Effect.runPromise(
    Effect.flatMap(Sandbox, (sandbox) => Effect.result(sandbox.invoke(invocation))).pipe(
      Effect.provide(context),
    ),
  )

/** the comparable face of an outcome: the answer's output, or failure tag + data
 * (identity is deliberately not compared: two adapters are two instances) */
const shapeOf = (outcome: Result.Result<SandboxAnswer, SandboxError>): unknown =>
  Result.isSuccess(outcome)
    ? { ok: outcome.success.output }
    : { ...outcome.failure, _tag: outcome.failure._tag }

describe('local/remote parity', () => {
  const invocation = (
    artifact: string,
    entrypoint: string,
    args: readonly string[] = [],
    limits?: SandboxInvocation['limits'],
  ): SandboxInvocation => ({
    artifact,
    artifactHash: hash(artifact),
    entrypoint,
    arguments: args,
    ...(limits === undefined ? {} : { limits }),
  })

  const CASES: readonly (readonly [string, SandboxInvocation])[] = [
    [
      'a completed evaluation',
      invocation(
        'globalThis.ok = (input) => JSON.stringify({ doubled: JSON.parse(input).n * 2 })',
        'ok',
        ['{"n":21}'],
        // cases that expect the engine to FINISH get generous limits: the
        // parity claim is about answers, not a cold ci runner's clock
        { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
      ),
    ],
    [
      'a thrown evaluation',
      invocation('globalThis.f = () => { throw new RangeError("policy says no") }', 'f', [], {
        softDeadlineMs: 5_000,
        hardDeadlineMs: 10_000,
      }),
    ],
    ['a soft timeout', invocation('globalThis.spin = () => { for (;;) {} }', 'spin')],
    [
      'an oversized result',
      invocation("globalThis.wide = () => 'x'.repeat(100000)", 'wide', [], {
        softDeadlineMs: 5_000,
        hardDeadlineMs: 10_000,
      }),
    ],
    [
      'a mismatched artifact hash',
      {
        artifact: 'globalThis.f = () => 1',
        artifactHash: hash('globalThis.f = () => 2'),
        entrypoint: 'f',
        arguments: [],
      },
    ],
    [
      'an oversized artifact',
      invocation(`globalThis.f = () => 1; // ${'x'.repeat(300 * 1024)}`, 'f'),
    ],
    ['a non-identifier entrypoint', invocation('globalThis.f = () => 1', 'f(); spin')],
  ]

  for (const [name, request] of CASES) {
    it(`answers alike: ${name}`, async () => {
      const [ours, theirs] = await Promise.all([runWith(local, request), runWith(remote, request)])
      expect(shapeOf(theirs)).toEqual(shapeOf(ours))
    }, 30_000)
  }

  it('reports the same engine identity on both sides, from the answer itself', async () => {
    const ok = 'globalThis.ok = () => "alive"'
    const request = invocation(ok, 'ok', [], { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 })
    const [ours, theirs] = await Promise.all([runWith(local, request), runWith(remote, request)])
    if (!Result.isSuccess(ours) || !Result.isSuccess(theirs)) throw new Error('expected answers')
    expect(theirs.success.runtime.engineVersion).toBe(ours.success.runtime.engineVersion)
    expect(theirs.success.runtime.runtimeBuildId).toMatch(/^[0-9a-f]{64}$/)
  }, 30_000)
})

describe('the transport frame budget', () => {
  it('refuses a pathological escaping density before it reaches the socket', async () => {
    // one megabyte of control characters json-escapes at 6x: legal content
    // bytes, an oversized frame. The client refuses instead of letting the
    // serializer close the connection under everyone else.
    const payload = '\u0001'.repeat(1024 * 1024 - 64)
    const artifact = `globalThis.f = () => 1; // ${payload}`
    const outcome = await runWith(remote, {
      artifact,
      artifactHash: hash(artifact),
      entrypoint: 'f',
      arguments: [],
      limits: { artifactBytes: 2 * 1024 * 1024 },
    })
    expect(Result.isFailure(outcome) && outcome.failure._tag).toBe('SandboxArtifactTooLarge')
    // and the connection is still whole: the next call answers normally
    const ok = 'globalThis.ok = () => "alive"'
    const after = await runWith(remote, {
      artifact: ok,
      artifactHash: hash(ok),
      entrypoint: 'ok',
      arguments: [],
      limits: { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
    })
    expect(Result.isSuccess(after) && after.success.output).toBe('alive')
  }, 30_000)

  it('refuses a pathological response instead of blowing the frame', async () => {
    // the runtime mirrors the client: an answer whose ENCODING exceeds the
    // frame budget fails as output-too-large, where the local stand-in would
    // happily return it - the stricter side is the transport's own guard
    const artifact = "globalThis.f = () => '\\u0001'.repeat(400 * 1024)"
    const outcome = await runWith(remote, {
      artifact,
      artifactHash: hash(artifact),
      entrypoint: 'f',
      arguments: [],
      limits: {
        outputBytes: 1024 * 1024,
        memoryBytes: 64 * 1024 * 1024,
        softDeadlineMs: 5_000,
        hardDeadlineMs: 10_000,
      },
    })
    expect(Result.isFailure(outcome) && outcome.failure._tag).toBe('SandboxOutputTooLarge')
  }, 30_000)
})

describe('a hostile or absent peer', () => {
  const attempt = (socket: string, timeoutMs: number) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(sandboxLayer({ socketPath: socket }))
      const ok = 'globalThis.ok = () => "alive"'
      return yield* Effect.flatMap(Sandbox, (sandbox) =>
        Effect.result(
          sandbox.invoke({
            artifact: ok,
            artifactHash: hash(ok),
            entrypoint: 'ok',
            arguments: [],
          }),
        ),
      ).pipe(Effect.provide(context))
    }).pipe(
      Effect.scoped,
      Effect.race(Effect.sleep(timeoutMs).pipe(Effect.andThen(Effect.sync(() => 'hung' as const)))),
    )

  const expectTypedRefusal = (
    outcome: Result.Result<SandboxAnswer, SandboxError> | 'hung',
  ): void => {
    expect(outcome).not.toBe('hung')
    if (outcome === 'hung') return
    expect(Result.isFailure(outcome)).toBe(true)
  }

  it('an absent socket is an outage, answered as such', async () => {
    // a request during an outage settles by the transport deadline
    // (hard 100ms + 15s grace); the race above it just catches a true hang
    const outcome = await Effect.runPromise(attempt(path.join(tempDir, 'absent.sock'), 25_000))
    expectTypedRefusal(outcome)
    if (outcome !== 'hung' && Result.isFailure(outcome))
      expect(outcome.failure._tag).toBe('SandboxUnavailable')
  }, 30_000)

  it('a peer speaking garbage fails the call, not the process', async () => {
    const garbagePath = path.join(tempDir, 'garbage.sock')
    const server = net.createServer((connection) => {
      connection.on('error', () => undefined)
      connection.on('data', () => {
        connection.write('not json at all\n{"weird":1}\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(garbagePath, resolve))
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const outcome = await Effect.runPromise(attempt(garbagePath, 20_000))
    expectTypedRefusal(outcome)
  }, 40_000)

  it('a peer slamming the door fails the call, not the process', async () => {
    const slamPath = path.join(tempDir, 'slam.sock')
    const server = net.createServer((connection) => connection.destroy())
    await new Promise<void>((resolve) => server.listen(slamPath, resolve))
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const outcome = await Effect.runPromise(attempt(slamPath, 20_000))
    expectTypedRefusal(outcome)
  }, 40_000)

  it('an oversized inbound frame fails the call, not the process', async () => {
    const floodPath = path.join(tempDir, 'flood.sock')
    const server = net.createServer((connection) => {
      connection.on('error', () => undefined)
      connection.on('data', () => {
        connection.write(`${'x'.repeat(3 * 1024 * 1024)}\n`)
      })
    })
    await new Promise<void>((resolve) => server.listen(floodPath, resolve))
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const outcome = await Effect.runPromise(attempt(floodPath, 20_000))
    expectTypedRefusal(outcome)
  }, 40_000)

  it('the real runtime dying mid-call fails the call and heals on restart', async () => {
    const ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-sandbox-kill-'))
    const ownSocket = path.join(ownDir, 'runtime.sock')
    const boot = (): ChildProcess =>
      spawn(process.execPath, [runtimeMain], {
        env: { ...process.env, QUALY_SANDBOX_RUNTIME_SOCKET: ownSocket },
        stdio: ['ignore', 'ignore', 'inherit'],
      })
    const first = boot()
    await waitForSocket(ownSocket, first)
    const ownScope = await Effect.runPromise(Scope.make())
    try {
      const context = await Effect.runPromise(
        Layer.buildWithScope(sandboxLayer({ socketPath: ownSocket }), ownScope),
      )
      // remember who is serving now: the healed answer must NOT carry this
      const ok0 = 'globalThis.ok = () => "alive"'
      const before = await Effect.runPromise(
        Effect.flatMap(Sandbox, (sandbox) =>
          Effect.result(
            sandbox.invoke({
              artifact: ok0,
              artifactHash: hash(ok0),
              entrypoint: 'ok',
              arguments: [],
              limits: { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
            }),
          ),
        ).pipe(Effect.provide(context)),
      )
      if (!Result.isSuccess(before)) throw new Error('expected the first runtime to answer')
      const firstInstance = before.success.runtime.instanceId

      const spin = 'globalThis.spin = () => { for (;;) {} }'
      const inFlight = Effect.runPromise(
        Effect.flatMap(Sandbox, (sandbox) =>
          Effect.result(
            sandbox.invoke({
              artifact: spin,
              artifactHash: hash(spin),
              entrypoint: 'spin',
              arguments: [],
              limits: { softDeadlineMs: 4_000, hardDeadlineMs: 5_000 },
            }),
          ),
        ).pipe(Effect.provide(context)),
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      first.kill('SIGKILL')
      const outcome = await inFlight
      expect(Result.isFailure(outcome)).toBe(true)

      // a fresh runtime on the same path serves the same client layer again.
      // The ruling is explicit: a request during the outage fails, only
      // requests AFTER the reconnect succeed - so poll until it does.
      fs.rmSync(ownSocket, { force: true })
      const second = boot()
      try {
        await waitForSocket(ownSocket, second)
        const ok = 'globalThis.ok = () => "alive"'
        const deadline = Date.now() + 20_000
        let healed: Result.Result<SandboxAnswer, SandboxError> | undefined
        for (;;) {
          healed = await Effect.runPromise(
            Effect.flatMap(Sandbox, (sandbox) =>
              Effect.result(
                sandbox.invoke({
                  artifact: ok,
                  artifactHash: hash(ok),
                  entrypoint: 'ok',
                  arguments: [],
                  limits: { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
                }),
              ),
            ).pipe(Effect.provide(context)),
          )
          if (Result.isSuccess(healed) || Date.now() > deadline) break
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (!Result.isSuccess(healed!)) throw new Error('expected the reconnect to heal')
        expect(healed.success.output).toBe('alive')
        // the identity is the NEW process's: a cached claim about the first
        // instance would be provenance for a runtime that no longer exists
        expect(healed.success.runtime.instanceId).not.toBe(firstInstance)
        expect(healed.success.runtime.engineVersion.length).toBeGreaterThan(0)
      } finally {
        second.kill('SIGKILL')
      }
    } finally {
      await Effect.runPromise(Scope.close(ownScope as Scope.Closeable, Exit.void))
      fs.rmSync(ownDir, { recursive: true, force: true })
    }
  }, 90_000)
})
