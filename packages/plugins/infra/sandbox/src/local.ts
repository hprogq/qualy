/**
 * The in-process sandbox: the engine pool behind the same Sandbox service
 * the remote adapter provides. This is a TEST STAND-IN, not a supported
 * runtime mode - production assembles the remote layer only, and an
 * unreachable runtime process is an outage, never a reason to run guest
 * code in the business process. Reached via the package's testkit subpath;
 * production source cannot import it (the testkit gate holds that).
 */

import { Effect, Layer } from 'effect'
import {
  engineIdentity,
  WorkerPool,
  type InvokeResponse,
  type PoolProblem,
} from '@qualy/sandbox-engine'
import { DEFAULT_LIMITS, ENTRYPOINT, limitIssue, type SandboxLimits } from '@qualy/sandbox-rpc'
import {
  SandboxArtifactMismatch,
  SandboxEvalFailed,
  SandboxMemoryExceeded,
  SandboxOutputTooLarge,
  SandboxStackExceeded,
  SandboxTimeout,
  SandboxWorkerLost,
  type SandboxError,
} from './errors.ts'
import { refuseOversize, sha256, Sandbox, type SandboxInvocation } from './service.ts'

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

const lost = (problem: PoolProblem): SandboxError =>
  problem.kind === 'hard-timeout'
    ? new SandboxTimeout({ phase: 'hard' })
    : new SandboxWorkerLost({ reason: problem.reason })

export const sandboxLocalLayer = (options?: {
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
      return { invoke, engine: Effect.succeed(engineIdentity()) }
    }),
  )
