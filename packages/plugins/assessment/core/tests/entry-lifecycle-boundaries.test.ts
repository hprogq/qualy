import { Effect } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, refusalOf, run, runningBatch, seed } from './support/round.ts'

// The two doors out of a claim, and where each one closes (§32.69).
// Withdrawing - taking the work back to edit - ends the moment anybody has
// really reviewed; abandoning - no longer claiming it - stays open across
// the whole life of the claim, approved included, and answers only to the
// phase plan. An appeal round is not withdrawable at all.

describe.runIf(postgresAvailable)('where withdraw ends and abandon does not', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-entry-boundaries')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('withdraw dies with the first real review act; abandon still works and closes the round', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-underway')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          // fresh round, nobody has spoken: the card offers withdraw
          const offeredBefore = submitted.capabilities.withdraw.state

          // a reviewer asks for more material - review has begun
          yield* assessment.requestSupplement(
            f.t,
            submitted.currentReviewInstanceId!,
            {
              instructions: 'show the certificate',
              requirements: [{ label: '证书', kind: 'file', required: true }],
            },
            f.principal(f.reviewer),
          )

          const withdrawn = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'draft', s1),
          )
          const seen = yield* assessment.getEntry(f.t, entry.id, s1)

          // the other door stays open: abandoning cancels the live round
          // and voids the claim, with the whole history kept
          const abandoned = yield* assessment.setEntryStatus(f.t, entry.id, 'voided', s1)
          const round = one<{ state: string; outcome: string }>(
            yield* runSql(
              sql`select state, outcome from review_instances where id = ${submitted.currentReviewInstanceId}`,
            ),
          )
          // one press, one sentence: the round's own cancellation
          // bookkeeping must not surface as a second user act (§32.73)
          const story = yield* assessment.listMyActivity(f.t, g.batch.id, {}, s1)
          return {
            offeredBefore,
            withdrawn,
            seen,
            abandoned,
            round,
            kinds: story.items.map((one) => one.kind),
          }
        }),
      ),
    )

    expect(result.offeredBefore).toBe('available')
    expect(refusalOf(result.withdrawn)?.reason).toBe('review-under-way')
    expect(result.seen.capabilities.withdraw).toEqual({
      state: 'blocked',
      reason: 'review-under-way',
    })
    expect(result.seen.capabilities.abandon.state).toBe('available')
    expect(result.abandoned.status).toBe('voided')
    expect(result.round.state).toBe('completed')
    expect(result.round.outcome).toBe('cancelled')
    expect(result.kinds.filter((kind) => kind === 'entry-abandoned')).toHaveLength(1)
    expect(result.kinds).not.toContain('entry-withdrawn')
  })

  it('withdrawing an untouched round is one user act in the feed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-withdraw')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.setEntryStatus(f.t, entry.id, 'draft', s1)
          const story = yield* assessment.listMyActivity(f.t, g.batch.id, {}, s1)
          return { kinds: story.items.map((one) => one.kind) }
        }),
      ),
    )

    expect(result.kinds).toEqual(['entry-withdrawn', 'entry-submitted', 'entry-created'])
  })

  it('an appeal round is never withdrawable back to draft', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-appeal')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...GATED, 'assessment.review.process', 'assessment.entry.appeal'],
            // an appeal climbs the escalation route, so the route must exist
            escalation: [
              {
                id: 'esc',
                label: '复核',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'reject', comment: 'not enough' },
            f.principal(f.reviewer),
          )
          const appealed = yield* assessment.appealReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { reason: 'the certificate is genuine' },
            s1,
          )
          void appealed
          const withdrawn = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'draft', s1),
          )
          const seen = yield* assessment.getEntry(f.t, entry.id, s1)
          return { withdrawn, withdrawCard: seen.capabilities.withdraw.state }
        }),
      ),
    )

    expect(refusalOf(result.withdrawn)?.reason).toBe('appeal-not-withdrawable')
    expect(result.withdrawCard).toBe('hidden')
  })

  it('an approved claim can be given up: the entry voids, the verdict stands', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-approved')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const approved = yield* assessment.getEntry(f.t, entry.id, s1)
          const offered = approved.capabilities.abandon.state
          const abandoned = yield* assessment.setEntryStatus(f.t, entry.id, 'voided', s1)
          const round = one<{ state: string; outcome: string }>(
            yield* runSql(
              sql`select state, outcome from review_instances where id = ${submitted.currentReviewInstanceId}`,
            ),
          )
          return { approvedStatus: approved.status, offered, abandoned, round }
        }),
      ),
    )

    expect(result.approvedStatus).toBe('approved')
    expect(result.offered).toBe('available')
    expect(result.abandoned.status).toBe('voided')
    // the review was not unsaid: the round still reads approved
    expect(result.round.state).toBe('completed')
    expect(result.round.outcome).toBe('approved')
  })

  it('a rejection hands the owner the reviewer suggestion, word for word', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-suggested')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { summary: '原文' } },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            {
              decision: 'reject',
              comment: '按建议改后重交',
              suggestedPayload: { summary: '建议的写法' },
            },
            f.principal(f.reviewer),
          )
          const seen = yield* assessment.getEntry(f.t, entry.id, s1)
          return { refusal: seen.refusal }
        }),
      ),
    )

    expect(result.refusal?.kind).toBe('rejected')
    expect(result.refusal?.suggestedPayload).toEqual({ summary: '建议的写法' })
  })

  it('the phase plan closes abandoning like any other act', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-gated')
          const assessment = yield* Assessment
          // a plan whose entry phase never opens the abandon door
          const g = yield* runningBatch(f, {
            profile: [
              'assessment.entry.create',
              'assessment.entry.edit',
              'assessment.entry.submit',
              'assessment.entry.withdraw',
            ],
          })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const refused = yield* Effect.exit(assessment.setEntryStatus(f.t, entry.id, 'voided', s1))
          // the card that carries gate answers is the listing's, not the
          // bare read's
          const mine = yield* assessment.listMyEntries(f.t, g.item.batchId, {}, s1)
          const card = mine.entries.find((one) => one.id === entry.id)!.capabilities.abandon
          return { refused, card }
        }),
      ),
    )

    expect(refusalOf(result.refused)?.reason).toBe('phase-closed')
    expect(result.card).toEqual({ state: 'blocked', reason: 'phase-closed' })
  })
})
