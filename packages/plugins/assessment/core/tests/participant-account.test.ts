import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed } from './support/round.ts'

/** the shape every item in these rounds is configured with */
const itemConfig = (f: { classType: string; reviewRole: string }) => ({
  entrySource: 'student' as const,
  formConfig: { files: {} },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: '1.00' } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  reviewPolicy: {
    normal: {
      stages: [
        {
          id: 's1',
          selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
          quorum: { type: 'any' },
        },
      ],
    },
    escalation: { stages: [] },
  },
})

// Reading somebody else's account: who may, what they get, and what the
// number they get has to agree with.
//
// The claim this suite exists for is not "an administrator can open the
// page". It is that the page is not a second opinion: the total an
// administrator checks and the total the participant reads come out of one
// piece of arithmetic, so the two can never drift into disagreeing about the
// same round. And that the door is administrative reach over THIS roster -
// not holding a review permission somewhere, not holding a membership row.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

describe.runIf(postgresAvailable)("one participant's account, read by staff", () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-participant-account')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('answers the administrator with exactly what the participant reads', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pa-same')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const admin = f.principal(f.admin)
          // one approved claim, so there is an amount for the two reads to
          // agree about rather than two empty accounts agreeing trivially
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const mine = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          const theirs = yield* assessment.getParticipantResult(f.t, g.batch.id, g.p1, admin)
          const claims = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, admin)
          const who = yield* assessment.getParticipant(f.t, g.batch.id, g.p1, admin)
          return { mine, theirs, claims, who, entryId: entry.id }
        }),
      ),
    )
    // the same account, line for line: one arithmetic, two doors
    expect(result.theirs).toEqual(result.mine)
    expect(result.who.id).toBe(result.claims.participantId)
    expect(result.claims.entries.map((one) => one.entry.id)).toEqual([result.entryId])
    // and the determination the amount was computed from is readable, which
    // the owner's own page never carried
    expect(result.claims.entries[0]!.recognition).not.toBeNull()
    expect(result.claims.entries[0]!.recognition!.source).toBe('review')
  })

  it('refuses everyone who does not administer this roster', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pa-doors')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // a participant of the same round asking about somebody else, a
          // reviewer who may judge claims in it, and a stranger
          const peer = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, g.p1, f.principal(f.s2)),
          )
          const peerEntries = yield* Effect.exit(
            assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, f.principal(f.s2)),
          )
          const reviewer = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, g.p1, f.principal(f.reviewer)),
          )
          const reviewerWho = yield* Effect.exit(
            assessment.getParticipant(f.t, g.batch.id, g.p1, f.principal(f.reviewer)),
          )
          const outsider = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Nobody', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const stranger = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, g.p1, f.principal(outsider)),
          )
          // and one id that is real, but on another round's roster
          const other = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const elsewhere = yield* Effect.exit(
            assessment.getParticipantResult(f.t, g.batch.id, other.p2, admin),
          )
          const elsewhereEntries = yield* Effect.exit(
            assessment.listParticipantEntries(f.t, g.batch.id, other.p2, {}, admin),
          )
          return {
            peer,
            peerEntries,
            reviewer,
            reviewerWho,
            stranger,
            elsewhere,
            elsewhereEntries,
          }
        }),
      ),
    )
    for (const refused of [
      result.peer,
      result.peerEntries,
      result.reviewer,
      result.reviewerWho,
      result.stranger,
    ]) {
      expect(errorOf<{ _tag: string }>(refused)?._tag).toBe('ACCESS_DENIED')
    }
    // Judging claims is not reading accounts. A reviewer sees the claims
    // routed to them, and that is a different question from "show me
    // everything this person has ever filed".
    expect(errorOf<{ _tag: string }>(result.reviewer)?._tag).toBe('ACCESS_DENIED')
    // an id from another round is not somebody else's participant here: it
    // is nobody, and the answer says exactly that
    for (const missing of [result.elsewhere, result.elsewhereEntries]) {
      expect(errorOf<{ _tag: string }>(missing)?._tag).toBe('ASSESSMENT_PARTICIPANT_NOT_FOUND')
    }
  })

  it('still reads the account of somebody taken off the roster', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pa-excluded')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            undefined,
            admin,
          )
          // taking somebody off a round keeps everything they filed; the
          // account is how anybody checks what that was
          const who = yield* assessment.getParticipant(f.t, g.batch.id, g.p1, admin)
          const claims = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, admin)
          const account = yield* assessment.getParticipantResult(f.t, g.batch.id, g.p1, admin)
          return { who, claims, account, entryId: entry.id }
        }),
      ),
    )
    expect(result.who.status).toBe('excluded')
    expect(result.claims.entries.map((one) => one.entry.id)).toEqual([result.entryId])
    expect(result.account.mode).toBe('provisional')
  })

  it('pages one participant at a time, and refuses another one’s cursor', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pa-paging')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // two questions, so one person can hold two claims
          const second = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '第二题',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: itemConfig(f),
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, second.id, { status: 'active' }, admin)
          const s1 = f.principal(f.s1)
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.createEntry(
            f.t,
            { itemId: second.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          const first = yield* assessment.listParticipantEntries(
            f.t,
            g.batch.id,
            g.p1,
            { limit: '1' },
            admin,
          )
          const next = yield* assessment.listParticipantEntries(
            f.t,
            g.batch.id,
            g.p1,
            { limit: '1', cursor: first.nextCursor! },
            admin,
          )
          // the same cursor, pointed at a different person: a cursor only
          // means something against the question it came from
          const crossed = yield* Effect.exit(
            assessment.listParticipantEntries(
              f.t,
              g.batch.id,
              g.p2,
              { cursor: first.nextCursor! },
              admin,
            ),
          )
          const theirs = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p2, {}, admin)
          return { first, next, crossed, theirs }
        }),
      ),
    )
    expect(result.first.entries).toHaveLength(1)
    expect(result.next.entries).toHaveLength(1)
    expect(result.first.entries[0]!.entry.id).not.toBe(result.next.entries[0]!.entry.id)
    expect(result.next.nextCursor).toBeNull()
    expect(errorOf<{ _tag: string }>(result.crossed)?._tag).toBe('BAD_REQUEST')
    // one person's page is one person's claims, never the round's
    expect(result.theirs.entries).toHaveLength(1)
  })

  it('keeps the determination when an administrative entry is withdrawn', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pa-void')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // an administrative record: the kind whose correction is to
          // withdraw it, because there is no author to hand it back to
          const recorded = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '行政登记',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: { ...itemConfig(f), entrySource: 'administrative' as const },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, recorded.id, { status: 'active' }, admin)
          // an administrative fact carries the document it rests on; the
          // service refuses one without a basis, which is the point of it
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: recorded.id, participantId: g.p1, payload: {}, note: '校纪字〔2026〕7号' },
            f.principal(f.recorder),
          )
          const before = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, admin)
          // Unmaking a record answers to the record authority rather than
          // to running the round: whoever could have entered the fact is who
          // may withdraw it. This round's administrator holds both, which is
          // the ordinary case and the one the screen is drawn for.
          yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'void', reason: '登记有误' },
            admin,
          )
          // the subject of a record is never the one who unmakes it, however
          // much authority they otherwise hold
          const selfServed = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              entry.id,
              { kind: 'void', reason: '我不认可' },
              f.principal(f.s1),
            ),
          )
          const after = yield* assessment.listParticipantEntries(f.t, g.batch.id, g.p1, {}, admin)
          const rows = yield* runSql(
            sql`select count(*)::int as n from entry_recognitions where entry_id = ${entry.id}`,
          )
          return { before, after, selfServed, kept: one<{ n: number }>(rows).n }
        }),
      ),
    )
    expect(errorOf<{ _tag: string }>(result.selfServed)?._tag).toBe(
      'ASSESSMENT_ENTRY_ACTION_REFUSED',
    )
    expect(result.before.entries[0]!.entry.status).not.toBe('voided')
    expect(result.after.entries[0]!.entry.status).toBe('voided')
    // the claim stops counting; nothing about what was determined is erased
    expect(result.kept).toBeGreaterThan(0)
  })
})
