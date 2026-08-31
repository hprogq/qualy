import { describe, expect, it } from 'vitest'
import { decodeFormulaEnvelope } from '../src/server/envelope.ts'
import { FORMULA_SCORING_LIMITS } from '../src/scoring/limits.ts'
import { MAX_COMPILED_ARTIFACT_BYTES } from '@qualy/sandbox-rpc'

// The one strict reading of a formula's answer: exactly the protocol's
// keys, nothing riding along, and a malformed answer named rather than
// projected into something plausible.

const reasonOf = (output: string) => {
  const decoded = decodeFormulaEnvelope(output)
  return decoded._tag === 'malformed' ? decoded.reason : undefined
}

describe('reading the formula envelope', () => {
  it('reads both lawful shapes', () => {
    expect(decodeFormulaEnvelope('{"ok":true,"amount":"7.50"}')).toEqual({
      _tag: 'envelope',
      envelope: { ok: true, amount: '7.50' },
    })
    expect(decodeFormulaEnvelope('{"ok":false,"failure":{"message":"no"}}')).toEqual({
      _tag: 'envelope',
      envelope: { ok: false, failure: { message: 'no' } },
    })
  })

  it('refuses everything that is not exactly an envelope', () => {
    for (const wrong of [
      'not json at all',
      '"a string"',
      '[1,2]',
      'null',
      '{"ok":"yes"}',
      '{"ok":true}',
      '{"ok":true,"amount":7}',
      '{"ok":true,"amount":"1","extra":true}',
      '{"ok":false}',
      '{"ok":false,"failure":"no"}',
      '{"ok":false,"failure":{"message":"no","stack":"..."}}',
      '{"ok":false,"failure":{"message":7}}',
      '{"ok":false,"failure":{"message":"no"},"extra":1}',
    ]) {
      expect(reasonOf(wrong), wrong).toBeDefined()
    }
  })

  it('caps a forged message at the protocol limit', () => {
    const long = 'x'.repeat(10_000)
    const decoded = decodeFormulaEnvelope(JSON.stringify({ ok: false, failure: { message: long } }))
    expect(decoded._tag).toBe('envelope')
    if (decoded._tag === 'envelope' && !decoded.envelope.ok) {
      expect(decoded.envelope.failure.message.length).toBe(2048)
    }
  })
})

describe('the scoring budget', () => {
  it('covers every artifact publication admits, and stays explicit elsewhere', () => {
    // publishable must mean executable: without this, a lawfully published
    // large formula would score as too large forever
    expect(FORMULA_SCORING_LIMITS.artifactBytes).toBe(MAX_COMPILED_ARTIFACT_BYTES)
    expect(FORMULA_SCORING_LIMITS.inputBytes).toBeGreaterThan(0)
    expect(FORMULA_SCORING_LIMITS.outputBytes).toBeGreaterThan(0)
    expect(FORMULA_SCORING_LIMITS.hardDeadlineMs).toBeGreaterThanOrEqual(
      FORMULA_SCORING_LIMITS.softDeadlineMs,
    )
  })
})
