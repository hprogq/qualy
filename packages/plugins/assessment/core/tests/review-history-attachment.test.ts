import { Effect, Exit } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import {
  GATED,
  errorOf,
  ok,
  one,
  run,
  runningBatch,
  seed,
  staged,
  type Seeded,
} from './support/round.ts'

// A reviewer reads a claim's history up to the version last handed in
// (getEntryHistory), and the files of that history are part of reading it: a
// file the claim carried in an earlier version handed in, and removed since,
// opens for exactly as long as the round's own reader does. Nothing beyond
// that history opens with it.

const answerOf = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit) ? 'ok' : (errorOf<{ _tag?: string }>(exit)?._tag ?? 'DIED')

/** a claim handed in with one file, withdrawn, and handed in again with another */
const twiceHandedIn = (f: Seeded) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const g = yield* runningBatch(f, { profile: [...GATED, 'assessment.review.process'] })
    const owner = f.principal(f.s1)
    const removed = yield* staged(f.t, f.s1)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId: g.p1, payload: { files: [removed] } },
      owner,
    )
    yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
    yield* assessment.setEntryStatus(f.t, entry.id, 'draft', owner)
    const current = yield* staged(f.t, f.s1)
    yield* assessment.appendEntryRevision(f.t, entry.id, { payload: { files: [current] } }, owner)
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
    return { g, entry, removed, current, round: sent.currentReviewInstanceId! }
  })

describe.runIf(postgresAvailable)('review access to historical attachments', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('review-history-attachment', { migrations: 'apply' })
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('opens an earlier submitted file only while the reviewer can read the round', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rha-open')
          const assessment = yield* Assessment
          const { entry, removed, current, round } = yield* twiceHandedIn(f)
          const reviewer = f.principal(f.reviewer)
          const history = yield* assessment.getEntryHistory(f.t, entry.id, reviewer)
          const before = {
            removed: answerOf(
              yield* Effect.exit(assessment.openAttachment(f.t, removed, reviewer)),
            ),
            current: answerOf(
              yield* Effect.exit(assessment.openAttachment(f.t, current, reviewer)),
            ),
            stranger: answerOf(
              yield* Effect.exit(assessment.openAttachment(f.t, removed, f.principal(f.s2))),
            ),
          }
          yield* assessment.decideReview(f.t, round, { decision: 'approve' }, reviewer)
          const after = answerOf(
            yield* Effect.exit(assessment.openAttachment(f.t, removed, reviewer)),
          )
          return { history, before, after }
        }),
      ),
    )
    expect(result.history.revisions).toHaveLength(2)
    expect(result.before).toEqual({
      removed: 'ok',
      current: 'ok',
      stranger: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
    })
    expect(result.after).toBe('ASSESSMENT_ATTACHMENT_NOT_FOUND')
  })

  it('keeps a version never handed in, and every other claim, from the reviewer', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rha-bounds')
          const assessment = yield* Assessment
          const { g, entry } = yield* twiceHandedIn(f)
          const reviewer = f.principal(f.reviewer)

          // A version after the one handed in, on the owner's desk while the
          // round is open. The service never leaves a round open beside a
          // working version, so it is planted: the bound must hold in the
          // query itself, not only in the order things usually happen.
          const desk = yield* staged(f.t, f.s1)
          const later = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions
                (tenant_id, entry_id, item_id, item_revision_id, revision_no,
                 payload, actor_id, subject_id, source)
              select tenant_id, entry_id, item_id, item_revision_id, revision_no + 1,
                     ${JSON.stringify({ files: [desk] })}::jsonb, actor_id, subject_id, source
                from entry_revisions
               where entry_id = ${entry.id}
               order by revision_no desc
               limit 1
              returning id`),
          ).id
          yield* runSql(sql`
            insert into entry_revision_attachments (tenant_id, revision_id, attachment_id, position)
            values (${f.t}, ${later}, ${desk}, 0)`)

          // other students' claims: one judged and closed, one never sent
          const other = f.principal(f.s2)
          const judgedFile = yield* staged(f.t, f.s2)
          const judged = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: { files: [judgedFile] } },
            other,
          )
          const judgedRound = (yield* assessment.setEntryStatus(f.t, judged.id, 'in_review', other))
            .currentReviewInstanceId!
          yield* assessment.decideReview(f.t, judgedRound, { decision: 'approve' }, reviewer)
          const draftFile = yield* staged(f.t, f.s3)
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p3, payload: { files: [draftFile] } },
            f.principal(f.s3),
          )

          const open = (file: string) =>
            Effect.map(Effect.exit(assessment.openAttachment(f.t, file, reviewer)), answerOf)
          return {
            desk: yield* open(desk),
            ownDesk: answerOf(
              yield* Effect.exit(assessment.openAttachment(f.t, desk, f.principal(f.s1))),
            ),
            judged: yield* open(judgedFile),
            draft: yield* open(draftFile),
          }
        }),
      ),
    )
    expect(result).toEqual({
      desk: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
      ownDesk: 'ok',
      judged: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
      draft: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
    })
  })

  it('closes the history and its files the moment the reviewer stops holding the role', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rha-revoked')
          const assessment = yield* Assessment
          const { entry, removed, current } = yield* twiceHandedIn(f)
          const reviewer = f.principal(f.reviewer)
          const doors = Effect.gen(function* () {
            return {
              history: answerOf(
                yield* Effect.exit(assessment.getEntryHistory(f.t, entry.id, reviewer)),
              ),
              removed: answerOf(
                yield* Effect.exit(assessment.openAttachment(f.t, removed, reviewer)),
              ),
              current: answerOf(
                yield* Effect.exit(assessment.openAttachment(f.t, current, reviewer)),
              ),
            }
          })
          const holding = yield* doors
          yield* runSql(sql`
            delete from role_grants
             where tenant_id = ${f.t} and user_id = ${f.reviewer} and role_id = ${f.reviewRole}`)
          return { holding, revoked: yield* doors }
        }),
      ),
    )
    expect(result.holding).toEqual({ history: 'ok', removed: 'ok', current: 'ok' })
    expect(result.revoked).toEqual({
      history: 'ASSESSMENT_ENTRY_NOT_FOUND',
      removed: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
      current: 'ASSESSMENT_ATTACHMENT_NOT_FOUND',
    })
  })
})
