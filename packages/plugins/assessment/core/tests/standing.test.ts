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
    const open = {
      toAnswer: 0,
      toFix: 0,
      draft: 0,
      rejected: 0,
      submitted: 0,
      approved: 0,
      filing: 'open',
    }

    // the round under way is there for both readers, and it is the only one
    expect(result.drafted.items).toHaveLength(1)
    expect(result.waiting.items).toHaveLength(1)

    // the student: their own filing moves between the buckets, and
    // nobody's work ever waits on them
    expect(row(result.drafted).myEntries).toEqual({ ...open, draft: 1 })
    expect(row(result.sent).myEntries).toEqual({ ...open, submitted: 1 })
    expect(row(result.returned).myEntries).toEqual({ ...open, toFix: 1 })
    for (const reading of [result.drafted, result.sent, result.returned]) {
      expect(row(reading).reviewsWaiting).toBeNull()
    }

    // the reviewer: a number, not null - and it follows the queue rather
    // than the standing, so being caught up still leaves the line drawn
    expect(row(result.waiting).reviewsWaiting).toBe(1)
    expect(row(result.emptied).reviewsWaiting).toBe(0)
    // the fixture's org-scope import sweeps the reviewer onto the roster
    // too, so their own filing exists and is simply empty
    expect(row(result.waiting).myEntries).toEqual(open)

    // off the roster is not the same as on it with nothing filed: the first
    // has no line to draw, the second has one that says so
    expect(row(result.outside).myEntries).toBeNull()
  }, 120_000)

  it('tells a filing that waits on its author, and one that was settled, from nothing filed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('standing-settled')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: PROFILE })
          const judge = f.principal(f.reviewer)
          const sent = (userId: string, participantId: string) =>
            Effect.gen(function* () {
              const entry = yield* assessment.createEntry(
                f.t,
                { itemId: g.item.id, participantId, payload: {} },
                f.principal(userId),
              )
              const out = yield* assessment.setEntryStatus(
                f.t,
                entry.id,
                'in_review',
                f.principal(userId),
              )
              return out.currentReviewInstanceId!
            })

          // the reviewer reaches the first two students' class: one filing
          // is accepted, the other is asked for more, answered, and refused
          yield* assessment.decideReview(
            f.t,
            yield* sent(f.s1, g.p1),
            { decision: 'approve' },
            judge,
          )
          const round = yield* sent(f.s2, g.p2)
          yield* assessment.requestSupplement(
            f.t,
            round,
            {
              instructions: '请补充活动说明',
              requirements: [{ label: '说明', kind: 'text', required: true }],
            },
            judge,
          )
          const asked = yield* assessment.listMyStanding(f.t, f.principal(f.s2))
          const view = yield* assessment.getReviewInstance(f.t, round, f.principal(f.s2))
          yield* assessment.answerSupplement(
            f.t,
            view.supplements.find((one) => one.status === 'open')!.id,
            { payload: { f1: '已补充活动说明' } },
            f.principal(f.s2),
          )
          yield* assessment.decideReview(
            f.t,
            round,
            { decision: 'reject', comment: 'not enough' },
            judge,
          )
          const accepted = yield* assessment.listMyStanding(f.t, f.principal(f.s1))
          const refused = yield* assessment.listMyStanding(f.t, f.principal(f.s2))
          // the fixture sweeps the administrator onto the roster too, with
          // nothing filed: filing is open, and then it is over
          const open = yield* assessment.listMyStanding(f.t, f.principal(f.admin))
          const plan = yield* assessment.getPlan(f.t, g.batch.id, f.principal(f.admin))
          yield* assessment.advancePhase(
            f.t,
            g.batch.id,
            { to: plan[1]!.id, force: true, reason: 'test closes filing' },
            f.principal(f.admin),
          )
          const over = yield* assessment.listMyStanding(f.t, f.principal(f.admin))
          const settled = yield* assessment.listMyStanding(f.t, f.principal(f.s1))
          return { batchId: g.batch.id, asked, accepted, refused, open, over, settled }
        }),
      ),
    )

    const mine = (standing: MyStanding) =>
      standing.items.find((item) => item.batchId === result.batchId)!.myEntries
    const none = { toAnswer: 0, toFix: 0, draft: 0, rejected: 0, submitted: 0, approved: 0 }

    expect(mine(result.asked)).toEqual({ ...none, toAnswer: 1, filing: 'open' })
    expect(mine(result.accepted)).toEqual({ ...none, approved: 1, filing: 'open' })
    expect(mine(result.refused)).toEqual({ ...none, rejected: 1, filing: 'open' })
    expect(mine(result.open)).toEqual({ ...none, filing: 'open' })
    expect(mine(result.over)).toEqual({ ...none, filing: 'closed' })
    // a settled filing stays counted once filing is over
    expect(mine(result.settled)).toEqual({ ...none, approved: 1, filing: 'closed' })
  }, 120_000)
})
