import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { twoFactScoring } from './support/catalogs.ts'
import { appointStaff } from './support/correction.ts'
import {
  errorOf,
  GATED,
  ok,
  one,
  refusalOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// Re-determining a concluded claim (ruling of 2026-09-25): a power granted
// on purpose, answering the reviewer's question outside any round. The new
// result supersedes the old one, never edits it; an answer that changes
// nothing writes nothing; a round still contesting the claim ends with it;
// and a new unfavourable result can be appealed once.

const OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.appeal',
]

const world = (f: Seeded) =>
  Effect.gen(function* () {
    const g = yield* runningBatch(f, {
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
    // over the whole tenant, as an inspection group sits: its reach is the
    // batch's too, so the participant page is its to read
    const inspector = yield* appointStaff(f, g.batch.id, {
      name: 'Inspector',
      at: f.root,
      codes: ['assessment.entry.redetermine', 'assessment.batch.manage'],
    })
    return { g, inspector: inspector.who }
  })

/** one claim, submitted by its student and judged by the class reviewer */
const judged = (
  f: Seeded,
  g: { item: { id: string }; p1: string },
  word: 'approve' | 'reject',
  who: string = f.s1,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const owner = f.principal(who)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId: g.p1, payload: {} },
      owner,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
    yield* assessment.decideReview(
      f.t,
      sent.currentReviewInstanceId!,
      word === 'approve'
        ? {
            decision: 'approve',
            recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
          }
        : { decision: 'reject', comment: '材料不足' },
      f.principal(f.reviewer),
    )
    return entry.id
  })

const claimOf = (entryId: string) =>
  Effect.map(
    runSql(sql`
      select e.status, e.current_review_instance_id, e.current_recognition_id,
        (select count(*)::int from entry_recognitions r where r.entry_id = e.id) as recognitions,
        (select string_agg(kind, ',' order by created_at) from entry_events ev
          where ev.entry_id = e.id) as events
      from entries e where e.id = ${entryId}`),
    (result) =>
      one<{
        status: string
        current_review_instance_id: string | null
        current_recognition_id: string | null
        recognitions: number
        events: string | null
      }>(result),
  )

describe.runIf(postgresAvailable)('re-determining a concluded claim', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-redetermination')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('corrects, revokes and overturns, and writes nothing when nothing changes', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rd-kinds')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const as = f.principal(w.inspector)
          const approvedId = yield* judged(f, w.g, 'approve')
          const same = yield* Effect.exit(
            assessment.redetermineEntry(
              f.t,
              approvedId,
              {
                decision: 'approve',
                recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
                reason: '复核无误',
              },
              as,
            ),
          )
          const untouched = yield* claimOf(approvedId)
          const corrected = yield* assessment.redetermineEntry(
            f.t,
            approvedId,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 2 } },
              reason: '证书为国家级',
            },
            as,
          )
          const afterCorrection = yield* claimOf(approvedId)
          const fact = one<{ source: string; supersedes_id: string | null; created_by: string }>(
            yield* runSql(sql`
              select source, supersedes_id, created_by from entry_recognitions
              where id = ${afterCorrection.current_recognition_id}`),
          )
          const revoked = yield* assessment.redetermineEntry(
            f.t,
            approvedId,
            { decision: 'reject', reason: '证书与本人不符' },
            as,
          )
          const afterRevocation = yield* claimOf(approvedId)
          const again = yield* Effect.exit(
            assessment.redetermineEntry(
              f.t,
              approvedId,
              { decision: 'reject', reason: '再次确认' },
              as,
            ),
          )
          const rejectedId = yield* judged(f, { item: w.g.item, p1: w.g.p2 }, 'reject', f.s2)
          const overturned = yield* assessment.redetermineEntry(
            f.t,
            rejectedId,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 1 } },
              reason: '补充证明已核实',
            },
            as,
          )
          return {
            same,
            untouched,
            corrected,
            afterCorrection,
            fact,
            revoked,
            afterRevocation,
            again,
            overturned,
            overturnedClaim: yield* claimOf(rejectedId),
            inspector: w.inspector,
          }
        }),
      ),
    )
    // an answer that changes nothing is refused, and writes nothing
    expect(refusalOf(result.same)?.reason).toBe('redetermination-unchanged')
    expect(result.untouched).toMatchObject({ recognitions: 1, events: null })
    // a correction supersedes the old determination, never edits it
    expect(result.corrected).toMatchObject({ kind: 'recognition-corrected', status: 'approved' })
    expect(result.afterCorrection).toMatchObject({
      status: 'approved',
      current_review_instance_id: null,
      recognitions: 2,
      events: 'recognition-corrected',
    })
    expect(result.fact).toMatchObject({ source: 'redetermination', created_by: result.inspector })
    expect(result.fact.supersedes_id).not.toBeNull()
    // a revocation leaves the determinations as history
    expect(result.revoked).toMatchObject({ kind: 'approval-revoked', status: 'rejected' })
    expect(result.afterRevocation).toMatchObject({
      status: 'rejected',
      recognitions: 2,
      events: 'recognition-corrected,approval-revoked',
    })
    expect(refusalOf(result.again)?.reason).toBe('redetermination-unchanged')
    expect(result.overturned).toMatchObject({ kind: 'rejection-overturned', status: 'approved' })
    expect(result.overturnedClaim).toMatchObject({
      status: 'approved',
      events: 'rejection-overturned',
    })
  })

  it('ends an appeal still contesting the claim, with what it was waiting for', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rd-ends-appeal')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const s1 = f.principal(f.s1)
          const entryId = yield* judged(f, w.g, 'reject')
          const appeal = yield* assessment.appealEntry(f.t, entryId, { reason: '请复核' }, s1)
          yield* assessment.requestSupplement(
            f.t,
            appeal.id,
            {
              instructions: '请补充证书原件',
              requirements: [{ label: '证书', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          const done = yield* assessment.redetermineEntry(
            f.t,
            entryId,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 1 } },
              reason: '督查组核实通过',
            },
            f.principal(w.inspector),
          )
          const round = one<{ state: string; outcome: string }>(
            yield* runSql(sql`select state, outcome from review_instances where id = ${appeal.id}`),
          )
          const trail = (yield* runSql(sql`
            select kind from review_events where review_instance_id = ${appeal.id}
            order by created_at, id`)) as { rows: { kind: string }[] }
          const ask = one<{ status: string }>(
            yield* runSql(sql`
              select status from review_supplement_requests where review_instance_id = ${appeal.id}`),
          )
          const late = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              appeal.id,
              { decision: 'reject', comment: '维持' },
              f.principal(f.reviewer),
            ),
          )
          return { done, round, trail: trail.rows.map((row) => row.kind), ask, late }
        }),
      ),
    )
    expect(result.done).toMatchObject({ kind: 'rejection-overturned', endedRound: true })
    expect(result.round).toEqual({ state: 'completed', outcome: 'superseded-by-redetermination' })
    expect(result.trail.at(-1)).toBe('superseded-by-redetermination')
    expect(result.ask.status).toBe('superseded')
    // the old round can no longer be concluded over the new result
    expect(Exit.isFailure(result.late)).toBe(true)
  })

  it('gives the participant one appeal against a new unfavourable result', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rd-appeal')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const s1 = f.principal(f.s1)
          const entryId = yield* judged(f, w.g, 'approve')
          // the participant spends the appeal of the first result
          const first = yield* assessment.appealEntry(f.t, entryId, { reason: '等级偏低' }, s1)
          yield* assessment.decideReview(
            f.t,
            first.id,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
            },
            f.principal(f.reviewer),
          )
          const spent = (yield* assessment.getEntry(f.t, entryId, s1)).capabilities.appeal
          yield* assessment.redetermineEntry(
            f.t,
            entryId,
            { decision: 'reject', reason: '证书与本人不符' },
            f.principal(w.inspector),
          )
          const fresh = (yield* assessment.getEntry(f.t, entryId, s1)).capabilities.appeal
          const second = yield* assessment.appealEntry(f.t, entryId, { reason: '证书属实' }, s1)
          const target = one<{ appealed_event_id: string | null; kind: string }>(
            yield* runSql(sql`
              select r.appealed_event_id, ev.kind from review_instances r
              join entry_events ev on ev.id = r.appealed_event_id
              where r.id = ${second.id}`),
          )
          yield* assessment.decideReview(
            f.t,
            second.id,
            { decision: 'reject', comment: '维持撤销' },
            f.principal(f.reviewer),
          )
          const third = yield* Effect.exit(
            assessment.appealEntry(f.t, entryId, { reason: '仍然不服' }, s1),
          )
          return { spent, fresh, target, third }
        }),
      ),
    )
    expect(result.spent).toEqual({ state: 'blocked', reason: 'appeal-exhausted' })
    expect(result.fresh).toEqual({ state: 'available', reason: null })
    expect(result.target.kind).toBe('approval-revoked')
    expect(refusalOf(result.third)?.reason).toBe('appeal-exhausted')
  })

  it('is granted on purpose: not to an administrator by holding everything, nor to a stranger', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rd-authority')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const entryId = yield* judged(f, w.g, 'approve')
          const byAdmin = yield* Effect.exit(
            assessment.redetermineEntry(
              f.t,
              entryId,
              { decision: 'reject', reason: '管理员尝试' },
              f.principal(f.admin),
            ),
          )
          const accepted = (yield* runSql(sql`
            select sp.permission_code from batch_access_sources s
            join batch_access_source_permissions sp
              on sp.tenant_id = s.tenant_id and sp.source_id = s.id
            where s.batch_id = ${w.g.batch.id} and s.subject_id = ${f.admin}`)) as {
            rows: { permission_code: string }[]
          }
          const stranger = yield* Effect.exit(
            assessment.redetermineEntry(
              f.t,
              entryId,
              { decision: 'reject', reason: '陌生人' },
              f.principal(f.s2),
            ),
          )
          return {
            byAdmin,
            accepted: accepted.rows.map((row) => row.permission_code),
            stranger,
          }
        }),
      ),
    )
    expect(refusalOf(result.byAdmin)?.reason).toBe('permission-not-held')
    expect(result.accepted).not.toContain('assessment.entry.redetermine')
    expect(result.accepted).toContain('assessment.review.process')
    expect(errorOf<{ _tag: string }>(result.stranger)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
  })

  it('offers the correction on the participant page to its holder only', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rd-offer')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const entryId = yield* judged(f, w.g, 'approve')
          const draft = yield* assessment.createEntry(
            f.t,
            { itemId: w.g.item.id, participantId: w.g.p2, payload: {} },
            f.principal(f.s2),
          )
          const asInspector = yield* assessment.listParticipantEntries(
            f.t,
            w.g.batch.id,
            w.g.p1,
            {},
            f.principal(w.inspector),
          )
          const asInspectorDraft = yield* assessment.listParticipantEntries(
            f.t,
            w.g.batch.id,
            w.g.p2,
            {},
            f.principal(w.inspector),
          )
          const asAdmin = yield* assessment.listParticipantEntries(
            f.t,
            w.g.batch.id,
            w.g.p1,
            {},
            f.principal(f.admin),
          )
          void draft
          return {
            inspector: asInspector.entries.find((one) => one.entry.id === entryId)!.corrections,
            onDraft: asInspectorDraft.entries[0]!.corrections,
            admin: asAdmin.entries.find((one) => one.entry.id === entryId)!.corrections,
          }
        }),
      ),
    )
    expect(result.inspector.redetermine).toEqual({ state: 'available', reason: null })
    expect(result.onDraft.redetermine).toEqual({ state: 'hidden', reason: null })
    expect(result.admin.redetermine).toEqual({ state: 'hidden', reason: null })
  })
})
