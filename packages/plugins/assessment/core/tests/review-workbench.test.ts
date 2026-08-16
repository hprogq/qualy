import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { errorOf, GATED, ok, run, runningBatch, seed } from './support/round.ts'

// What the workbench reads and what it is held to: the queue row carrying
// the filing itself, the day's counter on the batch's own calendar, the
// configured reason lists binding reject and escalate, and the context a
// page read resolves - the question's numbers, the siblings, the previous
// round's conclusion.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

describe.runIf(postgresAvailable)('the review workbench', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-workbench')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('projects the filing into the queue row and counts the day on the batch clock', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-queue')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })

          // a question with named fields, one more of them than a row shows:
          // the projection keeps the form's own order and stops at three
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '竞赛获奖',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 2,
              config: {
                entrySource: 'student',
                formConfig: {
                  files: {},
                  fields: [
                    { key: 'title', label: '竞赛名称', type: 'text' },
                    { key: 'level', label: '等级与名次', type: 'text' },
                    { key: 'date', label: '获奖日期', type: 'date' },
                    { key: 'extra', label: '备注', type: 'text' },
                  ],
                },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '2.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: {
                    stages: [
                      {
                        id: 'class',
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
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: item.id,
              participantId: g.p1,
              payload: {
                title: '中国机器人大赛',
                level: '市级 一等奖',
                date: '2026-05-09',
                extra: '证书原件备案',
              },
            },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)

          const before = yield* assessment.listReviewInbox(
            f.t,
            { batchId: g.batch.id },
            f.principal(f.reviewer),
          )
          const row = before.items.find((one) => one.itemId === item.id)!
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const after = yield* assessment.listReviewInbox(
            f.t,
            { batchId: g.batch.id },
            f.principal(f.reviewer),
          )
          return { before, row, after }
        }),
      ),
    )
    // the row carries the filing under its own labels, three at most, in
    // the form's own order - never a written summary
    expect(result.row.values).toEqual([
      { label: '竞赛名称', value: '中国机器人大赛' },
      { label: '等级与名次', value: '市级 一等奖' },
      { label: '获奖日期', value: '2026-05-09' },
    ])
    expect(result.row.unitName).toBe('Class A1')
    expect(result.row.route).toBe('normal')
    expect(result.row.roundNo).toBe(1)
    expect(result.row.attachmentCount).toBe(0)
    expect(result.before.handledToday).toBe(0)
    expect(result.after.handledToday).toBe(1)
  })

  it('holds reject and escalate to the configured reasons, and resolves the context', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-reasons')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const reviewer = f.principal(f.reviewer)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })

          const configured = yield* assessment.updateBatch(
            f.t,
            g.batch.id,
            {
              reviewReasons: {
                reject: ['材料不清晰', '超出材料时间范围'],
                escalate: ['材料真实性存疑'],
              },
            },
            admin,
          )

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!

          // a configured list makes the label part of the act: absent it is
          // refused, invented it is refused, and approve has no use for one
          const unlabelled = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'reject', comment: 'too blurry' },
              reviewer,
            ),
          )
          const invented = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'reject', reason: '不在名单', comment: 'too blurry' },
              reviewer,
            ),
          )
          const misplaced = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', reason: '材料不清晰' },
              reviewer,
            ),
          )
          const rejected = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', reason: '材料不清晰', comment: '证书照片缺少落款' },
            reviewer,
          )

          // the next round reads the last one's conclusion, and the numbers
          // the question is judged under, off the page read alone
          yield* assessment.appendEntryRevision(f.t, entry.id, { payload: {}, note: 'reshot' }, s1)
          const resent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round2 = yield* assessment.getReviewInstance(
            f.t,
            resent.currentReviewInstanceId!,
            reviewer,
          )
          return { configured, unlabelled, invented, misplaced, rejected, round2 }
        }),
      ),
    )
    expect(result.configured.reviewReasons).toEqual({
      reject: ['材料不清晰', '超出材料时间范围'],
      escalate: ['材料真实性存疑'],
    })
    const issueOf = (exit: (typeof result)['unlabelled']) =>
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(exit)?.issues[0]
    expect(issueOf(result.unlabelled)).toEqual({ field: 'reason', reason: 'required' })
    expect(issueOf(result.invented)).toEqual({ field: 'reason', reason: 'not-offered' })
    expect(issueOf(result.misplaced)).toEqual({ field: 'reason', reason: 'not-allowed' })
    // the label went onto the event verbatim, beside the word
    const said = result.rejected.events.find((event) => event.kind === 'rejected')!
    expect(said.reason).toBe('材料不清晰')
    expect(said.comment).toBe('证书照片缺少落款')
    // a decision response leaves the surroundings unresolved; a page read
    // pays for them
    expect(result.rejected.context).toBeNull()
    const context = result.round2.context!
    expect(context.previous).toMatchObject({
      kind: 'rejected',
      reason: '材料不清晰',
      comment: '证书照片缺少落款',
    })
    expect(context.worth).toMatchObject({
      each: '3.00',
      maxEntries: 1,
      groupName: '文体',
      groupCap: expect.stringMatching(/^10\.0000$|^10\.00$/) as string,
    })
    expect(context.worth.materialRange).toEqual({ start: '2026-03-01', end: '2026-09-01' })
    expect(context.siblings).toHaveLength(1)
    expect(context.siblings[0]!.current).toBe(true)
    // a sibling carries its own answers, so a duplicate can be read against
    // this one without a second endpoint the reviewer has no standing for
    expect(Array.isArray(context.siblings[0]!.values)).toBe(true)
    // identity travels with the round for the header that names the person
    expect(result.round2.unitName).toBe('Class A1')
  })

  it('opens the claim\u2019s whole story to whoever is judging it, and to nobody else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-history')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)

          // the reviewer holds the open round: reading how the filing got
          // here is part of judging it
          const forJudge = yield* assessment.getEntryHistory(f.t, entry.id, f.principal(f.reviewer))
          // a classmate holds nothing, and learns nothing - not even that
          // the claim exists
          const forStranger = yield* Effect.exit(
            assessment.getEntryHistory(f.t, entry.id, f.principal(f.s2)),
          )
          return { forJudge, forStranger }
        }),
      ),
    )
    expect(result.forJudge.rounds).toHaveLength(1)
    expect(result.forJudge.revisions.length).toBeGreaterThan(0)
    expect(errorOf<{ _tag: string }>(result.forStranger)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
  })

  it('lets a rejected claim go back as it stands, or be given up', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-way-on')
          const assessment = yield* Assessment
          const reviewer = f.principal(f.reviewer)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
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
            { decision: 'reject', comment: 'look again later' },
            reviewer,
          )
          // the rejected claim offers the way on, gated by the same gate
          // the act answers to
          const rejected = yield* assessment.getEntry(f.t, entry.id, s1)
          // and it may go back exactly as it stands: same revision, new round
          const resent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round2 = yield* assessment.getReviewInstance(
            f.t,
            resent.currentReviewInstanceId!,
            reviewer,
          )
          // a second claim, given up: the record stays and the place opens
          yield* assessment.decideReview(
            f.t,
            resent.currentReviewInstanceId!,
            { decision: 'reject', comment: 'no' },
            reviewer,
          )
          const abandoned = yield* assessment.setEntryStatus(f.t, entry.id, 'voided', s1)
          const again = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          return { rejected, resent, round2, abandoned, again }
        }),
      ),
    )
    expect(result.rejected.capabilities.submit.state).toBe('available')
    expect(result.rejected.capabilities.abandon.state).toBe('available')
    expect(result.resent.status).toBe('in_review')
    expect(result.round2.roundNo).toBe(2)
    // the same filing, unrewritten
    expect(result.round2.revision.revisionNo).toBe(1)
    expect(result.abandoned.status).toBe('voided')
    // maxEntries is 1 on this question, and the abandoned claim freed it
    expect(result.again.id).not.toBe(result.abandoned.id)
  })
})
