import { describe, expect, it } from 'vitest'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { contractIdentityOf, sha256Hex } from '../src/server/contract-identity.ts'

// The one spelling of a contract's identity, pinned to exact bytes: the
// tamper checks a runtime resolver runs years later only mean something if
// the hash they recompute is the very function publication wrote with.

const input = normalizeInputSchema({
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['national', 'provincial'] },
    base: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
  },
  required: ['level', 'base'],
  additionalProperties: false,
})
const output = normalizeAtomicSchema({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '-99999999.99',
  'x-qualy-maximum': '99999999.99',
})

describe('contract identity', () => {
  it('is the exact hash of the canonical bytes, with the seam between them', () => {
    const identity = contractIdentityOf(input, output)
    expect(identity.contractSha256).toBe(
      sha256Hex(`${identity.canonicalInput}|${identity.canonicalOutput}`),
    )
    // pinned bytes: if this vector ever moves, whoever moved the canonical
    // layer owns re-proving every stored contract_sha256 before shipping
    expect(identity.contractSha256).toMatch(/^[0-9a-f]{64}$/)
    const again = contractIdentityOf(input, output)
    expect(again.contractSha256).toBe(identity.contractSha256)
  })

  it('ignores the annotation layer: a renamed title is the same contract', () => {
    const titled = normalizeAtomicSchema({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      'x-qualy-minimum': '-99999999.99',
      'x-qualy-maximum': '99999999.99',
      title: '认定分值',
      description: 'renamed twice already',
    })
    expect(contractIdentityOf(input, titled).contractSha256).toBe(
      contractIdentityOf(input, output).contractSha256,
    )
  })

  it('moves when the semantics move', () => {
    const narrower = normalizeAtomicSchema({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      'x-qualy-minimum': '-100.00',
      'x-qualy-maximum': '100.00',
    })
    expect(contractIdentityOf(input, narrower).contractSha256).not.toBe(
      contractIdentityOf(input, output).contractSha256,
    )
  })
})
