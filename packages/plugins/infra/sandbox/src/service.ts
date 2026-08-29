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
import { Context, Effect, Layer } from 'effect'
import {
  DEFAULT_LIMITS,
  ENTRYPOINT,
  engineIdentity,
  WorkerPool,
  type InvokeResponse,
  type JsonValue,
  type PoolProblem,
  type SandboxLimits,
} from '@qualy/sandbox-engine'
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

/**
 * The sandbox ABI: how an artifact is entered (a global identifier called
 * with json-shaped arguments through engine handles) and how it answers
 * (a single string, length-checked in the guest). Frozen into published
 * formula versions; bump only when this calling convention changes.
 */
export const SANDBOX_ABI_VERSION = 1

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
    readonly invoke: (invocation: SandboxInvocation) => Effect.Effect<string, SandboxError>
    /** the engine's identity, for callers that freeze toolchains into records */
    readonly engine: string
  }
>()('@qualy/plugin-sandbox/Sandbox') {}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

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

const settled = (response: InvokeResponse): Effect.Effect<string, SandboxError> => {
  switch (response.verdict) {
    case 'completed':
      return Effect.succeed(response.value ?? '')
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

const LIMIT_CEILINGS: SandboxLimits = Object.freeze({
  softDeadlineMs: 60_000,
  hardDeadlineMs: 300_000,
  memoryBytes: 512 * 1024 * 1024,
  stackBytes: 8 * 1024 * 1024,
  artifactBytes: 8 * 1024 * 1024,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
})

const limitIssue = (limits: SandboxLimits): string | undefined => {
  for (const key of Object.keys(LIMIT_CEILINGS) as (keyof SandboxLimits)[]) {
    const value = limits[key]
    if (!Number.isSafeInteger(value) || value <= 0) return `${key} must be a positive integer`
    if (value > LIMIT_CEILINGS[key]) return `${key} exceeds ${LIMIT_CEILINGS[key]}`
  }
  // soft above hard is legal on purpose: the two gates are independent, and
  // a caller may trust only the host watchdog by pushing the engine's own
  // interrupt out of reach
  return undefined
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
      const invoke = (invocation: SandboxInvocation): Effect.Effect<string, SandboxError> => {
        const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...invocation.limits }
        // an infra service keeps its own invariants: a caller passing a
        // nonsensical limit is a defect in the caller, not a soft failure
        const wrong = limitIssue(limits)
        if (wrong !== undefined) return Effect.die(new Error(`sandbox limits: ${wrong}`))
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
