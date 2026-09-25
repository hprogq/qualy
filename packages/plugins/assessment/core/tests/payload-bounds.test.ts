import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { assessmentApiGroup, MAX_PLAN_PHASES } from '../src/api.ts'

// What one request may carry.
//
// The request body's own ceiling is 2 MiB, and every list below is walked by
// the service rather than only stored - reviewed against a plan, asked about
// once per element, written row by row under the batch lock. So a list with
// no bound of its own lets the largest question anybody may ask be decided by
// how short an element can be written. These ask the contract, the way the
// server decodes a request before a handler runs: a refusal here is a 400.

type Endpoints = typeof assessmentApiGroup.endpoints

const endpoint = (name: keyof Endpoints) =>
  (assessmentApiGroup.endpoints as Record<string, Endpoints[keyof Endpoints]>)[name]!

/** the json body schema of one endpoint */
const payloadOf = (name: keyof Endpoints) => {
  const [entry] = [...endpoint(name).payload.values()]
  return entry!.schemas[0] as Schema.Codec<unknown, unknown>
}

/** the query schema of one endpoint */
const queryOf = (name: keyof Endpoints) => endpoint(name).query as Schema.Codec<unknown, unknown>

const accepts = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value))

const id = (n: number) => `019fd31f-0a15-7092-b49e-${n.toString(16).padStart(12, '0')}`

describe('a plan write', () => {
  const put = payloadOf('putPhases')
  const phases = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      phaseKey: `stage-${index + 1}`,
      displayName: `Stage ${index + 1}`,
    }))

  it('holds as many phases as a plan may, and no more', () => {
    expect(accepts(put, { phases: phases(MAX_PLAN_PHASES) })).toBe(true)
    expect(accepts(put, { phases: phases(MAX_PLAN_PHASES + 1) })).toBe(false)
  })

  it('opens no more actions than the gate knows', () => {
    const codes = Array.from({ length: 64 }, () => 'assessment.entry.create')
    expect(accepts(put, { phases: [{ ...phases(1)[0], permissionProfile: codes }] })).toBe(false)
  })

  it('bounds a template the same way', () => {
    const create = payloadOf('createTemplate')
    expect(accepts(create, { name: 'Long', phases: phases(MAX_PLAN_PHASES + 1) })).toBe(false)
    expect(accepts(payloadOf('updateTemplate'), { phases: phases(MAX_PLAN_PHASES + 1) })).toBe(
      false,
    )
  })
})

describe('reopening a batch', () => {
  const reopen = payloadOf('setBatchStatus')
  const body = (displayName: string) => ({
    status: 'active',
    reason: 'appeals',
    phase: { displayName },
    plannedEntryAt: null,
  })

  // the name lands in the same column as every other phase name; a longer
  // one got past the contract and failed in postgres as a 500
  it('names the new phase within the column it is written to', () => {
    expect(accepts(reopen, body('x'.repeat(100)))).toBe(true)
    expect(accepts(reopen, body('x'.repeat(101)))).toBe(false)
  })
})

// keeps the helper honest: an id this file builds is one the contract takes
it('builds ids the contract accepts', () => {
  expect(accepts(queryOf('staffOptions'), { userIds: id(1) })).toBe(true)
})
