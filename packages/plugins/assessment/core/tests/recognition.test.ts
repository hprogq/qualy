import { Effect, Exit } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { gradedScoring, twoFactScoring } from './support/catalogs.ts'
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
          const appealed = yield* assessment.appealEntry(
            f.t,
            entryId,
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
            { payload: { 'claimed-level': 'national' } },
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
          // the reviewer looks at the new material and says nothing about
          // the level: whatever they are handed is what gets recorded
          yield* assessment.decideReview(
            f.t,
            again.currentReviewInstanceId!,
            { decision: 'approve', comment: 'certificate seen' },
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
          // the round starts over on the new chain; both steps approve
          // without saying anything about the level
          yield* assessment.decideReview(
            f.t,
            rerouted.id,
            { decision: 'approve', comment: 'first step' },
            f.principal(f.reviewer),
          )
          yield* assessment.decideReview(
            f.t,
            rerouted.id,
            { decision: 'approve', comment: 'second step' },
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

  it('keeps a recorded fact out of its subject\'s hands, and open to their argument', async () => {
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
          const card = yield* Effect.map(
            assessment.getEntry(f.t, entry.id, asSubject),
            (view) => ({
              abandon: view.capabilities.abandon.state,
              appeal: view.capabilities.appeal.state,
            }),
          )
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

  it('lets the office withdraw what the office recorded, with a reason', async () => {
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
          const admin = f.principal(f.admin)
          const wordless = yield* Effect.exit(
            assessment.interveneOnEntry(f.t, entry.id, { kind: 'void', reason: '  ' }, admin),
          )
          const voided = yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'void', reason: '经复核，记录有误' },
            admin,
          )
          return {
            wordless,
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

    expect(refusalOf(result.wordless)?.reason).toBe('reason-required')
    expect(result.status).toBe('voided')
    expect(result.rows).toHaveLength(1)
    expect(result.said.reason).toBe('经复核，记录有误')
  })
})
