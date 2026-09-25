import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { twoFactScoring } from './support/catalogs.ts'
import { GATED, ok, run, runningBatch, seed, type Seeded } from './support/round.ts'

// Upheld, corrected, revoked, overturned: what a round that revisited a
// result did to it is the system's to say (ruling of 2026-09-25), from
// where the claim stood before the round and where the round left it. The
// reviewer only ever said yes or no, and what it was recognised as.

const OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.appeal',
]

const provincial = { 'rec-level': 'provincial', 'rec-ordinal': 2 }
const national = { 'rec-level': 'national', 'rec-ordinal': 2 }

const world = (f: Seeded) =>
  runningBatch(f, {
    profile: OPEN,
    scoring: twoFactScoring,
    escalation: [
      {
        id: 'appeal',
        selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
        quorum: { type: 'any' },
      },
    ],
  })

/**
 * One claim judged `first`, appealed, and the appeal judged `then`; back
 * with the effect its history reports for the appeal round.
 */
const appealed = (
  f: Seeded,
  g: { item: { id: string }; p1: string },
  who: string,
  first: 'approve' | 'reject',
  then: { decision: 'approve'; values: Record<string, unknown> } | { decision: 'reject' },
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const owner = f.principal(who)
    const reviewer = f.principal(f.reviewer)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId: g.p1, payload: {} },
      owner,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
    yield* assessment.decideReview(
      f.t,
      sent.currentReviewInstanceId!,
      first === 'approve'
        ? { decision: 'approve', recognition: { values: provincial } }
        : { decision: 'reject', comment: '材料不足' },
      reviewer,
    )
    const appeal = yield* assessment.appealEntry(f.t, entry.id, { reason: '请复核' }, owner)
    yield* assessment.decideReview(
      f.t,
      appeal.id,
      then.decision === 'approve'
        ? {
            decision: 'approve',
            recognition: {
              values: then.values,
              ...(first === 'approve' ? { reason: '按复核认定' } : {}),
            },
          }
        : { decision: 'reject', comment: '复核结论' },
      reviewer,
    )
    const history = yield* assessment.getEntryHistory(f.t, entry.id, owner)
    return {
      appeal: history.rounds.find((round) => round.id === appeal.id)!.effect,
      first: history.rounds.find((round) => round.id === sent.currentReviewInstanceId)!.effect,
    }
  })

describe.runIf(postgresAvailable)('what a revisiting round did to the result', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-round-effect')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('tells an upheld approval from a corrected one by comparing before and after', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('re-effects')
          const g = yield* world(f)
          const as = (participantId: string) => ({ item: g.item, p1: participantId })
          return {
            upheldApproval: yield* appealed(f, as(g.p1), f.s1, 'approve', {
              decision: 'approve',
              values: provincial,
            }),
            corrected: yield* appealed(f, as(g.p2), f.s2, 'approve', {
              decision: 'approve',
              values: national,
            }),
          }
        }),
      ),
    )
    expect(result.upheldApproval).toEqual({ appeal: 'upheld', first: null })
    expect(result.corrected.appeal).toBe('corrected')
  })

  it('says a refusal upheld, and an approval revoked', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('re-directions')
          const g = yield* world(f)
          const as = (participantId: string) => ({ item: g.item, p1: participantId })
          return {
            upheldRefusal: yield* appealed(f, as(g.p1), f.s1, 'reject', { decision: 'reject' }),
            revoked: yield* appealed(f, as(g.p2), f.s2, 'approve', { decision: 'reject' }),
          }
        }),
      ),
    )
    expect(result.upheldRefusal.appeal).toBe('upheld')
    expect(result.revoked.appeal).toBe('revoked')
  })

  it('says a refusal overturned', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('re-overturned')
          const g = yield* world(f)
          return yield* appealed(f, { item: g.item, p1: g.p1 }, f.s1, 'reject', {
            decision: 'approve',
            values: provincial,
          })
        }),
      ),
    )
    expect(result.appeal).toBe('overturned')
  })
})
