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
  run,
  runningBatch,
  seed,
  staged,
  type Seeded,
} from './support/round.ts'

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

// A reviewer's reach is their unfinished duty, not their history. These
// cases hold the whole read boundary to that one sentence, across every
// door a reviewer can knock on - the instance, the entry's history, the
// cited file - because the boundary once differed per door: the instance
// answered a reviewer whose decision had already handed the round on, while
// the history said "not found" to the same person in the same breath.

let db: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('review-access', { migrations: 'apply' })
}, 120_000)

afterAll(async () => {
  await db?.dispose()
})

/**
 * What one door answered: `ok` when it opened, otherwise the tag of the
 * refusal.
 *
 * Only a real success is `ok`. A defect carries no `_tag`, so reading "no
 * tag" as "opened" made a crash indistinguishable from a door being held -
 * which is the single thing this suite exists to tell apart, and it would
 * have read a 500 on every one of these calls as access granted.
 */
const answerOf = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit) ? 'ok' : (errorOf<{ _tag?: string }>(exit)?._tag ?? 'DIED')

/**
 * A second stage over the seeded world: a college-level review role held at
 * College A, and a second reviewer standing beside the first at the class,
 * so "same node, same role, no decision yet" has somebody to be.
 */
const secondStage = (f: Seeded) =>
  Effect.gen(function* () {
    const collegeType = one<{ id: string }>(
      yield* runSql(sql`select id from org_types where tenant_id = ${f.t} and code = 'college'`),
    ).id
    const collegeA = one<{ id: string }>(
      yield* runSql(sql`select id from org_nodes where tenant_id = ${f.t} and name = 'College A'`),
    ).id
    const person = (name: string, at: string) =>
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${f.t}, ${name}, ${f.studentType}, ${at}) returning id`)
    const reviewer2 = one<{ id: string }>(yield* person('Reviewer Two', f.classA)).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${f.t}, ${reviewer2}, ${f.reviewRole}, ${f.classA}, 'self')`)
    const collegeRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status)
        values (${f.t}, 'college-reviewer', 'College reviewer', 'org', 'active') returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      select ${f.t}, ${collegeRole}, p.id from permissions p
      where p.code = 'assessment.review.process'`)
    const collegeReviewer = one<{ id: string }>(yield* person('College Reviewer', collegeA)).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${f.t}, ${collegeReviewer}, ${collegeRole}, ${collegeA}, 'self')`)
    return { collegeType, collegeRole, reviewer2, collegeReviewer }
  })

describe.runIf(postgresAvailable)('the review read boundary', () => {
  it('follows the duty: each handover strips the last stage, completion strips the last of all', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('access-chain')
          const assessment = yield* Assessment
          const extra = yield* secondStage(f)
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            stages: [
              {
                id: 'class',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'college',
                selector: {
                  kind: 'roleAt',
                  nodeTypeId: extra.collegeType,
                  roleIds: [extra.collegeRole],
                },
                quorum: { type: 'any' },
              },
            ],
          })
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!

          const doors = (who: string) =>
            Effect.all({
              instance: Effect.exit(
                assessment.getReviewInstance(f.t, instanceId, f.principal(who)),
              ),
              history: Effect.exit(assessment.getEntryHistory(f.t, entry.id, f.principal(who))),
              file: Effect.exit(assessment.openAttachment(f.t, file, f.principal(who))),
            })
          const shape = (three: {
            instance: Exit.Exit<unknown, unknown>
            history: Exit.Exit<unknown, unknown>
            file: Exit.Exit<unknown, unknown>
          }) => ({
            instance: answerOf(three.instance),
            history: answerOf(three.history),
            file: answerOf(three.file),
          })

          // the class stage is open: both of its reviewers hold every door,
          // the college's reviewer none of them yet
          const classDuty = shape(yield* doors(f.reviewer))
          const classPeer = shape(yield* doors(extra.reviewer2))
          const collegeEarly = shape(yield* doors(extra.collegeReviewer))

          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )

          // handed to the college: the class stage - the decider AND the
          // peer who never pressed anything - is stripped at once
          const classAfter = shape(yield* doors(f.reviewer))
          const peerAfter = shape(yield* doors(extra.reviewer2))
          const collegeDuty = shape(yield* doors(extra.collegeReviewer))

          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            f.principal(extra.collegeReviewer),
          )

          // completed: the last stage loses its doors like every stage
          // before it; the subject and the batch's administration keep
          // theirs, which is what tells an audit apart from a leak
          const collegeAfter = shape(yield* doors(extra.collegeReviewer))
          const subject = shape(yield* doors(f.s1))
          const admin = shape(yield* doors(f.admin))
          return {
            classDuty,
            classPeer,
            collegeEarly,
            classAfter,
            peerAfter,
            collegeDuty,
            collegeAfter,
            subject,
            admin,
          }
        }),
      ),
    )
    const OPEN = { instance: 'ok', history: 'ok', file: 'ok' }
    const SHUT = {
      instance: 'ASSESSMENT_REVIEW_NOT_FOUND',
      history: 'ASSESSMENT_ENTRY_NOT_FOUND',
      file: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
    }
    expect(result.classDuty).toEqual(OPEN)
    expect(result.classPeer).toEqual(OPEN)
    expect(result.collegeEarly).toEqual(SHUT)
    expect(result.classAfter).toEqual(SHUT)
    expect(result.peerAfter).toEqual(SHUT)
    expect(result.collegeDuty).toEqual(OPEN)
    expect(result.collegeAfter).toEqual(SHUT)
    expect(result.subject).toEqual(OPEN)
    expect(result.admin).toEqual(OPEN)
  })

  it('keeps the round with its reviewer through an open ask, and a rejection ends it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('access-ask')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const reviewer = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!

          const reads = () =>
            Effect.all({
              instance: Effect.exit(assessment.getReviewInstance(f.t, instanceId, reviewer)),
              history: Effect.exit(assessment.getEntryHistory(f.t, entry.id, reviewer)),
            })
          const shape = (two: {
            instance: Exit.Exit<unknown, unknown>
            history: Exit.Exit<unknown, unknown>
          }) => ({
            instance: answerOf(two.instance),
            history: answerOf(two.history),
          })

          yield* assessment.requestSupplement(
            f.t,
            instanceId,
            {
              instructions: 'ask for more',
              requirements: [{ label: 'why', kind: 'text', required: true }],
            },
            reviewer,
          )
          // the ask is the reviewer's own unfinished task: every door stays
          const whileAsking = shape(yield* reads())
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          yield* assessment.answerSupplement(
            f.t,
            mine.supplement!.requestId,
            { payload: { f1: 'answered' } },
            s1,
          )
          const afterAnswer = shape(yield* reads())

          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', comment: 'not enough' },
            reviewer,
          )
          // rejected: the round ended, and with it the reviewer's reach;
          // the person it went back to keeps reading their own claim
          const afterReject = shape(yield* reads())
          const subjectStill = yield* Effect.exit(assessment.getEntryHistory(f.t, entry.id, s1))
          return {
            whileAsking,
            afterAnswer,
            afterReject,
            subjectStill: answerOf(subjectStill),
          }
        }),
      ),
    )
    expect(result.whileAsking).toEqual({ instance: 'ok', history: 'ok' })
    expect(result.afterAnswer).toEqual({ instance: 'ok', history: 'ok' })
    expect(result.afterReject).toEqual({
      instance: 'ASSESSMENT_REVIEW_NOT_FOUND',
      history: 'ASSESSMENT_ENTRY_NOT_FOUND',
    })
    expect(result.subjectStill).toBe('ok')
  })
  it('takes the round from the colleague at every door while an ask is open', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('access-ask-peer')
          const assessment = yield* Assessment
          const extra = yield* secondStage(f)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!

          const doors = (who: string) =>
            Effect.all({
              instance: Effect.exit(
                assessment.getReviewInstance(f.t, instanceId, f.principal(who)),
              ),
              history: Effect.exit(assessment.getEntryHistory(f.t, entry.id, f.principal(who))),
              file: Effect.exit(assessment.openAttachment(f.t, file, f.principal(who))),
            })
          const shape = (three: {
            instance: Exit.Exit<unknown, unknown>
            history: Exit.Exit<unknown, unknown>
            file: Exit.Exit<unknown, unknown>
          }) => ({
            instance: answerOf(three.instance),
            history: answerOf(three.history),
            file: answerOf(three.file),
          })

          const peerBefore = shape(yield* doors(extra.reviewer2))
          yield* assessment.requestSupplement(
            f.t,
            instanceId,
            {
              instructions: 'ask for more',
              requirements: [{ label: 'why', kind: 'text', required: true }],
            },
            f.principal(f.reviewer),
          )
          // the ask is one reviewer's unfinished business: it holds every
          // door for the asker and closes every one of them to the pool
          const askerDuring = shape(yield* doors(f.reviewer))
          const peerDuring = shape(yield* doors(extra.reviewer2))
          // the administrative view is a different concept and survives
          const adminDuring = shape(yield* doors(f.admin))

          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          yield* assessment.answerSupplement(
            f.t,
            mine.supplement!.requestId,
            { payload: { f1: 'answered' } },
            s1,
          )
          // answered: the round is back in the shared pool
          const peerAfter = shape(yield* doors(extra.reviewer2))
          return { peerBefore, askerDuring, peerDuring, adminDuring, peerAfter }
        }),
      ),
    )
    const OPEN = { instance: 'ok', history: 'ok', file: 'ok' }
    expect(result.peerBefore).toEqual(OPEN)
    expect(result.askerDuring).toEqual(OPEN)
    expect(result.peerDuring).toEqual({
      instance: 'ASSESSMENT_REVIEW_NOT_FOUND',
      history: 'ASSESSMENT_ENTRY_NOT_FOUND',
      file: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
    })
    expect(result.adminDuring).toEqual(OPEN)
    expect(result.peerAfter).toEqual(OPEN)
  })
  // The suite reads every door through one helper, so the helper has to be
  // able to say the three things apart. It could not: a fallen door read as
  // an open one, which would have passed every case here on a 500.
  it('tells a door that opened from one that fell over', () => {
    expect(answerOf(Exit.succeed('through'))).toBe('ok')
    expect(answerOf(Exit.fail({ _tag: 'ASSESSMENT_REVIEW_NOT_FOUND' }))).toBe(
      'ASSESSMENT_REVIEW_NOT_FOUND',
    )
    expect(answerOf(Exit.die(new Error('a query failed')))).toBe('DIED')
  })
})
