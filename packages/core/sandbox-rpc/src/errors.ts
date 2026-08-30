/**
 * The runtime sandbox's wire errors. Schema-tagged because they cross a
 * process boundary and must be decoded, but they are NOT HTTP wire codes:
 * the plugin adapter translates them back into its host-internal error
 * family before any business code sees them.
 */

import { Schema } from 'effect'

export class SandboxTimeout extends Schema.TaggedError<SandboxTimeout>()('SandboxTimeout', {
  phase: Schema.Literals(['soft', 'hard']),
}) {}

export class SandboxMemoryExceeded extends Schema.TaggedError<SandboxMemoryExceeded>()(
  'SandboxMemoryExceeded',
  {},
) {}

export class SandboxStackExceeded extends Schema.TaggedError<SandboxStackExceeded>()(
  'SandboxStackExceeded',
  {},
) {}

export class SandboxOutputTooLarge extends Schema.TaggedError<SandboxOutputTooLarge>()(
  'SandboxOutputTooLarge',
  {},
) {}

export class SandboxArtifactTooLarge extends Schema.TaggedError<SandboxArtifactTooLarge>()(
  'SandboxArtifactTooLarge',
  { bytes: Schema.Number, limit: Schema.Number },
) {}

export class SandboxInputTooLarge extends Schema.TaggedError<SandboxInputTooLarge>()(
  'SandboxInputTooLarge',
  { bytes: Schema.Number, limit: Schema.Number },
) {}

export class SandboxArtifactMismatch extends Schema.TaggedError<SandboxArtifactMismatch>()(
  'SandboxArtifactMismatch',
  { expected: Schema.String, actual: Schema.String },
) {}

export class SandboxLimitsRefused extends Schema.TaggedError<SandboxLimitsRefused>()(
  'SandboxLimitsRefused',
  { issue: Schema.String },
) {}

export class SandboxEvalFailed extends Schema.TaggedError<SandboxEvalFailed>()(
  'SandboxEvalFailed',
  { name: Schema.String, message: Schema.String },
) {}

export class SandboxWorkerLost extends Schema.TaggedError<SandboxWorkerLost>()(
  'SandboxWorkerLost',
  { reason: Schema.String },
) {}

/**
 * The caller and this runtime do not speak the same protocol. Every invoke
 * names the versions it was compiled against, so a rolling upgrade that
 * swaps the runtime under a live socket is refused per request - never
 * half-understood.
 */
export class SandboxProtocolMismatch extends Schema.TaggedError<SandboxProtocolMismatch>()(
  'SandboxProtocolMismatch',
  {
    callerRpcApiVersion: Schema.Number,
    callerSandboxAbiVersion: Schema.Number,
    runtimeRpcApiVersion: Schema.Number,
    runtimeSandboxAbiVersion: Schema.Number,
  },
) {}

export const invokeErrors = [
  SandboxProtocolMismatch,
  SandboxTimeout,
  SandboxMemoryExceeded,
  SandboxStackExceeded,
  SandboxOutputTooLarge,
  SandboxArtifactTooLarge,
  SandboxInputTooLarge,
  SandboxArtifactMismatch,
  SandboxLimitsRefused,
  SandboxEvalFailed,
  SandboxWorkerLost,
] as const

export type RuntimeSandboxError =
  | SandboxProtocolMismatch
  | SandboxTimeout
  | SandboxMemoryExceeded
  | SandboxStackExceeded
  | SandboxOutputTooLarge
  | SandboxArtifactTooLarge
  | SandboxInputTooLarge
  | SandboxArtifactMismatch
  | SandboxLimitsRefused
  | SandboxEvalFailed
  | SandboxWorkerLost
