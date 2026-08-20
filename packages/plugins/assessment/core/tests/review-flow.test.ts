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
              insert into roles (tenant_id, code, name, kind, status)
              values (${f.t}, 'inspector', 'Inspector', 'org', 'active') returning id`),
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

  it('lets a middle escalation step reject when the phase opens it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rf-mid-reject')
          const assessment = yield* Assessment
          // the one difference from the case above: the phase says middle
          // steps of the escalation route may reject outright
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.review.reject-intermediate'],
          })
          const admin = f.principal(f.admin)
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
              title: '中途可退回的题',
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
            { decision: 'escalate', comment: '拿不准，提请复核' },
            reviewer,
          )
          const midway = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          const rejected = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', comment: '复核确认不予认定' },
            reviewer,
          )
          return { midway, rejected }
        }),
      ),
    )
    // the same middle step that only advises by default now offers the
    // rejection, and the act it offers goes through
    expect(result.midway.chain.route).toBe('escalation')
    expect(result.midway.chain.stageId).toBe('d1')
    expect(result.midway.actions.reject).toEqual({ state: 'available', reason: null })
    expect(result.rejected.state).toBe('completed')
    expect(result.rejected.outcome).toBe('rejected')
  })

  it('hands an escalation to the other route, and takes only one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rv-escalation')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const admin = f.principal(f.admin)
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
              title: '可提请复核的题',
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
            { decision: 'escalate', comment: '拿不准，提请复核' },
            reviewer,
          )
          // the escalation route is a review chain like the other one:
          // approving a middle step passes it on, and whether that step may
          // reject outright is the phase's word, not the round's origin
          const escalated = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          const noSecondEscalation = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'escalate', comment: '再上一次' },
              reviewer,
            ),
          )
          const passedOn = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            reviewer,
          )
          const settled = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            reviewer,
          )
          return { onNormal, raised, escalated, noSecondEscalation, passedOn, settled }
        }),
      ),
    )

    // the ordinary route offers to escalate; the escalation route does not
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
    // a middle step of the route advises unless the phase opens early
    // rejection, and escalating again is never on the table
    expect(result.escalated.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'blocked', reason: 'terminal-only' },
      escalate: { state: 'blocked', reason: 'in-escalation' },
    })
    expect(refusalOf(result.noSecondEscalation)?.reason).toBe('decision-not-available')
    expect(result.passedOn.chain.stageId).toBe('d2')
    expect(result.settled.outcome).toBe('approved')
    expect(result.settled.events.map((event) => event.kind)).toEqual([
      'submitted',
      'escalated',
      'approved',
      'approved',
    ])
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
              insert into roles (tenant_id, code, name, kind, status)
              values (${f.t}, 'stand-in', 'Stand-in reviewer', 'org', 'active') returning id`),
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
          return {
            report,
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

    expect(result.report.review).toMatchObject({ open: 1, blocked: 1, sameStageMappable: 1 })
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

  it('walks an appeal down the escalation route, endable only at its last step', async () => {
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
              title: '可申诉的题',
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
              { decision: 'escalate', comment: '想上报' },
              reviewer,
            ),
          )
          yield* assessment.decideReview(
            f.t,
            first,
            { decision: 'reject', comment: '材料不足' },
            reviewer,
          )
          // somebody else's decision is not theirs to contest
          const stranger = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '不服' }, f.principal(f.s2)),
          )
          const wordless = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '  ' }, s1),
          )
          const appealed = yield* assessment.appealReview(
            f.t,
            first,
            { reason: '证书原件已补交，请复核' },
            s1,
          )
          const second = appealed.id
          // one open round per claim: the same decision cannot be contested twice
          const again = yield* Effect.exit(
            assessment.appealReview(f.t, first, { reason: '再来一次' }, s1),
          )
          const midway = yield* assessment.getReviewInstance(f.t, second, reviewer)
          const rejectTooSoon = yield* Effect.exit(
            assessment.decideReview(f.t, second, { decision: 'reject', comment: '不行' }, reviewer),
          )
          yield* assessment.decideReview(f.t, second, { decision: 'approve' }, reviewer)
          const atEnd = yield* assessment.getReviewInstance(f.t, second, reviewer)
          const settled = yield* assessment.decideReview(
            f.t,
            second,
            { decision: 'reject', comment: '复核后仍不予认定' },
            reviewer,
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
            midway,
            rejectTooSoon,
            atEnd,
            settled,
            firstId: first,
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

    // and only its last step can turn it down
    expect(result.midway.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'blocked', reason: 'terminal-only' },
    })
    expect(refusalOf(result.rejectTooSoon)?.reason).toBe('decision-not-available')
    expect(result.atEnd.actions).toMatchObject({
      approve: { state: 'available' },
      reject: { state: 'available' },
    })
    expect(result.settled.outcome).toBe('rejected')
  })
})
