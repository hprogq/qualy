import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { twoFactScoring } from './support/catalogs.ts'
import { appointStaff } from './support/correction.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed } from './support/round.ts'

// What re-determining reads (ruling of 2026-09-25 #33): the power to change
// a result carries the least reading it takes to exercise it - the
// accounts, claims and histories of the people the holder's accepted
// authority covers - without administering the roster, and nothing of
// anybody else's.

const OPEN = [...GATED, 'assessment.review.process']

describe.runIf(postgresAvailable)('what re-determining reads', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-redetermination-reach')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('opens the accounts it covers, and re-determines there, with no roster authority', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rr-reach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN, scoring: twoFactScoring })
          // the inspection group over the student's class, and nothing else
          const inspector = yield* appointStaff(f, g.batch.id, {
            name: 'Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          const as = f.principal(inspector.who)
          const owner = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            owner,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
            },
            f.principal(f.reviewer),
          )

          const batch = yield* assessment.getBatch(f.t, g.batch.id, as)
          const roster = yield* assessment.listParticipants(f.t, g.batch.id, { limit: 50 }, as)
          const person = yield* assessment.getParticipant(f.t, g.batch.id, g.p1, as)
          const account = yield* assessment.getParticipantResult(f.t, g.batch.id, g.p1, as)
          const claims = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, as)
          const detail = yield* assessment.getEntry(f.t, entry.id, as)
          const history = yield* assessment.getEntryHistory(f.t, entry.id, as)
          // and out of reach: the student in the other college
          const farPerson = yield* Effect.exit(assessment.getParticipant(f.t, g.batch.id, g.p3, as))
          const farAccount = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, g.p3, as),
          )
          const farClaims = yield* Effect.exit(
            assessment.listParticipantEntries(f.t, g.batch.id, g.p3, {}, as),
          )
          // an id naming nobody gets the same answer as one out of reach
          const nobody = yield* Effect.exit(
            assessment.getParticipantResult(
              f.t,
              g.batch.id,
              '01a0b900-0000-7000-8000-00000000dead',
              as,
            ),
          )
          const redetermined = yield* assessment.redetermineEntry(
            f.t,
            entry.id,
            { decision: 'reject', reason: '材料与事实不符' },
            as,
          )
          const status = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${entry.id}`),
          ).status
          return {
            capabilities: batch.capabilities,
            roster: roster.map((row) => row.id),
            p2: g.p2,
            p3: g.p3,
            person: person.id,
            accountLines: account.lines.length,
            claims: claims.entries.map((row) => row.entry.id),
            detail: detail.id,
            history: history.rounds.length,
            farPerson,
            farAccount,
            farClaims,
            nobody,
            redetermined,
            status,
            entryId: entry.id,
            p1: g.p1,
          }
        }),
      ),
    )
    expect(result.capabilities).toEqual(
      expect.objectContaining({ manage: false, redetermine: true }),
    )
    // the people the authority covers, and no others
    expect(result.roster).toEqual(expect.arrayContaining([result.p1, result.p2]))
    expect(result.roster).not.toContain(result.p3)
    expect(result.person).toBe(result.p1)
    expect(result.accountLines).toBeGreaterThan(0)
    expect(result.claims).toEqual([result.entryId])
    expect(result.detail).toBe(result.entryId)
    expect(result.history).toBeGreaterThan(0)
    const refusals: readonly Exit.Exit<unknown, unknown>[] = [
      result.farPerson,
      result.farAccount,
      result.farClaims,
      result.nobody,
    ]
    for (const refused of refusals) {
      expect(Exit.isFailure(refused)).toBe(true)
      expect(errorOf<{ _tag: string }>(refused)?._tag).toBe('ACCESS_DENIED')
    }
    expect(result.status).toBe('rejected')
  })

  it('reads no accounts for somebody holding neither door', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rr-none')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const reviewer = f.principal(f.reviewer)
          const batch = yield* assessment.getBatch(f.t, g.batch.id, reviewer)
          const roster = yield* Effect.exit(
            assessment.listParticipants(f.t, g.batch.id, { limit: 50 }, reviewer),
          )
          const account = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, g.p1, reviewer),
          )
          return { capabilities: batch.capabilities, roster, account }
        }),
      ),
    )
    expect(result.capabilities).toEqual(
      expect.objectContaining({ manage: false, redetermine: false }),
    )
    expect(errorOf<{ _tag: string }>(result.roster)?._tag).toBe('ACCESS_DENIED')
    expect(errorOf<{ _tag: string }>(result.account)?._tag).toBe('ACCESS_DENIED')
  })
})
