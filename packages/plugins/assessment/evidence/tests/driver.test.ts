import { randomUUID } from 'node:crypto'
import { Effect, Exit, Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { evidenceDriver, evidenceConfig } from '../src/driver.ts'
import { assignmentPlan, normalizeAtomicSchema } from '@qualy/value-schema'
import type { ItemPayloadInvalid } from '@qualy/plugin-assessment/plugin'

// The evidence driver on its own: what an administrator may configure, what
// a student's payload must satisfy, and which attachments a payload cites.
// The first two real item configurations are proven in core's suite, through
// the same validation the configuration api runs.

const batch = { materialRange: { start: '2026-03-01', end: '2026-09-01' } }

const decode = (config: unknown, payload: unknown) =>
  Effect.runSyncExit(evidenceDriver.decodePayload(config, payload, batch))

const issuesOf = (
  exit: Exit.Exit<unknown, unknown>,
): readonly { field: string; reason: string }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: { issues?: [] } }[] }).reasons ?? [])
        .map((entry) => (entry.error as { issues?: [] } | undefined)?.issues ?? [])
        .flat()
    : []

const config = {
  fields: [
    { key: 'certificate-no', type: 'text', label: '证书编号', required: true, maxLength: 64 },
    { key: 'issued-on', type: 'date', label: '签发日期', min: '2026-04-01' },
    { key: 'proof', type: 'attachment', label: '证明材料', required: true, maxCount: 2 },
  ],
}

describe('what an administrator may configure', () => {
  it('accepts the three field kinds and refuses what they cannot mean', () => {
    const decodeConfig = (candidate: unknown) =>
      Effect.runSyncExit(evidenceDriver.decodePayload(candidate, {}, batch).pipe(Effect.asVoid))
    // a readable config with nothing required decodes an empty payload
    expect(
      Exit.isSuccess(decodeConfig({ fields: [{ key: 'note', type: 'text', label: '备注' }] })),
    ).toBe(true)
    // an unreadable config never reaches field checks
    const unreadable = [
      { fields: [] },
      {
        fields: [
          { key: 'a', type: 'text', label: 'A' },
          { key: 'a', type: 'text', label: 'A2' },
        ],
      },
      {
        fields: [
          { key: 'when', type: 'date', label: 'When', min: '2026-05-01', max: '2026-04-01' },
        ],
      },
      { fields: [{ key: 'Bad Key', type: 'text', label: 'x' }] },
      { fields: [{ key: 'file', type: 'attachment', label: 'x', maxCount: 0 }] },
    ]
    for (const candidate of unreadable) {
      const exit = decodeConfig(candidate)
      expect(Exit.isFailure(exit), JSON.stringify(candidate)).toBe(true)
      expect(issuesOf(exit).map((issue) => issue.reason)).toContain('config-unreadable')
    }
  })
})

describe('what a payload must satisfy', () => {
  it('accepts a complete filing and normalizes it', () => {
    const attachment = randomUUID()
    const exit = decode(config, {
      'certificate-no': '  BJ-2026-0042  ',
      'issued-on': '2026-05-01',
      proof: [attachment],
    })
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        'certificate-no': 'BJ-2026-0042',
        'issued-on': '2026-05-01',
        proof: [attachment],
      })
    }
  })

  it('names every missing or malformed field at once', () => {
    const exit = decode(config, {
      'issued-on': 'not a date',
      proof: [],
      stray: 'who put this here',
    })
    const issues = issuesOf(exit)
    expect(issues).toContainEqual({ field: 'certificate-no', reason: 'required' })
    expect(issues).toContainEqual({ field: 'issued-on', reason: 'not-a-date' })
    expect(issues).toContainEqual({ field: 'proof', reason: 'required' })
    expect(issues).toContainEqual({ field: 'stray', reason: 'unknown-field' })
  })

  it('holds a date to the round and to the field, half-open end included', () => {
    const proof = [randomUUID()]
    const within = { 'certificate-no': 'X', proof }
    // before the field's own floor, though inside the round
    expect(issuesOf(decode(config, { ...within, 'issued-on': '2026-03-15' }))).toContainEqual({
      field: 'issued-on',
      reason: 'out-of-range',
    })
    // the material range end is exclusive: the end day itself is out
    expect(issuesOf(decode(config, { ...within, 'issued-on': '2026-09-01' }))).toContainEqual({
      field: 'issued-on',
      reason: 'out-of-range',
    })
    // the day before it is in
    expect(Exit.isSuccess(decode(config, { ...within, 'issued-on': '2026-08-31' }))).toBe(true)
    // a nonexistent calendar day is refused as a date, not as a range miss
    expect(issuesOf(decode(config, { ...within, 'issued-on': '2026-02-31' }))).toContainEqual({
      field: 'issued-on',
      reason: 'not-a-date',
    })
  })

  it('holds attachments to count, id shape and uniqueness', () => {
    const base = { 'certificate-no': 'X', 'issued-on': '2026-05-01' }
    const id = randomUUID()
    expect(
      issuesOf(decode(config, { ...base, proof: [id, randomUUID(), randomUUID()] })),
    ).toContainEqual({ field: 'proof', reason: 'too-many-attachments' })
    expect(issuesOf(decode(config, { ...base, proof: [id, id] }))).toContainEqual({
      field: 'proof',
      reason: 'duplicate-attachment',
    })
    expect(issuesOf(decode(config, { ...base, proof: ['not-a-uuid'] }))).toContainEqual({
      field: 'proof',
      reason: 'not-attachments',
    })
  })

  it('names the attachments a payload cites, field by field', () => {
    const a = randomUUID()
    const b = randomUUID()
    const refs = evidenceDriver.attachmentRefs(
      {
        fields: [
          {
            key: 'proof',
            type: 'attachment',
            label: 'x',
            maxCount: 2,
            accept: ['application/pdf'],
            maxFileBytes: 5_242_880,
          },
          { key: 'note', type: 'text', label: 'y' },
        ],
      },
      { proof: [a, b], note: 'hello' },
    )
    // accept and maxFileBytes ride on the ref: core holds the trusted file
    // facts, the driver holds the field's rules, and this is where they meet
    expect(refs).toEqual([
      { field: 'proof', attachmentId: a, accept: ['application/pdf'], maxFileBytes: 5_242_880 },
      { field: 'proof', attachmentId: b, accept: ['application/pdf'], maxFileBytes: 5_242_880 },
    ])
  })

  it('refuses a date field whose window misses the round entirely', () => {
    // well-formed on its own (min < max), and no legal day exists inside the
    // round: the config gauntlet is where this dies, not the first student
    const issues = evidenceDriver.configIssues!(
      {
        fields: [
          { key: 'when', type: 'date', label: 'When', min: '2026-09-01', max: '2026-12-31' },
        ],
      },
      batch,
    )
    expect(issues).toEqual([{ path: 'formConfig.fields[0]', reason: 'date-window-empty' }])
    // a window clipped by the range but not emptied is fine
    expect(
      evidenceDriver.configIssues!(
        { fields: [{ key: 'when', type: 'date', label: 'When', min: '2026-08-31' }] },
        batch,
      ),
    ).toEqual([])
  })
})

describe('an answer read against the next version of the form', () => {
  const project = (from: unknown, to: unknown, payload: unknown) =>
    evidenceDriver.projectPayload!(from, to, payload)

  const named = (id: string, key: string, type: string, over: Record<string, unknown> = {}) => ({
    id,
    key,
    type,
    label: id,
    ...(type === 'attachment' ? { maxCount: 1 } : {}),
    ...over,
  })

  it('follows a field wherever it moved, and drops the ones that are gone', () => {
    const before = { fields: [named('a', 'k1', 'text'), named('b', 'k2', 'text')] }
    // reordered, one deleted, one added: the same two questions, differently
    // arranged, plus one nobody has answered
    const after = { fields: [named('b', 'k2', 'text'), named('c', 'k3', 'text')] }
    expect(project(before, after, { k1: 'first', k2: 'second' })).toEqual({ k2: 'second' })
  })

  it('does not follow a field whose key moved to another question', () => {
    // the slot is the same word; the question behind it is a different one,
    // so nothing carries. This is the case a slot-name match gets wrong.
    const before = { fields: [named('a', 'shared', 'text')] }
    const after = { fields: [named('b', 'shared', 'text')] }
    expect(project(before, after, { shared: 'mine' })).toEqual({})
  })

  it('treats a retyped field as a different question', () => {
    const before = { fields: [named('a', 'k1', 'text')] }
    const after = { fields: [named('a', 'k1', 'date')] }
    expect(project(before, after, { k1: 'not a date' })).toEqual({})
  })

  it('identifies a form written before ids by the keys it always had', () => {
    const before = { fields: [{ key: 'k1', type: 'text', label: 'old' }] }
    const after = { fields: [named('k1', 'k1', 'text'), named('new', 'k2', 'text')] }
    expect(project(before, after, { k1: 'kept' })).toEqual({ k1: 'kept' })
  })

  it('refuses two fields that answer to the same identity', () => {
    const clashing = {
      fields: [named('same', 'k1', 'text'), named('same', 'k2', 'text')],
    }
    expect(Exit.isSuccess(decode(clashing, {}))).toBe(false)
  })
})

describe('the typed fields', () => {
  const typedConfig = {
    fields: [
      {
        id: 'placing',
        key: 'placing-slot',
        type: 'integer',
        label: '获奖序位',
        required: true,
        min: 1,
        max: 10,
      },
      { key: 'hours', type: 'decimal', label: '时长', maxScale: 2, min: '0', max: '100' },
      {
        id: 'level',
        key: 'level',
        type: 'choice',
        label: '赛事级别',
        required: true,
        options: [
          { value: 'national', label: '国家级' },
          { value: 'provincial', label: '省部级' },
        ],
      },
      { key: 'issued-on', type: 'date', label: '签发日期', required: true },
      { key: 'proof', type: 'attachment', label: '证明材料', maxCount: 2 },
    ],
  }

  it('refuses configurations the kinds cannot mean', () => {
    const refused = (fields: unknown[]) =>
      Result.isFailure(Schema.decodeUnknownResult(evidenceConfig)({ fields }))
    // an integer whose floor is above its ceiling
    expect(refused([{ key: 'n', type: 'integer', label: 'N', min: 5, max: 1 }])).toBe(true)
    // a decimal bound more precise than the field's own scale
    expect(refused([{ key: 'd', type: 'decimal', label: 'D', maxScale: 1, min: '0.25' }])).toBe(
      true,
    )
    // a decimal with no scale at all: the config records what was decided
    expect(refused([{ key: 'd', type: 'decimal', label: 'D' }])).toBe(true)
    // choices that are not choices
    expect(refused([{ key: 'c', type: 'choice', label: 'C', options: [] }])).toBe(true)
    expect(
      refused([
        {
          key: 'c',
          type: 'choice',
          label: 'C',
          options: [
            { value: 'a', label: 'A' },
            { value: 'a', label: 'B' },
          ],
        },
      ]),
    ).toBe(true)
  })

  it('judges typed values by the one schema, with no coercion', async () => {
    const attempt = (payload: Record<string, unknown>) =>
      Effect.runPromiseExit(evidenceDriver.decodePayload(typedConfig, payload, batch))
    const good = await attempt({
      'placing-slot': 2,
      hours: '3.50',
      level: 'provincial',
      'issued-on': '2026-05-01',
    })
    expect(Exit.isSuccess(good)).toBe(true)
    if (Exit.isSuccess(good)) {
      const decoded = good.value as Record<string, unknown>
      // the integer is a number; the decimal is stored in its one canonical
      // spelling; the choice is the stable value, never the words
      expect(decoded['placing-slot']).toBe(2)
      expect(decoded['hours']).toBe('3.5')
      expect(decoded['level']).toBe('provincial')
    }

    const reasonsOf = (exit: Exit.Exit<unknown, ItemPayloadInvalid>) => {
      if (!Exit.isFailure(exit)) return []
      const failed = (exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? []
      const error = failed.map((one) => one.error).find((one) => one !== undefined) as
        ItemPayloadInvalid | undefined
      return (error?.issues ?? []).map(
        (issue: { field: string; reason: string }) => `${issue.field}:${issue.reason}`,
      )
    }
    // "2" the string is a different claim from 2 the number
    expect(
      reasonsOf(
        await attempt({ 'placing-slot': '2', level: 'national', 'issued-on': '2026-05-01' }),
      ),
    ).toContain('placing-slot:not-an-integer')
    expect(
      reasonsOf(
        await attempt({ 'placing-slot': 99, level: 'national', 'issued-on': '2026-05-01' }),
      ),
    ).toContain('placing-slot:out-of-range')
    expect(
      reasonsOf(
        await attempt({
          'placing-slot': 1,
          hours: '1.234',
          level: 'national',
          'issued-on': '2026-05-01',
        }),
      ),
    ).toContain('hours:too-precise')
    expect(
      reasonsOf(
        await attempt({
          'placing-slot': 1,
          hours: 'abc',
          level: 'national',
          'issued-on': '2026-05-01',
        }),
      ),
    ).toContain('hours:not-a-decimal')
    // the lexical grammar has no leading zeros: "03.25" is not a spelling
    // of anything, the same rule the platform amount already enforces
    expect(
      reasonsOf(
        await attempt({
          'placing-slot': 1,
          hours: '03.25',
          level: 'national',
          'issued-on': '2026-05-01',
        }),
      ),
    ).toContain('hours:not-a-decimal')
    expect(
      reasonsOf(await attempt({ 'placing-slot': 1, level: 'city', 'issued-on': '2026-05-01' })),
    ).toContain('level:not-a-choice')
  })

  it('offers every typed field for binding, and never a file', () => {
    const offered = evidenceDriver.bindableFields!(typedConfig, batch)
    expect(offered.map((field) => field.fieldId)).toEqual([
      'placing',
      'hours',
      'level',
      'issued-on',
    ])
    // identity and address are different answers, and the plan needs both:
    // this field kept its id while its key names the payload slot
    const placing = offered.find((field) => field.fieldId === 'placing')!
    expect(placing.payloadKey).toBe('placing-slot')
    expect(placing.schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
    expect(placing.always).toBe(true)
    // an optional field promises nothing about presence
    const hours = offered.find((field) => field.fieldId === 'hours')!
    expect(hours.always).toBe(false)
    expect(hours.schema).toMatchObject({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
    })
    // the choice carries its business words on the annotation layer
    const level = offered.find((field) => field.fieldId === 'level')!
    expect(level.schema).toMatchObject({
      enum: ['national', 'provincial'],
      'x-qualy-enumLabels': { national: '国家级', provincial: '省部级' },
    })
    expect(offered.some((field) => field.fieldId === 'proof')).toBe(false)
  })

  it('states the required-text domain it already enforces, and proves it binds', () => {
    // decode refuses a required text whose trimmed answer is empty, so the
    // schema handed to binding proofs must say minLength 1 - or a safe
    // assignment to a nonempty recognition is refused as widening
    const wording = {
      fields: [
        { key: 'basis', type: 'text', label: '依据', required: true, maxLength: 64 },
        { key: 'note', type: 'text', label: '备注', maxLength: 64 },
      ],
    }
    const offered = evidenceDriver.bindableFields!(wording, batch)
    const basis = offered.find((field) => field.fieldId === 'basis')!
    const note = offered.find((field) => field.fieldId === 'note')!
    expect(basis.schema).toMatchObject({ type: 'string', minLength: 1 })
    expect('minLength' in note.schema).toBe(false)
    // a required text may seed a recognition that itself refuses emptiness
    const nonempty = normalizeAtomicSchema({ type: 'string', minLength: 1, maxLength: 64 })
    expect(assignmentPlan(normalizeAtomicSchema(basis.schema), nonempty)).toEqual({
      kind: 'direct',
    })
    // an optional text still holds '' in its domain, and is refused there
    expect(assignmentPlan(normalizeAtomicSchema(note.schema), nonempty).kind).toBe('incompatible')
  })

  it('refuses a field that keeps its identity while changing its type', () => {
    // the browser mints a fresh id on retype; the server holds the same
    // rule against whoever speaks the api directly - identity is what ties
    // historical evidence to recognition bindings
    const before = {
      fields: [{ id: 'stable', key: 'hours', type: 'integer', label: '时长', min: 0, max: 99 }],
    }
    const retyped = {
      fields: [{ id: 'stable', key: 'hours', type: 'decimal', label: '时长', maxScale: 2 }],
    }
    expect(evidenceDriver.transitionIssues!(before, retyped, batch)).toEqual([
      { path: 'formConfig.fields.hours', reason: 'field-type-change-requires-new-id' },
    ])
    // a minted identity IS a new field, whatever slot it lands on
    const minted = {
      fields: [{ id: 'stable-2', key: 'hours-2', type: 'decimal', label: '时长', maxScale: 2 }],
    }
    expect(evidenceDriver.transitionIssues!(before, minted, batch)).toEqual([])
    // and a brand-new field beside the old one transitions nothing
    const grown = {
      fields: [
        { id: 'stable', key: 'hours', type: 'integer', label: '时长', min: 0, max: 99 },
        { key: 'note', type: 'text', label: '备注' },
      ],
    }
    expect(evidenceDriver.transitionIssues!(before, grown, batch)).toEqual([])
  })

  it('drops a value whose field changed type, like every other retype', async () => {
    const before = {
      fields: [{ id: 'n', key: 'n', type: 'text', label: 'N' }],
    }
    const after = {
      fields: [{ id: 'n', key: 'n', type: 'integer', label: 'N', min: 0, max: 10 }],
    }
    const carried = evidenceDriver.projectPayload!(before, after, { n: '3' })
    expect(carried).toEqual({})
  })
})

describe('accepted configuration implies profile-legal schemas', () => {
  const refused = (fields: unknown[]) =>
    Result.isFailure(Schema.decodeUnknownResult(evidenceConfig)({ fields }))

  it('refuses what would later detonate inside the trusted process', () => {
    // an unsafe integer bound passes Number.isInteger but not the value
    // profile: accepted, it would throw out of normalizeAtomicSchema the
    // first time a student's payload is decoded - a server defect where a
    // configuration refusal belongs
    expect(
      refused([{ key: 'n', type: 'integer', label: 'N', min: 0, max: 9007199254740992 }]),
    ).toBe(true)
    // the same trap from below
    expect(refused([{ key: 'n', type: 'integer', label: 'N', min: -9007199254740992 }])).toBe(true)
    // and the safe sibling stands, so the gate is the profile, not the kind
    expect(
      refused([{ key: 'n', type: 'integer', label: 'N', min: 0, max: 9007199254740991 }]),
    ).toBe(false)
    // a text cap beyond the profile's own length bound is the same family
    expect(refused([{ key: 't', type: 'text', label: 'T', maxLength: 100001 }])).toBe(true)
    expect(refused([{ key: 't', type: 'text', label: 'T', maxLength: 500 }])).toBe(false)
  })
})
