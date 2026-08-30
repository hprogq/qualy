import { Effect, Exit } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { gradedScoring } from './support/catalogs.ts'
import { errorOf, GATED, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

/** one student's claim, filed and submitted, back with its round */
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

/** a question the office records against, published and ready */
const recordItem = (f: Seeded, batchId: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title: '违纪扣分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: null,
        config: {
          entrySource: 'administrative',
          formConfig: {},
          scoringConfig: {
            calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: {
            normal: {
              stages: [
                {
                  id: 's1',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
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
    return item
  })

// What the institution decided, kept as its own fact.
//
// Today every question asks for nothing, so every determination is the empty
// one - and that is the point: the whole path has to be exercised while it
// is still cheap to change, because Phase 6 puts real values through exactly
// these rows. What is asserted here is the shape of the trail: a
// determination exists for every approved claim, it names how it was made,
// it is never edited, and a second one supersedes rather than replaces.

describe.runIf(postgresAvailable)('recognitions', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-recognition')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })

  interface RecognitionRow {
    id: string
    entryId: string
    values: Record<string, unknown>
    source: string
    supersedesId: string | null
    reviewInstanceId: string | null
    reviewEventId: string | null
    itemRevisionId: string
    createdBy: string | null
  }

  const recognitionsOf = (entryId: string) =>
    Effect.map(
      runSql(sql`
        select id as "id", entry_id as "entryId", values as "values", source as "source",
               supersedes_id as "supersedesId", review_instance_id as "reviewInstanceId",
               review_event_id as "reviewEventId", item_revision_id as "itemRevisionId",
               created_by as "createdBy"
        from entry_recognitions where entry_id = ${entryId} order by created_at`),
      (result) => (result as { rows: RecognitionRow[] }).rows,
    )

  const pointerOf = (entryId: string) =>
    Effect.map(
      runSql(sql`select current_recognition_id as "id" from entries where id = ${entryId}`),
      (result) => one<{ id: string | null }>(result).id,
    )

  it('records what an approval determined, and points the claim at it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-approve')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { entryId, instanceId } = yield* submitted(f, g, g.p1, f.s1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve', comment: 'checked' },
            f.principal(f.reviewer),
          )
          return {
            rows: yield* recognitionsOf(entryId),
            pointer: yield* pointerOf(entryId),
            instanceId,
          }
        }),
      ),
    )

    expect(result.rows).toHaveLength(1)
    const [determination] = result.rows
    // a fixed question asks for nothing, so the complete determination is
    // the empty one - not a placeholder, the whole answer
    expect(determination!.values).toEqual({})
    expect(determination!.source).toBe('review')
    expect(determination!.reviewInstanceId).toBe(result.instanceId)
    expect(determination!.reviewEventId).not.toBeNull()
    expect(determination!.supersedesId).toBeNull()
    expect(result.pointer).toBe(determination!.id)
  })

  it('leaves a refusal undetermined, and refuses to be handed one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-reject')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { entryId, instanceId } = yield* submitted(f, g, g.p1, f.s1)
          const offered = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'reject', comment: 'no', recognition: { values: {} } },
              f.principal(f.reviewer),
            ),
          )
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'reject', comment: 'the certificate is for another year' },
            f.principal(f.reviewer),
          )
          return {
            offered,
            rows: yield* recognitionsOf(entryId),
            pointer: yield* pointerOf(entryId),
            said: one<{ payload: unknown }>(
              yield* runSql(sql`
                select recognition_payload as "payload" from review_events
                where review_instance_id = ${instanceId} and kind = 'rejected'`),
            ),
          }
        }),
      ),
    )

    // "I cannot tell" is a legitimate thing to say; a refusal that carried a
    // determination would be putting words in the reviewer's mouth
    expect(Exit.isFailure(result.offered)).toBe(true)
    expect(errorOf<{ issues: readonly { field: string; reason: string }[] }>(result.offered)?.issues).toEqual([
      { field: 'recognition', reason: 'not-allowed' },
    ])
    expect(result.rows).toEqual([])
    expect(result.pointer).toBeNull()
    expect(result.said.payload).toBeNull()
  })

  it('supersedes rather than edits when a claim is determined a second time', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-again')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { entryId, instanceId } = yield* submitted(f, g, g.p1, f.s1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve', comment: 'checked' },
            f.principal(f.reviewer),
          )
          const first = yield* recognitionsOf(entryId)
          // the office sends it back and it is judged again: a second
          // determination of the same claim
          yield* assessment.interveneOnEntry(
            f.t,
            entryId,
            { kind: 'return-for-revision', reason: 'the certificate is unreadable' },
            f.principal(f.admin),
          )
          yield* assessment.appendEntryRevision(
            f.t,
            entryId,
            { payload: {} },
            f.principal(f.s1),
          )
          const again = yield* assessment.setEntryStatus(
            f.t,
            entryId,
            'in_review',
            f.principal(f.s1),
          )
          yield* assessment.decideReview(
            f.t,
            again.currentReviewInstanceId!,
            { decision: 'approve', comment: 'readable now' },
            f.principal(f.reviewer),
          )
          return {
            first,
            rows: yield* recognitionsOf(entryId),
            pointer: yield* pointerOf(entryId),
          }
        }),
      ),
    )

    expect(result.first).toHaveLength(1)
    expect(result.rows).toHaveLength(2)
    const [older, newer] = result.rows
    // the first determination is exactly as it was written: a second look
    // adds a fact, it does not revise one
    expect(older).toEqual(result.first[0])
    expect(newer!.supersedesId).toBe(older!.id)
    expect(result.pointer).toBe(newer!.id)
  })

  // Where the next reviewer starts from.
  //
  // A round that re-read the student's claim would quietly undo every
  // correction made below it: the whole reason a claim reaches an appeal is
  // that somebody disagreed with what it was recognised as. These two use a
  // question whose score actually depends on the determination - national
  // pays 10.00, provincial pays 4.00 - because with the empty determination
  // production has today, "carried forward" and "read off the filing again"
  // are the same object and neither test would fail.

  const at = (f: Seeded, id: string) => ({
    id,
    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
    quorum: { type: 'any' },
  })

  const graded = (f: Seeded) =>
    runningBatch(f, {
      profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
      scoring: gradedScoring,
      stages: [at(f, 'class')],
      // an appeal needs somewhere to be heard
      escalation: [at(f, 'dept')],
    })

  /** the claim as filed: the student says it was a national award */
  const claimed = (f: Seeded, g: { item: { id: string } }, participantId: string) =>
    Effect.gen(function* () {
      const assessment = yield* Assessment
      const as = f.principal(f.s1)
      const entry = yield* assessment.createEntry(
        f.t,
        { itemId: g.item.id, participantId, payload: { 'claimed-level': 'national' } },
        as,
      )
      const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
      return { entryId: entry.id, instanceId: sent.currentReviewInstanceId! }
    })

  it('opens an appeal on the determination it contests, not on the claim', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-appeal')
          const assessment = yield* Assessment
          const g = yield* graded(f)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          // the first reviewer corrects the level down
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'checked',
              recognition: {
                values: { 'rec-level': 'provincial' },
                reason: '证书落款为省级主办单位',
              },
            },
            f.principal(f.reviewer),
          )
          const appealed = yield* assessment.appealReview(
            f.t,
            instanceId,
            { reason: '主办单位为全国学会' },
            f.principal(f.s1),
          )
          // the appeal reviewer agrees with the file as it stands and says
          // nothing about the level
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            { decision: 'approve', comment: 'upheld' },
            f.principal(f.reviewer),
          )
          return { rows: yield* recognitionsOf(entryId), pointer: yield* pointerOf(entryId) }
        }),
      ),
    )

    expect(result.rows).toHaveLength(2)
    const [corrected, upheld] = result.rows
    expect(corrected!.values).toEqual({ 'rec-level': 'provincial' })
    // the appeal upheld the correction it was opened against; re-reading the
    // filing would have handed back 'national' and silently overturned it
    expect(upheld!.values).toEqual({ 'rec-level': 'provincial' })
    expect(upheld!.supersedesId).toBe(corrected!.id)
    expect(result.pointer).toBe(upheld!.id)
  })

  it('carries a determination across a round the administrator re-routed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-reroute')
          const assessment = yield* Assessment
          const g = yield* graded(f)
          const admin = f.principal(f.admin)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'checked',
              recognition: {
                values: { 'rec-level': 'provincial' },
                reason: '证书落款为省级主办单位',
              },
            },
            f.principal(f.reviewer),
          )
          // the office sends it back, the student refiles the same claim,
          // and the administrator moves the open round onto a renamed ladder
          yield* assessment.interveneOnEntry(
            f.t,
            entryId,
            { kind: 'return-for-revision', reason: '请补交原件' },
            admin,
          )
          yield* assessment.appendEntryRevision(
            f.t,
            entryId,
            { payload: { 'claimed-level': 'national' } },
            f.principal(f.s1),
          )
          yield* assessment.setEntryStatus(f.t, entryId, 'in_review', f.principal(f.s1))
          const swapped = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: gradedScoring,
            reviewPolicy: {
              normal: {
                stages: [
                  {
                    id: 'class-2',
                    selector: {
                      kind: 'roleAt',
                      nodeTypeId: f.classType,
                      roleIds: [f.reviewRole],
                    },
                    quorum: { type: 'any' },
                  },
                ],
              },
              escalation: { stages: [at(f, 'dept')] },
            },
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
          const rerouted = one<{ id: string; origin: string }>(
            yield* runSql(sql`
              select id, origin from review_instances
              where entry_id = ${entryId} and state = 'active'`),
          )
          yield* assessment.decideReview(
            f.t,
            rerouted.id,
            { decision: 'approve', comment: 'original seen' },
            f.principal(f.reviewer),
          )
          return {
            origin: rerouted.origin,
            rows: yield* recognitionsOf(entryId),
          }
        }),
      ),
    )

    expect(result.origin).toBe('reroute')
    expect(result.rows).toHaveLength(2)
    // the refiled claim says 'national' again and the new round starts on a
    // new chain, but what the question stands recognised as was decided by a
    // person and does not reset because a stage was renamed
    expect(result.rows[1]!.values).toEqual({ 'rec-level': 'provincial' })
  })

  it('determines an administrative record without inventing a review', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id)
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: item.id,
              participantId: g.p1,
              payload: {},
              note: 'the office register, page 14',
            },
            f.principal(f.recorder),
          )
          return {
            status: entry.status,
            rows: yield* recognitionsOf(entry.id),
            pointer: yield* pointerOf(entry.id),
            rounds: one<{ count: string }>(
              yield* runSql(
                sql`select count(*)::text as "count" from review_instances where entry_id = ${entry.id}`,
              ),
            ).count,
          }
        }),
      ),
    )

    expect(result.status).toBe('approved')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.source).toBe('record')
    // no round was invented to carry it: the office's word stands on its own
    expect(result.rows[0]!.reviewInstanceId).toBeNull()
    expect(result.rounds).toBe('0')
    expect(result.pointer).toBe(result.rows[0]!.id)
  })
})
