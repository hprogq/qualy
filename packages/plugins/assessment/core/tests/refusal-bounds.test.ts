import { describe, expect, it } from 'vitest'
import { boundIssues, MAX_ISSUES } from '../src/issues.ts'
import { ItemPayloadInvalid } from '../src/plugin.ts'
import { judgeRecognition } from '../src/scoring/recognition.ts'

// A refusal names what was wrong with a payload, and a payload is whatever
// its caller sent: an object with a hundred thousand unknown keys must not
// come back as a hundred thousand issues, built under the round's lock. The
// evidence driver's own stray-key walk is held in its suite.

const manyKeys = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, index]))

describe('how many problems one refusal names', () => {
  it('bounds a driver refusal however the driver builds it, and says more were cut', () => {
    const issues = Array.from({ length: 1000 }, (_, index) => ({
      field: `k${index}`,
      reason: 'unknown-field',
    }))
    const refused = new ItemPayloadInvalid(issues)
    expect(refused.issues).toHaveLength(MAX_ISSUES + 1)
    expect(refused.issues[MAX_ISSUES]).toEqual({ field: '', reason: 'truncated' })
    // a short list is left exactly as it was
    expect(new ItemPayloadInvalid(issues.slice(0, 3)).issues).toEqual(issues.slice(0, 3))
    expect(boundIssues(issues)).toHaveLength(MAX_ISSUES + 1)
  })

  it('names at most the bound of unknown determination keys', () => {
    const issues = judgeRecognition({}, manyKeys(1000))
    expect(issues).toHaveLength(MAX_ISSUES + 1)
    expect(issues[MAX_ISSUES]).toEqual({ recognitionId: '', reason: 'truncated' })
  })
})
