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
          const appealed = yield* assessment.appealEntry(
            f.t,
            entry.id,
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

  // A refused claim under appeal still reads `rejected` (§32.21), which is
  // also the status that may be edited or sent back as it stands. The appeal
  // is judging the filing it was opened on, so both of those wait for it:
  // a new version would leave the appeal's verdict with nowhere to land, and
  // a second round beside it is one the claim cannot carry.
  it('keeps a refused claim under appeal on its filing until the appeal is decided', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-appeal-holds')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...GATED, 'assessment.review.process', 'assessment.entry.appeal'],
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
          const appealed = yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: 'the certificate is genuine' },
            s1,
          )
          const standing = () =>
            Effect.map(
              runSql(sql`
                select status, current_revision_id, current_recognition_id
                from entries where id = ${entry.id}`),
              (rows) =>
                one<{
                  status: string
                  current_revision_id: string
                  current_recognition_id: string | null
                }>(rows),
            )
          const before = yield* standing()
          const edited = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1),
          )
          const resubmitted = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          const seen = yield* assessment.getEntry(f.t, entry.id, s1)
          const card = (yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)).entries[0]!
          const during = yield* standing()
          // the appeal is upheld at the ladder's only rung
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const after = yield* standing()
          const settled = one<{ id: string }>(
            yield* runSql(sql`
              select id from entry_recognitions where review_instance_id = ${appealed.id}`),
          )
          return { before, edited, resubmitted, seen, card, during, after, settled }
        }),
      ),
    )

    expect(refusalOf(result.edited)?.reason).toBe('appeal-under-way')
    // a refusal, not a defect: the second round never reached the database
    expect(refusalOf(result.resubmitted)?.reason).toBe('appeal-under-way')
    for (const capabilities of [result.seen.capabilities, result.card.capabilities]) {
      expect(capabilities.edit).toEqual({ state: 'blocked', reason: 'appeal-under-way' })
      expect(capabilities.submit).toEqual({ state: 'blocked', reason: 'appeal-under-way' })
    }
    // nothing moved while the appeal was heard
    expect(result.during).toEqual(result.before)
    // and the verdict landed on the claim it was about
    expect(result.after.status).toBe('approved')
    expect(result.after.current_revision_id).toBe(result.before.current_revision_id)
    expect(result.after.current_recognition_id).toBe(result.settled.id)
  })

  // Giving up a claim that is under appeal takes the appeal with it. The
  // claim kept its standing through the appeal (§32.21), so the round is
  // found through the claim's pointer, not its status - and a round left
  // open over a voided claim would sit in the reviewers' queue, keep any
  // ask alive, and hold the batch open.
  it('closes the appeal a claim was carrying when its owner gives the claim up', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lb-appeal-abandon')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...GATED, 'assessment.review.process', 'assessment.entry.appeal'],
            escalation: [
              {
                id: 'esc',
                label: '复核',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const reviewer = f.principal(f.reviewer)
          /** a claim decided once, then appealed by its owner */
          const appealed = (who: string, participantId: string, first: 'approve' | 'reject') =>
            Effect.gen(function* () {
              const owner = f.principal(who)
              const entry = yield* assessment.createEntry(
                f.t,
                { itemId: g.item.id, participantId, payload: {} },
                owner,
              )
              const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
              yield* assessment.decideReview(
                f.t,
                sent.currentReviewInstanceId!,
                first === 'approve'
                  ? { decision: 'approve' }
                  : { decision: 'reject', comment: '不足' },
                reviewer,
              )
              const round = yield* assessment.appealEntry(
                f.t,
                entry.id,
                { reason: '请复核' },
                owner,
              )
              return { entryId: entry.id, roundId: round.id, owner }
            })
          const kept = yield* appealed(f.s1, g.p1, 'approve')
          const asked = yield* appealed(f.s2, g.p2, 'reject')
          yield* assessment.requestSupplement(
            f.t,
            asked.roundId,
            {
              instructions: 'show the certificate',
              requirements: [{ label: '证书', kind: 'file', required: true }],
            },
            reviewer,
          )
          const queuedBefore = (yield* assessment.listReviewInbox(f.t, {}, reviewer)).items.map(
            (row) => row.instanceId,
          )
          const gaveUp = yield* assessment.setEntryStatus(f.t, kept.entryId, 'voided', kept.owner)
          yield* assessment.setEntryStatus(f.t, asked.entryId, 'voided', asked.owner)
          const queuedAfter = (yield* assessment.listReviewInbox(f.t, {}, reviewer)).items.map(
            (row) => row.instanceId,
          )
          const rounds = (yield* runSql(sql`
            select ri.id, ri.state, ri.outcome,
              exists (
                select 1 from review_events ev
                where ev.review_instance_id = ri.id and ev.kind = 'cancelled-by-submitter'
              ) as said
            from review_instances ri
            where ri.id in (${kept.roundId}, ${asked.roundId})`)) as {
            rows: { id: string; state: string; outcome: string; said: boolean }[]
          }
          const ask = one<{ status: string }>(
            yield* runSql(sql`
              select status from review_supplement_requests
              where review_instance_id = ${asked.roundId}`),
          )
          const open = one<{ n: number }>(
            yield* runSql(sql`
              select count(*)::int as n from review_instances ri
              join entries e on e.id = ri.entry_id
              where e.batch_id = ${g.batch.id}
                and ri.state in ('active', 'blocked', 'awaiting_supplement')`),
          )
          return { kept, queuedBefore, gaveUp, queuedAfter, rounds: rounds.rows, ask, open }
        }),
      ),
    )

    expect(result.queuedBefore).toContain(result.kept.roundId)
    expect(result.gaveUp.status).toBe('voided')
    for (const round of result.rounds) {
      expect(round).toMatchObject({ state: 'completed', outcome: 'cancelled', said: true })
    }
    expect(result.rounds).toHaveLength(2)
    expect(result.queuedAfter).not.toContain(result.kept.roundId)
    // the ask on the other appeal went with its round
    expect(result.ask.status).toBe('superseded')
    expect(result.open.n).toBe(0)
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
