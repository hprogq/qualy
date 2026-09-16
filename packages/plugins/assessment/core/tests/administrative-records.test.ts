import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { gradedScoring } from './support/catalogs.ts'
import { GATED, ok, run, runningBatch, seed, type Seeded } from './support/round.ts'

// The book of what the institution has recorded in a round.
//
// It is a read, so what it has to get right is what it lets through: only
// administrative facts, only about people the reader may record on, and the
// determination read through the question version it was JUDGED under rather
// than the question as it stands today.

/**
 * An administrative question, published and ready.
 *
 * It walks no route when it is written - a record is approved as it is
 * filed - and keeps one anyway, because that is where an appeal against it
 * is heard.
 */
const recordItem = (f: Seeded, batchId: string, over?: { scoring?: unknown; title?: string }) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const stage = (id: string) => ({
      id,
      selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
      quorum: { type: 'any' },
    })
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title: over?.title ?? '违纪扣分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: null,
        config: {
          entrySource: 'administrative',
          formConfig: {},
          scoringConfig: over?.scoring ?? {
            calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: {
            normal: { stages: [stage('s1')] },
            escalation: { stages: [stage('appeal')] },
          },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    return item
  })

describe.runIf(postgresAvailable)('the administrative record book', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-administrative-records')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('holds only administrative facts, and only about people the reader may record on', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ar-scope')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          const deduction = yield* recordItem(f, g.batch.id)

          const recorder = f.principal(f.recorder)
          // one inside the recorder's college, one the students filed
          // themselves, which is not an administrative act at all
          yield* assessment.createEntry(
            f.t,
            {
              itemId: deduction.id,
              participantId: g.p1,
              payload: {},
              note: '校发〔2026〕12 号',
            },
            recorder,
          )
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )

          const asRecorder = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 50 },
            recorder,
          )
          const asAdmin = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 50 },
            admin,
          )
          return { asRecorder, asAdmin }
        }),
      ),
    )

    // the student's own filing is not in the book, whoever reads it
    expect(found.asAdmin).toHaveLength(1)
    expect(found.asRecorder).toHaveLength(1)
    expect(found.asAdmin[0]!.source).toBe('record')
    // a record is approved the moment it is written
    expect(found.asAdmin[0]!.status).toBe('approved')
    // the basis rides with the row: an administrative fact is never written
    // without one, and this is where a reader checks it
    expect(found.asAdmin[0]!.revision.note).toBe('校发〔2026〕12 号')
    // actor and subject are two different people, which the row states
    expect(found.asAdmin[0]!.revision.actorId).not.toBe(found.asAdmin[0]!.participant.userId)
  })

  it('shows a recorder nothing outside their own reach', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ar-reach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          const deduction = yield* recordItem(f, g.batch.id)

          // the administrator may record anywhere, so both colleges get one
          yield* assessment.createEntry(
            f.t,
            { itemId: deduction.id, participantId: g.p1, payload: {}, note: '甲' },
            admin,
          )
          yield* assessment.createEntry(
            f.t,
            { itemId: deduction.id, participantId: g.p3, payload: {}, note: '乙' },
            admin,
          )

          const asRecorder = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 50 },
            f.principal(f.recorder),
          )
          const asAdmin = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 50 },
            admin,
          )
          return { asRecorder, asAdmin, inside: g.p1 }
        }),
      ),
    )

    // the recorder is anchored to college A: the college B record is not
    // hidden by a later filter, it never leaves sql
    expect(found.asAdmin).toHaveLength(2)
    expect(found.asRecorder).toHaveLength(1)
    expect(found.asRecorder[0]!.participant.id).toBe(found.inside)
  })

  it('names a determination by the question version it was judged under', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ar-frozen')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          // a question whose score is whatever the office determines
          const award = yield* recordItem(f, g.batch.id, {
            scoring: gradedScoring,
            title: '荣誉称号',
          })
          yield* assessment.createEntry(
            f.t,
            {
              itemId: award.id,
              participantId: g.p1,
              payload: {},
              note: '校发〔2026〕7 号',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            admin,
          )
          const book = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 50 },
            admin,
          )
          return { book }
        }),
      ),
    )

    const row = found.book[0]!
    expect(row.recognition).not.toBeNull()
    expect(row.recognition!.values).toEqual({ 'rec-level': 'provincial' })
    // the fields come from the frozen revision, so a reader is told what the
    // opaque id meant at the time rather than being handed a bare key
    expect(row.recognition!.fields.map((field) => field.id)).toEqual(['rec-level'])
    // and the schema beside it is the frozen one, not a bare opaque key
    expect(row.recognition!.fields[0]!.schema).not.toBeUndefined()
  })

  it('finds a person by name or by business number, in sql', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ar-search')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: GATED })
          const admin = f.principal(f.admin)

          const all = yield* assessment.listParticipants(f.t, g.batch.id, { limit: 50 }, admin)
          const target = all[0]!
          const byName = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { q: target.displayName, limit: 50 },
            admin,
          )
          const nobody = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { q: 'no-such-person-here', limit: 50 },
            admin,
          )
          // a needle with sql wildcards in it is a needle, not a pattern
          const literal = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { q: '%', limit: 50 },
            admin,
          )
          return { all: all.length, byName, nobody, literal }
        }),
      ),
    )

    expect(found.all).toBeGreaterThan(1)
    expect(found.byName).toHaveLength(1)
    expect(found.nobody).toHaveLength(0)
    expect(found.literal).toHaveLength(0)
  })
})
