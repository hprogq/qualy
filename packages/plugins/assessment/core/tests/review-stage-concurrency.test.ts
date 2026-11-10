import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { sql } from 'kysely'
import { Assessment } from '../src/server/index.ts'
import { errorOf, GATED, ok, run, runningBatch, seed } from './support/round.ts'

describe.runIf(postgresAvailable)('review stage concurrency', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  beforeAll(async () => {
    db = await createTestContext('stage-probe')
  })
  afterAll(async () => {
    await db?.dispose()
  })
  it('observes two decisions against the same originally read stage', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('stage-probe')
          const assessment = yield* Assessment
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${f.s2}, ${f.reviewRole}, ${f.classA}, 'self')`)
          const stages = ['one', 'two'].map((id) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          }))
          const g = yield* runningBatch(f, {
            profile: [...GATED, 'assessment.review.process'],
            stages,
          })
          const owner = f.principal(f.s1)
          const judge = f.principal(f.reviewer)
          const colleague = f.principal(f.s2)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            owner,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
          const id = sent.currentReviewInstanceId!
          const firstRead = yield* assessment.getReviewInstance(f.t, id, judge)
          const secondRead = yield* assessment.getReviewInstance(f.t, id, colleague)
          const first = yield* assessment.decideReview(
            f.t,
            id,
            { decision: 'approve', expectedStage: firstRead.chain },
            judge,
          )
          const second = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              id,
              { decision: 'approve', expectedStage: secondRead.chain },
              colleague,
            ),
          )
          const ask = yield* Effect.exit(
            assessment.requestSupplement(
              f.t,
              id,
              {
                instructions: 'Clarify',
                requirements: [{ label: 'Proof', kind: 'text', required: true }],
                expectedStage: secondRead.chain,
              },
              colleague,
            ),
          )
          const fresh = yield* assessment.getReviewInstance(f.t, id, colleague)
          const final = yield* assessment.decideReview(
            f.t,
            id,
            { decision: 'approve', expectedStage: fresh.chain },
            colleague,
          )
          return { firstRead, secondRead, first, second, ask, final }
        }),
      ),
    )
    expect(result.firstRead.chain.stageId).toBe('one')
    expect(result.secondRead.chain.stageId).toBe('one')
    expect(result.first.chain.stageId).toBe('two')
    expect(errorOf<{ _tag: string; reason: string }>(result.second)).toMatchObject({
      _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
      reason: 'review-stage-changed',
    })
    expect(errorOf<{ _tag: string; reason: string }>(result.ask)).toMatchObject({
      _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
      reason: 'review-stage-changed',
    })
    expect(result.final.state).toBe('completed')
  })
})
