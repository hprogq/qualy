import { Effect } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, run, runningBatch, seed } from './support/round.ts'

// One person's record, as this plugin contributes to it: the rounds they
// are in, and what they filed. Both are narrowed to what the READER may
// see - which rounds, and in which rounds a claim is anybody's business
// but the owner's and the staff's.

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
          // a fellow participant may see the round, so may see who is in it
          const byPeer = yield* assessment.listUserBatches(
            f.t,
            f.s1,
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
            byOutsider: byOutsider.length,
            batchId: g.batch.id,
          }
        }),
      ),
    )
    expect(result.ofS1).toEqual([[result.batchId, 'active', 'Class A1']])
    expect(result.ofS2).toEqual([['excluded', true]])
    expect(result.manageable).toBe(true)
    expect(result.byPeer).toBe(1)
    expect(result.byOutsider).toBe(0)
  })

  it('lists what somebody filed to the round’s staff, and never to a fellow participant', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ur-entries')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED] })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const byAdmin = yield* assessment.listUserEntries(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(f.admin),
          )
          // the recorder works on this round, and so may look
          const byStaff = yield* assessment.listUserEntries(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(f.recorder),
          )
          const byPeer = yield* assessment.listUserEntries(
            f.t,
            f.s1,
            { limit: 10 },
            f.principal(f.s3),
          )
          return {
            byAdmin: byAdmin.map((row) => [row.id, row.batchName, row.itemTitle, row.status]),
            byStaff: byStaff.length,
            byPeer: byPeer.length,
            entryId: entry.id,
          }
        }),
      ),
    )
    expect(result.byAdmin).toEqual([[result.entryId, 'Round', '退役复学', 'draft']])
    expect(result.byStaff).toBe(1)
    expect(result.byPeer).toBe(0)
  })
})
