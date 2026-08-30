import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { DEFAULT_REVIEW_REASONS } from '../src/review/reasons.ts'
import { errorOf, GATED, ok, one, refusalOf, run, runningBatch, seed } from './support/round.ts'

// What the workbench reads and what it is held to: the queue row carrying
// the filing itself, the day's counter on the batch's own calendar, the
// configured reason lists binding reject and escalate, and the context a
// page read resolves - the question's numbers, the siblings, the previous
// round's conclusion.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

describe.runIf(postgresAvailable)('the review workbench', () => {
  it('opens a fresh batch with the system reason lists already on it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-defaults')
          const assessment = yield* Assessment
          // straight from creation, before any fixture switches presets off:
          // the reviewer's picker must work without an administrator ever
          // having visited the settings page
          return yield* assessment.createBatch(
            f.t,
            {
              name: 'Fresh',
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
            },
            f.principal(f.admin),
          )
        }),
      ),
    )
    expect(result.reviewReasons).toEqual({
      reject: [...DEFAULT_REVIEW_REASONS.reject],
      escalate: [...DEFAULT_REVIEW_REASONS.escalate],
    })
    // both lists end in the open reason: the server refuses labels outside
    // the list, and a closed list corners whoever none of the presets fit
    expect(result.reviewReasons.reject.at(-1)).toBe('其他原因')
    expect(result.reviewReasons.escalate.at(-1)).toBe('其他原因')
  })

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
    // the row carries the claim's identity line (§32.74): elected fields,
    // or the first identifying ones - attachments and blanks never held
    // a place a name could have
    expect(result.row.values).toEqual([
      { label: '竞赛名称', value: '中国机器人大赛', files: null },
      { label: '等级与名次', value: '市级 一等奖', files: null },
      { label: '获奖日期', value: '2026-05-09', files: null },
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
    // the version before the judged one travels with the page read, so the
    // workbench's default comparison never waits on a second request
    expect(context.previousRevision).toMatchObject({ revisionNo: 1 })
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

  it('shows a reviewer only what was handed in, never a sibling still on the desk', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-drafts')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const reviewer = f.principal(f.reviewer)
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)

          // a question that admits several claims, so one can be judged
          // while another is still being written
          const contest = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '学科竞赛获奖',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 3,
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
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
          yield* assessment.setItemStatus(f.t, contest.id, { status: 'active' }, admin)

          const submitted = yield* assessment.createEntry(
            f.t,
            { itemId: contest.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, submitted.id, 'in_review', s1)
          // the second claim never leaves the participant's desk
          yield* assessment.createEntry(
            f.t,
            { itemId: contest.id, participantId: g.p1, payload: {} },
            s1,
          )

          const page = yield* assessment.getReviewInstance(
            f.t,
            sent.currentReviewInstanceId!,
            reviewer,
          )
          return { entryId: submitted.id, page }
        }),
      ),
    )
    // A draft has never been submitted: to its writer it is a work surface,
    // to a reviewer it does not exist. The submitted claim alone is the
    // whole sibling list.
    const siblings = result.page.context!.siblings
    expect(siblings.map((one) => one.entryId)).toEqual([result.entryId])
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
    // and nothing before it: resent as it stood, there is no earlier
    // version for a comparison to read
    expect(result.round2.context!.previousRevision).toBeNull()
    expect(result.abandoned.status).toBe('voided')
    // maxEntries is 1 on this question, and the abandoned claim freed it
    expect(result.again.id).not.toBe(result.abandoned.id)
  })

  it('grants a constant question to everybody, and reviews nobody for it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-granted')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)

          // the base points of terms.md: an item, so the account can name it
          const base = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'constant',
              title: '文体表现基础分',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: null,
              config: {
                entrySource: 'administrative',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: { mode: 'none' },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, base.id, { status: 'active' }, admin)

          // whoever stands on the roster is granted it - filing is refused
          const filed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: base.id, participantId: g.p1, payload: {} },
              f.principal(f.s1),
            ),
          )
          const standing = yield* assessment.getMyResult(f.t, g.batch.id, f.principal(f.s1))
          return { filed, standing }
        }),
      ),
    )
    expect(errorOf<{ reason?: string }>(result.filed)?.reason).toBe('item-not-fileable')
    expect(result.standing.total).toBe('3.00')
    const line = result.standing.lines.find((one) => one.kind === 'derived')!
    expect(line.label).toBe('文体表现基础分')
    expect(line.value).toBe('3.00')
  })

  it('counts an unreviewed question the moment it is submitted', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-unreviewed')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)

          const checkin = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '健康打卡',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 5,
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '0.20' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                // said, never implied: an empty route stays a refusal
                reviewPolicy: { mode: 'none' },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, checkin.id, { status: 'active' }, admin)

          const emptyRoute = yield* Effect.exit(
            assessment.createItem(
              f.t,
              g.batch.id,
              {
                itemType: 'evidence',
                title: 'bad',
                scoreGroupId: groups.groups[0]!.id,
                maxEntries: 1,
                config: {
                  entrySource: 'student',
                  formConfig: { files: {} },
                  scoringConfig: {
                    calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                    aggregator: { ref: 'sum@1', config: {} },
                  },
                  reviewPolicy: { normal: { stages: [] }, escalation: { stages: [] } },
                },
              },
              admin,
            ),
          )

          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: checkin.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const standing = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          const queue = yield* assessment.listReviewInbox(
            f.t,
            { batchId: g.batch.id },
            f.principal(f.reviewer),
          )
          return { emptyRoute, sent, standing, queue }
        }),
      ),
    )
    // an empty stage list is a configuration mistake, not a quiet "no review"
    expect(errorOf<{ _tag: string }>(result.emptyRoute)?._tag).toBe(
      'ASSESSMENT_ITEM_CONFIG_INVALID',
    )
    // the submission is the decision: approved at once, no round anywhere
    expect(result.sent.status).toBe('approved')
    expect(result.sent.currentReviewInstanceId).toBeNull()
    expect(result.standing.total).toBe('0.20')
    expect(result.queue.items.find((one) => one.itemTitle === '健康打卡')).toBeUndefined()
  })

  it('refuses to answer an ask it cannot read, instead of closing around it', async () => {
    // A newer build can store a requirement kind this one has never heard
    // of. "I do not understand this ask" must never be read as "this ask
    // does not exist": judged against the shrunken list, an empty answer
    // would satisfy completeness and the request would close as answered
    // around the very thing it asked for.
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-supplement-foreign')
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
          yield* assessment.requestSupplement(
            f.t,
            sent.currentReviewInstanceId!,
            {
              instructions: '请补充说明。',
              requirements: [{ label: '情况说明', kind: 'text', required: true }],
            },
            reviewer,
          )
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          // the future writes a kind this build does not speak
          yield* runSql(sql`
            update review_supplement_requests
            set requirements = '[{"key":"f1","label":"选择","kind":"choice","required":true}]'::jsonb
            where id = ${mine.supplement!.requestId}`)
          const refused = yield* Effect.exit(
            assessment.answerSupplement(f.t, mine.supplement!.requestId, { payload: {} }, s1),
          )
          const status = one<{ status: string }>(
            yield* runSql(sql`
              select status from review_supplement_requests
              where id = ${mine.supplement!.requestId}`),
          )
          return { refused: refusalOf(refused), status }
        }),
      ),
    )

    expect(result.refused?.reason).toBe('requirements-unreadable')
    // and the ask still stands, unclosed, for a build that can read it
    expect(result.status.status).toBe('open')
  })

  it('answers a lost race with a refusal, never a defect', async () => {
    // Two tabs answer the same ask. Both read the request while it is
    // open; one lands first. The loser must be told the request is no
    // longer open - the state it would have seen had it re-read under the
    // lock - and must never be fed to the unique response index as a
    // server defect.
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-supplement-race')
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
          yield* assessment.requestSupplement(
            f.t,
            sent.currentReviewInstanceId!,
            {
              instructions: '请补充说明。',
              requirements: [{ label: '情况说明', kind: 'text', required: true }],
            },
            reviewer,
          )
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          const answer = () =>
            Effect.exit(
              assessment.answerSupplement(
                f.t,
                mine.supplement!.requestId,
                { payload: { f1: '同一份说明。' } },
                s1,
              ),
            )
          const [a, b] = yield* Effect.all([answer(), answer()], { concurrency: 2 })
          return { a, b }
        }),
      ),
    )

    const outcomes = [result.a, result.b]
    const wins = outcomes.filter((exit) => exit._tag === 'Success')
    expect(wins).toHaveLength(1)
    const lost = outcomes.find((exit) => exit._tag === 'Failure')!
    // typed, named, harmless - and specifically NOT a die out of the
    // unique index
    const cause = lost._tag === 'Failure' ? (lost.cause as { failures?: readonly unknown[] }) : {}
    const reasons = (cause as { reasons?: readonly { _tag: string }[] }).reasons ?? []
    expect(reasons.map((one) => one._tag)).toEqual(['Fail'])
  })

  it('pauses the round to ask for more, and the answer brings it back', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-supplement')
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
          const instanceId = sent.currentReviewInstanceId!

          const asked = yield* assessment.requestSupplement(
            f.t,
            instanceId,
            {
              instructions: '证书信息看不清，请补充说明并附原件照片。',
              requirements: [
                { label: '情况说明', kind: 'text', required: true },
                { label: '证书照片', kind: 'file', required: false },
              ],
            },
            reviewer,
          )
          // out of everybody's queue while it waits, and undecidable
          const queueWhileWaiting = yield* assessment.listReviewInbox(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          const decideWhileWaiting = yield* Effect.exit(
            assessment.decideReview(f.t, instanceId, { decision: 'approve' }, reviewer),
          )
          // the person who filed sees the ask on their own claim
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          // held to the ask: the required piece must actually be there
          const empty = yield* Effect.exit(
            assessment.answerSupplement(f.t, mine.supplement!.requestId, { payload: {} }, s1),
          )
          // a classmate learns nothing, not even that the ask exists
          const stranger = yield* Effect.exit(
            assessment.answerSupplement(
              f.t,
              mine.supplement!.requestId,
              { payload: { f1: 'x' } },
              f.principal(f.s2),
            ),
          )
          const answered = yield* assessment.answerSupplement(
            f.t,
            mine.supplement!.requestId,
            { payload: { f1: '证书原件已交学院备案，照片随此说明。' } },
            s1,
          )
          const queueAfter = yield* assessment.listReviewInbox(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          const decided = yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve' },
            reviewer,
          )
          return {
            asked,
            queueWhileWaiting,
            decideWhileWaiting,
            mine,
            empty,
            stranger,
            answered,
            queueAfter,
            decided,
          }
        }),
      ),
    )
    expect(result.asked.state).toBe('awaiting_supplement')
    expect(result.asked.capabilities.canCancelSupplement).toBe(true)
    expect(result.asked.supplements).toHaveLength(1)
    expect(result.asked.supplements[0]!.status).toBe('open')
    // keys are the server's, positional and stable for the answer to name
    expect(result.asked.supplements[0]!.requirements.map((one) => one.key)).toEqual(['f1', 'f2'])
    expect(result.queueWhileWaiting.items).toHaveLength(0)
    expect(errorOf<{ reason?: string }>(result.decideWhileWaiting)?.reason).toBe(
      'awaiting-supplement',
    )
    expect(result.mine.supplement).toMatchObject({
      instructions: '证书信息看不清，请补充说明并附原件照片。',
    })
    expect(
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(result.empty)?.issues[0],
    ).toEqual({ field: 'f1', reason: 'required' })
    expect(errorOf<{ _tag: string }>(result.stranger)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    // the answer reopens the round where it stood, with the answer beside it
    expect(result.answered.state).toBe('active')
    expect(result.answered.supplements[0]!.status).toBe('answered')
    expect(result.answered.supplements[0]!.response).toMatchObject({
      payload: { f1: '证书原件已交学院备案，照片随此说明。' },
    })
    expect(result.queueAfter.items).toHaveLength(1)
    expect(result.decided.outcome).toBe('approved')
  })

  it('hands a rejected claim back with the words it was rejected in', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-refusal')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const reviewer = f.principal(f.reviewer)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          yield* assessment.updateBatch(
            f.t,
            g.batch.id,
            { reviewReasons: { reject: ['材料不清晰'], escalate: [] } },
            admin,
          )
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          // nothing has been said against it yet
          const waiting = yield* assessment.getEntry(f.t, entry.id, s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'reject', reason: '材料不清晰', comment: '证书照片缺少落款。' },
            reviewer,
          )
          const back = yield* assessment.getEntry(f.t, entry.id, s1)
          const listed = yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)
          // taken up again: the claim is nobody's to act on but the reviewer's
          yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const resent = yield* assessment.getEntry(f.t, entry.id, s1)
          return { waiting, back, listed, resent }
        }),
      ),
    )
    expect(result.waiting.refusal).toBeNull()
    expect(result.back.refusal).toMatchObject({
      kind: 'rejected',
      reason: '材料不清晰',
      comment: '证书照片缺少落款。',
    })
    // the same word travels with the row in the list, not only on a page read
    expect(result.listed.entries[0]?.refusal?.comment).toBe('证书照片缺少落款。')
    expect(result.resent.refusal).toBeNull()
  })

  it('lists what the step is waiting on somebody else for, to whoever holds it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-awaiting')
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
          const instanceId = sent.currentReviewInstanceId!

          const before = yield* assessment.listAwaitingSupplements(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          yield* assessment.requestSupplement(
            f.t,
            instanceId,
            {
              instructions: '请补充盖章那一面，并写明机构全称。',
              requirements: [{ label: '机构全称', kind: 'text', required: true }],
            },
            reviewer,
          )
          const waiting = yield* assessment.listAwaitingSupplements(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          // the person it is waiting on is not a reviewer here, and learns
          // nothing about the step's own list
          const forSubject = yield* assessment.listAwaitingSupplements(
            f.t,
            { batchId: g.batch.id },
            s1,
          )

          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          yield* assessment.answerSupplement(
            f.t,
            mine.supplement!.requestId,
            { payload: { f1: '市中心血站城东采血点' } },
            s1,
          )
          const answered = yield* assessment.listAwaitingSupplements(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          // judged, and it leaves the list with the round it belonged to
          yield* assessment.decideReview(f.t, instanceId, { decision: 'approve' }, reviewer)
          const after = yield* assessment.listAwaitingSupplements(
            f.t,
            { batchId: g.batch.id },
            reviewer,
          )
          return { before, waiting, forSubject, answered, after }
        }),
      ),
    )
    expect(result.before.items).toHaveLength(0)
    expect(result.waiting.items).toHaveLength(1)
    expect(result.waiting.items[0]).toMatchObject({
      status: 'open',
      itemTitle: expect.any(String) as string,
      asks: ['机构全称'],
    })
    expect(result.forSubject.items).toHaveLength(0)
    // answered, and still listed - back in the queue, but the reviewer who
    // asked has to be able to find it as the answer to their own question
    expect(result.answered.items[0]?.status).toBe('answered')
    expect(result.after.items).toHaveLength(0)
  })

  it('holds an open ask with its sender, and returns the answer to the pool', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-ask-owner')
          const assessment = yield* Assessment
          // a second reviewer standing at the same class, same role - seeded
          // before the batch exists, because the batch copies its accepted
          // authority at creation
          const peerId = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Reviewer Two', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${peerId}, ${f.reviewRole}, ${f.classA}, 'self')`)
          const peer = f.principal(peerId)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const asker = f.principal(f.reviewer)

          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instanceId = sent.currentReviewInstanceId!
          // both stand in the shared pool before anybody asks
          const poolBefore = yield* Effect.all({
            asker: assessment.listReviewInbox(f.t, { batchId: g.batch.id }, asker),
            peer: assessment.listReviewInbox(f.t, { batchId: g.batch.id }, peer),
          })

          yield* assessment.requestSupplement(
            f.t,
            instanceId,
            {
              instructions: '请补充说明。',
              requirements: [{ label: '情况说明', kind: 'text', required: true }],
            },
            asker,
          )

          // the wait is the sender's alone: their list has it, the peer's
          // does not, and the peer cannot read the round as its reviewer
          const waiting = yield* Effect.all({
            asker: assessment.listAwaitingSupplements(f.t, { batchId: g.batch.id }, asker),
            peer: assessment.listAwaitingSupplements(f.t, { batchId: g.batch.id }, peer),
          })
          const peerRead = yield* Effect.exit(assessment.getReviewInstance(f.t, instanceId, peer))
          // nor unsay it: the ask is not the stage's to cancel
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          const peerCancel = yield* Effect.exit(
            assessment.cancelSupplement(f.t, mine.supplement!.requestId, peer),
          )
          // the administrator still reads it - as an administrator, with
          // no review capabilities riding along
          const adminSeen = yield* assessment.getReviewInstance(
            f.t,
            instanceId,
            f.principal(f.admin),
          )

          // the answer brings the round back to everybody eligible
          yield* assessment.answerSupplement(
            f.t,
            mine.supplement!.requestId,
            { payload: { f1: '已补充。' } },
            s1,
          )
          const poolAfter = yield* Effect.all({
            asker: assessment.listReviewInbox(f.t, { batchId: g.batch.id }, asker),
            peer: assessment.listReviewInbox(f.t, { batchId: g.batch.id }, peer),
          })
          return { poolBefore, waiting, peerRead, peerCancel, adminSeen, poolAfter, instanceId }
        }),
      ),
    )

    const holds = (rows: { items: readonly { instanceId: string }[] }) =>
      rows.items.some((row) => row.instanceId === result.instanceId)
    expect(holds(result.poolBefore.asker)).toBe(true)
    expect(holds(result.poolBefore.peer)).toBe(true)
    expect(result.waiting.asker.items).toHaveLength(1)
    expect(result.waiting.peer.items).toHaveLength(0)
    expect(errorOf<{ _tag: string }>(result.peerRead)?._tag).toBe('ASSESSMENT_REVIEW_NOT_FOUND')
    expect(refusalOf(result.peerCancel)?.reason).toBe('not-requester')
    expect(result.adminSeen.capabilities.canDecide).toBe(false)
    expect(result.adminSeen.capabilities.canCancelSupplement).toBe(false)
    expect(holds(result.poolAfter.asker)).toBe(true)
    expect(holds(result.poolAfter.peer)).toBe(true)
  })

  it('lets the ask be taken back, and an abandonment close over it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-supplement-out')
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
          const ask = (instanceId: string) =>
            assessment.requestSupplement(
              f.t,
              instanceId,
              {
                instructions: '请补充说明。',
                requirements: [{ label: '情况说明', kind: 'text', required: true }],
              },
              reviewer,
            )
          yield* ask(sent.currentReviewInstanceId!)
          // the ask is review work (§32.69): the claim can no longer be
          // pulled back to draft, but its owner may still stop claiming it
          // - and the ask dies with the round that carried it
          const withdrawn = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'draft', s1),
          )
          const abandoned = yield* assessment.setEntryStatus(f.t, entry.id, 'voided', s1)
          const afterAbandon = yield* assessment.getEntry(f.t, entry.id, s1)

          const second = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const resent = yield* assessment.setEntryStatus(f.t, second.id, 'in_review', s1)
          const round2 = resent.currentReviewInstanceId!
          const asked = yield* ask(round2)
          const openRequestId = asked.supplements.find((one) => one.status === 'open')!.id
          const cancelled = yield* assessment.cancelSupplement(f.t, openRequestId, reviewer)
          const decided = yield* assessment.decideReview(
            f.t,
            round2,
            { decision: 'approve' },
            reviewer,
          )
          return { withdrawn, abandoned, afterAbandon, cancelled, decided }
        }),
      ),
    )
    expect(refusalOf(result.withdrawn)?.reason).toBe('review-under-way')
    expect(result.abandoned.status).toBe('voided')
    expect(result.afterAbandon.supplement).toBeNull()
    // taking the ask back returns the round to the queue as it stood
    expect(result.cancelled.state).toBe('active')
    expect(result.cancelled.supplements.find((one) => one.status === 'cancelled')).toBeDefined()
    expect(result.cancelled.capabilities.canDecide).toBe(true)
    expect(result.decided.outcome).toBe('approved')
  })

  it('files a declaration in one press, through whatever review it configured', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-declared')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const pledge = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'declaration',
              title: '诚信应考承诺',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '0.50' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: { mode: 'none' },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, pledge.id, { status: 'active' }, admin)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: pledge.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const standing = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          return { sent, standing }
        }),
      ),
    )
    expect(result.sent.status).toBe('approved')
    expect(result.standing.total).toBe('0.50')
  })

  it('answers stage staffing per batch, not once per node and role', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('wb-two-batches')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          // two rounds of the same tenant standing at the same class, waiting
          // on the same role: everything the patrol memoizes is identical
          // between them except the batch
          const autumn = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const makeup = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const submit = Effect.fn(function* (g: typeof autumn) {
            const entry = yield* assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            )
            const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
            return sent.currentReviewInstanceId!
          })
          const good = yield* submit(autumn)
          const short = yield* submit(makeup)
          // and then the make-up round takes the reviewer's judging back,
          // which is a fact about that batch alone
          yield* assessment.setAccessDeny(
            f.t,
            makeup.batch.id,
            { userId: f.reviewer, permission: 'assessment.review.process', denied: true },
            admin,
          )

          const patrol = yield* assessment.patrolReviewRounds
          const standing = (id: string) =>
            Effect.map(
              runSql(sql`
                select state, blocked_reason from review_instances where id = ${id}`),
              (rows) => one<{ state: string; blocked_reason: string | null }>(rows),
            )
          return { patrol, good: yield* standing(good), short: yield* standing(short) }
        }),
      ),
    )
    // the staffed round is untouched, whichever order the sweep read them in
    expect(result.good).toEqual({ state: 'active', blocked_reason: null })
    // and the one that really has nobody says so in the words the alert panel
    // splits on: an appointment is missing, not a recusal
    expect(result.short).toEqual({ state: 'blocked', blocked_reason: 'no-assignee' })
    expect(result.patrol).toEqual({ blocked: 1, released: 0 })
  })
})
