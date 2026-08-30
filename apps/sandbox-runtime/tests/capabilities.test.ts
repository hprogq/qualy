import { describe, expect, it } from 'vitest'
import {
  LIMIT_CEILINGS,
  SANDBOX_RPC_ENVELOPE_BUDGET,
  SANDBOX_RPC_MAX_FRAME_BYTES,
} from '@qualy/sandbox-rpc'
import { runtimeCapabilities } from '../src/capabilities.ts'

describe('what the runtime claims about itself', () => {
  it('states the transport ceilings beside the raw resource maxima', () => {
    // the raw maxima are engine resource ceilings; without the transport
    // pair beside them, a reader is invited to believe an 8 MiB payload is
    // sendable through a 2 MiB frame
    const spoken = runtimeCapabilities('instance-under-test')
    expect(spoken.maxFrameBytes).toBe(SANDBOX_RPC_MAX_FRAME_BYTES)
    expect(spoken.maxEnvelopeBytes).toBe(SANDBOX_RPC_ENVELOPE_BUDGET)
    expect(spoken.maxEnvelopeBytes).toBeLessThan(spoken.maxArtifactBytes)
    // and the raw family is exactly what it always was: nothing renamed,
    // nothing reinterpreted, rpc surface still version 1
    expect(spoken.rpcApiVersion).toBe(1)
    expect(spoken.maxArtifactBytes).toBe(LIMIT_CEILINGS.artifactBytes)
    expect(spoken.maxArgumentsBytes).toBe(LIMIT_CEILINGS.inputBytes)
    expect(spoken.maxOutputBytes).toBe(LIMIT_CEILINGS.outputBytes)
    expect(spoken.runtimeInstanceId).toBe('instance-under-test')
  })
})
