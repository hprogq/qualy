import { Effect } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { recordItem } from './support/administrative.ts'
import { appointStaff } from './support/correction.ts'
import { GATED, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

/** the seed's second class, under college B */
const classB = (f: Seeded) =>
  Effect.map(
    runSql(sql`select id from org_nodes where tenant_id = ${f.t} and name = 'Class B1'`),
    (result) => one<{ id: string }>(result).id,
  )

// One person's record, as this plugin contributes to it: the rounds they
// are in, and what they filed. Both are narrowed to what the READER may
// see (ruling of 2026-09-25 #21): a round shows up to whoever administers
// it or works on it, never to a fellow participant; a claim shows up only
// to a reader who may read that very claim.

describe.runIf(postgresAvailable)('what one person’s record says about assessment', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-user-record')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('lists the rounds somebody is in with their membership, and only to a reader who may see them', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ur-batches')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED] })
          // taken off the list: the round stays on the record with the day it ended
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p2,
            'excluded',
            'moved away',
            f.principal(f.admin),
          )
          const ofS1 = yield* assessment.listUserBatches(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(f.admin),
          )
          const ofS2 = yield* assessment.listUserBatches(
            f.t,
            f.s2,
            { limit: 10 },
            f.principal(f.admin),
          )
          // a fellow participant sees the round, and their own place in it,
          // but being in a round with somebody is not a way in to theirs
          const byPeer = yield* assessment.listUserBatches(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(f.s3),
          )
          const ownByPeer = yield* assessment.listUserBatches(
            f.t,
            f.s3,
            { limit: 10 },
            f.principal(f.s3),
          )
          // somebody outside the round altogether sees nothing of it
          const outsider = yield* Effect.map(
            runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Outsider', ${f.studentType}, ${f.root}) returning id`),
            (rows) => (rows as { rows: { id: string }[] }).rows[0]!.id,
          )
          const byOutsider = yield* assessment.listUserBatches(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(outsider),
          )
          return {
            ofS1: ofS1.map((row) => [row.batchId, row.membershipStatus, row.anchorNodeName]),
            ofS2: ofS2.map((row) => [row.membershipStatus, row.excludedAt !== null]),
            manageable: ofS1[0]?.manageable,
            byPeer: byPeer.length,
            ownByPeer: ownByPeer.length,
            byOutsider: byOutsider.length,
            batchId: g.batch.id,
          }
        }),
      ),
    )
    expect(result.ofS1).toEqual([[result.batchId, 'active', 'Class A1']])
    expect(result.ofS2).toEqual([['excluded', true]])
    expect(result.manageable).toBe(true)
    expect(result.byPeer).toBe(0)
    expect(result.ownByPeer).toBe(1)
    expect(result.byOutsider).toBe(0)
  })

  it('lists each claim only to a reader who may read that claim', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ur-entries')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED] })
          const s1 = f.principal(f.s1)
          const filed = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const office = yield* recordItem(f, g.batch.id)
          const recorded = yield* assessment.createEntry(
            f.t,
            { itemId: office.id, participantId: g.p1, payload: {}, note: '校发〔2026〕3 号' },
            f.principal(f.recorder),
          )
          // re-determining over the student's class, and over the other one
          const near = yield* appointStaff(f, g.batch.id, {
            name: 'Near Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          const far = yield* appointStaff(f, g.batch.id, {
            name: 'Far Inspector',
            at: yield* classB(f),
            codes: ['assessment.entry.redetermine'],
          })
          const idsBy = (who: string) =>
            Effect.map(
              assessment.listUserEntries(f.t, f.s1, { limit: 10 }, f.principal(who)),
              (rows) => rows.map((row) => row.id).sort(),
            )
          return {
            byAdmin: yield* idsBy(f.admin),
            byOwner: yield* idsBy(f.s1),
            byRecorder: yield* idsBy(f.recorder),
            byNear: yield* idsBy(near.who),
            byFar: yield* idsBy(far.who),
            byReviewer: yield* idsBy(f.reviewer),
            byPeer: yield* idsBy(f.s3),
            filed: filed.id,
            recorded: recorded.id,
          }
        }),
      ),
    )
    const both = [result.filed, result.recorded].sort()
    expect(result.byAdmin).toEqual(both)
    expect(result.byOwner).toEqual(both)
    // recording authority reads the facts it could have written, not what
    // the student filed about themselves
    expect(result.byRecorder).toEqual([result.recorded])
    // re-determining reads every claim of the people it covers, and no others
    expect(result.byNear).toEqual(both)
    expect(result.byFar).toEqual([])
    // working on the round in another capacity, or being in it, reads none
    expect(result.byReviewer).toEqual([])
    expect(result.byPeer).toEqual([])
  })
})
