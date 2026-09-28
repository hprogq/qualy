import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Principal } from '@qualy/rbac-contract'
import { Assessment } from '../src/server/index.ts'
import { twoFactScoring } from './support/catalogs.ts'
import { appointStaff } from './support/correction.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed, staged } from './support/round.ts'

// What staff read of somebody's claims (ruling of 2026-09-29): viewing all
// claims is a reading power of its own, a draft never handed in is its
// owner's alone, and a claim being revised after a return shows everybody
// else the version last handed in until the revision is sent.

const OPEN = [...GATED, 'assessment.review.process']

/** the results roster as this reader reads it: the people they may open */
const accounts = (tenantId: string, batchId: string, as: Principal) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return (yield* assessment.listParticipantAccounts(
      tenantId,
      batchId,
      { filter: {}, order: 'name', page: 1, limit: 50 },
      as,
    )).rows
  })

const lastHandedIn = (entryId: string) =>
  Effect.map(
    runSql(sql`select last_submitted_revision_id from entries where id = ${entryId}`),
    (rows) => one<{ last_submitted_revision_id: string | null }>(rows).last_submitted_revision_id,
  )

describe.runIf(postgresAvailable)('what staff read of the claims handed in', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-handed-in')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('reads every claim handed in over the people it covers, and changes nothing', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('hi-read-all')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN, scoring: twoFactScoring })
          const counsellor = yield* appointStaff(f, g.batch.id, {
            name: 'Counsellor',
            at: f.classA,
            codes: ['assessment.entry.read-all'],
          })
          const as = f.principal(counsellor.who)
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
          const roster = yield* accounts(f.t, g.batch.id, as)
          const recordRoster = yield* Effect.exit(
            assessment.listParticipants(f.t, g.batch.id, { limit: 50 }, as),
          )
          const person = yield* assessment.getParticipant(f.t, g.batch.id, g.p1, as)
          const account = yield* assessment.getParticipantResult(f.t, g.batch.id, g.p1, as)
          const claims = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, as)
          const detail = yield* assessment.getEntry(f.t, entry.id, as)
          const history = yield* assessment.getEntryHistory(f.t, entry.id, as)
          const redetermined = yield* Effect.exit(
            assessment.redetermineEntry(
              f.t,
              entry.id,
              { decision: 'reject', reason: '材料与事实不符' },
              as,
            ),
          )
          const farClaims = yield* Effect.exit(
            assessment.listParticipantEntries(f.t, g.batch.id, g.p3, {}, as),
          )
          return {
            capabilities: batch.capabilities,
            roster: roster.map((row) => row.id),
            recordRoster,
            person: person.claims,
            account: JSON.stringify(account),
            claims: claims.entries.map((row) => row.entry.id),
            detail: detail.id,
            history: history.rounds.length,
            redetermined,
            farClaims,
            entryId: entry.id,
            p1: g.p1,
            p3: g.p3,
          }
        }),
      ),
    )
    expect(result.capabilities).toEqual(
      expect.objectContaining({ readAll: true, redetermine: false, record: false, manage: false }),
    )
    expect(result.roster).toContain(result.p1)
    expect(result.roster).not.toContain(result.p3)
    // the roster of people to record on is recording's
    expect(errorOf<{ _tag: string }>(result.recordRoster)?._tag).toBe('ACCESS_DENIED')
    expect(result.person).toBe(true)
    // the account names the claim its line stands on
    expect(result.account).toContain(result.entryId)
    expect(result.claims).toEqual([result.entryId])
    expect(result.detail).toBe(result.entryId)
    expect(result.history).toBeGreaterThan(0)
    expect(Exit.isFailure(result.redetermined)).toBe(true)
    expect(errorOf<{ _tag: string }>(result.farClaims)?._tag).toBe('ACCESS_DENIED')
  })

  it('keeps a draft never handed in to its owner, whoever else may read the round', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('hi-draft')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const counsellor = yield* appointStaff(f, g.batch.id, {
            name: 'Counsellor',
            at: f.classA,
            codes: ['assessment.entry.read-all'],
          })
          const owner = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1)
          const draft = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            owner,
          )
          const readers = [f.principal(f.admin), f.principal(counsellor.who)]
          const seen = []
          for (const as of readers) {
            seen.push({
              detail: yield* Effect.exit(assessment.getEntry(f.t, draft.id, as)),
              history: yield* Effect.exit(assessment.getEntryHistory(f.t, draft.id, as)),
              listed: (yield* assessment.listParticipantEntries(
                f.t,
                g.batch.id,
                g.p1,
                {},
                as,
              )).entries.map((row) => row.entry.id),
              file: yield* Effect.exit(assessment.openAttachment(f.t, file, as)),
            })
          }
          return {
            seen,
            own: (yield* assessment.getEntry(f.t, draft.id, owner)).id,
            ownFile: yield* Effect.exit(assessment.openAttachment(f.t, file, owner)),
            last: yield* lastHandedIn(draft.id),
            draftId: draft.id,
          }
        }),
      ),
    )
    for (const reader of result.seen) {
      expect(errorOf<{ _tag: string }>(reader.detail)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
      expect(errorOf<{ _tag: string }>(reader.history)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
      expect(reader.listed).not.toContain(result.draftId)
      expect(Exit.isFailure(reader.file)).toBe(true)
    }
    expect(result.own).toBe(result.draftId)
    expect(Exit.isSuccess(result.ownFile)).toBe(true)
    expect(result.last).toBeNull()
  })

  it('shows everybody but the owner the version last handed in while it is revised', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('hi-revise')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const counsellor = yield* appointStaff(f, g.batch.id, {
            name: 'Counsellor',
            at: f.classA,
            codes: ['assessment.entry.read-all'],
          })
          const owner = f.principal(f.s1)
          const staff = f.principal(counsellor.who)
          const first = yield* staged(f.t, f.s1)
          const filed = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [first] } },
            owner,
          )
          const handed = filed.currentRevision!.id
          yield* assessment.setEntryStatus(f.t, filed.id, 'in_review', owner)
          const afterSubmit = yield* lastHandedIn(filed.id)
          yield* assessment.interveneOnEntry(
            f.t,
            filed.id,
            { kind: 'return-for-revision', reason: '请补充证明材料' },
            f.principal(f.admin),
          )
          const second = yield* staged(f.t, f.s1)
          const revised = yield* assessment.appendEntryRevision(
            f.t,
            filed.id,
            { payload: { files: [second] } },
            owner,
          )
          const working = revised.currentRevision!.id
          const whileRevising = {
            last: yield* lastHandedIn(filed.id),
            staff: (yield* assessment.getEntry(f.t, filed.id, staff)).currentRevision?.id,
            owner: (yield* assessment.getEntry(f.t, filed.id, owner)).currentRevision?.id,
            listed: (yield* assessment.listParticipantEntries(
              f.t,
              g.batch.id,
              g.p1,
              {},
              staff,
            )).entries.map((row) => row.entry.currentRevision?.id),
            staffHistory: (yield* assessment.getEntryHistory(f.t, filed.id, staff)).revisions.map(
              (revision) => revision.id,
            ),
            ownerHistory: (yield* assessment.getEntryHistory(f.t, filed.id, owner)).revisions.map(
              (revision) => revision.id,
            ),
            firstFile: yield* Effect.exit(assessment.openAttachment(f.t, first, staff)),
            secondFile: yield* Effect.exit(assessment.openAttachment(f.t, second, staff)),
            ownSecondFile: yield* Effect.exit(assessment.openAttachment(f.t, second, owner)),
          }
          yield* assessment.setEntryStatus(f.t, filed.id, 'in_review', owner)
          const resent = {
            last: yield* lastHandedIn(filed.id),
            staff: (yield* assessment.getEntry(f.t, filed.id, staff)).currentRevision?.id,
            secondFile: yield* Effect.exit(assessment.openAttachment(f.t, second, staff)),
          }
          return { handed, working, afterSubmit, whileRevising, resent }
        }),
      ),
    )
    expect(result.afterSubmit).toBe(result.handed)
    const revising = result.whileRevising
    expect(revising.last).toBe(result.handed)
    expect(revising.staff).toBe(result.handed)
    expect(revising.owner).toBe(result.working)
    expect(revising.listed).toEqual([result.handed])
    expect(revising.staffHistory).toEqual([result.handed])
    expect(revising.ownerHistory).toEqual([result.handed, result.working])
    expect(Exit.isSuccess(revising.firstFile)).toBe(true)
    expect(Exit.isFailure(revising.secondFile)).toBe(true)
    expect(Exit.isSuccess(revising.ownSecondFile)).toBe(true)
    // sent again, the revision is what everybody reads
    expect(result.resent.last).toBe(result.working)
    expect(result.resent.staff).toBe(result.working)
    expect(Exit.isSuccess(result.resent.secondFile)).toBe(true)
  })
})
