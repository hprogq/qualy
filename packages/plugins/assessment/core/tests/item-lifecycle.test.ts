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
} from './support/round.ts'

// The end of a question's life, and who may still read the files it leaves
// behind. Deletion is for rounds where nothing happened; voiding keeps every
// record and stops the counting; restoring reopens the question and revives
// nothing. Attachments answer to their story: subject, judges, batch
// administrators - and nobody else, whatever else they hold.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

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
                  stages: [
                    {
                      selector: {
                        kind: 'roleAt',
                        nodeTypeId: f.classType,
                        roleIds: [f.reviewRole],
                      },
                      quorum: { type: 'any' },
                    },
                  ],
                  normalTerminal: 0,
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
                  stages: [
                    {
                      selector: {
                        kind: 'roleAt',
                        nodeTypeId: f.classType,
                        roleIds: [f.reviewRole],
                      },
                      quorum: { type: 'any' },
                    },
                  ],
                  normalTerminal: 0,
                },
              },
            },
            admin,
          )
          const draftVoid = yield* Effect.exit(
            assessment.setItemStatus(f.t, item.id, { status: 'voided', reason: 'why not' }, admin),
          )
          yield* assessment.deleteItem(f.t, item.id, admin)
          const gone = yield* Effect.exit(assessment.getItem(f.t, item.id, admin))
          return {
            activeDelete,
            draftDelete,
            draftGone,
            blankReason,
            byStudent,
            restoreActive,
            draftVoid,
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
})
