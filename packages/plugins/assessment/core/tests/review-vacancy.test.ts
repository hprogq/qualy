import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// A `nearestRole` step nobody holds anywhere above the participant is a
// vacancy (ADR 0007): the round has to stand there, blocked, with no unit to
// name. Every door that moves a round onto a step - submitting, approving
// onward, climbing the escalation route, appealing - used to read the
// missing unit as "the route ends here" and refuse, which left an upstream
// judge able only to approve and a participant told their claim could not
// be reviewed.

const REVIEW_OPEN = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.appeal',
]

/** a role nobody is appointed to, anywhere */
const vacantRole = (f: Seeded) =>
  Effect.map(
    runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, anchor_mode)
      values (${f.t}, 'counsellor', 'Counsellor', 'org', 'active', 'allow-list') returning id`),
    (result) => one<{ id: string }>(result).id,
  )

const classStep = (f: Seeded, id: string) => ({
  id,
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

const counsellorStep = (id: string, roleId: string) => ({
  id,
  selector: { kind: 'nearestRole', roleId },
  quorum: { type: 'any' },
})

const standing = (instanceId: string) =>
  Effect.map(
    runSql(sql`
      select state, blocked_reason, current_stage_id, current_node_id, current_node_path::text
      from review_instances where id = ${instanceId}`),
    (result) =>
      one<{
        state: string
        blocked_reason: string | null
        current_stage_id: string
        current_node_id: string | null
        current_node_path: string | null
      }>(result),
  )

describe.runIf(postgresAvailable)('a vacant step', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-vacancy')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('takes a submission whose first step nobody holds, and lets it be taken back', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-vacant-first')
          const assessment = yield* Assessment
          const counsellor = yield* vacantRole(f)
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [counsellorStep('counsellor', counsellor)],
          })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          const parked = yield* standing(round)
          // nobody has judged anything, so the filing can still come back;
          // ending a round that stands nowhere keeps its place as nowhere
          const back = yield* assessment.setEntryStatus(f.t, entry.id, 'draft', s1)
          const ended = yield* standing(round)
          return { parked, back: back.status, ended }
        }),
      ),
    )
    expect(result.parked).toEqual({
      state: 'blocked',
      blocked_reason: 'no-assignee',
      current_stage_id: 'counsellor',
      current_node_id: null,
      current_node_path: null,
    })
    expect(result.back).toBe('draft')
    expect(result.ended).toMatchObject({ state: 'completed', current_node_id: null })
  })

  it('hands an approval on to a vacant step instead of refusing it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-vacant-next')
          const assessment = yield* Assessment
          const counsellor = yield* vacantRole(f)
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [classStep(f, 'class'), counsellorStep('counsellor', counsellor)],
          })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          const moved = yield* assessment.decideReview(
            f.t,
            round,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const claim = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${entry.id}`),
          )
          return { moved, parked: yield* standing(round), claim }
        }),
      ),
    )
    // the confirmation is on the record and the round waits for a
    // counsellor rather than ending with the class's word alone
    expect(result.moved.events.map((event) => event.kind)).toEqual([
      'submitted',
      'approved',
      'assignee-not-found',
    ])
    expect(result.parked).toMatchObject({
      state: 'blocked',
      blocked_reason: 'no-assignee',
      current_stage_id: 'counsellor',
      current_node_id: null,
    })
    expect(result.claim.status).toBe('in_review')
  })

  it('climbs an objection onto a vacant rung, and opens an appeal on one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-vacant-rung')
          const assessment = yield* Assessment
          const counsellor = yield* vacantRole(f)
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [classStep(f, 'class')],
            escalation: [counsellorStep('counsellor', counsellor)],
          })
          const reviewer = f.principal(f.reviewer)
          const s1 = f.principal(f.s1)
          const s2 = f.principal(f.s2)
          // escalating onto a route whose only rung is vacant
          const first = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const firstSent = yield* assessment.setEntryStatus(f.t, first.id, 'in_review', s1)
          const escalated = yield* assessment.decideReview(
            f.t,
            firstSent.currentReviewInstanceId!,
            { decision: 'escalate', comment: '拿不准，提请复核' },
            reviewer,
          )
          // and a refused claim appealed onto the same route
          const second = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            s2,
          )
          const secondSent = yield* assessment.setEntryStatus(f.t, second.id, 'in_review', s2)
          yield* assessment.decideReview(
            f.t,
            secondSent.currentReviewInstanceId!,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          const appealed = yield* assessment.appealEntry(f.t, second.id, { reason: '请复核' }, s2)
          return {
            escalated: yield* standing(escalated.id),
            escalatedEvents: escalated.events.map((event) => event.kind),
            appealed: yield* standing(appealed.id),
          }
        }),
      ),
    )
    expect(result.escalated).toMatchObject({
      state: 'blocked',
      blocked_reason: 'no-assignee',
      current_stage_id: 'counsellor',
      current_node_id: null,
    })
    expect(result.escalatedEvents).toEqual(['submitted', 'escalated', 'assignee-not-found'])
    expect(result.appealed).toMatchObject({
      state: 'blocked',
      blocked_reason: 'no-assignee',
      current_stage_id: 'counsellor',
      current_node_id: null,
    })
  })
  // Appointing somebody is what ends a vacancy: the patrol asks the vacant
  // step again along the same frozen lineage, places the round at the unit
  // it finds and releases it, without the question being edited to force a
  // reroute.
  it('wakes a round at a vacant step once somebody is appointed to it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-vacant-heal')
          const assessment = yield* Assessment
          const counsellor = yield* vacantRole(f)
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [counsellorStep('counsellor', counsellor)],
          })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const round = (yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1))
            .currentReviewInstanceId!
          const idle = yield* assessment.patrolReviewRounds
          const stillVacant = yield* standing(round)
          // a counsellor appointed at the student's class, whose review
          // authority the round accepts
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${counsellor}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const who = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Counsellor', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const grant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${who}, ${counsellor}, ${f.classA}, 'self') returning id`),
          ).id
          const source = one<{ id: string }>(
            yield* runSql(sql`
              insert into batch_access_sources
                (tenant_id, batch_id, role_assignment_id, subject_id, origin)
              values (${f.t}, ${g.batch.id}, ${grant}, ${who}, 'explicit') returning id`),
          ).id
          yield* runSql(sql`
            insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
            values (${f.t}, ${source}, 'assessment.review.process')`)
          const woke = yield* assessment.patrolReviewRounds
          const placed = yield* standing(round)
          const decided = yield* assessment.decideReview(
            f.t,
            round,
            { decision: 'approve' },
            f.principal(who),
          )
          return { idle, stillVacant, woke, placed, decided: decided.outcome, classA: f.classA }
        }),
      ),
    )
    expect(result.idle.released).toBe(0)
    expect(result.stillVacant).toMatchObject({ state: 'blocked', current_node_id: null })
    expect(result.woke.released).toBe(1)
    expect(result.placed).toMatchObject({
      state: 'active',
      blocked_reason: null,
      current_stage_id: 'counsellor',
      current_node_id: result.classA,
    })
    expect(result.decided).toBe('approved')
  })
})
