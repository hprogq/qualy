import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { twoFactScoring } from './support/catalogs.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// The escalation route as a pipeline (re-ruled 2026-09-25, replacing the
// ladder of §32.66 on which any step could approve for good). A reviewer
// answers the same question everywhere - yes or no, and when yes, what it is
// recognised as - and what that answer does is the route's business: in the
// middle of the escalation route it is an opinion the next step reads and
// starts from, and only the last live step concludes. An appeal walks the
// same route, so it can end better or worse than the decision it contests.

const REVIEW_OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
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

/**
 * The class reviewer on the ordinary route, and a two-step escalation
 * route: a middle step and a last one, each held by a role of its own.
 */
const pipelineWorld = (f: Seeded) =>
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
      profile: REVIEW_OPEN,
      scoring: twoFactScoring,
      stages: [step('class', f.reviewRole)],
      escalation: [step('grade', midRole), step('counsellor', endRole)],
    })
    const appointAs = (name: string, roleId: string) =>
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
    const mid = yield* appointAs('Grade Lead', midRole)
    const end = yield* appointAs('Counsellor', endRole)
    return { g, mid, end }
  })

const standing = (entryId: string) =>
  Effect.map(
    runSql(sql`
      select e.status,
        (select count(*)::int from entry_recognitions r where r.entry_id = e.id) as recognitions
      from entries e where e.id = ${entryId}`),
    (result) => one<{ status: string; recognitions: number }>(result),
  )

describe.runIf(postgresAvailable)('the escalation route as a pipeline', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-pipeline')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('carries a middle step’s approval up as the determination the last step starts from', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pl-opinion')
          const assessment = yield* Assessment
          const w = yield* pipelineWorld(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: w.g.item.id, participantId: w.g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            round,
            { decision: 'escalate', comment: '拿不准，提请复核' },
            f.principal(f.reviewer),
          )
          const atMiddle = yield* assessment.getReviewInstance(f.t, round, f.principal(w.mid))
          const opined = yield* assessment.decideReview(
            f.t,
            round,
            {
              decision: 'approve',
              comment: '建议认定为省级',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
            },
            f.principal(w.mid),
          )
          const midway = yield* standing(entry.id)
          const atEnd = yield* assessment.getReviewInstance(f.t, round, f.principal(w.end))
          // the last step judges for itself: a different determination from
          // the one it was handed has to say why
          const unexplained = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              round,
              {
                decision: 'approve',
                recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 2 } },
              },
              f.principal(w.end),
            ),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            round,
            {
              decision: 'approve',
              recognition: {
                values: { 'rec-level': 'national', 'rec-ordinal': 2 },
                reason: '证书为国家级',
              },
            },
            f.principal(w.end),
          )
          const fact = one<{ values: Record<string, unknown>; created_by: string }>(
            yield* runSql(sql`
              select values, created_by from entry_recognitions where entry_id = ${entry.id}`),
          )
          return { atMiddle, opined, midway, atEnd, unexplained, settled, fact, end: w.end }
        }),
      ),
    )

    // approving in the middle is offered, and is not the verdict
    expect(result.atMiddle.actions.approve.state).toBe('available')
    expect(result.atMiddle.actions.approvalConcludes).toBe(false)
    // the opinion moved the round on and made nothing a fact
    expect(result.opined.state).toBe('active')
    expect(result.opined.chain.stageId).toBe('counsellor')
    expect(result.midway).toEqual({ status: 'in_review', recognitions: 0 })
    // the last step reads the opinion and starts from its determination
    expect(result.atEnd.actions.approvalConcludes).toBe(true)
    expect(result.atEnd.recognitionForm?.seed).toEqual({
      'rec-level': 'provincial',
      'rec-ordinal': 2,
    })
    const opinion = result.atEnd.events.find((event) => event.kind === 'opinion-approved')
    expect(opinion?.comment).toBe('建议认定为省级')
    expect(
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(result.unexplained)?.issues,
    ).toEqual([{ field: 'recognition.reason', reason: 'required' }])
    // only the last step's word is the conclusion, and the fact is its own
    expect(result.settled.outcome).toBe('approved')
    expect(result.fact.values).toEqual({ 'rec-level': 'national', 'rec-ordinal': 2 })
    expect(result.fact.created_by).toBe(result.end)
    expect(result.settled.events.map((event) => event.kind)).toEqual([
      'submitted',
      'escalated',
      'opinion-approved',
      'approved',
    ])
  })

  it('lets an appeal against an approval end in its revocation, whatever the middle said', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pl-appeal-down')
          const assessment = yield* Assessment
          const w = yield* pipelineWorld(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: w.g.item.id, participantId: w.g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 3 } },
            },
            f.principal(f.reviewer),
          )
          const appealed = yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '应认定为国家级' },
            s1,
          )
          // the middle step would uphold it; that is an opinion, not the end
          const upheldMidway = yield* assessment.decideReview(
            f.t,
            appealed.id,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 3 } },
            },
            f.principal(w.mid),
          )
          const during = yield* standing(entry.id)
          // the last step finds the claim should never have been approved
          const revoked = yield* assessment.decideReview(
            f.t,
            appealed.id,
            { decision: 'reject', comment: '证书与本人不符' },
            f.principal(w.end),
          )
          const after = yield* standing(entry.id)
          const again = yield* Effect.exit(
            assessment.decideReview(f.t, appealed.id, { decision: 'approve' }, f.principal(w.mid)),
          )
          return { upheldMidway, during, revoked, after, again }
        }),
      ),
    )

    expect(result.upheldMidway.state).toBe('active')
    expect(result.upheldMidway.chain.stageId).toBe('counsellor')
    // the claim kept counting while the appeal ran
    expect(result.during).toEqual({ status: 'approved', recognitions: 1 })
    expect(result.revoked.outcome).toBe('rejected')
    expect(result.after.status).toBe('rejected')
    expect(Exit.isFailure(result.again)).toBe(true)
  })
})
