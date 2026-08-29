/**
 * One evaluation, from the wire's point of view: validate everything again
 * (whatever connects to this socket is not a friend), run the engine pool,
 * and answer with the typed wire errors. The trusted server did the same
 * checks before paying the round trip; this side cannot know that.
 */

import { Effect } from 'effect'
import {
  ENTRYPOINT as ENGINE_ENTRYPOINT,
  type InvokeResponse,
  type JsonValue,
  type PoolProblem,
  type WorkerPool,
} from '@qualy/sandbox-engine'
import {
  SANDBOX_RPC_ENVELOPE_BUDGET,
  SandboxArtifactMismatch,
  SandboxArtifactTooLarge,
  SandboxEvalFailed,
  SandboxInputTooLarge,
  SandboxLimitsRefused,
  SandboxMemoryExceeded,
  SandboxOutputTooLarge,
  SandboxStackExceeded,
  SandboxTimeout,
  SandboxWorkerLost,
  limitIssue,
  type RuntimeSandboxError,
  type SandboxLimits,
} from '@qualy/sandbox-rpc'
import { createHash } from 'node:crypto'

export interface WireInvoke {
  readonly artifact: string
  readonly artifactSha256: string
  readonly entrypoint: string
  readonly argumentsJson: string
  readonly limits: SandboxLimits
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const settled = (
  response: InvokeResponse,
): Effect.Effect<{ output: string }, RuntimeSandboxError> => {
  switch (response.verdict) {
    case 'completed': {
      const output = response.value ?? ''
      // the engine capped the output's SIZE; a hostile escaping density
      // could still blow the transport frame, and an oversized frame closes
      // the whole connection - refuse before writing, mirroring the client
      const encodedBytes = Buffer.byteLength(JSON.stringify({ output }), 'utf8')
      if (encodedBytes > SANDBOX_RPC_ENVELOPE_BUDGET)
        return Effect.fail(new SandboxOutputTooLarge())
      return Effect.succeed({ output })
    }
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

const lost = (problem: PoolProblem): RuntimeSandboxError =>
  problem.kind === 'hard-timeout'
    ? new SandboxTimeout({ phase: 'hard' })
    : new SandboxWorkerLost({ reason: problem.reason })

export const invoke = (
  pool: WorkerPool,
  request: WireInvoke,
): Effect.Effect<{ output: string }, RuntimeSandboxError> => {
  const wrong = limitIssue(request.limits)
  if (wrong !== undefined) return Effect.fail(new SandboxLimitsRefused({ issue: wrong }))
  if (!ENGINE_ENTRYPOINT.test(request.entrypoint))
    return Effect.fail(
      new SandboxEvalFailed({ name: 'TypeError', message: 'entrypoint is not an identifier' }),
    )
  const artifactBytes = Buffer.byteLength(request.artifact, 'utf8')
  if (artifactBytes > request.limits.artifactBytes)
    return Effect.fail(
      new SandboxArtifactTooLarge({ bytes: artifactBytes, limit: request.limits.artifactBytes }),
    )
  const inputBytes = Buffer.byteLength(request.argumentsJson, 'utf8')
  if (inputBytes > request.limits.inputBytes)
    return Effect.fail(
      new SandboxInputTooLarge({ bytes: inputBytes, limit: request.limits.inputBytes }),
    )
  const actual = sha256(request.artifact)
  if (actual !== request.artifactSha256)
    return Effect.fail(new SandboxArtifactMismatch({ expected: request.artifactSha256, actual }))
  let parsed: unknown
  try {
    parsed = JSON.parse(request.argumentsJson)
  } catch {
    parsed = undefined
  }
  if (!Array.isArray(parsed))
    return Effect.fail(
      new SandboxEvalFailed({ name: 'TypeError', message: 'arguments are not a json array' }),
    )
  return Effect.tryPromise({
    try: () =>
      pool.run(
        {
          id: pool.nextId(),
          artifact: request.artifact,
          entrypoint: request.entrypoint,
          arguments: parsed as readonly JsonValue[],
          softDeadlineMs: request.limits.softDeadlineMs,
          memoryBytes: request.limits.memoryBytes,
          stackBytes: request.limits.stackBytes,
          outputBytes: request.limits.outputBytes,
        },
        request.limits.hardDeadlineMs,
      ),
    catch: (problem) => lost(problem as PoolProblem),
  }).pipe(Effect.flatMap(settled))
}
