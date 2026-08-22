import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import {
  errorOf,
  GATED,
  ok,
  one,
  refusalOf,
  run,
  runningBatch,
  seed,
  staged,
  type Seeded,
} from './support/round.ts'

// The single review stage under attack. Who may judge is one SQL definition
// shared with submit's arrival check, so most cases here flip one conjunct -
// standing, acceptance, the gate, distance - and watch the queue, the
// decision and the submission refuse together.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']
/** the same round with escalation shut off, as an appeal window has it */
const NO_DOUBTS = [...GATED, 'assessment.review.process']

/** an accepted source carrying review.process, the way a sync would write it */
const accept = (t: string, batchId: string, subjectId: string, assignmentId: string) =>
  runSql(sql`
    with s as (
      insert into batch_access_sources (tenant_id, batch_id, role_assignment_id, subject_id, origin)
      values (${t}, ${batchId}, ${assignmentId}, ${subjectId}, 'explicit')
      returning tenant_id, id
    )
    insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
    select tenant_id, id, 'assessment.review.process' from s`)

/** one student's entry, filed and submitted, back with its instance id */
const submitted = (f: Seeded, g: { item: { id: string } }, participantId: string, who: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId, payload: {} },
      as,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    return { entryId: entry.id, instanceId: sent.currentReviewInstanceId! }
  })

describe.runIf(postgresAvailable)('the single review stage', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-flow')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('answers the queue only to whoever the one definition admits', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-defn')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { instanceId } = yield* submitted(f, g, g.p1, f.s1)

          // somebody holding the same role over the whole college, accepted
          // and all - a subtree grant participates in jurisdiction, never in
          // stage membership
          const collegeA = one<{ id: string }>(
            yield* runSql(
              sql`select id from org_nodes where tenant_id = ${f.t} and name = 'College A'`,
            ),
          ).id
          const wide = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Vice Dean', ${f.studentType}, ${collegeA}) returning id`),
          ).id
          const wideGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${wide}, ${f.reviewRole}, ${collegeA}, 'subtree') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, wide, wideGrant)

          // the same role anchored on the stage node itself, written the way
          // an administrator ordinarily writes one - coverage says nothing
          // about membership, the anchor does
          const near = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Head Teacher', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const nearGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${near}, ${f.reviewRole}, ${f.classA}, 'subtree') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, near, nearGrant)

          const queueOf = (who: string) =>
            Effect.map(assessment.listReviewInbox(f.t, {}, f.principal(who)), (page) => page.items)
          const forReviewer = yield* queueOf(f.reviewer)
          const forWide = yield* queueOf(wide)
          const forNear = yield* queueOf(near)
          const forRecorder = yield* queueOf(f.recorder)

          // take the acceptance back: the queue empties, and the next
          // submission cannot even arrive - one definition, both doors
          yield* runSql(sql`
            insert into batch_access_denies (tenant_id, batch_id, subject_id, permission_code)
            values (${f.t}, ${g.batch.id}, ${f.reviewer}, 'assessment.review.process')`)
          const denied = yield* queueOf(f.reviewer)
          // the submission still lands - a round with nobody in it waits for
          // somebody rather than blaming the student - but the queue that
          // one definition governs is empty for the person just denied
          const arrival = yield* submitted(f, g, g.p2, f.s2)
          const afterArrival = yield* queueOf(f.reviewer)

          return {
            instanceId,
            forReviewer,
            forWide,
            forNear,
            forRecorder,
            denied,
            arrival,
            afterArrival,
          }
        }),
      ),
    )

    expect(result.forReviewer).toHaveLength(1)
    expect(result.forReviewer[0]).toMatchObject({
      instanceId: result.instanceId,
      batchName: 'Round',
      itemTitle: '退役复学',
      participantName: 'Zhang San',
      roundNo: 1,
    })
    // anchored above the stage: jurisdiction, not membership
    expect(result.forWide).toEqual([])
    // anchored on the stage's own node: a member, whatever its coverage
    expect(result.forNear.map((item) => item.instanceId)).toEqual([result.instanceId])
    expect(result.forRecorder).toEqual([])
    expect(result.denied).toEqual([])
    expect(result.arrival.instanceId).toBeDefined()
    expect(result.afterArrival).toEqual([])
  })

  it('admits a stage grant only once the batch accepted that very assignment', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-same-src')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { instanceId } = yield* submitted(f, g, g.p1, f.s1)

          // an inspector: review.process accepted into this batch, through a
          // role that is NOT the stage's
          const inspectorRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'inspector', 'Inspector', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${inspectorRole}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const inspector = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Inspector', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const inspectorGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${inspector}, ${inspectorRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, inspector, inspectorGrant)

          // now they are also handed the stage role - but the batch has not
          // accepted THAT assignment, and the older acceptance may not carry it
          const stageGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${inspector}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          const queueOf = () =>
            Effect.map(
              assessment.listReviewInbox(f.t, {}, f.principal(inspector)),
              (page) => page.items,
            )
          const borrowed = yield* queueOf()
          const judged = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve' },
              f.principal(inspector),
            ),
          )

          yield* accept(f.t, g.batch.id, inspector, stageGrant)
          const accepted = yield* queueOf()
          return { borrowed, judged, accepted, instanceId }
        }),
      ),
    )

    expect(result.borrowed).toEqual([])
    // not even readable through the stage: without the accepted stage
    // assignment they are a stranger to this round
    expect(errorOf<{ _tag: string }>(result.judged)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(result.accepted.map((item) => item.instanceId)).toEqual([result.instanceId])
  })

  it('keeps judging shut while the phase is', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-gate')
          const assessment = yield* Assessment
          // the entry phase as it usually is: filing open, judging not yet
          const g = yield* runningBatch(f)
          const { instanceId } = yield* submitted(f, g, g.p1, f.s1)
          const queue = yield* assessment.listReviewInbox(f.t, {}, f.principal(f.reviewer))
          const decided = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve' },
              f.principal(f.reviewer),
            ),
          )
          const detail = yield* assessment.getReviewInstance(
            f.t,
            instanceId,
            f.principal(f.reviewer),
          )
          return { queue: queue.items, decided, detail }
        }),
      ),
    )

    expect(result.queue).toEqual([])
    expect(refusalOf(result.decided)?.reason).toBe('phase-closed')
    expect(result.detail.capabilities.canDecide).toBe(false)
  })

  it('closes a round exactly once', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-close')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { entryId, instanceId } = yield* submitted(f, g, g.p1, f.s1)
          const reviewer = f.principal(f.reviewer)
          const before = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          const approved = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve', comment: 'checked against the certificate' },
            reviewer,
          )
          const again = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'reject', comment: 'no' },
              reviewer,
            ),
          )
          const entry = yield* assessment.getEntry(f.t, entryId, f.principal(f.s1))
          const withdraw = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entryId, 'draft', f.principal(f.s1)),
          )
          return { before, approved, again, entry, withdraw }
        }),
      ),
    )

    expect(result.before.capabilities.canDecide).toBe(true)
    expect(result.before.state).toBe('active')
    expect(result.approved.state).toBe('completed')
    expect(result.approved.outcome).toBe('approved')
    expect(result.approved.events.map((event) => event.kind)).toEqual(['submitted', 'approved'])
    expect(result.approved.events[1]!.comment).toBe('checked against the certificate')
    expect(errorOf<{ _tag: string }>(result.again)?._tag).toBe('ASSESSMENT_REVIEW_CONFLICT')
    expect(result.entry.status).toBe('approved')
    expect(refusalOf(result.withdraw)?.reason).toBe('entry-not-withdrawable')
  })

  it('rejects only with a word, holds advice to the judged evidence, and reopens as a new round', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-reject')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const fileA = yield* staged(f.t, f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [fileA] } },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!

          const wordless = yield* Effect.exit(
            assessment.decideReview(f.t, instanceId, { decision: 'reject' }, reviewer),
          )
          const fileB = yield* staged(f.t, f.s1)
          const growing = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              {
                decision: 'reject',
                comment: 'swap the file',
                suggestedPayload: { files: [fileB] },
              },
              reviewer,
            ),
          )
          const advisedApproval = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', suggestedPayload: { files: [fileA] } },
              reviewer,
            ),
          )
          const rejected = yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'reject',
              comment: 'date the certificate',
              suggestedPayload: { files: [fileA], hint: 'add the issue date' },
            },
            reviewer,
          )
          const after = yield* assessment.getEntry(f.t, entry.id, s1)

          // advice moved nothing; the student's own next revision does
          const revised = yield* assessment.appendEntryRevision(
            f.t,
            entry.id,
            { payload: { files: [fileA], dated: '2026-05-01' } },
            s1,
          )
          const resent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round2 = yield* assessment.getReviewInstance(
            f.t,
            resent.currentReviewInstanceId!,
            reviewer,
          )
          const closed = yield* assessment.decideReview(
            f.t,
            resent.currentReviewInstanceId!,
            { decision: 'approve' },
            reviewer,
          )
          const final = yield* assessment.getEntry(f.t, entry.id, s1)
          return {
            wordless,
            growing,
            advisedApproval,
            rejected,
            after,
            revised,
            round2,
            closed,
            final,
          }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(exit)?.issues
    expect(issuesOf(result.wordless)).toEqual([{ field: 'comment', reason: 'required' }])
    expect(issuesOf(result.growing)).toEqual([{ field: 'files', reason: 'attachment-not-cited' }])
    expect(issuesOf(result.advisedApproval)).toEqual([
      { field: 'suggestedPayload', reason: 'not-allowed' },
    ])
    expect(result.rejected.outcome).toBe('rejected')
    const rejection = result.rejected.events[1]!
    expect(rejection.kind).toBe('rejected')
    expect(rejection.comment).toBe('date the certificate')
    expect(rejection.suggestedPayload).toMatchObject({ hint: 'add the issue date' })
    expect(result.after.status).toBe('rejected')
    expect(result.after.currentRevision!.revisionNo).toBe(1)
    expect(result.revised.status).toBe('draft')
    expect(result.round2.roundNo).toBe(2)
    expect(result.round2.revision.revisionNo).toBe(2)
    expect(result.closed.outcome).toBe('approved')
    expect(result.final.status).toBe('approved')
  })

  it('shows a round only to its own people, and lets none of them judge themselves', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-people')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          // the second student also holds the review role at the class,
          // accepted and all - distance is the only thing keeping them out
          const peerGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${f.s2}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, f.s2, peerGrant)
          const own = yield* submitted(f, g, g.p2, f.s2)

          const s2Queue = yield* assessment.listReviewInbox(f.t, {}, f.principal(f.s2))
          const selfJudged = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              own.instanceId,
              { decision: 'approve' },
              f.principal(f.s2),
            ),
          )
          const asSubject = yield* assessment.getReviewInstance(
            f.t,
            own.instanceId,
            f.principal(f.s2),
          )
          const asAdmin = yield* assessment.getReviewInstance(
            f.t,
            own.instanceId,
            f.principal(f.admin),
          )
          const adminJudged = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              own.instanceId,
              { decision: 'approve' },
              f.principal(f.admin),
            ),
          )
          const strangerRead = yield* Effect.exit(
            assessment.getReviewInstance(f.t, own.instanceId, f.principal(f.s3)),
          )
          const strangerJudged = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              own.instanceId,
              { decision: 'approve' },
              f.principal(f.s3),
            ),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            own.instanceId,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          return {
            s2Queue: s2Queue.items,
            selfJudged,
            asSubject,
            asAdmin,
            adminJudged,
            strangerRead,
            strangerJudged,
            settled,
          }
        }),
      ),
    )

    expect(result.s2Queue).toEqual([])
    expect(refusalOf(result.selfJudged)?.reason).toBe('not-reviewer')
    expect(result.asSubject.capabilities.canDecide).toBe(false)
    expect(result.asAdmin.capabilities.canDecide).toBe(false)
    expect(refusalOf(result.adminJudged)?.reason).toBe('not-reviewer')
    expect(errorOf<{ _tag: string }>(result.strangerRead)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(errorOf<{ _tag: string }>(result.strangerJudged)?._tag).toBe(
      'ASSESSMENT_REVIEW_NOT_FOUND',
    )
    expect(result.settled.outcome).toBe('approved')
  })

  it('pages the queue oldest first and refuses a cursor it did not write', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-pages')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const first = yield* submitted(f, g, g.p1, f.s1)
          const second = yield* submitted(f, g, g.p2, f.s2)
          const reviewer = f.principal(f.reviewer)
          const page1 = yield* assessment.listReviewInbox(f.t, { limit: '1' }, reviewer)
          const page2 = yield* assessment.listReviewInbox(
            f.t,
            { limit: '1', cursor: page1.nextCursor! },
            reviewer,
          )
          const tampered = yield* Effect.exit(
            assessment.listReviewInbox(f.t, { cursor: 'not-a-cursor' }, reviewer),
          )
          return { first, second, page1, page2, tampered }
        }),
      ),
    )

    expect(result.page1.items.map((item) => item.instanceId)).toEqual([result.first.instanceId])
    expect(result.page1.nextCursor).not.toBeNull()
    expect(result.page2.items.map((item) => item.instanceId)).toEqual([result.second.instanceId])
    expect(result.page2.nextCursor).toBeNull()
    expect(errorOf<{ _tag: string }>(result.tampered)?._tag).toBe('BAD_REQUEST')
  })

  it('carries a middle rung\u2019s objection up the ladder, with the opinion on record', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rf-mid-objection')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // a second and a third judge at the same class, because the ladder
          // refuses whoever already judged an earlier step of the round
          const another = (name: string) =>
            Effect.gen(function* () {
              const who = one<{ id: string }>(
                yield* runSql(sql`
                  insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                  values (${f.t}, ${name}, ${f.studentType}, ${f.classA}) returning id`),
              ).id
              const grant = one<{ id: string }>(
                yield* runSql(sql`
                  insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
                  values (${f.t}, ${who}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
              ).id
              yield* accept(f.t, g.batch.id, who, grant)
              return { who, grant }
            })
          const second = yield* another('Second Judge')
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const at = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          })
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '\u4e2d\u9014\u5f02\u8bae\u7684\u9898',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: { stages: [at('n1')] },
                  escalation: { stages: [at('d1'), at('d2')] },
                },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!
          const reviewer = f.principal(f.reviewer)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'escalate', comment: '\u62ff\u4e0d\u51c6\uff0c\u63d0\u8bf7\u590d\u6838' },
            reviewer,
          )
          const judge2 = f.principal(second.who)
          const midway = yield* assessment.getReviewInstance(f.t, instanceId, judge2)
          // the objection is an opinion that climbs, never a verdict here
          const objected = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', comment: '\u590d\u6838\u8ba4\u4e3a\u4e0d\u5e94\u8ba4\u5b9a' },
            judge2,
          )
          // both judges of this round are spent: the ladder's last rung has
          // nobody independent left, which blocks rather than skips
          const parked = one<{ state: string; blocked_reason: string; current_stage_id: string }>(
            yield* runSql(sql`
              select state, blocked_reason, current_stage_id
              from review_instances where id = ${instanceId}`),
          )
          // a third judge is appointed, and the patrol releases the round
          const third = yield* another('Third Judge')
          yield* assessment.patrolReviewRounds
          const healed = one<{ state: string; blocked_reason: string | null }>(
            yield* runSql(sql`
              select state, blocked_reason from review_instances where id = ${instanceId}`),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', comment: '\u7ec8\u5ba1\u4e0d\u4e88\u8ba4\u5b9a' },
            f.principal(third.who),
          )
          return { midway, objected, parked, healed, settled }
        }),
      ),
    )
    // every rung may settle the matter, a middle rung may object or climb
    expect(result.midway.chain.route).toBe('escalation')
    expect(result.midway.chain.stageId).toBe('d1')
    expect(result.midway.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
      escalate: { state: 'available' },
    })
    // the objection moved the round, and said why nobody could take it yet
    expect(result.objected.chain.stageId).toBe('d2')
    expect(result.parked).toEqual({
      state: 'blocked',
      blocked_reason: 'no-independent-reviewer',
      current_stage_id: 'd2',
    })
    expect(result.healed).toEqual({ state: 'active', blocked_reason: null })
    expect(result.settled.outcome).toBe('rejected')
    // the wait and the release are on the record between the words
    expect(result.settled.events.map((event) => event.kind)).toEqual([
      'submitted',
      'escalated',
      'opinion-rejected',
      'assignee-not-found',
      'assignee-found',
      'rejected',
    ])
  })

  it('hands an escalation to the ladder, where any rung may settle it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-escalation')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // a second judge at the class: the escalator is spent for this round
          const second = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Second Judge', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const secondGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${second}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, second, secondGrant)
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const at = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          })
          // one ordinary step and two escalation steps, all landing on the same
          // level: this case is about the machine, not about the org
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '\u53ef\u63d0\u8bf7\u590d\u6838\u7684\u9898',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: { stages: [at('n1')] },
                  escalation: { stages: [at('d1'), at('d2')] },
                },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!
          const reviewer = f.principal(f.reviewer)

          const onNormal = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          const raised = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'escalate', comment: '\u62ff\u4e0d\u51c6\uff0c\u63d0\u8bf7\u590d\u6838' },
            reviewer,
          )
          // the escalator already judged this round: the ladder is closed to
          // them - the queue empties and even reading is over
          const escalatorQueue = yield* Effect.map(
            assessment.listReviewInbox(f.t, {}, reviewer),
            (page) => page.items,
          )
          const escalatorRead = yield* Effect.exit(
            assessment.getReviewInstance(f.t, instanceId, reviewer),
          )
          // a rung of the ladder settles the matter itself: approval here is
          // the round approved, not a hand-on to the next rung
          const escalated = yield* assessment.getReviewInstance(
            f.t,
            instanceId,
            f.principal(second),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            f.principal(second),
          )
          return { onNormal, raised, escalatorQueue, escalatorRead, escalated, settled }
        }),
      ),
    )

    // the ordinary route offers to escalate; the ladder is entered whole
    expect(result.onNormal.chain.route).toBe('normal')
    expect(result.onNormal.chain.stageId).toBe('n1')
    expect(result.onNormal.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
      escalate: { state: 'available' },
    })
    // raising it leaves the ordinary route entirely rather than carrying on
    expect(result.raised.chain.route).toBe('escalation')
    expect(result.raised.chain.stageId).toBe('d1')
    expect(result.escalatorQueue).toEqual([])
    expect(errorOf<{ _tag: string }>(result.escalatorRead)?._tag).toBe(
      'ASSESSMENT_REVIEW_NOT_FOUND',
    )
    // a middle rung of the ladder holds every word, escalating included
    expect(result.escalated.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
      escalate: { state: 'available' },
    })
    expect(result.settled.outcome).toBe('approved')
    expect(result.settled.events.map((event) => event.kind)).toEqual([
      'submitted',
      'escalated',
      'approved',
    ])
  })

  it('steps over a rung held only by this round\u2019s own judges, and blocks on an empty one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-rung-skip')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          // a role of its own for the last rung, held by somebody fresh
          const finalRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'final-judge', 'Final judge', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${finalRole}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const closer = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Closer', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const closerGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${closer}, ${finalRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, closer, closerGrant)
          // and a role nobody holds at all, for the vacancy case
          const emptyRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'nobody-yet', 'Nobody yet', 'org', 'active', 'allow-list') returning id`),
          ).id
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const at = (id: string, roleId: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [roleId] },
            quorum: { type: 'any' },
          })
          const filed = (title: string, escalation: unknown[]) =>
            Effect.gen(function* () {
              const item = yield* assessment.createItem(
                f.t,
                g.batch.id,
                {
                  itemType: 'evidence',
                  title,
                  scoreGroupId: groups.groups[0]!.id,
                  maxEntries: 1,
                  config: {
                    entrySource: 'student',
                    formConfig: {},
                    scoringConfig: {
                      calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                      aggregator: { ref: 'sum@1', config: {} },
                    },
                    reviewPolicy: {
                      normal: { stages: [at('n1', f.reviewRole)] },
                      escalation: { stages: escalation },
                    },
                  },
                },
                admin,
              )
              yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
              return item
            })
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)

          // the first rung is held only by the escalator: stepped over, and
          // the round lands on the fresh judge with the skip on record
          const skippable = yield* filed('\u53ef\u8df3\u8fc7\u7684\u68af\u5b50', [
            at('d1', f.reviewRole),
            at('d2', finalRole),
          ])
          const first = yield* assessment.createEntry(
            f.t,
            { itemId: skippable.id, participantId: g.p1, payload: {} },
            s1,
          )
          const firstSent = yield* assessment.setEntryStatus(f.t, first.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            firstSent.currentReviewInstanceId!,
            { decision: 'escalate', comment: '\u63d0\u8bf7\u590d\u6838' },
            reviewer,
          )
          const landed = yield* assessment.getReviewInstance(
            f.t,
            firstSent.currentReviewInstanceId!,
            f.principal(closer),
          )

          // a rung nobody holds at all never skips: the duty is configured
          // and unstaffed, which is the administrator's to fix
          const stuck = yield* filed('\u7f3a\u5458\u7684\u68af\u5b50', [
            at('e1', emptyRole),
            at('e2', finalRole),
          ])
          const second = yield* assessment.createEntry(
            f.t,
            { itemId: stuck.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          const secondSent = yield* assessment.setEntryStatus(
            f.t,
            second.id,
            'in_review',
            f.principal(f.s2),
          )
          yield* assessment.decideReview(
            f.t,
            secondSent.currentReviewInstanceId!,
            { decision: 'escalate', comment: '\u63d0\u8bf7\u590d\u6838' },
            reviewer,
          )
          const parked = one<{ state: string; blocked_reason: string; current_stage_id: string }>(
            yield* runSql(sql`
              select state, blocked_reason, current_stage_id
              from review_instances where id = ${secondSent.currentReviewInstanceId!}`),
          )
          return { landed, parked }
        }),
      ),
    )

    expect(result.landed.chain.route).toBe('escalation')
    expect(result.landed.chain.stageId).toBe('d2')
    // the stepped-over rung says so, on the chain and in the trail
    expect(result.landed.chain.escalation.find((stage) => stage.id === 'd1')?.skipped).toBe(
      'reviewer-conflict',
    )
    expect(result.landed.events.map((event) => event.kind)).toEqual([
      'submitted',
      'escalated',
      'stage-skipped',
    ])
    expect(result.parked).toEqual({
      state: 'blocked',
      blocked_reason: 'no-assignee',
      current_stage_id: 'e1',
    })
  })

  it('lets an administrator hand a claim back without pretending to judge it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-return')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
          const reviewer = f.principal(f.reviewer)

          // one waiting on an empty level: the deadlock this exists for
          const stuck = yield* submitted(f, g, g.p1, f.s1)
          yield* runSql(
            sql`update role_grants set revoked_at = now() where user_id = ${f.reviewer}`,
          )
          const blocked = yield* submitted(f, g, g.p2, f.s2)
          const strangerTried = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              blocked.entryId,
              { kind: 'return-for-revision', reason: '不该由我说了算' },
              f.principal(f.s2),
            ),
          )
          const wordless = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              blocked.entryId,
              { kind: 'return-for-revision', reason: '   ' },
              admin,
            ),
          )
          const returned = yield* assessment.interveneOnEntry(
            f.t,
            blocked.entryId,
            { kind: 'return-for-revision', reason: '本级暂无审核人，请补充后重新提交' },
            admin,
          )
          const round = one<{ state: string; outcome: string }>(
            yield* runSql(sql`
              select state, outcome from review_instances where id = ${blocked.instanceId}`),
          )
          const said = yield* runSql(sql`
            select kind from review_events where review_instance_id = ${blocked.instanceId}
            order by created_at, id`)
          const logged = yield* runSql(sql`
            select kind, reason from entry_events where entry_id = ${blocked.entryId}`)
          // handed back is not rejected: it is the owner's to finish again
          const asOwner = yield* assessment.getEntry(f.t, blocked.entryId, f.principal(f.s2))
          const revised = yield* assessment.appendEntryRevision(
            f.t,
            blocked.entryId,
            { payload: {} },
            f.principal(f.s2),
          )

          // and one that was already through: an administrator can ask for
          // more even after it counted, and it is still not a rejection
          yield* runSql(sql`update role_grants set revoked_at = null where user_id = ${f.reviewer}`)
          yield* assessment.decideReview(f.t, stuck.instanceId, { decision: 'approve' }, reviewer)
          const afterApproval = yield* assessment.interveneOnEntry(
            f.t,
            stuck.entryId,
            { kind: 'return-for-revision', reason: '证书需要重新上传' },
            admin,
          )

          return {
            strangerTried,
            wordless,
            returned,
            round,
            said: (said as { rows: { kind: string }[] }).rows.map((row) => row.kind),
            logged: one<{ kind: string; reason: string }>(logged),
            asOwner,
            revised,
            afterApproval,
          }
        }),
      ),
    )

    expect(errorOf<{ _tag: string }>(result.strangerTried)?._tag).toBe('ACCESS_DENIED')
    expect(refusalOf(result.wordless)?.reason).toBe('reason-required')
    expect(result.returned.status).toBe('needs_revision')
    expect(result.returned.currentReviewInstanceId).toBeNull()
    // the capability is the owner's, and an administrator reading it is not
    // being offered the pen
    expect(result.returned.capabilities.edit.state).toBe('hidden')
    expect(result.asOwner.capabilities.edit.state).toBe('available')
    // sent back for revision: only a new version answers, so re-sending the
    // same one is offered disabled with the reason, never quietly
    expect(result.asOwner.capabilities.submit).toEqual({
      state: 'blocked',
      reason: 'must-revise-first',
    })
    // the round ends as superseded, not as a rejection anybody made
    expect(result.round).toEqual({ state: 'completed', outcome: 'superseded' })
    expect(result.said).toEqual(['submitted', 'assignee-not-found', 'returned-for-revision'])
    expect(result.logged.kind).toBe('revision-required')
    expect(result.logged.reason).toBe('本级暂无审核人，请补充后重新提交')
    expect(result.revised.status).toBe('draft')
    expect(result.afterApproval.status).toBe('needs_revision')
  })

  it('carries a stranded round onto the level the administrator just fixed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-reroute')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)

          // the level the question names has nobody in it
          yield* runSql(
            sql`update role_grants set revoked_at = now() where user_id = ${f.reviewer}`,
          )
          const stuck = yield* submitted(f, g, g.p1, f.s1)

          // somebody who does hold a level here, under a different role
          const standIn = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'stand-in', 'Stand-in reviewer', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${standIn}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const grant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${f.recorder}, ${standIn}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, f.recorder, grant)

          // the same step, pointed at the role somebody actually holds
          const fixed = {
            entrySource: 'student' as const,
            formConfig: {},
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: '3.00' } },
              aggregator: { ref: 'sum@1', config: {} },
            },
            reviewPolicy: {
              normal: {
                stages: [
                  {
                    id: 'class',
                    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [standIn] },
                    quorum: { type: 'any' },
                  },
                ],
              },
              escalation: { stages: [] },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: fixed }, admin),
          )
          const report = errorOf<{
            impactToken: string
            review: { open: number; blocked: number; sameStageMappable: number }
          }>(asked)!
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: fixed,
              reason: '原审核角色无人在岗',
              effects: {
                impactToken: report.impactToken,
                review: { open: 'reroute-blocked', missingCurrentStage: 'refuse' },
              },
            },
            admin,
          )

          const rounds = yield* runSql(sql`
            select id, round_no, state, outcome, origin, current_stage_id, supersedes_instance_id
            from review_instances where entry_id = ${stuck.entryId} order by round_no`)
          const entry = yield* assessment.getEntry(f.t, stuck.entryId, f.principal(f.s1))
          // and the new round is one the stand-in can actually work
          const queue = yield* assessment.listReviewInbox(f.t, {}, f.principal(f.recorder))
          // the administrator's one act stays one event, on the round it
          // ended; the new round says how it began through origin alone
          const saidPerRound = yield* runSql(sql`
            select ri.round_no, re.kind from review_events re
            join review_instances ri on ri.id = re.review_instance_id
            where ri.entry_id = ${stuck.entryId}
            order by ri.round_no, re.created_at, re.id`)
          // the workbench summary names the round just before, whatever
          // ended it: a re-routed round must never vanish from the account
          const newRoundId = one<{ id: string }>(
            yield* runSql(sql`
              select id from review_instances
              where entry_id = ${stuck.entryId} and round_no = 2`),
          ).id
          const onNewRound = yield* assessment.getReviewInstance(
            f.t,
            newRoundId,
            f.principal(f.recorder),
          )
          return {
            report,
            saidPerRound: (saidPerRound as { rows: { round_no: number; kind: string }[] }).rows,
            previous: onNewRound.context?.previous ?? null,
            earlier: onNewRound.context?.earlier ?? [],
            oldId: stuck.instanceId,
            rounds: (
              rounds as {
                rows: {
                  id: string
                  round_no: number
                  state: string
                  outcome: string | null
                  origin: string
                  current_stage_id: string
                  supersedes_instance_id: string | null
                }[]
              }
            ).rows,
            entry,
            queue: queue.items,
          }
        }),
      ),
    )

    expect(result.report.review).toMatchObject({
      open: 1,
      blocked: 1,
      sameStageMappable: 1,
      pastChanged: 0,
    })
    // one administrator act, one event - on the round it ended
    expect(result.saidPerRound).toEqual([
      { round_no: 1, kind: 'submitted' },
      { round_no: 1, kind: 'assignee-not-found' },
      { round_no: 1, kind: 'rerouted' },
    ])
    // the round before is THE round before: ended by a re-route, and said so
    expect(result.previous).toMatchObject({ roundNo: 1, kind: 'rerouted' })
    expect(result.earlier).toEqual([])
    // the round it was standing in ends as superseded, never edited in place
    expect(result.rounds[0]).toMatchObject({
      round_no: 1,
      state: 'completed',
      outcome: 'superseded',
      origin: 'initial',
    })
    // and a new one opens at the same step, under the new policy
    expect(result.rounds[1]).toMatchObject({
      round_no: 2,
      state: 'active',
      origin: 'reroute',
      current_stage_id: 'class',
      supersedes_instance_id: result.oldId,
    })
    expect(result.entry.status).toBe('in_review')
    expect(result.entry.currentReviewInstanceId).toBe(
      result.rounds[1]!.round_no === 2 ? result.entry.currentReviewInstanceId : null,
    )
    expect(result.queue.map((one) => one.entryId)).toEqual([result.entry.id])
  })

  it('sends migrated rounds back to the start of their route when told to', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-restart')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [
              {
                id: 'n1',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'n2',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const admin = f.principal(f.admin)
          const second = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Second Judge', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const secondGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${second}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, second, secondGrant)
          const { entryId, instanceId } = yield* submitted(f, g, g.p1, f.s1)
          // walk to the second step, so the walked-so-far is real
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          // the same two steps, reordered: both survive, the past does not
          const swapped = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: '3.00' } },
              aggregator: { ref: 'sum@1', config: {} },
            },
            reviewPolicy: {
              normal: {
                stages: [
                  {
                    id: 'n2',
                    selector: {
                      kind: 'roleAt',
                      nodeTypeId: f.classType,
                      roleIds: [f.reviewRole],
                    },
                    quorum: { type: 'any' },
                  },
                  {
                    id: 'n1',
                    selector: {
                      kind: 'roleAt',
                      nodeTypeId: f.classType,
                      roleIds: [f.reviewRole],
                    },
                    quorum: { type: 'any' },
                  },
                ],
              },
              escalation: { stages: [] },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: swapped }, admin),
          )
          const report = errorOf<{
            impactToken: string
            review: { sameStageMappable: number; pastChanged: number }
          }>(asked)!
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: swapped,
              reason: '\u8c03\u6574\u5ba1\u6838\u987a\u5e8f',
              effects: {
                impactToken: report.impactToken,
                review: {
                  open: 'reroute-all',
                  missingCurrentStage: 'refuse',
                  // the administrator asked for a full re-review: the round
                  // lands at the start of its own route, not at its step
                  landing: 'route-start',
                },
              },
            },
            admin,
          )
          const rounds = yield* runSql(sql`
            select round_no, state, origin, current_stage_id
            from review_instances where entry_id = ${entryId} order by round_no`)
          return {
            report,
            rounds: (
              rounds as {
                rows: {
                  round_no: number
                  state: string
                  origin: string
                  current_stage_id: string
                }[]
              }
            ).rows,
          }
        }),
      ),
    )

    // both steps survive by identity, but what stands before the current one
    // changed - and the report says so before anybody confirms anything
    expect(result.report.review).toMatchObject({ sameStageMappable: 1, pastChanged: 1 })
    // the fresh round starts the route over, at the route's own first step
    expect(result.rounds[1]).toMatchObject({
      round_no: 2,
      state: 'active',
      origin: 'reroute',
      current_stage_id: 'n2',
    })
  })

  // A round keeps what it is when an administrator moves it onto a newer
  // chain. An appeal is the one round a claim may not be withdrawn out of -
  // withdrawing would quietly unmake the decision being contested - and the
  // withdrawal rule reads that off the round the claim currently stands on.
  it('keeps an appeal an appeal when the chain moves under it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-reroute-appeal')
          const assessment = yield* Assessment
          const at = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          })
          const g = yield* runningBatch(f, {
            profile: [...NO_DOUBTS, 'assessment.entry.appeal'],
            stages: [at('n1')],
            escalation: [at('d1')],
          })
          const admin = f.principal(f.admin)
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
            { decision: 'reject', comment: '材料不足' },
            f.principal(f.reviewer),
          )
          const appealed = yield* assessment.appealReview(
            f.t,
            sent.currentReviewInstanceId!,
            { reason: '证书原件已补交，请复核' },
            s1,
          )
          // the administrator renames the ladder's step, which moves every
          // open round onto the new chain
          const swapped = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: '3.00' } },
              aggregator: { ref: 'sum@1', config: {} },
            },
            reviewPolicy: { normal: { stages: [at('n1')] }, escalation: { stages: [at('d2')] } },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: swapped }, admin),
          )
          const report = errorOf<{ impactToken: string }>(asked)!
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: swapped,
              reason: '改环节名',
              effects: {
                impactToken: report.impactToken,
                review: {
                  open: 'reroute-all',
                  missingCurrentStage: 'refuse',
                  landing: 'route-start',
                },
              },
            },
            admin,
          )
          const moved = one<{ origin: string; appealed_instance_id: string | null }>(
            yield* runSql(sql`
              select origin, appealed_instance_id from review_instances
              where entry_id = ${entry.id} and supersedes_instance_id = ${appealed.id}`),
          )
          // and the claim is still not withdrawable out of it
          const withdrawn = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'draft', s1),
          )
          return { moved, contested: sent.currentReviewInstanceId!, withdrawn }
        }),
      ),
    )
    expect(result.moved).toMatchObject({
      origin: 'appeal',
      appealed_instance_id: result.contested,
    })
    expect(refusalOf(result.withdrawn)?.reason).toBe('appeal-not-withdrawable')
  })

  // A sitting held at the end of the ladder. The grammar forbids a panel on
  // the escalation route's last step because a split there would have
  // nowhere to go - but it checks that by POSITION, while a round walks by
  // RESOLUTION: a later step whose selector finds nobody for this
  // participant is stepped over, and the sitting before it becomes the last
  // one. The split has to settle there rather than take the vote down with it.
  it('settles a split sitting that turns out to be the end of the ladder', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-split-end')
          const assessment = yield* Assessment
          // a type nobody in this tenant stands under, so a stage asking for
          // it resolves to no node and the walk steps over it
          const nowhere = one<{ id: string }>(
            yield* runSql(sql`
              insert into org_types (tenant_id, name)
              values (${f.t}, 'Faculty') returning id`),
          ).id
          const at = (id: string, type: string, quorum: unknown) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: type, roleIds: [f.reviewRole] },
            quorum,
          })
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [at('class', f.classType, { type: 'any' })],
            escalation: [
              at('panel', f.classType, { type: 'all' }),
              // last by position, so the grammar allows the panel before it
              at('faculty', nowhere, { type: 'any' }),
            ],
          })
          // somebody at the panel step who has not judged this round: the
          // reviewer who escalates is excluded from the rungs above
          const colleague = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Colleague', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const grant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${colleague}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, colleague, grant)

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            round,
            { decision: 'escalate', comment: '拿不准，请上一级看' },
            f.principal(f.reviewer),
          )
          const sitting = one<{ current_stage_id: string }>(
            yield* runSql(sql`
              select current_stage_id from review_instances where id = ${round}`),
          ).current_stage_id
          // the sitting says no, and there is no rung above it to say it to
          const settled = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              round,
              { decision: 'reject', comment: '仍不予认定' },
              f.principal(colleague),
            ),
          )
          const after = one<{ state: string; outcome: string | null; status: string }>(
            yield* runSql(sql`
              select ri.state, ri.outcome, e.status from review_instances ri
              join entries e on e.id = ri.entry_id where ri.id = ${round}`),
          )
          const panel = one<{ state: string; resolution: string | null }>(
            yield* runSql(sql`
              select state, resolution from review_panels
              where review_instance_id = ${round}`),
          )
          return { sitting, settled, after, panel }
        }),
      ),
    )
    // the escalation put the round on the panel, which the walk made the last
    // rung because the one after it resolves to nobody
    expect(result.sitting).toBe('panel')
    expect(Exit.isSuccess(result.settled)).toBe(true)
    // and the split is the refusal, rather than a vote thrown away
    expect(result.after).toMatchObject({
      state: 'completed',
      outcome: 'rejected',
      status: 'rejected',
    })
    // the sitting's own row says what the sitting did, not what a sitting
    // one rung lower would have done with the same split
    expect(result.panel).toEqual({ state: 'resolved', resolution: 'rejected' })
  })

  // Two judges at one step, deciding at the same moment. Whoever the batch
  // lock lets through first is answered; the other one is answering a step
  // the round has already left, and a word taken against a step its author
  // no longer holds must not be able to close the round from there.
  it('answers a word against the step the round stands on when it is written', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-stale-word')
          const assessment = yield* Assessment
          const senior = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'senior-reviewer', 'Senior reviewer', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${senior}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const g = yield* runningBatch(f, {
            profile: NO_DOUBTS,
            stages: [
              {
                id: 'class',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'senior',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [senior] },
                quorum: { type: 'any' },
              },
            ],
          })
          // a colleague at the first step, and somebody else entirely at the
          // second - so the step the round moves to is one the colleague has
          // no standing at
          const person = (name: string, role: string) =>
            Effect.gen(function* () {
              const id = one<{ id: string }>(
                yield* runSql(sql`
                  insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                  values (${f.t}, ${name}, ${f.studentType}, ${f.classA}) returning id`),
              ).id
              const grant = one<{ id: string }>(
                yield* runSql(sql`
                  insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
                  values (${f.t}, ${id}, ${role}, ${f.classA}, 'self') returning id`),
              ).id
              yield* accept(f.t, g.batch.id, id, grant)
              return id
            })
          const colleague = yield* person('Colleague', f.reviewRole)
          yield* person('Senior', senior)

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          // both read the round at its first step, then race for the lock
          const [confirmed, refused] = yield* Effect.all(
            [
              Effect.exit(
                assessment.decideReview(
                  f.t,
                  round,
                  { decision: 'approve', comment: '与证书相符' },
                  f.principal(f.reviewer),
                ),
              ),
              Effect.exit(
                assessment.decideReview(
                  f.t,
                  round,
                  { decision: 'reject', comment: '材料不足' },
                  f.principal(colleague),
                ),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          const after = one<{ state: string; outcome: string | null; current_stage_id: string }>(
            yield* runSql(sql`
              select state, outcome, current_stage_id from review_instances where id = ${round}`),
          )
          return { confirmed, refused, after }
        }),
      ),
    )
    // exactly one of the two words lands
    expect([result.confirmed, result.refused].filter((exit) => Exit.isSuccess(exit))).toHaveLength(
      1,
    )
    // and the round is where that one word put it: either handed to the
    // second step and still open, or closed by the refusal - never handed on
    // and then closed from the step it had left
    if (Exit.isSuccess(result.refused)) {
      expect(result.after).toMatchObject({ state: 'completed', outcome: 'rejected' })
    } else {
      expect(result.after).toMatchObject({ state: 'active', current_stage_id: 'senior' })
    }
  })

  // The same race with an ask instead of a word. An ask pauses the round,
  // and while it waits only the reviewer who sent it still holds the round
  // (§32.70) - so an ask taken against a step the round has already left
  // takes the claim out of the next judge's queue in the name of somebody
  // with no standing there, and no member of staff can take it back: the
  // requester alone may cancel, and their reach ended with the step.
  it('refuses an ask taken against the step the round left', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-stale-ask')
          const assessment = yield* Assessment
          const senior = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'senior-reviewer', 'Senior reviewer', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${senior}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const g = yield* runningBatch(f, {
            profile: NO_DOUBTS,
            stages: [
              {
                id: 'class',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'senior',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [senior] },
                quorum: { type: 'any' },
              },
            ],
          })
          const person = (name: string, role: string) =>
            Effect.gen(function* () {
              const id = one<{ id: string }>(
                yield* runSql(sql`
                  insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
                  values (${f.t}, ${name}, ${f.studentType}, ${f.classA}) returning id`),
              ).id
              const grant = one<{ id: string }>(
                yield* runSql(sql`
                  insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
                  values (${f.t}, ${id}, ${role}, ${f.classA}, 'self') returning id`),
              ).id
              yield* accept(f.t, g.batch.id, id, grant)
              return id
            })
          const colleague = yield* person('Colleague', f.reviewRole)
          yield* person('Senior', senior)

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = sent.currentReviewInstanceId!
          // the confirmation goes first so it holds the batch while the ask
          // reads the round; the ask then wakes up behind a round that moved
          const [confirmed, asked] = yield* Effect.all(
            [
              Effect.exit(
                assessment.decideReview(
                  f.t,
                  round,
                  { decision: 'approve', comment: '与证书相符' },
                  f.principal(f.reviewer),
                ),
              ),
              Effect.exit(
                Effect.gen(function* () {
                  yield* Effect.sleep('20 millis')
                  return yield* assessment.requestSupplement(
                    f.t,
                    round,
                    {
                      instructions: '请补交证书原件',
                      requirements: [{ label: '证书原件', kind: 'file', required: true }],
                    },
                    f.principal(colleague),
                  )
                }),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          const after = one<{ state: string; current_stage_id: string }>(
            yield* runSql(sql`
              select state, current_stage_id from review_instances where id = ${round}`),
          )
          const asks = Number(
            one<{ n: string }>(
              yield* runSql(sql`
                select count(*) as n from review_supplement_requests
                where review_instance_id = ${round}`),
            ).n,
          )
          const askedAt = one<{ stage_id: string | null }>(
            yield* runSql(sql`
              select stage_id from review_events
              where review_instance_id = ${round} and kind = 'supplement-requested'`),
          )?.stage_id
          return { confirmed, asked, after, asks, askedAt }
        }),
      ),
    )
    // one of the two lands, never both: an ask and a confirmation are two
    // claims on the same step
    expect([result.confirmed, result.asked].filter((exit) => Exit.isSuccess(exit))).toHaveLength(1)
    if (Exit.isSuccess(result.asked)) {
      // the ask held the step it was taken at, and paused the round there
      expect(result.after).toEqual({ state: 'awaiting_supplement', current_stage_id: 'class' })
      expect(result.askedAt).toBe('class')
    } else {
      // the confirmation handed the round on, and nothing paused it
      expect(result.after).toEqual({ state: 'active', current_stage_id: 'senior' })
      expect(result.asks).toBe(0)
    }
  })

  // What may be done to the claim is read where the claim is held (§32.75):
  // inside the transaction, under the batch lock, after the re-read. Asked
  // at the door instead, the window would be answered from a reading taken
  // before anything was locked, and it would also answer ahead of the
  // staleness test - so somebody contesting a conclusion their claim has
  // already outgrown would be told the window is shut rather than that they
  // are arguing with the wrong conclusion.
  it('answers a stale appeal for what it is before it answers for the window', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-appeal-order')
          const assessment = yield* Assessment
          // a window with no appealing in it, so the gate would refuse
          const g = yield* runningBatch(f, { profile: NO_DOUBTS })
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const firstSent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const first = firstSent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            first,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          // filed again with more in it and approved: the first round is no
          // longer the conclusion the claim stands on
          yield* assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1)
          const secondSent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            secondSent.currentReviewInstanceId!,
            { decision: 'approve', comment: '这次齐了' },
            reviewer,
          )
          const outgrown = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '不服第一轮' }, s1),
          )
          return { outgrown }
        }),
      ),
    )
    expect(refusalOf(result.outgrown)?.reason).toBe('decision-superseded')
  })

  // An appeal argues with the conclusion the claim stands on now. The trail
  // keeps every earlier round so a reader can see how the claim got here,
  // but only the current pointers say what is still open to argument -
  // otherwise a rejection already answered by a later approval could take
  // the claim back off that approval, and reopen it against the older
  // filing, on material the claim itself has moved past.
  it('refuses an appeal against a conclusion the claim has outgrown', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-superseded')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...NO_DOUBTS, 'assessment.entry.appeal'],
            escalation: [
              {
                id: 'college',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const s1 = f.principal(f.s1)
          const s2 = f.principal(f.s2)
          const reviewer = f.principal(f.reviewer)

          // one claim rejected, filed again with more in it, and approved:
          // two rounds against two different filings
          const one_ = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const firstSent = yield* assessment.setEntryStatus(f.t, one_.id, 'in_review', s1)
          const first = firstSent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            first,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          yield* assessment.appendEntryRevision(f.t, one_.id, { payload: {} }, s1)
          const secondSent = yield* assessment.setEntryStatus(f.t, one_.id, 'in_review', s1)
          const second = secondSent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            second,
            { decision: 'approve', comment: '这次齐了' },
            reviewer,
          )
          const outgrown = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '不服第一轮' }, s1),
          )
          const current = yield* assessment.appealReview(f.t, second, { reason: '仍有异议' }, s1)

          // the other claim keeps one filing throughout: rejected, and asked
          // again unchanged, which is the participant's right (§32.65). Both
          // rounds judged the same revision, so only the pointer tells the
          // two conclusions apart
          const two = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            s2,
          )
          const earlySent = yield* assessment.setEntryStatus(f.t, two.id, 'in_review', s2)
          const early = earlySent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            early,
            { decision: 'reject', comment: '不予认定' },
            reviewer,
          )
          const lateSent = yield* assessment.setEntryStatus(f.t, two.id, 'in_review', s2)
          const late = lateSent.currentReviewInstanceId!
          yield* assessment.decideReview(
            f.t,
            late,
            { decision: 'reject', comment: '仍不予认定' },
            reviewer,
          )
          const sameFiling = one<{ same: boolean }>(
            yield* runSql(sql`
              select (select revision_id from review_instances where id = ${early})
                   = (select revision_id from review_instances where id = ${late}) as same`),
          ).same
          const stale = yield* Effect.exit(
            assessment.appealReview(f.t, early, { reason: '不服第一次' }, s2),
          )
          // and that live conclusion contested twice at once: the batch lock
          // orders the two, so the claim takes exactly one transition and the
          // loser is told a round is already under way
          const together = yield* Effect.all(
            [
              Effect.exit(assessment.appealReview(f.t, late, { reason: '请复核一次' }, s2)),
              Effect.exit(assessment.appealReview(f.t, late, { reason: '请再复核一次' }, s2)),
            ],
            { concurrency: 'unbounded' },
          )
          const contested = yield* runSql(sql`
            select appealed_instance_id from review_instances
            where origin = 'appeal' and entry_id in (${one_.id}, ${two.id})
            order by created_at, id`)

          return { second, outgrown, sameFiling, late, stale, contested, together }
        }),
      ),
    )
    // the superseded rejection is refused in its own words, so a stale screen
    // can say what happened rather than "this cannot be done right now"
    expect(refusalOf(result.outgrown)?.reason).toBe('decision-superseded')
    // and the same refusal where the two rounds judged one filing: it is the
    // pointer that decides, not the material
    expect(result.sameFiling).toBe(true)
    expect(refusalOf(result.stale)?.reason).toBe('decision-superseded')
    // sent together, one opens the appeal and the other is refused
    expect(result.together.filter((exit) => Exit.isSuccess(exit))).toHaveLength(1)
    // and every appeal that was allowed contests the round its claim stands
    // on - one apiece, the second and the late one
    expect(
      (result.contested.rows as readonly { appealed_instance_id: string }[]).map(
        (row) => row.appealed_instance_id,
      ),
    ).toEqual([result.second, result.late])
  })

  it('walks an appeal down the ladder, open to the judges of the round it contests', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-appeal')
          const assessment = yield* Assessment
          // an appeal window: no escalating, only appeals and the reviews of them
          const g = yield* runningBatch(f, {
            profile: [
              'assessment.entry.create',
              'assessment.entry.submit',
              'assessment.entry.appeal',
              'assessment.review.process',
            ],
          })
          const admin = f.principal(f.admin)
          // a second judge, for the rung after the first one's objection
          const second = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Second Judge', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const secondGrant = one<{ id: string }>(
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
              values (${f.t}, ${second}, ${f.reviewRole}, ${f.classA}, 'self') returning id`),
          ).id
          yield* accept(f.t, g.batch.id, second, secondGrant)
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const at = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          })
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '\u53ef\u7533\u8bc9\u7684\u9898',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: { stages: [at('n1')] },
                  escalation: { stages: [at('d1'), at('d2')] },
                },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const first = sent.currentReviewInstanceId!
          // escalating is shut off in this window, so the reviewer decides
          const escalationShut = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              first,
              { decision: 'escalate', comment: '\u60f3\u4e0a\u62a5' },
              reviewer,
            ),
          )
          yield* assessment.decideReview(
            f.t,
            first,
            { decision: 'reject', comment: '\u6750\u6599\u4e0d\u8db3' },
            reviewer,
          )
          // somebody else's decision is not theirs to contest
          const stranger = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '\u4e0d\u670d' }, f.principal(f.s2)),
          )
          const wordless = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '  ' }, s1),
          )
          const appealed = yield* assessment.appealReview(
            f.t,
            first,
            { reason: '\u8bc1\u4e66\u539f\u4ef6\u5df2\u8865\u4ea4\uff0c\u8bf7\u590d\u6838' },
            s1,
          )
          const second_ = appealed.id
          // one open round per claim: the same decision cannot be contested twice
          const again = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '\u518d\u6765\u4e00\u6b21' }, s1),
          )
          // The judge who rejected the first round is eligible for the appeal
          // on purpose (\u00a732.66): a fresh round means fresh standing, and the
          // rejecter re-examining their own call is re-examination, not
          // self-review. Their queue holds it.
          const rejecterQueue = yield* Effect.map(
            assessment.listReviewInbox(f.t, {}, reviewer),
            (page) => page.items.map((one) => one.instanceId),
          )
          const midway = yield* assessment.getReviewInstance(f.t, second_, reviewer)
          // a middle rung's rejection is an opinion that climbs
          const objected = yield* assessment.decideReview(
            f.t,
            second_,
            { decision: 'reject', comment: '\u4ecd\u8ba4\u4e3a\u4e0d\u5e94\u8ba4\u5b9a' },
            reviewer,
          )
          const atEnd = yield* assessment.getReviewInstance(f.t, second_, f.principal(second))
          const settled = yield* assessment.decideReview(
            f.t,
            second_,
            { decision: 'reject', comment: '\u590d\u6838\u540e\u4ecd\u4e0d\u4e88\u8ba4\u5b9a' },
            f.principal(second),
          )
          const rounds = yield* runSql(sql`
            select round_no, origin, current_route, revision_id,
                   appealed_instance_id, outcome
            from review_instances where entry_id = ${entry.id} order by round_no`)
          return {
            escalationShut,
            stranger,
            wordless,
            appealed,
            again,
            rejecterQueue,
            midway,
            objected,
            atEnd,
            settled,
            firstId: first,
            secondId: second_,
            rows: (
              rounds as {
                rows: {
                  round_no: number
                  origin: string
                  current_route: string
                  revision_id: string
                  appealed_instance_id: string | null
                  outcome: string | null
                }[]
              }
            ).rows,
          }
        }),
      ),
    )

    // the phase, not the policy, is what shut escalating off
    expect(refusalOf(result.escalationShut)?.reason).toBe('phase-closed')
    expect(errorOf<{ _tag: string }>(result.stranger)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(refusalOf(result.wordless)?.reason).toBe('reason-required')
    expect(refusalOf(result.again)?.reason).toBe('review-already-open')

    // the appeal opens on the escalation route against the very same filing
    expect(result.appealed.chain.route).toBe('escalation')
    expect(result.appealed.chain.stageId).toBe('d1')
    expect(result.rows[1]).toMatchObject({
      round_no: 2,
      origin: 'appeal',
      current_route: 'escalation',
      revision_id: result.rows[0]!.revision_id,
      appealed_instance_id: result.firstId,
    })

    // the first round's rejecter takes the appeal like any other judge
    expect(result.rejecterQueue).toContain(result.secondId)
    expect(result.midway.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
      // climbing is the ladder's own machinery, not the phase's
      escalate: { state: 'available' },
    })
    // and their objection climbed to somebody who had not yet judged round 2
    expect(result.objected.chain.stageId).toBe('d2')
    expect(result.atEnd.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
      escalate: { state: 'blocked', reason: 'route-end' },
    })
    expect(result.settled.outcome).toBe('rejected')
    expect(result.settled.events.map((event) => event.kind)).toEqual([
      'appealed',
      'opinion-rejected',
      'rejected',
    ])
  })
})
