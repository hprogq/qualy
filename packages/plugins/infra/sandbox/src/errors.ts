/**
 * How an invocation refuses. These are host-internal errors — the scoring
 * pipeline that calls the sandbox translates them for its own wire — so none
 * carries an HTTP identity. A formula's own structured refusal (q.fail) is
 * not here at all: it travels inside a successful response's value, encoded
 * by the trusted wrapper, and the sandbox never learns it exists.
 */

import { Data } from 'effect'

export class SandboxArtifactTooLarge extends Data.TaggedError('SandboxArtifactTooLarge')<{
  readonly bytes: number
  readonly limit: number
}> {}

export class SandboxInputTooLarge extends Data.TaggedError('SandboxInputTooLarge')<{
  readonly bytes: number
  readonly limit: number
}> {}

export class SandboxArtifactMismatch extends Data.TaggedError('SandboxArtifactMismatch')<{
  readonly expected: string
  readonly actual: string
}> {}

export class SandboxTimeout extends Data.TaggedError('SandboxTimeout')<{
  /** soft: the engine's interrupt fired; hard: the watchdog terminated the worker */
  readonly phase: 'soft' | 'hard'
}> {}

export class SandboxMemoryExceeded extends Data.TaggedError('SandboxMemoryExceeded') {}

export class SandboxStackExceeded extends Data.TaggedError('SandboxStackExceeded') {}

export class SandboxOutputTooLarge extends Data.TaggedError('SandboxOutputTooLarge') {}

export class SandboxWorkerLost extends Data.TaggedError('SandboxWorkerLost')<{
  readonly reason: string
}> {}

export class SandboxEvalFailed extends Data.TaggedError('SandboxEvalFailed')<{
  readonly name: string
  readonly message: string
}> {}

/**
 * The runtime sandbox process cannot be reached, refused the connection, or
 * speaks an incompatible protocol. There is no local fallback on purpose:
 * the operation fails and the caller reports an outage.
 */
export class SandboxUnavailable extends Data.TaggedError('SandboxUnavailable')<{
  readonly reason: string
}> {}

export type SandboxError =
  | SandboxArtifactTooLarge
  | SandboxInputTooLarge
  | SandboxArtifactMismatch
  | SandboxTimeout
  | SandboxMemoryExceeded
  | SandboxStackExceeded
  | SandboxOutputTooLarge
  | SandboxWorkerLost
  | SandboxEvalFailed
  | SandboxUnavailable
