import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
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

// Reopening (ruling of 2026-09-25): staff contesting a conclusion on the
// participant's behalf. It walks the whole escalation route from its first
// live step, exactly as an appeal does, and it is not the participant's
// appeal - the conclusion it reaches is new, and has one of its own. A
// question with no escalation route cannot be reopened.

const OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.review.reopen',
  'assessment.entry.appeal',
]

const accept = (t: string, batchId: string, subjectId: string, assignmentId: string) =>
  runSql(sql`
    with s as (
      insert into batch_access_sources (tenant_id, batch_id, role_assignment_id, subject_id, origin)
      values (${t}, ${batchId}, ${assignmentId}, ${subjectId}, 'explicit')
      returning tenant_id, id
    )
    insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
    select tenant_id, id, 'assessment.review.process' from s`)

/** a two-step escalation route with a judge of its own at each step, and a reopener */
const world = (f: Seeded, over?: { escalation?: boolean }) =>
  Effect.gen(function* () {
    const role = (code: string) =>
      Effect.gen(function* () {
        const id = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, anchor_mode)
            values (${f.t}, ${code}, ${code}, 'org', 'active', 'allow-list') returning id`),
        ).id
        yield* runSql(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${f.t}, ${id}, p.id from permissions p
          where p.code = 'assessment.review.process'`)
        return id
      })
    const midRole = yield* role('grade-lead')
    const endRole = yield* role('counsellor')
    const step = (id: string, roleId: string) => ({
      id,
      selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [roleId] },
      quorum: { type: 'any' },
    })
    const g = yield* runningBatch(f, {
      profile: OPEN,
      escalation: over?.escalation === false ? [] : [step('grade', midRole), step('end', endRole)],
    })
    const judgeAs = (name: string, roleId: string) =>
      Effect.gen(function* () {
        const who = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.t}, ${name}, ${f.studentType}, ${f.classA}) returning id`),
        ).id
        const grant = one<{ id: string }>(
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${who}, ${roleId}, ${f.classA}, 'self') returning id`),
        ).id
        yield* accept(f.t, g.batch.id, who, grant)
        return who
      })
    const mid = yield* judgeAs('Grade Lead', midRole)
    const end = yield* judgeAs('Counsellor', endRole)
    const reopener = yield* appointStaff(f, g.batch.id, {
      name: 'Reviewer General',
      at: f.root,
      codes: ['assessment.review.reopen', 'assessment.batch.manage'],
    })
    return { g, mid, end, reopener: reopener.who }
  })

const approvedClaim = (f: Seeded, g: { item: { id: string }; p1: string }) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const s1 = f.principal(f.s1)
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
    return { entryId: entry.id, decision: sent.currentReviewInstanceId! }
  })

describe.runIf(postgresAvailable)('reopening a concluded claim', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-reopen')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('walks the whole escalation route and spends nothing of the participant’s', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ro-walk')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const s1 = f.principal(f.s1)
          const claim = yield* approvedClaim(f, w.g)
          const offered = (yield* assessment.listParticipantEntries(
            f.t,
            w.g.batch.id,
            w.g.p1,
            {},
            f.principal(w.reopener),
          )).entries[0]!.corrections.reopen
          const opened = yield* assessment.reopenEntry(
            f.t,
            claim.entryId,
            { reason: '抽查发现证书存疑' },
            f.principal(w.reopener),
          )
          const round = one<{
            origin: string
            initiator: string
            appealed_instance_id: string
            current_stage_id: string
          }>(
            yield* runSql(sql`
              select origin, initiator, appealed_instance_id, current_stage_id
              from review_instances where id = ${opened.id}`),
          )
          const during = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${claim.entryId}`),
          )
          // the first step only gives an opinion; the last one concludes
          yield* assessment.decideReview(
            f.t,
            opened.id,
            { decision: 'reject', comment: '证书与本人不符' },
            f.principal(w.mid),
          )
          const concluded = yield* assessment.decideReview(
            f.t,
            opened.id,
            { decision: 'reject', comment: '撤销原通过' },
            f.principal(w.end),
          )
          const after = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${claim.entryId}`),
          )
          // the reopening reached a new conclusion, and it has its appeal
          const appeal = (yield* assessment.getEntry(f.t, claim.entryId, s1)).capabilities.appeal
          const appealed = yield* Effect.exit(
            assessment.appealEntry(f.t, claim.entryId, { reason: '证书属实' }, s1),
          )
          // and the participant is told their claim was reopened, not only
          // shown a dot
          const told = (yield* assessment.listMyActivity(
            f.t,
            w.g.batch.id,
            { perspective: 'participant' },
            s1,
          )).items.map((row) => row.kind)
          return { offered, opened, round, during, concluded, after, appeal, appealed, claim, told }
        }),
      ),
    )
    expect(result.offered).toEqual({ state: 'available', reason: null })
    expect(result.round).toMatchObject({
      origin: 'reopen',
      initiator: 'staff',
      appealed_instance_id: result.claim.decision,
      current_stage_id: 'grade',
    })
    expect(result.opened.events[0]?.kind).toBe('reopened')
    // the claim keeps counting while it is re-examined
    expect(result.during.status).toBe('approved')
    expect(result.concluded.outcome).toBe('rejected')
    expect(result.after.status).toBe('rejected')
    expect(result.appeal).toEqual({ state: 'available', reason: null })
    expect(Exit.isSuccess(result.appealed)).toBe(true)
    expect(result.told).toContain('review-reopened')
  })

  it('may reopen a conclusion whose one appeal is spent', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ro-after-appeal')
          const assessment = yield* Assessment
          const w = yield* world(f)
          const s1 = f.principal(f.s1)
          const claim = yield* approvedClaim(f, w.g)
          const appeal = yield* assessment.appealEntry(f.t, claim.entryId, { reason: '偏低' }, s1)
          yield* assessment.decideReview(
            f.t,
            appeal.id,
            { decision: 'approve', comment: '同意' },
            f.principal(w.mid),
          )
          yield* assessment.decideReview(
            f.t,
            appeal.id,
            { decision: 'approve' },
            f.principal(w.end),
          )
          const spent = (yield* assessment.getEntry(f.t, claim.entryId, s1)).capabilities.appeal
          const reopened = yield* Effect.exit(
            assessment.reopenEntry(
              f.t,
              claim.entryId,
              { reason: '工作组复查' },
              f.principal(w.reopener),
            ),
          )
          return { spent, reopened }
        }),
      ),
    )
    expect(result.spent).toEqual({ state: 'blocked', reason: 'appeal-exhausted' })
    expect(Exit.isSuccess(result.reopened)).toBe(true)
  })

  it('refuses a question with no escalation route, the participant and a stranger', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ro-refusals')
          const assessment = yield* Assessment
          const w = yield* world(f, { escalation: false })
          const claim = yield* approvedClaim(f, w.g)
          const offered = (yield* assessment.listParticipantEntries(
            f.t,
            w.g.batch.id,
            w.g.p1,
            {},
            f.principal(w.reopener),
          )).entries[0]!.corrections.reopen
          const noRoute = yield* Effect.exit(
            assessment.reopenEntry(f.t, claim.entryId, { reason: '复查' }, f.principal(w.reopener)),
          )
          const byStudent = yield* Effect.exit(
            assessment.reopenEntry(f.t, claim.entryId, { reason: '复查' }, f.principal(f.s1)),
          )
          const byStranger = yield* Effect.exit(
            assessment.reopenEntry(f.t, claim.entryId, { reason: '复查' }, f.principal(f.s2)),
          )
          return { offered, noRoute, byStudent, byStranger }
        }),
      ),
    )
    expect(result.offered).toEqual({ state: 'blocked', reason: 'no-appeal-route' })
    expect(refusalOf(result.noRoute)?.reason).toBe('no-appeal-route')
    expect(errorOf<{ _tag: string }>(result.byStudent)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(errorOf<{ _tag: string }>(result.byStranger)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
  })
})
