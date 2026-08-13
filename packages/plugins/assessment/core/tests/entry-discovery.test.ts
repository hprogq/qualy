import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed, staged } from './support/round.ts'

// The way back in. A browser refresh forgets every entry id it ever held;
// these two reads are how a participant finds their filings again and how
// anyone entitled reads the whole account of one claim.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

describe.runIf(postgresAvailable)('finding entries again', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-entry-discovery')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('lists every state of one’s own filings, pages them, and shows nobody else’s', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ed-list')
          const assessment = yield* Assessment
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          // one item allows one entry per person; three items give the
          // caller three filings in three states
          const second = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '志愿服务',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: itemConfig(f),
            },
            f.principal(f.admin),
          )
          const third = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '晨读打卡',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: itemConfig(f),
            },
            f.principal(f.admin),
          )
          const draft = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.createEntry(
            f.t,
            { itemId: second.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.setEntryStatus(f.t, submitted.id, 'in_review', s1)
          const judged = yield* assessment.createEntry(
            f.t,
            { itemId: third.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, judged.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'reject', comment: 'try again' },
            f.principal(f.reviewer),
          )
          // a neighbour's filing must never surface in this list
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )

          const all = yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)
          const page1 = yield* assessment.listMyEntries(f.t, g.batch.id, { limit: '2' }, s1)
          const page2 = yield* assessment.listMyEntries(
            f.t,
            g.batch.id,
            { limit: '2', cursor: page1.nextCursor! },
            s1,
          )
          const neighbour = yield* assessment.listMyEntries(f.t, g.batch.id, {}, f.principal(f.s2))
          // enrolled after the roster was drawn: no membership row, no "my"
          const latecomer = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Latecomer', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const outsider = yield* Effect.exit(
            assessment.listMyEntries(f.t, g.batch.id, {}, f.principal(latecomer)),
          )
          return { all, page1, page2, neighbour, outsider, draft, submitted, judged }
        }),
      ),
    )

    expect(result.all.entries.map((entry) => [entry.id, entry.status])).toEqual([
      [result.draft.id, 'draft'],
      [result.submitted.id, 'in_review'],
      [result.judged.id, 'rejected'],
    ])
    expect(result.all.nextCursor).toBeNull()
    expect(result.page1.entries).toHaveLength(2)
    expect(result.page2.entries.map((entry) => entry.id)).toEqual([result.judged.id])
    expect(result.page2.nextCursor).toBeNull()
    expect(result.neighbour.entries).toHaveLength(1)
    expect(result.neighbour.entries[0]!.id).not.toBe(result.draft.id)
    // the round itself is not theirs to see: visibility answers before
    // membership, the same order as every batch read
    expect(errorOf<{ _tag: string }>(result.outsider)?._tag).toBe('ACCESS_DENIED')
  })

  it('tells each reader who they are in each round, and only there', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ed-caps')
          const assessment = yield* Assessment
          const a = yield* runningBatch(f)
          const b = yield* runningBatch(f)
          // both rounds inherited the same tenant assignments; the second
          // one takes the reviewer's authority back, so the same person is
          // a reviewer in A and nobody of the kind in B
          yield* runSql(sql`
            insert into batch_access_denies (tenant_id, batch_id, subject_id, permission_code)
            values (${f.t}, ${b.batch.id}, ${f.reviewer}, 'assessment.review.process')`)
          yield* assessment.setParticipantStatus(
            f.t,
            a.batch.id,
            a.p1,
            'excluded',
            'moved away',
            f.principal(f.admin),
          )
          const capsOf = (batchId: string, who: string) =>
            Effect.map(
              assessment.getBatch(f.t, batchId, f.principal(who)),
              (batch) => batch.capabilities,
            )
          return {
            reviewerInA: yield* capsOf(a.batch.id, f.reviewer),
            reviewerInB: yield* capsOf(b.batch.id, f.reviewer),
            recorder: yield* capsOf(a.batch.id, f.recorder),
            student: yield* capsOf(a.batch.id, f.s2),
            excluded: yield* capsOf(a.batch.id, f.s1),
            admin: yield* capsOf(a.batch.id, f.admin),
          }
        }),
      ),
    )

    expect(result.reviewerInA).toMatchObject({ review: true, record: false, manage: false })
    expect(result.reviewerInB).toMatchObject({ review: false })
    expect(result.recorder).toMatchObject({ review: false, record: true })
    expect(result.student).toMatchObject({
      personal: true,
      review: false,
      record: false,
      manage: false,
    })
    // exclusion takes back eligibility, never the standing of having been in
    expect(result.excluded).toMatchObject({ personal: true })
    expect(result.admin).toMatchObject({ manage: true })
  })

  it('hands back the whole account of one claim, to its own people only', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ed-history')
          const assessment = yield* Assessment
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const file = yield* staged(f.t, f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            {
              decision: 'reject',
              comment: 'date the certificate',
              suggestedPayload: { files: [file], hint: 'add the issue date' },
            },
            f.principal(f.reviewer),
          )
          yield* assessment.appendEntryRevision(
            f.t,
            entry.id,
            { payload: { files: [file], dated: '2026-05-01' } },
            s1,
          )
          const resent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            resent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )

          const own = yield* assessment.getEntryHistory(f.t, entry.id, s1)
          const admin = yield* assessment.getEntryHistory(f.t, entry.id, f.principal(f.admin))
          const stranger = yield* Effect.exit(
            assessment.getEntryHistory(f.t, entry.id, f.principal(f.s2)),
          )
          return { own, admin, stranger, file }
        }),
      ),
    )

    expect(result.own.entry.status).toBe('approved')
    expect(result.own.revisions.map((revision) => revision.revisionNo)).toEqual([1, 2])
    expect(result.own.revisions[0]!.attachments).toEqual([
      { attachmentId: result.file, position: 0 },
    ])
    expect(result.own.rounds.map((round) => [round.roundNo, round.outcome])).toEqual([
      [1, 'rejected'],
      [2, 'approved'],
    ])
    const rejection = result.own.rounds[0]!.events.find((event) => event.kind === 'rejected')!
    expect(rejection.comment).toBe('date the certificate')
    expect(rejection.suggestedPayload).toMatchObject({ hint: 'add the issue date' })
    // each round names the revision it judged, so the reader can line the
    // two histories up
    expect(result.own.rounds[0]!.revisionId).toBe(result.own.revisions[0]!.id)
    expect(result.own.rounds[1]!.revisionId).toBe(result.own.revisions[1]!.id)
    expect(result.admin.revisions).toHaveLength(2)
    expect(errorOf<{ _tag: string }>(result.stranger)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
  })
})

/** the one standard student item shape these cases reuse */
const itemConfig = (f: { classType: string; reviewRole: string }) => ({
  entrySource: 'student' as const,
  formConfig: { files: {} },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: '1.00' } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  reviewPolicy: {
    stages: [
      {
        selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
        quorum: { type: 'any' },
      },
    ],
    normalTerminal: 0,
  },
})
