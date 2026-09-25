import { Effect, Exit } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, refusalOf, run, runningBatch, seed } from './support/round.ts'

// Taking somebody off a round's roster takes every act they had with it,
// answering an ask included, and nothing of theirs is left in motion: the
// rounds on their claims end in the exclusion's own transaction. A first
// review is void and the claim goes back to a draft its owner may send again
// once readmitted; a round reconsidering a settled claim is void and the
// claim keeps exactly what it stood on before.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

describe.runIf(postgresAvailable)('what leaving the roster does to open work', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-participant-exclusion')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('ends a first review and its ask, and lets a readmitted owner send the claim again', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('px-first')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const roundId = sent.currentReviewInstanceId!
          yield* assessment.requestSupplement(
            f.t,
            roundId,
            {
              instructions: 'show the certificate',
              requirements: [{ label: '说明', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          const requestId = one<{ id: string }>(
            yield* runSql(
              sql`select id from review_supplement_requests where review_instance_id = ${roundId}`,
            ),
          ).id

          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'transferred out',
            admin,
          )

          const round = one<{ state: string; outcome: string }>(
            yield* runSql(sql`select state, outcome from review_instances where id = ${roundId}`),
          )
          const lastEvent = one<{ kind: string; actor_id: string }>(
            yield* runSql(sql`
              select kind, actor_id from review_events where review_instance_id = ${roundId}
              order by created_at desc, id desc limit 1`),
          )
          const ask = one<{ status: string }>(
            yield* runSql(
              sql`select status from review_supplement_requests where id = ${requestId}`,
            ),
          )
          const claim = one<{ status: string; current_review_instance_id: string | null }>(
            yield* runSql(
              sql`select status, current_review_instance_id from entries where id = ${entry.id}`,
            ),
          )
          const queued = (yield* assessment.listReviewInbox(f.t, {}, f.principal(f.reviewer))).items
          const answered = yield* Effect.exit(
            assessment.answerSupplement(f.t, requestId, { payload: { f1: '补充' } }, s1),
          )
          const card = (yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)).entries[0]!

          // back on the roster: the claim is a draft its owner sends again
          yield* assessment.setParticipantStatus(f.t, g.batch.id, g.p1, 'active', undefined, admin)
          const again = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          return { round, lastEvent, ask, claim, queued, answered, card, again, roundId }
        }),
      ),
    )

    expect(result.round).toEqual({ state: 'completed', outcome: 'subject-excluded' })
    expect(result.lastEvent.kind).toBe('subject-excluded')
    expect(result.ask.status).toBe('superseded')
    expect(result.claim).toEqual({ status: 'draft', current_review_instance_id: null })
    expect(result.queued).toHaveLength(0)
    expect(refusalOf(result.answered)?.reason).toBe('request-not-open')
    expect(result.card.supplement).toBeNull()
    expect(result.card.openRound).toBeNull()
    expect(result.card.capabilities.submit.state).toBe('hidden')
    expect(result.again.status).toBe('in_review')
    expect(result.again.currentReviewInstanceId).not.toBe(result.roundId)
  })

  it('keeps a contested claim on what it stood on when its appeal ends with the roster place', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('px-appeal')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
            escalation: [
              {
                id: 'esc',
                label: '复核',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const decision = sent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            decision,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const before = one<{ status: string; current_recognition_id: string }>(
            yield* runSql(
              sql`select status, current_recognition_id from entries where id = ${entry.id}`,
            ),
          )
          const appeal = yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '等级认定有误' },
            s1,
          )

          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'transferred out',
            admin,
          )

          const round = one<{ state: string; outcome: string }>(
            yield* runSql(sql`select state, outcome from review_instances where id = ${appeal.id}`),
          )
          const after = one<{
            status: string
            current_recognition_id: string
            current_review_instance_id: string
          }>(
            yield* runSql(sql`
              select status, current_recognition_id, current_review_instance_id
              from entries where id = ${entry.id}`),
          )
          // readmitted: the appeal the exclusion ended never concluded, so
          // it spent nothing and the decision may be appealed again
          yield* assessment.setParticipantStatus(f.t, g.batch.id, g.p1, 'active', undefined, admin)
          const card = yield* assessment.getEntry(f.t, entry.id, s1)
          const again = yield* Effect.exit(
            assessment.appealEntry(f.t, entry.id, { reason: '等级认定有误' }, s1),
          )
          return { decision, before, round, after, card: card.capabilities.appeal, again }
        }),
      ),
    )

    expect(result.round).toEqual({ state: 'completed', outcome: 'subject-excluded' })
    expect(result.after).toEqual({
      status: result.before.status,
      current_recognition_id: result.before.current_recognition_id,
      current_review_instance_id: result.decision,
    })
    expect(result.after.status).toBe('approved')
    expect(result.card).toEqual({ state: 'available', reason: null })
    expect(Exit.isSuccess(result.again)).toBe(true)
  })

  it('answers no ask from somebody already off the roster, and offers them none', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('px-legacy')
          const assessment = yield* Assessment
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.requestSupplement(
            f.t,
            sent.currentReviewInstanceId!,
            {
              instructions: 'show the certificate',
              requirements: [{ label: '说明', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          const requestId = one<{ id: string }>(
            yield* runSql(sql`
              select id from review_supplement_requests
              where review_instance_id = ${sent.currentReviewInstanceId}`),
          ).id
          // an exclusion written before exclusions ended open work: the
          // round and its ask are still open
          yield* runSql(sql`
            update batch_participants set status = 'excluded', excluded_at = now()
            where id = ${g.p1}`)
          const answered = yield* Effect.exit(
            assessment.answerSupplement(f.t, requestId, { payload: { f1: '补充' } }, s1),
          )
          const card = (yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)).entries[0]!
          const desk = yield* assessment.getMyOverview(f.t, g.batch.id, s1)
          const round = yield* assessment.getReviewInstance(f.t, sent.currentReviewInstanceId!, s1)
          return {
            answered,
            card,
            actions: desk.participant!.actions,
            offered: round.capabilities.canAnswerSupplement,
          }
        }),
      ),
    )

    expect(refusalOf(result.answered)?.reason).toBe('participant-not-active')
    expect(result.card.supplement).toBeNull()
    expect(result.actions).toEqual([])
    expect(result.offered).toBe(false)
  })
})
