import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Storage } from '@qualy/plugin-storage/server'
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

// A question's whole life. It is composed as a draft that only the people
// running the round can see, and published on purpose; deletion is for
// rounds where nothing happened; voiding keeps every record and stops the
// counting; restoring reopens the question and revives nothing. Attachments
// answer to their story: subject, judges, batch administrators - and nobody
// else, whatever else they hold.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

/** another question on a round the fixture already runs, composed as a draft */
const compose = (f: Seeded, batchId: string, scoreGroupId: string, title: string, value: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title,
        scoreGroupId,
        maxEntries: 1,
        config: {
          entrySource: 'student',
          formConfig: { files: {} },
          scoringConfig: {
            calculator: { ref: 'fixed@1', config: { value } },
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
            doubt: { stages: [] },
          },
        },
      },
      f.principal(f.admin),
    )
  })

describe.runIf(postgresAvailable)('the item lifecycle and the files it leaves', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-item-lifecycle')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('deletes only what nothing ever happened to; everything else is a void with a reason', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('il-delete')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // a running round: its question cannot be deleted, only voided
          const g = yield* runningBatch(f)
          const activeDelete = yield* Effect.exit(assessment.deleteItem(f.t, g.item.id, admin))
          const unpublished = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '从未提出的题',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: {
                    stages: [
                      {
                        id: 's1',
                        selector: {
                          kind: 'roleAt',
                          nodeTypeId: f.classType,
                          roleIds: [f.reviewRole],
                        },
                        quorum: { type: 'any' },
                      },
                    ],
                  },
                  doubt: { stages: [] },
                },
              },
            },
            admin,
          )
          const draftDelete = yield* Effect.exit(assessment.deleteItem(f.t, unpublished.id, admin))
          const draftGone = yield* Effect.exit(assessment.getItem(f.t, unpublished.id, admin))
          const blankReason = yield* Effect.exit(
            assessment.setItemStatus(f.t, g.item.id, { status: 'voided', reason: '   ' }, admin),
          )
          const byStudent = yield* Effect.exit(
            assessment.setItemStatus(
              f.t,
              g.item.id,
              { status: 'voided', reason: 'not yours to say' },
              f.principal(f.s1),
            ),
          )
          const restoreActive = yield* Effect.exit(
            assessment.setItemStatus(f.t, g.item.id, { status: 'active' }, admin),
          )

          // a draft round: the question leaves without ceremony, and the
          // ceremony is refused outright
          const draft = yield* assessment.createBatch(
            f.t,
            {
              name: 'Draft round',
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
            },
            admin,
          )
          const groups = yield* assessment.replaceScoreGroups(
            f.t,
            draft.id,
            {
              groups: [{ name: '文体', parentGroupId: null, cap: '10.00', floor: null }],
              expectedVersion: 1,
            },
            admin,
          )
          const item = yield* assessment.createItem(
            f.t,
            draft.id,
            {
              itemType: 'evidence',
              title: '晨读打卡',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: {
                    stages: [
                      {
                        id: 's1',
                        selector: {
                          kind: 'roleAt',
                          nodeTypeId: f.classType,
                          roleIds: [f.reviewRole],
                        },
                        quorum: { type: 'any' },
                      },
                    ],
                  },
                  doubt: { stages: [] },
                },
              },
            },
            admin,
          )
          const draftVoid = yield* Effect.exit(
            assessment.setItemStatus(f.t, item.id, { status: 'voided', reason: 'why not' }, admin),
          )

          // a supplementary stage that opens this question alone: taking the
          // question would leave the stage open to every question instead
          const supplementary = one<{ id: string }>(
            yield* runSql(
              sql`insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name)
                  values (${f.t}, ${draft.id}, 90, 'supplementary', 'Supplementary') returning id`,
            ),
          ).id
          yield* runSql(
            sql`insert into phase_item_scopes (tenant_id, phase_id, item_id)
                values (${f.t}, ${supplementary}, ${item.id})`,
          )
          const onlyInScope = yield* Effect.exit(assessment.deleteItem(f.t, item.id, admin))
          // with a second question in the same allowance, the delete narrows it
          const neighbour = one<{ id: string }>(
            yield* runSql(
              sql`insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id)
                  values (${f.t}, ${draft.id}, 'evidence', 'neighbour question', ${groups.groups[0]!.id})
                  returning id`,
            ),
          ).id
          yield* runSql(
            sql`insert into phase_item_scopes (tenant_id, phase_id, item_id)
                values (${f.t}, ${supplementary}, ${neighbour})`,
          )

          yield* assessment.deleteItem(f.t, item.id, admin)
          const gone = yield* Effect.exit(assessment.getItem(f.t, item.id, admin))
          const stillScoped = one<{ remaining: number }>(
            yield* runSql(
              sql`select count(*)::int as remaining from phase_item_scopes
                   where tenant_id = ${f.t} and phase_id = ${supplementary}`,
            ),
          ).remaining
          return {
            activeDelete,
            draftDelete,
            draftGone,
            blankReason,
            byStudent,
            restoreActive,
            draftVoid,
            onlyInScope,
            stillScoped,
            gone,
          }
        }),
      ),
    )

    // a published question keeps its record: void it, never delete it
    expect(refusalOf(result.activeDelete)?.reason).toBe('item-published')
    // one never published was never asked, so it may simply go
    expect(result.draftDelete._tag).toBe('Success')
    expect(errorOf<{ _tag: string }>(result.draftGone)?._tag).toBe('ASSESSMENT_ITEM_NOT_FOUND')
    expect(refusalOf(result.blankReason)?.reason).toBe('reason-required')
    expect(errorOf<{ _tag: string }>(result.byStudent)?._tag).toBe('ACCESS_DENIED')
    expect(refusalOf(result.restoreActive)?.reason).toBe('item-not-voided')
    expect(refusalOf(result.draftVoid)?.reason).toBe('batch-draft')
    // the last question a stage names cannot leave silently; once the stage
    // names another, the same delete only narrows what it opens
    expect(refusalOf(result.onlyInScope)?.reason).toBe('item-last-in-phase-scope')
    expect(result.stillScoped).toBe(1)
    expect(errorOf<{ _tag: string }>(result.gone)?._tag).toBe('ASSESSMENT_ITEM_NOT_FOUND')
  })

  it('voids the open work, preserves the decided, and restores without reviving', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('il-void')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })

          // three people, three states on the same question
          const rejected = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const sent1 = yield* assessment.setEntryStatus(
            f.t,
            rejected.id,
            'in_review',
            f.principal(f.s1),
          )
          yield* assessment.decideReview(
            f.t,
            sent1.currentReviewInstanceId!,
            { decision: 'reject', comment: 'not enough' },
            f.principal(f.reviewer),
          )
          const inReview = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          const sent2 = yield* assessment.setEntryStatus(
            f.t,
            inReview.id,
            'in_review',
            f.principal(f.s2),
          )
          const instance2 = sent2.currentReviewInstanceId!
          const drafted = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p3, payload: {} },
            f.principal(f.s3),
          )

          const voided = yield* assessment.setItemStatus(
            f.t,
            g.item.id,
            { status: 'voided', reason: 'policy withdrawn for the term' },
            admin,
          )
          const statusOf = (entryId: string) =>
            Effect.map(
              runSql(sql`select status from entries where id = ${entryId}`),
              (rows) => one<{ status: string }>(rows).status,
            )
          const afterVoid = {
            rejected: yield* statusOf(rejected.id),
            inReview: yield* statusOf(inReview.id),
            drafted: yield* statusOf(drafted.id),
          }
          const instanceRow = one<{ state: string; outcome: string }>(
            yield* runSql(sql`select state, outcome from review_instances where id = ${instance2}`),
          )
          const events = (yield* runSql(sql`
              select kind from review_events where review_instance_id = ${instance2}
              order by created_at, id`)) as { rows: { kind: string }[] }
          const configEvents = (yield* runSql(sql`
              select diff from batch_config_revisions
              where batch_id = ${g.batch.id} order by revision`)) as {
            rows: { diff: Record<string, unknown> }[]
          }

          const whileVoided = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p3, payload: {} },
              f.principal(f.s3),
            ),
          )
          const restored = yield* assessment.setItemStatus(
            f.t,
            g.item.id,
            { status: 'active' },
            admin,
          )
          const afterRestore = {
            inReview: yield* statusOf(inReview.id),
            instance: one<{ state: string; outcome: string }>(
              yield* runSql(
                sql`select state, outcome from review_instances where id = ${instance2}`,
              ),
            ),
          }
          // the question is open for new work; the voided entry does not
          // count against the limit
          const anew = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          return {
            voided,
            afterVoid,
            instanceRow,
            events: events.rows.map((row) => row.kind),
            configEvents: configEvents.rows.map((row) => row.diff),
            whileVoided,
            restored,
            afterRestore,
            anew,
          }
        }),
      ),
    )

    expect(result.voided.status).toBe('voided')
    expect(result.afterVoid).toEqual({
      rejected: 'rejected',
      inReview: 'voided',
      drafted: 'voided',
    })
    expect(result.instanceRow).toEqual({ state: 'completed', outcome: 'cancelled' })
    expect(result.events).toEqual(['submitted', 'cancelled-item-voided'])
    expect(result.configEvents).toContainEqual({ voidedItem: result.voided.id })
    expect(refusalOf(result.whileVoided)?.reason).toBe('item-not-active')
    expect(result.restored.status).toBe('active')
    expect(result.afterRestore.inReview).toBe('voided')
    expect(result.afterRestore.instance).toEqual({ state: 'completed', outcome: 'cancelled' })
    expect(result.configEvents.length).toBeGreaterThanOrEqual(1)
    expect(result.anew.status).toBe('draft')
  })

  it('lets a file be read by its story’s people and nobody else, retirement included', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('il-files')
          const assessment = yield* Assessment
          const storage = yield* Storage
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const file = yield* staged(f.t, f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            f.principal(f.s1),
          )
          yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', f.principal(f.s1))

          const openAs = (who: string) =>
            Effect.exit(assessment.openAttachment(f.t, file, f.principal(who)))
          const subject = yield* openAs(f.s1)
          const judge = yield* openAs(f.reviewer)
          const admin = yield* openAs(f.admin)
          const neighbour = yield* openAs(f.s2)
          const recorder = yield* openAs(f.recorder)

          // your own upload is yours while it is still nobody's evidence
          const pending = yield* staged(f.t, f.s2)
          const ownPending = yield* Effect.exit(
            assessment.openAttachment(f.t, pending, f.principal(f.s2)),
          )
          const othersPending = yield* Effect.exit(
            assessment.openAttachment(f.t, pending, f.principal(f.s1)),
          )

          // history outlives standing: excluded from the roster, retired in
          // storage - the subject still reads what they filed
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'moved away',
            f.principal(f.admin),
          )
          yield* storage.retire({ tenantId: f.t, attachmentId: file })
          const excludedRetired = yield* openAs(f.s1)

          // another tenant's identically-named ask sees nothing
          const f2 = yield* seed('il-files-other')
          const crossTenant = yield* Effect.exit(
            assessment.openAttachment(f2.t, file, f2.principal(f2.admin)),
          )
          return {
            subject,
            judge,
            admin,
            neighbour,
            recorder,
            ownPending,
            othersPending,
            excludedRetired,
            crossTenant,
          }
        }),
      ),
    )

    const opened = (exit: unknown) =>
      ok(exit as never) as { meta: { id: string }; target: { kind: string } }
    expect(opened(result.subject).target.kind).toBe('stream')
    expect(opened(result.judge).meta.id).toBeDefined()
    expect(opened(result.admin).meta.id).toBeDefined()
    const refused = (exit: unknown) => errorOf<{ _tag: string }>(exit as never)?._tag
    expect(refused(result.neighbour)).toBe('ASSESSMENT_ATTACHMENT_NOT_FOUND')
    expect(refused(result.recorder)).toBe('ASSESSMENT_ATTACHMENT_NOT_FOUND')
    expect(opened(result.ownPending).meta.id).toBeDefined()
    expect(refused(result.othersPending)).toBe('ASSESSMENT_ATTACHMENT_NOT_FOUND')
    expect(opened(result.excludedRetired).meta.id).toBeDefined()
    expect(refused(result.crossTenant)).toBe('ASSESSMENT_ATTACHMENT_NOT_FOUND')
  })

  it('asks a composed question once, and keeps the asking apart from a reopening', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('il-publish')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const composed = yield* compose(f, g.batch.id, g.item.scoreGroupId, '志愿服务', '2.00')
          const beforeStudent = yield* assessment.listItems(f.t, g.batch.id, f.principal(f.s1))
          const beforeAdmin = yield* assessment.listItems(f.t, g.batch.id, admin)
          const published = yield* assessment.setItemStatus(
            f.t,
            composed.id,
            { status: 'active' },
            admin,
          )
          const afterStudent = yield* assessment.listItems(f.t, g.batch.id, f.principal(f.s1))
          const again = yield* Effect.exit(
            assessment.setItemStatus(f.t, composed.id, { status: 'active' }, admin),
          )
          yield* assessment.setItemStatus(
            f.t,
            composed.id,
            { status: 'voided', reason: 'withdrawn for the term' },
            admin,
          )
          const restored = yield* assessment.setItemStatus(
            f.t,
            composed.id,
            { status: 'active' },
            admin,
          )
          const revisions = (yield* runSql(sql`
              select diff from batch_config_revisions
              where batch_id = ${g.batch.id} order by revision`)) as {
            rows: { diff: Record<string, unknown> }[]
          }
          return {
            composed,
            asked: g.item.id,
            beforeStudent: beforeStudent.items.map((row) => row.id),
            studentManages: beforeStudent.capabilities.canManage,
            beforeAdmin: beforeAdmin.items.map((row) => row.id),
            adminManages: beforeAdmin.capabilities.canManage,
            published,
            afterStudent: afterStudent.items.map((row) => row.id),
            again,
            restored,
            diffs: revisions.rows.map((row) => row.diff),
          }
        }),
      ),
    )

    expect(result.composed.status).toBe('draft')
    // whoever composes the paper sees the question; the round's own people
    // are told about it when it is asked of them, and not before
    expect(result.beforeStudent).toEqual([result.asked])
    expect(result.studentManages).toBe(false)
    expect(result.beforeAdmin).toContain(result.composed.id)
    expect(result.adminManages).toBe(true)
    expect(result.published.status).toBe('active')
    expect(result.afterStudent).toContain(result.composed.id)
    // asking is a change to what the round asks, and the round's history
    // carries it as its own act
    expect(result.diffs).toContainEqual({ publishedItem: result.composed.id })
    // Asking an already asked question comes back as a refused restore: the
    // service names the act by the status it started from, and an active
    // question did not start from a draft.
    expect(refusalOf(result.again)?.reason).toBe('item-not-voided')
    expect(errorOf<{ action: string }>(result.again)?.action).toBe('restore')
    // reopening a withdrawn question is the same write, and the record still
    // tells the two apart
    expect(result.restored.status).toBe('active')
    expect(result.diffs).toContainEqual({ restoredItem: result.composed.id })
    expect(result.diffs.filter((diff) => 'publishedItem' in diff)).toHaveLength(1)
  })

  it('leaves a question nobody was asked out of the account, and states a withdrawn one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('il-account')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          // the asked question is answered, the answer approved, and the
          // question then withdrawn: that is the branch with history on it
          const filed = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, filed.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          yield* assessment.setItemStatus(
            f.t,
            g.item.id,
            { status: 'voided', reason: 'policy withdrawn for the term' },
            admin,
          )
          // a question composed and never asked, in the same group
          const composed = yield* compose(f, g.batch.id, g.item.scoreGroupId, '晨读打卡', '5.00')
          const answering = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: composed.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )
          const account = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          // An approved entry cannot reach a question still being composed
          // through the api: createEntry refuses it above, and setItemStatus
          // has no way back to draft. The scorer's own guard is written for
          // rows that got there anyway, so it is reached the only way it can
          // be reached - by writing them.
          const planted = one<{ id: string }>(
            yield* runSql(sql`
              insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
              values (${f.t}, ${g.batch.id}, ${composed.id}, ${g.p1}, 'self', 'approved')
              returning id`),
          ).id
          const revision = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
              values (${f.t}, ${planted}, ${composed.id}, ${composed.currentRevision!.id}, 1,
                      '{}', ${f.s1}, ${f.s1}, 'self')
              returning id`),
          ).id
          yield* runSql(
            sql`update entries set current_revision_id = ${revision} where id = ${planted}`,
          )
          const withPlanted = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          // and the same row once the question is asked, so that the silence
          // above is the draft status and not an entry the account never saw
          yield* assessment.setItemStatus(f.t, composed.id, { status: 'active' }, admin)
          const onceAsked = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          return { voided: g.item.id, planted, answering, account, withPlanted, onceAsked }
        }),
      ),
    )

    expect(refusalOf(result.answering)?.reason).toBe('item-not-active')
    const linesOf = (account: {
      lines: readonly { lineId: string; kind: string; value: string }[]
    }) => account.lines.map((line) => [line.lineId, line.kind, line.value])
    // the withdrawn question is stated at zero to whoever has history on it
    expect(linesOf(result.account)).toEqual([
      [`item:${result.voided}:voided`, 'item-voided', '0.00'],
    ])
    expect(result.account.total).toBe('0.00')
    // a question never asked is absent from the account entirely, approved
    // entry or not: at zero it would read as asked and come to nothing
    expect(linesOf(result.withPlanted)).toEqual(linesOf(result.account))
    expect(result.withPlanted.total).toBe('0.00')
    expect(linesOf(result.onceAsked)).toEqual([
      [`item:${result.voided}:voided`, 'item-voided', '0.00'],
      [`entry:${result.planted}`, 'entry', '5.00'],
    ])
    expect(result.onceAsked.total).toBe('5.00')
  })
})
