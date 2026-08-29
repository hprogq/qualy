import { describe, expect, it } from 'vitest'
import { RpcSerialization } from 'effect/unstable/rpc'
import {
  SANDBOX_RPC_ENVELOPE_BUDGET,
  SANDBOX_RPC_MAX_FRAME_BYTES,
  SOURCE_LIMIT,
} from '../src/index.ts'

// The frame-budget ruling: the largest LEGAL payloads are encoded for real
// and asserted under the ceiling - no arithmetic about escaping overhead.
// The invoke direction is additionally guarded at runtime on both sides
// (measured encodings, remote.test.ts); this pins the compile direction
// and the realistic worst case of each.

const parser = RpcSerialization.makeNdjson().makeUnsafe()

const frameBytes = (message: unknown): number => {
  const encoded = parser.encode(message)
  return Buffer.byteLength(encoded as string, 'utf8')
}

describe('the ndjson frame budget', () => {
  it('carries the largest legal CompileFormula request', () => {
    // worst realistic density: a source full of CJK (3 utf-8 bytes per
    // character, not escaped by JSON) plus heavy quoting
    const source = `${'的'.repeat(Math.floor((SOURCE_LIMIT - 4096) / 3))}${'"\\\\'.repeat(1024)}`
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(SOURCE_LIMIT)
    const bytes = frameBytes({
      _tag: 'Request',
      id: '1',
      tag: 'CompileFormula',
      payload: { source },
      headers: [],
    })
    expect(bytes).toBeLessThan(SANDBOX_RPC_MAX_FRAME_BYTES)
  })

  it('keeps the envelope allowance honest', () => {
    // the two runtime-side guards compare the ENCODED BODY against the
    // envelope budget; the envelope itself must fit in what is left
    const body = { output: 'x'.repeat(64) }
    const overhead =
      frameBytes({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: body } }) -
      Buffer.byteLength(JSON.stringify(body), 'utf8')
    expect(overhead).toBeLessThan(SANDBOX_RPC_MAX_FRAME_BYTES - SANDBOX_RPC_ENVELOPE_BUDGET)
  })
})
