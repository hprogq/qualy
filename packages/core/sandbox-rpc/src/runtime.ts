/**
 * The runtime half of the sandbox protocol: what this engine build IS, and
 * one evaluation. Arguments travel as one JSON string on purpose - the
 * transport gets no second number representation to disagree over.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { invokeErrors } from './errors.ts'
import { SandboxLimitsSchema } from './protocol.ts'

export const RuntimeCapabilities = Schema.Struct({
  rpcApiVersion: Schema.Number,
  sandboxAbiVersion: Schema.Number,
  quickjsEngineVersion: Schema.String,
  /** digest of the engine implementation actually serving; provenance only */
  runtimeBuildId: Schema.String,
  /** minted at process start; distinguishes one serving instance from the next */
  runtimeInstanceId: Schema.String,
  maxArtifactBytes: Schema.Number,
  maxArgumentsBytes: Schema.Number,
  maxOutputBytes: Schema.Number,
  defaultSoftDeadlineMs: Schema.Number,
  defaultHardDeadlineMs: Schema.Number,
})

export const RuntimeSandboxRpcs = RpcGroup.make(
  Rpc.make('GetRuntimeCapabilities', {
    success: RuntimeCapabilities,
  }),
  Rpc.make('Invoke', {
    payload: {
      artifact: Schema.String,
      artifactSha256: Schema.String,
      entrypoint: Schema.String,
      argumentsJson: Schema.String,
      limits: SandboxLimitsSchema,
      // the protocol this request was compiled against: the runtime refuses
      // what it does not speak, so a swapped process can never half-answer
      rpcApiVersion: Schema.Number,
      sandboxAbiVersion: Schema.Number,
    },
    // who actually answered, alongside the answer: provenance read anywhere
    // else can name a process that no longer exists
    success: Schema.Struct({
      output: Schema.String,
      engineVersion: Schema.String,
      runtimeBuildId: Schema.String,
      runtimeInstanceId: Schema.String,
    }),
    error: Schema.Union(invokeErrors),
  }),
)
