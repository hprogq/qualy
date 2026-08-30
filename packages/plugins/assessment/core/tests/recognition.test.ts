import { Effect, Exit } from 'effect'
import { inspect } from 'node:util'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { gradedScoring, narrowFactTest, twoFactScoring } from './support/catalogs.ts'
import {
  errorOf,
  GATED,
  ok,
  one,
  refusalOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

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
const recordItem = (f: Seeded, batchId: string, over?: { scoring?: unknown }) =>
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
          scoringConfig: over?.scoring ?? {
            calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          // an administrative record walks no route when it is written -
          // it is approved as it is filed - and keeps one anyway, because
          // that is where an appeal against it is heard
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
            escalation: {
              stages: [
                {
                  id: 'appeal',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                  quorum: { type: 'any' },
                },
              ],
            },
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
    expect(
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(result.offered)?.issues,
    ).toEqual([{ field: 'recognition', reason: 'not-allowed' }])
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
          yield* assessment.appendEntryRevision(f.t, entryId, { payload: {} }, f.principal(f.s1))
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
        { itemId: g.item.id, participantId, payload: { 'claimed-level-slot': 'national' } },
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
          const appealed = yield* assessment.appealEntry(
            f.t,
            entryId,
            { reason: '主办单位为全国学会' },
            f.principal(f.s1),
          )
          // the appeal reviewer confirms exactly what they were shown - no
          // reason given, so if the seed were the filing's claim instead of
          // the correction, this would be a contradiction and refused
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            {
              decision: 'approve',
              comment: 'upheld',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
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

  it('reads the new material when a claim is refiled, not the old determination', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-refiled')
          const assessment = yield* Assessment
          const g = yield* graded(f)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          // the first reviewer determines it provincial, against the first
          // filing, which claimed national
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
          // the office sends it back; the student files the national
          // certificate they were missing and submits again
          yield* assessment.interveneOnEntry(
            f.t,
            entryId,
            { kind: 'return-for-revision', reason: '请补交主办单位证明' },
            f.principal(f.admin),
          )
          yield* assessment.appendEntryRevision(
            f.t,
            entryId,
            { payload: { 'claimed-level-slot': 'national' } },
            f.principal(f.s1),
          )
          const again = yield* assessment.setEntryStatus(
            f.t,
            entryId,
            'in_review',
            f.principal(f.s1),
          )
          const round = one<{ origin: string }>(
            yield* runSql(
              sql`select origin from review_instances where id = ${again.currentReviewInstanceId!}`,
            ),
          )
          // the reviewer confirms the new material's own claim, reasonless:
          // were the seed still the old determination, this would read as a
          // contradiction and be refused
          yield* assessment.decideReview(
            f.t,
            again.currentReviewInstanceId!,
            {
              decision: 'approve',
              comment: 'certificate seen',
              recognition: { values: { 'rec-level': 'national' } },
            },
            f.principal(f.reviewer),
          )
          return { origin: round.origin, rows: yield* recognitionsOf(entryId) }
        }),
      ),
    )

    expect(result.origin).toBe('initial')
    expect(result.rows).toHaveLength(2)
    // a first look at a new filing is a first look: it starts from the
    // material, not from a determination made about material that has since
    // been replaced
    expect(result.rows[1]!.values).toEqual({ 'rec-level': 'national' })
  })

  it('carries a determination across a round the administrator re-routed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-reroute')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // two steps, so the first reviewer's word does not end the round:
          // the round is still open, holding a determination, when the
          // administrator moves it
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
            scoring: gradedScoring,
            stages: [at(f, 'n1'), at(f, 'n2')],
          })
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
          // the administrator renames the second step, which moves every
          // open round onto the new chain
          const swapped = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: gradedScoring,
            reviewPolicy: {
              normal: { stages: [at(f, 'n1'), at(f, 'n2-renamed')] },
              escalation: { stages: [] },
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
          // the round starts over on the new chain; both steps confirm the
          // inherited correction, reasonless - a wrong seed would make this
          // a contradiction and refuse it
          yield* assessment.decideReview(
            f.t,
            rerouted.id,
            {
              decision: 'approve',
              comment: 'first step',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.reviewer),
          )
          yield* assessment.decideReview(
            f.t,
            rerouted.id,
            {
              decision: 'approve',
              comment: 'second step',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.reviewer),
          )
          return { origin: rerouted.origin, rows: yield* recognitionsOf(entryId) }
        }),
      ),
    )

    expect(result.origin).toBe('reroute')
    expect(result.rows).toHaveLength(1)
    // the student's filing says national and the round restarted on a new
    // chain, but a reviewer had already determined provincial in the round
    // this one replaced - renaming a step is not a reason to unmake that
    expect(result.rows[0]!.values).toEqual({ 'rec-level': 'provincial' })
  })

  it('asks for a reason only when a reviewer contradicts, not when they fill in', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-first-fill')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            // two determinations: one the filing seeds, one only a reviewer
            // can make
            scoring: twoFactScoring,
            stages: [at(f, 'n1'), at(f, 'n2')],
          })
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          // the first reviewer writes the fact nobody had determined, and
          // leaves the seeded one alone: that is doing the job, not changing
          // somebody's mind, so no explanation is owed
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'first look',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 2 } },
            },
            f.principal(f.reviewer),
          )
          // the second one contradicts it, and is asked why
          const bare = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              {
                decision: 'approve',
                comment: 'second look',
                recognition: { values: { 'rec-level': 'provincial', 'rec-ordinal': 2 } },
              },
              f.principal(f.reviewer),
            ),
          )
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'second look',
              recognition: {
                values: { 'rec-level': 'provincial', 'rec-ordinal': 2 },
                reason: '主办单位是省级学会',
              },
            },
            f.principal(f.reviewer),
          )
          return { bare, rows: yield* recognitionsOf(entryId) }
        }),
      ),
    )

    expect(
      errorOf<{ issues: readonly { field: string; reason: string }[] }>(result.bare)?.issues,
    ).toEqual([{ field: 'recognition.reason', reason: 'required' }])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.values).toEqual({ 'rec-level': 'provincial', 'rec-ordinal': 2 })
  })

  it('hands an appeal exactly what the office determined, and nothing else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-appeal-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
          })
          const item = yield* recordItem(f, g.batch.id, { scoring: gradedScoring })
          // the filing claims national; the office, who is the author of the
          // determination, writes it down as provincial
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: item.id,
              participantId: g.p1,
              payload: { 'claimed-level-slot': 'national' },
              note: '登记表第 14 页',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.recorder),
          )
          yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '主办单位为全国学会' },
            f.principal(f.s1),
          )
          // the appeal reviewer confirms what they were shown, reasonless:
          // if the seed were the filing's claim rather than the office's
          // word, this would be a contradiction and refused
          const round = one<{ id: string }>(
            yield* runSql(
              sql`select id from review_instances where entry_id = ${entry.id} and state = 'active'`,
            ),
          )
          yield* assessment.decideReview(
            f.t,
            round.id,
            {
              decision: 'approve',
              comment: 'upheld',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.reviewer),
          )
          return { rows: yield* recognitionsOf(entry.id) }
        }),
      ),
    )

    expect(result.rows).toHaveLength(2)
    // upholding inherits the determination under appeal - the one the round
    // wrote down as contested - not the filing's own claim. Re-reading the
    // material would hand back 'national' and quietly overturn the office.
    expect(result.rows[0]!.values).toEqual({ 'rec-level': 'provincial' })
    expect(result.rows[1]!.values).toEqual({ 'rec-level': 'provincial' })
    expect(result.rows[1]!.source).toBe('review')
  })

  it("does not carry an old filing's determination onto new material through an appeal", async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-appeal-refiled')
          const assessment = yield* Assessment
          const g = yield* graded(f)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          // the first filing is determined provincial and approved
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
          // sent back; new material filed and rejected without determining
          yield* assessment.interveneOnEntry(
            f.t,
            entryId,
            { kind: 'return-for-revision', reason: '请补交原件' },
            f.principal(f.admin),
          )
          yield* assessment.appendEntryRevision(
            f.t,
            entryId,
            { payload: { 'claimed-level-slot': 'national' } },
            f.principal(f.s1),
          )
          yield* assessment.setEntryStatus(f.t, entryId, 'in_review', f.principal(f.s1))
          const second = one<{ id: string }>(
            yield* runSql(
              sql`select id from review_instances where entry_id = ${entryId} and state = 'active'`,
            ),
          )
          yield* assessment.decideReview(
            f.t,
            second.id,
            { decision: 'reject', comment: '仍有疑问' },
            f.principal(f.reviewer),
          )
          // the student contests the rejection of the NEW material
          const appealed = yield* assessment.appealEntry(
            f.t,
            entryId,
            { reason: '原件已附上' },
            f.principal(f.s1),
          )
          yield* assessment.decideReview(
            f.t,
            appealed.id,
            {
              decision: 'approve',
              comment: 'the original checks out',
              recognition: { values: { 'rec-level': 'national' } },
            },
            f.principal(f.reviewer),
          )
          return { rows: yield* recognitionsOf(entryId) }
        }),
      ),
    )

    // The contested rejection determined nothing, and the determination the
    // claim still points at was made about the OLD filing. Inheriting it
    // would write the old material's conclusion onto the new; the seed falls
    // through to the new filing instead.
    const latest = result.rows[result.rows.length - 1]!
    expect(latest.values).toEqual({ 'rec-level': 'national' })
  })

  it('closes the appeal a withdrawn record was carrying', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-void-round')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
          })
          const item = yield* recordItem(f, g.batch.id)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {}, note: '违纪记录' },
            f.principal(f.recorder),
          )
          const appealed = yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '当天我在校外实习' },
            f.principal(f.s1),
          )
          // the office withdraws the record while the appeal is open
          const voided = yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'void', reason: '经复核，记录有误' },
            f.principal(f.admin),
          )
          // and the round closed with it: a reviewer arriving late finds a
          // concluded round, not a live queue item about a withdrawn fact
          const decided = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              appealed.id,
              { decision: 'approve', comment: 'too late' },
              f.principal(f.reviewer),
            ),
          )
          return {
            status: voided.status,
            round: one<{ state: string; outcome: string | null }>(
              yield* runSql(
                sql`select state, outcome from review_instances where id = ${appealed.id}`,
              ),
            ),
            pointer: one<{ current: string | null }>(
              yield* runSql(
                sql`select current_review_instance_id as current from entries where id = ${entry.id}`,
              ),
            ).current,
            decided,
          }
        }),
      ),
    )

    expect(result.status).toBe('voided')
    expect(result.round).toEqual({ state: 'completed', outcome: 'cancelled' })
    expect(result.pointer).toBeNull()
    expect(Exit.isFailure(result.decided)).toBe(true)
  })

  it('refuses a determination that is not an object, in words', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-not-object')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { instanceId } = yield* submitted(f, g, g.p1, f.s1)
          const offered = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', comment: 'ok', recognition: { values: null } },
              f.principal(f.reviewer),
            ),
          )
          return { offered }
        }),
      ),
    )

    // the wire hands over an unknown; a malformed one is a request to refuse
    // in the vocabulary already written for it, never a defect
    expect(Exit.isFailure(result.offered)).toBe(true)
    expect(
      errorOf<{ issues: readonly { reason: string }[] }>(result.offered)?.issues?.[0]?.reason,
    ).toBe('not-an-object')
  })

  it('keeps what an appeal contests across a re-route', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-appeal-rerouted')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
          })
          const item = yield* recordItem(f, g.batch.id, { scoring: gradedScoring })
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: item.id,
              participantId: g.p1,
              payload: { 'claimed-level-slot': 'national' },
              note: '登记表第 14 页',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.recorder),
          )
          yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '主办单位为全国学会' },
            f.principal(f.s1),
          )
          // the administrator renames the appeal step, which moves the open
          // appeal onto a new chain
          const renamed = {
            entrySource: 'administrative' as const,
            formConfig: {},
            scoringConfig: gradedScoring,
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
              escalation: {
                stages: [
                  {
                    id: 'appeal-2',
                    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                    quorum: { type: 'any' },
                  },
                ],
              },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, item.id, { config: renamed, reason: '改环节名' }, admin),
          )
          const report = errorOf<{ impactToken: string }>(asked)!
          yield* assessment.updateItem(
            f.t,
            item.id,
            {
              config: renamed,
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
          const moved = one<{ id: string; appealed_recognition_id: string | null }>(
            yield* runSql(sql`
              select id, appealed_recognition_id from review_instances
              where entry_id = ${entry.id} and state = 'active'`),
          )
          yield* assessment.decideReview(
            f.t,
            moved.id,
            {
              decision: 'approve',
              comment: 'upheld',
              recognition: { values: { 'rec-level': 'provincial' } },
            },
            f.principal(f.reviewer),
          )
          return { moved, rows: yield* recognitionsOf(entry.id) }
        }),
      ),
    )

    // the pointer travelled with the round, and upholding on the new chain
    // still inherits the office's determination rather than the filing's
    // claim
    expect(result.moved.appealed_recognition_id).not.toBeNull()
    const latest = result.rows[result.rows.length - 1]!
    expect(latest.values).toEqual({ 'rec-level': 'provincial' })
  })

  it('refuses a registrar recording against themselves, twice over', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-self-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id)
          // the registrar is on the roster too: same student type, standing
          // under the batch's own import rule
          const mine = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${g.batch.id} and user_id = ${f.recorder}`),
          )
          const refused = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: item.id, participantId: mine.id, payload: {}, note: '给自己记一笔' },
              f.principal(f.recorder),
            ),
          )
          // and the table says the same thing to writers the service never
          // sees: a migration, an import, a path that forgets. A real record
          // first, as the template the smuggled row rides on.
          const real = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {}, note: '正常登记' },
            f.principal(f.recorder),
          )
          const smuggled = yield* Effect.exit(
            runSql(sql`
              insert into entry_revisions
                (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload,
                 actor_id, subject_id, source)
              select e.tenant_id, e.id, e.item_id, r.item_revision_id, 99, '{}',
                     ${f.recorder}, ${f.recorder}, 'record'
              from entries e
              join entry_revisions r on r.id = e.current_revision_id
              where e.id = ${real.id}`),
          )
          return { refused, smuggled }
        }),
      ),
    )

    // approved on sight and nobody reviews it: both halves of a record
    // depend on the two people being two people
    expect(refusalOf(result.refused)?.reason).toBe('self-record-refused')
    expect(Exit.isFailure(result.smuggled)).toBe(true)
    expect(inspect(result.smuggled, { depth: 8 })).toContain(
      'chk_entry_revisions_record_two_people',
    )
  })

  it('keeps a deduction beyond the reach of its own subject, record power or not', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-self-void')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id)
          // somebody else enters a deduction against the registrar, who is
          // on the roster like anybody else
          const mine = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${g.batch.id} and user_id = ${f.recorder}`),
          )
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: mine.id, payload: {}, note: '违纪记录' },
            f.principal(f.admin),
          )
          const standing = () =>
            Effect.map(
              runSql(sql`
                select status, current_recognition_id as recognition
                from entries where id = ${entry.id}`),
              (raw) => one<{ status: string; recognition: string | null }>(raw),
            )
          const before = yield* standing()
          // holding the record power does not put your own deduction in
          // your hands: unmaking a record is the same power as making one,
          // and both need the two people to be two people
          const selfVoid = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              entry.id,
              { kind: 'void', reason: '不服，先删了' },
              f.principal(f.recorder),
            ),
          )
          const after = yield* standing()
          // another registrar whose authority covers them still can
          const voided = yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'void', reason: '经复核，记录有误' },
            f.principal(f.admin),
          )
          return { selfVoid, before, after, status: voided.status }
        }),
      ),
    )

    expect(refusalOf(result.selfVoid)?.reason).toBe('self-record-refused')
    // the refusal changed nothing: still approved, still the same
    // determination, still counted
    expect(result.after).toEqual(result.before)
    expect(result.after.status).toBe('approved')
    expect(result.after.recognition).not.toBeNull()
    expect(result.status).toBe('voided')
  })

  it('never assumes a determination nobody submitted', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-implicit')
          const assessment = yield* Assessment
          const g = yield* graded(f)
          const { instanceId } = yield* claimed(f, g, g.p1)
          // "approve" alone, against a contract that asks for something: an
          // old client or a screen that failed to render the form must not
          // have the defaults recorded as this reviewer's words
          const bare = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', comment: 'looks fine' },
              f.principal(f.reviewer),
            ),
          )
          // and the same at the registrar's door, where approval is
          // immediate
          const item = yield* recordItem(f, g.batch.id, { scoring: gradedScoring })
          const bareRecord = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              {
                itemId: item.id,
                participantId: g.p1,
                payload: { 'claimed-level-slot': 'national' },
                note: '登记表第 14 页',
              },
              f.principal(f.recorder),
            ),
          )
          return { bare, bareRecord }
        }),
      ),
    )

    // the two doors are refused in the same words
    for (const refusal of [result.bare, result.bareRecord] as Exit.Exit<unknown, unknown>[]) {
      expect(Exit.isFailure(refusal)).toBe(true)
      expect(
        errorOf<{ issues: readonly { field: string; reason: string }[] }>(refusal)?.issues,
      ).toEqual([{ field: 'recognition', reason: 'required' }])
    }
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

  it('refuses to strand a determination somebody already made', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-compat')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* graded(f)
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
          // the administrator renames the determination the claim stands on.
          // Scoring reads today's plan, so the approved claim would be
          // approved and unscorable - and nothing would say so until
          // somebody opened a results page
          const renamed = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: {
              ...gradedScoring,
              recognitions: { 'rec-grade': { defaultFromFieldId: 'claimed-level' } },
              bindings: { level: { kind: 'recognition' as const, recognitionId: 'rec-grade' } },
            },
            reviewPolicy: {
              normal: { stages: [at(f, 'class')] },
              escalation: { stages: [at(f, 'dept')] },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: renamed, reason: '换一个认定名' },
              admin,
            ),
          )
          return {
            entryId,
            refused: errorOf<{ issues: readonly { path: string; reason: string }[] }>(asked)!,
          }
        }),
      ),
    )

    // the save stops and names the claim it would strand: there is no
    // remedy a student or a reviewer could carry out, so it is not a
    // decision to offer - it is a configuration that cannot be saved
    expect(result.refused.issues).toEqual([
      {
        path: `scoringConfig.recognitions:${result.entryId}`,
        reason: 'strands-existing-recognition',
      },
    ])
  })

  it('refuses to leave an open round determining under a contract nobody can read', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-open-round')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* graded(f)
          // a round is open and has determined nothing yet
          const { entryId } = yield* claimed(f, g, g.p1)
          const renamed = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: {
              ...gradedScoring,
              recognitions: { 'rec-grade': { defaultFromFieldId: 'claimed-level' } },
              bindings: { level: { kind: 'recognition' as const, recognitionId: 'rec-grade' } },
            },
            reviewPolicy: {
              normal: { stages: [at(f, 'class')] },
              escalation: { stages: [at(f, 'dept')] },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: renamed, reason: '换一个认定名' },
              admin,
            ),
          )
          return {
            entryId,
            refused: errorOf<{ issues: readonly { path: string; reason: string }[] }>(asked)!,
          }
        }),
      ),
    )

    // the round judges by the contract it opened with, and would settle on a
    // determination the new plan cannot read - so the save stops rather than
    // letting that round walk toward an unscorable approval
    expect(result.refused.issues).toEqual([
      {
        path: `scoringConfig.recognitions:${result.entryId}`,
        reason: 'strands-existing-recognition',
      },
    ])
  })

  // The same trials with a typed window instead of a renamed id: the
  // narrowing gate must be a judgement about VALUES, not about the shape of
  // the configuration change.

  const narrowScoring = {
    ...twoFactScoring,
    calculator: { ref: narrowFactTest.ref, config: {} },
  }
  const policyOf = (f: Seeded) => ({
    normal: { stages: [at(f, 'class')] },
    escalation: { stages: [at(f, 'dept')] },
  })
  const twoFacted = (f: Seeded, scoring: unknown = twoFactScoring) =>
    runningBatch(f, {
      profile: [...REVIEW_OPEN, 'assessment.entry.appeal'],
      scoring,
      stages: [at(f, 'class')],
      escalation: [at(f, 'dept')],
    })

  it('refuses to narrow a window a determination already sits outside', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-narrow')
          const assessment = yield* Assessment
          const g = yield* twoFacted(f)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'checked',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 9 } },
            },
            f.principal(f.reviewer),
          )
          // ordinal 9 was determined; the narrow calculator reads 1..5
          const asked = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              {
                config: {
                  entrySource: 'student' as const,
                  formConfig: { files: {} },
                  scoringConfig: narrowScoring,
                  reviewPolicy: policyOf(f),
                },
                reason: '收紧序位',
              },
              f.principal(f.admin),
            ),
          )
          return {
            entryId,
            refused: errorOf<{ issues: readonly { path: string; reason: string }[] }>(asked)!,
          }
        }),
      ),
    )

    expect(result.refused.issues).toEqual([
      {
        path: `scoringConfig.recognitions:${result.entryId}`,
        reason: 'strands-existing-recognition',
      },
    ])
  })

  it('lets a narrowing through when every determination still fits', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-narrow-ok')
          const assessment = yield* Assessment
          const g = yield* twoFacted(f)
          const { instanceId } = yield* claimed(f, g, g.p1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'checked',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 3 } },
            },
            f.principal(f.reviewer),
          )
          // ordinal 3 fits the narrow window; nothing is stranded, so the
          // save must not be refused over the determinations
          const asked = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              {
                config: {
                  entrySource: 'student' as const,
                  formConfig: { files: {} },
                  scoringConfig: narrowScoring,
                  reviewPolicy: policyOf(f),
                },
                reason: '收紧序位',
              },
              f.principal(f.admin),
            ),
          )
          return errorOf<{ issues?: readonly { reason: string }[] }>(asked)
        }),
      ),
    )

    expect(result?.issues).toBeUndefined()
  })

  it('holds an open round to the window it opened with', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-frozen-window')
          const assessment = yield* Assessment
          const g = yield* twoFacted(f, narrowScoring)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          const before = yield* Effect.map(
            runSql(
              sql`select current_revision_id as "id" from assessment_items where id = ${g.item.id}`,
            ),
            (rows) => one<{ id: string }>(rows).id,
          )
          // widening 1..5 to 1..10 strands nothing, so the save goes through
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student' as const,
                formConfig: { files: {} },
                scoringConfig: twoFactScoring,
                reviewPolicy: policyOf(f),
              },
              reason: '放宽序位',
            },
            f.principal(f.admin),
          )
          const after = yield* Effect.map(
            runSql(
              sql`select current_revision_id as "id" from assessment_items where id = ${g.item.id}`,
            ),
            (rows) => one<{ id: string }>(rows).id,
          )
          // the sitting round still judges by the contract it opened with:
          // 8 is legal under the question as it reads today, and refused
          const wide = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              {
                decision: 'approve',
                comment: 'checked',
                recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 8 } },
              },
              f.principal(f.reviewer),
            ),
          )
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'checked',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 4 } },
            },
            f.principal(f.reviewer),
          )
          return {
            before,
            after,
            wide: errorOf<{ issues: readonly { field: string; reason: string }[] }>(wide)!,
            rows: yield* recognitionsOf(entryId),
          }
        }),
      ),
    )

    expect(result.after).not.toBe(result.before)
    expect(result.wide.issues).toEqual([{ field: 'recognition.rec-ordinal', reason: 'maximum' }])
    // and what it settled on is recorded against the revision it judged by
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.itemRevisionId).toBe(result.before)
  })

  it('lets a change through that every open round could still satisfy', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-open-ok')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* graded(f)
          yield* claimed(f, g, g.p1)
          // the same determinations, a different amount: nothing a round
          // could produce becomes unreadable, so there is nothing to refuse
          const repriced = {
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: gradedScoring,
            reviewPolicy: {
              normal: { stages: [at(f, 'class'), at(f, 'dept')] },
              escalation: { stages: [at(f, 'dept')] },
            },
          }
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: repriced, reason: '加一级' }, admin),
          )
          // a policy change still asks what to do with the open round; what
          // it must not do is refuse the save over the determinations
          return errorOf<{ issues?: readonly { reason: string }[] }>(asked)
        }),
      ),
    )

    expect(result?.issues).toBeUndefined()
  })

  it("keeps a recorded fact out of its subject's hands, and open to their argument", async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-admin-boundary')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: [...REVIEW_OPEN, 'assessment.entry.appeal', 'assessment.entry.abandon'],
            stages: [at(f, 'class')],
            escalation: [at(f, 'dept')],
          })
          const item = yield* recordItem(f, g.batch.id)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {}, note: '违纪记录' },
            f.principal(f.recorder),
          )
          const asSubject = f.principal(f.s1)
          // the student cannot make the office's deduction stop counting
          const abandoned = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'voided', asSubject),
          )
          const card = yield* Effect.map(assessment.getEntry(f.t, entry.id, asSubject), (view) => ({
            abandon: view.capabilities.abandon.state,
            appeal: view.capabilities.appeal.state,
          }))
          // but they can say they disagree with it, which is the whole point
          const appealed = yield* assessment.appealEntry(
            f.t,
            entry.id,
            { reason: '当天我在校外实习' },
            asSubject,
          )
          const round = one<{
            origin: string
            appealed_instance_id: string | null
            appealed_recognition_id: string | null
          }>(
            yield* runSql(sql`
              select origin, appealed_instance_id, appealed_recognition_id
              from review_instances where id = ${appealed.id}`),
          )
          return {
            abandoned,
            card,
            round,
            recognitionId: yield* pointerOf(entry.id),
            status: (yield* assessment.getEntry(f.t, entry.id, asSubject)).status,
          }
        }),
      ),
    )

    // a penalty the office recorded is not the student's to delete
    expect(refusalOf(result.abandoned)?.reason).toBe('entry-not-abandonable')
    expect(result.card.abandon).toBe('hidden')
    // and the appeal names the determination itself: there is no round that
    // made it, which is exactly why the old door could not be opened here
    expect(result.card.appeal).toBe('available')
    expect(result.round.origin).toBe('appeal')
    expect(result.round.appealed_instance_id).toBeNull()
    expect(result.round.appealed_recognition_id).toBe(result.recognitionId)
    expect(result.status).toBe('in_review')
  })

  it('lets the registrar withdraw what the registrar recorded, and nobody narrower or wider', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-admin-void')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {}, note: '违纪记录' },
            f.principal(f.recorder),
          )
          const attentionOf = () =>
            Effect.map(
              runSql(sql`
                select participant_attention_revision as marked, participant_seen_revision as seen
                from entries where id = ${entry.id}`),
              (raw) => one<{ marked: number; seen: number }>(raw),
            )
          // an external fact just landed on the participant's account: the
          // persistent marker is what an offline student comes back to
          const afterRecord = yield* attentionOf()

          // Somebody who runs the batch but was never given the power to
          // record. Unmaking a deduction is the same power as making one,
          // so the batch being theirs is not enough.
          const managerOnly = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              select ${f.t}, 'Manager', user_type_id, primary_org_node_id from users where id = ${f.admin}
              returning id`),
          ).id
          const managerRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
              values (${f.t}, 'batch-manager', 'Batch manager', 'org', 'active', 'allow-list')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${managerRole}, p.id from permissions p
            where p.code = 'assessment.batch.manage'`)
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${managerOnly}, ${managerRole}, ${f.root}, 'subtree')`)
          const managed = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              entry.id,
              { kind: 'void', reason: '看着不对' },
              f.principal(managerOnly),
            ),
          )

          // and a registrar whose accepted authority stops at college A
          // cannot withdraw a record about somebody standing in college B
          const admin = f.principal(f.admin)
          const outside = yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p3, payload: {}, note: '另一学院的记录' },
            admin,
          )
          const outOfReach = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              outside.id,
              { kind: 'void', reason: '越界试一下' },
              f.principal(f.recorder),
            ),
          )

          const wordless = yield* Effect.exit(
            assessment.interveneOnEntry(
              f.t,
              entry.id,
              { kind: 'void', reason: '  ' },
              f.principal(f.recorder),
            ),
          )
          const voided = yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'void', reason: '经复核，记录有误' },
            f.principal(f.recorder),
          )
          const afterVoid = yield* attentionOf()
          return {
            afterRecord,
            managed,
            outOfReach,
            wordless,
            afterVoid,
            status: voided.status,
            // the determination stays exactly as written: the office is not
            // saying it never decided, only that the fact no longer applies
            rows: yield* recognitionsOf(entry.id),
            said: one<{ kind: string; reason: string | null }>(
              yield* runSql(sql`
                select kind, reason from entry_events
                where entry_id = ${entry.id} and kind = 'voided-by-staff'`),
            ),
          }
        }),
      ),
    )

    // the record itself raised the unread marker, and the withdrawal raised
    // it again: both change the participant's effective facts
    expect(result.afterRecord.marked).toBeGreaterThan(result.afterRecord.seen)
    expect(result.afterVoid.marked).toBeGreaterThan(result.afterRecord.marked)
    // running the batch is not the power to unmake a record
    expect(refusalOf(result.managed)?.reason).toBe('permission-not-held')
    // and holding the power somewhere is not holding it here
    expect(refusalOf(result.outOfReach)?.reason).toBe('participant-out-of-reach')
    expect(refusalOf(result.wordless)?.reason).toBe('reason-required')
    expect(result.status).toBe('voided')
    expect(result.rows).toHaveLength(1)
    expect(result.said.reason).toBe('经复核，记录有误')
  })

  it('hands the approver the form the frozen contract asks for, and nobody else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-form')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            scoring: twoFactScoring,
            stages: [at(f, 'n1'), at(f, 'n2')],
          })
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          const reviewer = f.principal(f.reviewer)
          const first = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          // the first stage confirms the seeded fact and determines the
          // reviewer-only one
          yield* assessment.decideReview(
            f.t,
            instanceId,
            {
              decision: 'approve',
              comment: 'first look',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 2 } },
            },
            reviewer,
          )
          const second = yield* assessment.getReviewInstance(f.t, instanceId, reviewer)
          const subject = yield* assessment.getReviewInstance(f.t, instanceId, f.principal(f.s1))
          // and a question that asks for nothing offers no form
          void entryId
          return { first, second, subject }
        }),
      ),
    )

    const form = result.first.recognitionForm!
    // the contract's fields, in the calculator's own parameter order, each
    // carrying its frozen schema - ids are opaque identities with hyphens
    expect(form.fields.map((field) => field.id)).toEqual(['rec-level', 'rec-ordinal'])
    // the filing seeds what it can; the reviewer-only fact arrives blank
    expect(form.seed).toEqual({ 'rec-level': 'national' })
    expect(form.locked).toBeNull()
    // the next stage inherits the whole determination as its seed
    expect(result.second.recognitionForm!.seed).toEqual({
      'rec-level': 'national',
      'rec-ordinal': 2,
    })
    // the subject is not deciding anything: no form - which is a statement
    // about acting, not about who may read a recognition
    expect(result.subject.recognitionForm).toBeNull()
  })

  it('offers no form on an empty contract, and the frozen text to a sitting', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-form-empty')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const { instanceId } = yield* submitted(f, g, g.p1, f.s1)
          const empty = yield* assessment.getReviewInstance(
            f.t,
            instanceId,
            f.principal(f.reviewer),
          )
          return { empty }
        }),
      ),
    )
    // fixed@1 asks for nothing: the approval needs no form and the screen
    // must not invent one
    expect(result.empty.recognitionForm).toBeNull()
  })

  it('hands the registrar the contract, its defaults, and nobody else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rec-contract')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const typed = yield* recordItem(f, g.batch.id, { scoring: gradedScoring })
          const plain = yield* recordItem(f, g.batch.id)
          const contract = yield* assessment.getRecognitionContract(
            f.t,
            typed.id,
            f.principal(f.recorder),
          )
          const empty = yield* assessment.getRecognitionContract(
            f.t,
            plain.id,
            f.principal(f.recorder),
          )
          const stranger = yield* Effect.exit(
            assessment.getRecognitionContract(f.t, typed.id, f.principal(f.s1)),
          )
          return { contract, empty, stranger }
        }),
      ),
    )

    const contract = result.contract!
    expect(contract.fields.map((field) => field.id)).toEqual(['rec-level'])
    // the pre-fill map: the payload address and the one named conversion,
    // never the calculator or its constants
    expect(contract.defaults).toEqual([
      {
        recognitionId: 'rec-level',
        payloadKey: 'claimed-level-slot',
        assignment: { kind: 'direct' },
      },
    ])
    expect(Object.keys(contract)).toEqual(['itemRevisionId', 'fields', 'defaults'])
    // a question that asks for nothing has no contract to hand over
    expect(result.empty).toBeNull()
    // and the pre-fill map is the registrar's: a student gets a refusal,
    // not a map of how determinations are derived
    expect(Exit.isFailure(result.stranger)).toBe(true)
  })
})
