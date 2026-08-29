/**
 * The sandbox service: resource-limited, deterministic execution of a
 * self-contained artifact. Business-blind on purpose — no tenant, no item,
 * no version ids; the caller knows its context, this service only knows how
 * to run code safely.
 *
 * The worker pool is the one scoped resource: acquired when the layer
 * builds, workers spawned lazily on first use, all of them terminated when
 * the host's scope closes.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Context, Effect, Layer } from 'effect'
import {
  SandboxArtifactMismatch,
  SandboxArtifactTooLarge,
  SandboxEvalFailed,
  SandboxInputTooLarge,
  SandboxMemoryExceeded,
  SandboxOutputTooLarge,
  SandboxStackExceeded,
  SandboxTimeout,
  SandboxWorkerLost,
  type SandboxError,
} from './errors.ts'
import { WorkerPool, type PoolProblem } from './pool.ts'
import {
  DEFAULT_LIMITS,
  ENTRYPOINT,
  type InvokeResponse,
  type JsonValue,
  type SandboxLimits,
} from './protocol.ts'

export interface SandboxInvocation {
  /** the complete, self-contained program; nothing else will be resolvable */
  readonly artifact: string
  /** sha-256 hex of the artifact; refused when it does not match */
  readonly artifactHash: string
  /** a global identifier the artifact defined */
  readonly entrypoint: string
  readonly arguments: readonly JsonValue[]
  readonly limits?: Partial<SandboxLimits>
}

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly invoke: (invocation: SandboxInvocation) => Effect.Effect<JsonValue, SandboxError>
    /** the engine's identity, for callers that freeze toolchains into records */
    readonly engine: string
  }
>()('@qualy/plugin-sandbox/Sandbox') {}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const engineIdentity = (): string => {
  const manifest = createRequire(import.meta.url)(
    '@jitl/quickjs-wasmfile-release-sync/package.json',
  ) as { name: string; version: string }
  return `${manifest.name}@${manifest.version}`
}

const refuseOversize = (
  invocation: SandboxInvocation,
  limits: SandboxLimits,
): SandboxError | undefined => {
  const artifactBytes = Buffer.byteLength(invocation.artifact, 'utf8')
  if (artifactBytes > limits.artifactBytes)
    return new SandboxArtifactTooLarge({ bytes: artifactBytes, limit: limits.artifactBytes })
  const inputBytes = Buffer.byteLength(JSON.stringify(invocation.arguments), 'utf8')
  if (inputBytes > limits.inputBytes)
    return new SandboxInputTooLarge({ bytes: inputBytes, limit: limits.inputBytes })
  return undefined
}

const settled = (response: InvokeResponse): Effect.Effect<JsonValue, SandboxError> => {
  switch (response.verdict) {
    case 'completed':
      return Effect.succeed(response.value ?? null)
    case 'interrupted':
      return Effect.fail(new SandboxTimeout({ phase: 'soft' }))
    case 'out-of-memory':
      return Effect.fail(new SandboxMemoryExceeded())
    case 'stack-overflow':
      return Effect.fail(new SandboxStackExceeded())
    case 'output-too-large':
      return Effect.fail(new SandboxOutputTooLarge())
    case 'eval-failed':
      return Effect.fail(
        new SandboxEvalFailed({
          name: response.problem?.name ?? 'Error',
          message: response.problem?.message ?? 'evaluation failed',
        }),
      )
  }
}

const lost = (problem: PoolProblem): SandboxError =>
  problem.kind === 'hard-timeout'
    ? new SandboxTimeout({ phase: 'hard' })
    : new SandboxWorkerLost({ reason: problem.reason })

export const sandboxLayer = (options?: {
  readonly size?: number
  readonly variant?: 'release' | 'debug'
}): Layer.Layer<Sandbox> =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WorkerPool({ size: options?.size ?? 2, variant: options?.variant ?? 'release' }),
        ),
        (acquired) => Effect.promise(() => acquired.shutdown()),
      )
      const invoke = (invocation: SandboxInvocation): Effect.Effect<JsonValue, SandboxError> => {
        const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...invocation.limits }
        if (!ENTRYPOINT.test(invocation.entrypoint))
          return Effect.fail(
            new SandboxEvalFailed({
              name: 'TypeError',
              message: 'entrypoint is not an identifier',
            }),
          )
        const oversize = refuseOversize(invocation, limits)
        if (oversize !== undefined) return Effect.fail(oversize)
        const actual = sha256(invocation.artifact)
        if (actual !== invocation.artifactHash)
          return Effect.fail(
            new SandboxArtifactMismatch({ expected: invocation.artifactHash, actual }),
          )
        return Effect.tryPromise({
          try: () =>
            pool.run(
              {
                id: pool.nextId(),
                artifact: invocation.artifact,
                entrypoint: invocation.entrypoint,
                arguments: invocation.arguments,
                softDeadlineMs: limits.softDeadlineMs,
                memoryBytes: limits.memoryBytes,
                stackBytes: limits.stackBytes,
                outputBytes: limits.outputBytes,
              },
              limits.hardDeadlineMs,
            ),
          catch: (problem) => lost(problem as PoolProblem),
        }).pipe(Effect.flatMap(settled))
      }
      return { invoke, engine: engineIdentity() }
    }),
  )

export const serviceLayer: Layer.Layer<Sandbox> = sandboxLayer()
