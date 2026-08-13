import { randomUUID } from 'node:crypto'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { evidenceDriver } from '../src/driver.ts'

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
          },
          { key: 'note', type: 'text', label: 'y' },
        ],
      },
      { proof: [a, b], note: 'hello' },
    )
    expect(refs).toEqual([
      { field: 'proof', attachmentId: a, accept: ['application/pdf'] },
      { field: 'proof', attachmentId: b, accept: ['application/pdf'] },
    ])
  })
})
