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
    },
    success: Schema.Struct({ output: Schema.String }),
    error: Schema.Union(invokeErrors),
  }),
)
