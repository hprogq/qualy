import { inspect } from 'node:util'
import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, refusalOf, run, runningBatch, seed, type Seeded } from './support/round.ts'

// One participant appeal per conclusion (ruling of 2026-09-25). A
// conclusion an appeal reached cannot be appealed again, a conclusion
// cannot be the root target of two appeals, and a new filing that is
// judged again is a new conclusion with an appeal of its own. A re-routed
// appeal is the same appeal, carried onto a newer chain.

const APPEAL_OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.appeal',
]

const world = (f: Seeded) =>
  runningBatch(f, {
    profile: APPEAL_OPEN,
    escalation: [
      {
        id: 'appeal',
        selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
        quorum: { type: 'any' },
      },
    ],
  })

describe.runIf(postgresAvailable)('one appeal per conclusion', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-appeal-once')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('refuses to appeal what an appeal concluded, and says so on the card first', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ao-exhausted')
          const assessment = yield* Assessment
          const g = yield* world(f)
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          const before = yield* assessment.getEntry(f.t, entry.id, s1)
          const appealed = yield* assessment.appealEntry(f.t, entry.id, { reason: '请复核' }, s1)
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            { decision: 'reject', comment: '维持' },
            reviewer,
          )
          const after = yield* assessment.getEntry(f.t, entry.id, s1)
          const listed = yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)
          const again = yield* Effect.exit(
            assessment.appealEntry(f.t, entry.id, { reason: '仍然不服' }, s1),
          )
          return {
            before: before.capabilities.appeal,
            after: after.capabilities.appeal,
            listed: listed.entries.find((one) => one.id === entry.id)!.capabilities.appeal,
            again,
          }
        }),
      ),
    )
    expect(result.before).toEqual({ state: 'available', reason: null })
    expect(result.after).toEqual({ state: 'blocked', reason: 'appeal-exhausted' })
    expect(result.listed).toEqual({ state: 'blocked', reason: 'appeal-exhausted' })
    expect(refusalOf(result.again)?.reason).toBe('appeal-exhausted')
  })

  it('gives a newly judged filing an appeal of its own', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ao-new-filing')
          const assessment = yield* Assessment
          const g = yield* world(f)
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          const appealed = yield* assessment.appealEntry(f.t, entry.id, { reason: '请复核' }, s1)
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            { decision: 'reject', comment: '维持' },
            reviewer,
          )
          // new material, judged again: a conclusion the appeal never saw
          yield* assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1)
          const resent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            resent.currentReviewInstanceId!,
            { decision: 'reject', comment: '仍不足' },
            reviewer,
          )
          const fresh = yield* assessment.getEntry(f.t, entry.id, s1)
          const second = yield* Effect.exit(
            assessment.appealEntry(f.t, entry.id, { reason: '新材料请复核' }, s1),
          )
          return { fresh: fresh.capabilities.appeal, second }
        }),
      ),
    )
    expect(result.fresh).toEqual({ state: 'available', reason: null })
    expect(Exit.isSuccess(result.second)).toBe(true)
  })

  it('holds the line in the database: a conclusion is the root of one appeal', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ao-database')
          const assessment = yield* Assessment
          const g = yield* world(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const contested = sent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            contested,
            { decision: 'reject', comment: '材料不足' },
            f.principal(f.reviewer),
          )
          const appealed = yield* assessment.appealEntry(f.t, entry.id, { reason: '请复核' }, s1)
          // a second appeal against the same conclusion, written around the
          // service: the round beside it is closed first so only the new
          // index can refuse it
          yield* runSql(sql`
            update review_instances set state = 'completed', outcome = 'rejected',
              completed_at = now() where id = ${appealed.id}`)
          const copy = (supersedes: string | null) =>
            runSql(sql`
              insert into review_instances
                (tenant_id, entry_id, revision_id, round_no, origin, initiator,
                 appealed_instance_id, supersedes_instance_id, policy_revision_id,
                 recognition_revision_id, effective_chain, current_route,
                 current_stage_id, state, current_role_ids, current_node_id,
                 current_node_path, outcome, completed_at)
              select tenant_id, entry_id, revision_id, round_no + 10, 'appeal', 'participant',
                     appealed_instance_id, ${supersedes}::uuid, policy_revision_id,
                     recognition_revision_id, effective_chain, current_route,
                     current_stage_id, 'completed', current_role_ids, current_node_id,
                     current_node_path, 'rejected', now()
              from review_instances where id = ${appealed.id}`)
          const twice = yield* Effect.exit(copy(null))
          // the same target carried by a round that replaced the appeal is
          // that appeal moved, and is admitted
          const moved = yield* Effect.exit(copy(appealed.id))
          const roots = one<{ count: number }>(
            yield* runSql(sql`
              select count(*)::int as count from review_instances
              where appealed_instance_id = ${contested} and origin = 'appeal'
                and supersedes_instance_id is null`),
          )
          return { twice, moved, roots }
        }),
      ),
    )
    expect(Exit.isFailure(result.twice)).toBe(true)
    expect(
      inspect(Exit.isFailure(result.twice) ? result.twice.cause : '', { depth: 12 }),
    ).toContain('uq_review_instances_appeal_of_instance')
    expect(Exit.isSuccess(result.moved)).toBe(true)
    expect(result.roots.count).toBe(1)
  })
})
