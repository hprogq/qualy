import { Effect } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment, type MyStanding } from '../src/server/index.ts'
import { GATED, ok, run, runningBatch, seed } from './support/round.ts'

// What a reader has to do in the rounds under way, asked of every round at
// once.
//
// The two facts the card above the batch list stands on: how much of this
// reader's own filing is waiting on them, and how much of other people's is.
// Either is null for somebody it is not about - one who does not judge in
// that round, one who is not on its roster - because "not your job" and
// "your job, nothing pending" are different answers, and only the first one
// means there is no line to draw. The fixture gives both readers in one
// round: the student holds no reviewing authority, the reviewer holds a
// role that carries it.

const PROFILE = [...GATED, 'assessment.review.process']

describe.runIf(postgresAvailable)('the standing of a reader across the rounds under way', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-standing')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('counts the reader’s own filing by what it waits for, and answers null to whoever does not judge', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('standing')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: PROFILE })
          const s1 = f.principal(f.s1)
          const judge = f.principal(f.reviewer)
          const admin = f.principal(f.admin)

          // filed and not yet sent: the owner's own, nothing anybody else
          // is waiting on
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const drafted = yield* assessment.listMyStanding(f.t, s1)

          // sent: it leaves the owner's hands and arrives in the queue
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const sent = yield* assessment.listMyStanding(f.t, s1)
          const waiting = yield* assessment.listMyStanding(f.t, judge)

          // sent back: in the owner's hands again, and out of the queue
          yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'return-for-revision', reason: '证书等级与填写不符' },
            admin,
          )
          const returned = yield* assessment.listMyStanding(f.t, s1)
          const emptied = yield* assessment.listMyStanding(f.t, judge)

          // somebody who administers the round without taking part in it.
          // The fixture's import sweeps every user type into every round,
          // so the roster row is taken away rather than never made.
          yield* runSql(sql`
            delete from batch_participants
            where tenant_id = ${f.t} and batch_id = ${g.batch.id} and user_id = ${f.admin}`)
          const outside = yield* assessment.listMyStanding(f.t, admin)

          return {
            batchId: g.batch.id,
            drafted,
            sent,
            waiting,
            returned,
            emptied,
            outside,
            submitted,
          }
        }),
      ),
    )

    const row = (standing: MyStanding) =>
      standing.items.find((item) => item.batchId === result.batchId)!

    // the round under way is there for both readers, and it is the only one
    expect(result.drafted.items).toHaveLength(1)
    expect(result.waiting.items).toHaveLength(1)

    // the student: their own filing moves between the three buckets, and
    // nobody's work ever waits on them
    expect(row(result.drafted).myEntries).toEqual({ toFix: 0, draft: 1, submitted: 0 })
    expect(row(result.sent).myEntries).toEqual({ toFix: 0, draft: 0, submitted: 1 })
    expect(row(result.returned).myEntries).toEqual({ toFix: 1, draft: 0, submitted: 0 })
    for (const reading of [result.drafted, result.sent, result.returned]) {
      expect(row(reading).reviewsWaiting).toBeNull()
    }

    // the reviewer: a number, not null - and it follows the queue rather
    // than the standing, so being caught up still leaves the line drawn
    expect(row(result.waiting).reviewsWaiting).toBe(1)
    expect(row(result.emptied).reviewsWaiting).toBe(0)
    // the fixture's org-scope import sweeps the reviewer onto the roster
    // too, so their own filing exists and is simply empty
    expect(row(result.waiting).myEntries).toEqual({ toFix: 0, draft: 0, submitted: 0 })

    // off the roster is not the same as on it with nothing filed: the first
    // has no line to draw, the second has one that says so
    expect(row(result.outside).myEntries).toBeNull()
  }, 120_000)
})
