import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, run, runningBatch, seed } from './support/round.ts'

// The unread dot's whole contract (§32.72): external changes ring the bell,
// the owner's own acts never do, looking silences exactly what was looked
// at, and a change racing the look stays unread. Stage handovers are not
// news - only the verdict is.

const PROFILE = [...GATED, 'assessment.review.process']

describe.runIf(postgresAvailable)('the participant attention model', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-attention')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  // Paging the feed. The rows carry a millisecond rendering for the wire and
  // the column keeps microseconds, so a cursor built from what is shown asks
  // the next page for everything older than a rounded-down instant - and
  // drops whatever was written inside the gap, which is exactly where the
  // rows written alongside the boundary row live.
  it('pages the feed without dropping rows that share an instant', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('at-paging')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: PROFILE })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.requestSupplement(
            f.t,
            submitted.currentReviewInstanceId!,
            {
              instructions: '请补充现场照片',
              requirements: [{ label: '照片', kind: 'file', required: true }],
            },
            f.principal(f.reviewer),
          )
          // every row of this story into one millisecond, a microsecond
          // apart: the shape a burst of writes really has, and the shape a
          // truncated cursor cannot page through
          const cluster = (table: string, base: string) =>
            runSql(sql`
              with ordered as (
                select id, row_number() over (order by created_at, id) as n
                from ${sql.raw(table)} where entry_id = ${entry.id}
              )
              update ${sql.raw(table)} t
              set created_at = ${sql.raw(`timestamptz '${base}'`)} + (o.n * interval '1 microsecond')
              from ordered o where o.id = t.id and t.tenant_id = ${f.t}`)
          yield* cluster('entry_revisions', '2026-08-01 10:00:00.500100+00')
          yield* cluster('entry_events', '2026-08-01 10:00:00.500500+00')
          yield* runSql(sql`
            update review_events set created_at = timestamptz '2026-08-01 10:00:00.500800+00'
            where tenant_id = ${f.t}`)

          const whole = yield* assessment.listMyActivity(f.t, g.batch.id, { limit: '50' }, s1)
          const paged: string[] = []
          let cursor: string | undefined
          for (let turn = 0; turn < 20; turn += 1) {
            const page = yield* assessment.listMyActivity(
              f.t,
              g.batch.id,
              cursor === undefined ? { limit: '2' } : { limit: '2', cursor },
              s1,
            )
            paged.push(...page.items.map((one) => one.id))
            if (page.nextCursor === null) break
            cursor = page.nextCursor
          }
          return { whole: whole.items.map((one) => one.id), paged }
        }),
      ),
    )
    // there is a story to page through in the first place
    expect(result.whole.length).toBeGreaterThan(2)
    // and walking it two at a time reads the same story, in the same order
    expect(result.paged).toEqual(result.whole)
  })

  it('rings on the verdict, not on the stage handover, and a look silences it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('at-verdict')
          const assessment = yield* Assessment
          // two stages, so a mid-chain approval exists to NOT ring on
          const g = yield* runningBatch(f, {
            profile: PROFILE,
            stages: [
              {
                id: 'class',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'class-again',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const s1 = f.principal(f.s1)
          const unread = () =>
            Effect.map(
              assessment.listMyEntries(f.t, g.batch.id, {}, s1),
              (page) => page.attention.unreadItemIds,
            )

          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          // own acts ring nothing
          const afterOwn = yield* unread()

          // the first stage confirms; the round moves on - still no news
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const afterHandover = yield* unread()

          // the second reviewer is excluded? same reviewer holds both class
          // stages - same-round independence only binds the escalation
          // route, so the same judge may take the second step here
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const afterVerdict = yield* unread()

          yield* assessment.markMyEntryRead(f.t, g.batch.id, g.item.id, s1)
          const afterLook = yield* unread()
          // idempotent: looking twice is still just looked
          const again = yield* assessment.markMyEntryRead(f.t, g.batch.id, g.item.id, s1)
          return { afterOwn, afterHandover, afterVerdict, afterLook, again, itemId: g.item.id }
        }),
      ),
    )

    expect(result.afterOwn).toEqual([])
    expect(result.afterHandover).toEqual([])
    expect(result.afterVerdict).toEqual([result.itemId])
    expect(result.afterLook).toEqual([])
    expect(result.again).toEqual({ ok: true })
  })

  it('keeps a change that raced the look unread, and tells the story in order', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('at-race')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: PROFILE })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)

          // the reviewer asks for material: news
          yield* assessment.requestSupplement(
            f.t,
            submitted.currentReviewInstanceId!,
            {
              instructions: '请补充现场照片',
              requirements: [{ label: '照片', kind: 'file', required: true }],
            },
            f.principal(f.reviewer),
          )
          // the owner looks...
          yield* assessment.markMyEntryRead(f.t, g.batch.id, g.item.id, s1)
          // ...and in the same breath the ask is withdrawn: newer than the
          // look, so the dot must come back
          const mine = yield* assessment.getEntry(f.t, entry.id, s1)
          yield* assessment.cancelSupplement(
            f.t,
            mine.supplement!.requestId,
            f.principal(f.reviewer),
          )
          const racedUnread = (yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)).attention
            .unreadItemIds

          // the desk knows what needs a hand, and the activity tells the
          // story newest first in business words
          const overview = yield* assessment.getMyOverview(f.t, g.batch.id, s1)
          const activity = yield* assessment.listMyActivity(f.t, g.batch.id, {}, s1)
          return {
            racedUnread,
            itemId: g.item.id,
            summary: overview.participant!,
            kinds: activity.items.map((one) => one.kind),
            ats: activity.items.map((one) => one.at),
          }
        }),
      ),
    )

    expect(result.racedUnread).toEqual([result.itemId])
    // the ask was cancelled, so nothing needs the owner's hand any more
    expect(result.summary.actions).toEqual([])
    expect(result.summary.unreadItemIds).toEqual([result.itemId])
    // newest first: cancel, ask, submit, create - and no raw event kinds
    expect(result.kinds).toEqual([
      'supplement-cancelled',
      'supplement-requested',
      'entry-submitted',
      'entry-created',
    ])
    // the wire speaks ISO, not postgres text: the browser parses it as-is
    for (const at of result.ats) {
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    }
  })

  it('lists the open ask and the return mark as the two things to handle', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('at-actions')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: PROFILE })
          const s1 = f.principal(f.s1)
          const admin = f.principal(f.admin)
          const first = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, first.id, 'in_review', s1)
          // approved by the round, then sent back by the administrator:
          // that is the return mark the summary must carry
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          yield* assessment.interveneOnEntry(
            f.t,
            first.id,
            { kind: 'return-for-revision', reason: '证书等级与填写不符' },
            admin,
          )
          // and a fresh round on the same claim carrying an open ask -
          // a returned claim answers with a new version first (§32.65)
          yield* assessment.appendEntryRevision(f.t, first.id, { payload: {} }, s1)
          const resent = yield* assessment.setEntryStatus(f.t, first.id, 'in_review', s1)
          yield* assessment.requestSupplement(
            f.t,
            resent.currentReviewInstanceId!,
            {
              instructions: '请补充证书原件',
              requirements: [{ label: '证书', kind: 'file', required: true }],
            },
            f.principal(f.reviewer),
          )
          return {
            summary: (yield* assessment.getMyOverview(f.t, g.batch.id, s1)).participant!,
          }
        }),
      ),
    )

    const kinds = result.summary.actions.map((action) => action.kind)
    expect(kinds).toContain('supplement')
    expect(result.summary.actions.find((one) => one.kind === 'supplement')?.summary).toBe(
      '请补充证书原件',
    )
  })

  it('gives the reviewer a desk of their own: the queue count, and their acts in their voice', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('at-reviewer')
          const assessment = yield* Assessment
          // two stages, so one approval hands on and the next one settles
          const g = yield* runningBatch(f, {
            profile: PROFILE,
            stages: [
              {
                id: 'class',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
              {
                id: 'class-again',
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
          })
          const s1 = f.principal(f.s1)
          const judge = f.principal(f.reviewer)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)

          // one claim waiting, nothing done yet: the desk counts, the feed is quiet
          const before = yield* assessment.getMyOverview(f.t, g.batch.id, judge)
          const quiet = yield* assessment.listMyActivity(f.t, g.batch.id, {}, judge)

          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'approve' },
            judge,
          )
          const midway = yield* assessment.listMyActivity(f.t, g.batch.id, {}, judge)
          yield* assessment.decideReview(
            f.t,
            submitted.currentReviewInstanceId!,
            { decision: 'approve' },
            judge,
          )
          const after = yield* assessment.getMyOverview(f.t, g.batch.id, judge)
          const story = yield* assessment.listMyActivity(f.t, g.batch.id, {}, judge)
          // each lane alone: the reviewer lane also walks the query shape
          // where the reviewer piece leads the union
          const reviewerLane = yield* assessment.listMyActivity(
            f.t,
            g.batch.id,
            { perspective: 'reviewer' },
            judge,
          )
          const filtered = yield* assessment.listMyActivity(
            f.t,
            g.batch.id,
            { perspective: 'participant' },
            judge,
          )
          return { before, quiet, midway, after, story, reviewerLane, filtered }
        }),
      ),
    )

    // the fixture's org-scope import sweeps the reviewer into the roster
    // too, so their participant branch exists and is simply empty
    expect(result.before.participant).toEqual({ unreadItemIds: [], actions: [] })
    expect(result.before.reviewer?.pendingCount).toBe(1)
    expect(result.before.reviewer?.answeredAskCount).toBe(0)
    // the queue's second line: the same one claim, under its score group
    expect(result.before.reviewer?.queueGroups.reduce((sum, g) => sum + g.count, 0)).toBe(1)
    expect(result.before.reviewer?.answeredAsks).toEqual([])
    expect(result.quiet.items).toEqual([])
    // a mid-chain approval is a handover in the reviewer's own story too
    expect(result.midway.items.map((one) => one.kind)).toEqual(['review-stage-approved'])
    expect(result.after.reviewer?.pendingCount).toBe(0)
    expect(result.after.reviewer?.queueGroups).toEqual([])
    const settled = result.story.items[0]!
    expect(result.story.items.map((one) => one.kind)).toEqual([
      'review-approved',
      'review-stage-approved',
    ])
    expect(settled.perspective).toBe('reviewer')
    expect(settled.subjectName).not.toBeNull()
    // the door closed with the round: the server hands out no way back
    // into a finished instance this reader could no longer open (§32.74)
    expect(settled.instanceId).toBeNull()
    // mid-chain the round was still this judge's to open
    expect(result.midway.items[0]!.instanceId).not.toBeNull()
    expect(result.reviewerLane.items.map((one) => one.kind)).toEqual([
      'review-approved',
      'review-stage-approved',
    ])
    expect(result.filtered.items).toEqual([])
  })
})
