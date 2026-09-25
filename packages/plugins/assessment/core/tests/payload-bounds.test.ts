import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { assessmentApiGroup, MAX_PLAN_PHASES, MAX_SCORE_GROUPS } from '../src/api.ts'
import { BATCH_STAFF_CODES } from '../src/permissions.ts'

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

// The zone is bound into AT TIME ZONE, and the platform and PostgreSQL read
// some spellings differently: `+08:00` is UTC+8 to one and UTC-8 to the
// other, `+0800` and legacy aliases such as `CTT` are refused by the
// database outright. Only region names reach the service.
describe('a batch time zone', () => {
  const update = payloadOf('updateBatch')
  const create = payloadOf('createBatch')
  const creating = (timezone: string) => ({
    name: 'Zone',
    materialRange: { start: '2026-03-01', end: '2026-09-01' },
    timezone,
    import: { orgNodeIds: [id(1)], userTypeIds: [id(2)] },
  })

  it('takes a region name', () => {
    for (const timezone of [
      'UTC',
      'Asia/Shanghai',
      'Etc/GMT-8',
      'America/Argentina/Buenos_Aires',
    ]) {
      expect(accepts(update, { timezone }), timezone).toBe(true)
    }
    expect(accepts(create, creating('Asia/Shanghai'))).toBe(true)
  })

  it('refuses an offset or an alias the two sides read differently', () => {
    for (const timezone of ['+0800', '+08:00', '+08', '-0530', 'CTT', 'CST', 'PRC']) {
      expect(accepts(update, { timezone }), timezone).toBe(false)
    }
    expect(accepts(create, creating('+08:00'))).toBe(false)
  })
})

// Every person-by-unit pair of a staffing selection is its own authorization
// question, and the list of people had no bound at all: one request could
// ask thousands of them.
describe('the roles a staffing selection could be offered', () => {
  const options = queryOf('staffOptions')
  const ids = (count: number) => Array.from({ length: count }, (_, index) => id(index))

  it('takes one id, or as many as the write takes', () => {
    // a query parameter named once arrives as a single value
    expect(accepts(options, { userIds: id(1), orgNodeIds: id(2) })).toBe(true)
    expect(accepts(options, { userIds: ids(200), orgNodeIds: ids(200) })).toBe(true)
  })

  it('refuses more than that', () => {
    expect(accepts(options, { userIds: ids(201) })).toBe(false)
    expect(accepts(options, { orgNodeIds: ids(201) })).toBe(false)
  })
})

// A sync names changes the round offers, each with the capabilities to take
// from it. Neither list had a bound: the selection is walked change by
// change under the batch lock.
describe('a staff sync selection', () => {
  const sync = payloadOf('applyAccessSync')
  const choice = (n: number, permissions: readonly string[] = ['assessment.review.process']) => ({
    kind: 'new',
    id: id(n),
    permissions,
  })

  it('takes a roster-sized selection of changes', () => {
    const accept = Array.from({ length: 5000 }, (_, index) => choice(index))
    expect(accepts(sync, { accept })).toBe(true)
    expect(accepts(sync, { accept: [...accept, choice(5000)] })).toBe(false)
  })

  it('takes no more capabilities for one change than a batch accepts', () => {
    const many = Array.from(
      { length: BATCH_STAFF_CODES.length + 1 },
      () => 'assessment.review.process',
    )
    expect(accepts(sync, { accept: [choice(1, many.slice(0, -1))] })).toBe(true)
    expect(accepts(sync, { accept: [choice(1, many)] })).toBe(false)
  })
})

// The paper's tree arrives whole, and every group is walked up to the top
// looking for a cycle before any of it is written under the batch lock.
describe('a score group tree', () => {
  const put = payloadOf('replaceScoreGroups')
  const groups = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      parentGroupId: null,
      name: `Group ${index + 1}`,
      cap: null,
      floor: null,
    }))

  it('holds as many groups as a paper may, and no more', () => {
    expect(accepts(put, { groups: groups(MAX_SCORE_GROUPS), expectedVersion: 1 })).toBe(true)
    expect(accepts(put, { groups: groups(MAX_SCORE_GROUPS + 1), expectedVersion: 1 })).toBe(false)
  })
})
