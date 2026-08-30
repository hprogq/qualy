import { engineIdentity, runtimeBuildId } from '@qualy/sandbox-engine'
import {
  DEFAULT_LIMITS,
  LIMIT_CEILINGS,
  RPC_API_VERSION,
  SANDBOX_ABI_VERSION,
  SANDBOX_RPC_ENVELOPE_BUDGET,
  SANDBOX_RPC_MAX_FRAME_BYTES,
} from '@qualy/sandbox-rpc'

/**
 * What this serving process claims about itself, in one place a test can
 * hold still. Two families of numbers, deliberately side by side:
 *
 * maxArtifactBytes / maxArgumentsBytes / maxOutputBytes are RAW RESOURCE
 * ceilings - the most a limits object may ask the engine for. They are NOT
 * a promise that a payload of that size is transportable.
 *
 * maxFrameBytes / maxEnvelopeBytes are the TRANSPORT ceilings: one NDJSON
 * frame, and what a message body may encode to inside it. What is actually
 * sendable is decided by the authoritative encoded-envelope gate both roles
 * run - a request is artifact + arguments + hashes + limits + envelope,
 * and escaping density is the payload's own affair - so no raw number here
 * can stand in for that measurement.
 */
export const runtimeCapabilities = (runtimeInstanceId: string) => ({
  rpcApiVersion: RPC_API_VERSION,
  sandboxAbiVersion: SANDBOX_ABI_VERSION,
  quickjsEngineVersion: engineIdentity(),
  runtimeBuildId: runtimeBuildId(),
  runtimeInstanceId,
  maxArtifactBytes: LIMIT_CEILINGS.artifactBytes,
  maxArgumentsBytes: LIMIT_CEILINGS.inputBytes,
  maxOutputBytes: LIMIT_CEILINGS.outputBytes,
  maxFrameBytes: SANDBOX_RPC_MAX_FRAME_BYTES,
  maxEnvelopeBytes: SANDBOX_RPC_ENVELOPE_BUDGET,
  defaultSoftDeadlineMs: DEFAULT_LIMITS.softDeadlineMs,
  defaultHardDeadlineMs: DEFAULT_LIMITS.hardDeadlineMs,
})
