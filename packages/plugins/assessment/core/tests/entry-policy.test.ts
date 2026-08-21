import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { errorOf, ok, one, refusalOf, run, runningBatch, seed, staged } from './support/round.ts'

// The resource policy under attack. Every case here is somebody trying the
// thing the matrix forbids: filing as somebody else, recording outside your
// reach, editing what was submitted, citing another person's file, a second
// claim past the limit. Written before any screen exists, because a screen
// only ever hides buttons - this layer is the refusal itself.

describe.runIf(postgresAvailable)('the entry resource policy', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-entry-policy')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('derives who is speaking, and refuses filing as anyone else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-derive')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const own = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const asAnother = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { own, asAnother }
        }),
      ),
    )

    expect(result.own.status).toBe('draft')
    expect(result.own.source).toBe('self')
    expect(result.own.currentRevision?.source).toBe('self')
    expect(refusalOf(result.asAnother)?.reason).toBe('not-your-participant')
  })

  it('holds staff records to their accepted, anchored reach', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          // an administrative item beside the student one
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const deduction = yield* assessment.createItem(
            f.t,
            g.batch.id,
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
          // an administrative question only records once it is published
          yield* assessment.setItemStatus(
            f.t,
            deduction.id,
            { status: 'active' },
            f.principal(f.admin),
          )
          const recorder = f.principal(f.recorder)
          const inReach = yield* assessment.createEntry(
            f.t,
            {
              itemId: deduction.id,
              participantId: g.p1,
              payload: {},
              note: '校发〔2026〕12 号',
            },
            recorder,
          )
          const outOfReach = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p3, payload: {}, note: '同一份文件' },
              recorder,
            ),
          )
          const noBasis = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p2, payload: {} },
              recorder,
            ),
          )
          const studentRecords = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p1, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { inReach, outOfReach, noBasis, studentRecords }
        }),
      ),
    )

    // recorded is decided, immediately and without a review instance
    expect(result.inReach.status).toBe('approved')
    expect(result.inReach.source).toBe('record')
    expect(result.inReach.currentReviewInstanceId).toBeNull()
    // the audit's case: record over college A says nothing about college B
    expect(refusalOf(result.outOfReach)?.reason).toBe('participant-out-of-reach')
    expect(refusalOf(result.noBasis)?.reason).toBe('basis-required')
    // a student does not hold record, whatever item they aim at
    expect(refusalOf(result.studentRecords)?.reason).toBe('permission-not-held')
  })

  it('refuses to file an answer against a question that moved while it was written', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-revision')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const admin = f.principal(f.admin)
          const drawn = g.item.currentRevision!.id

          // a draft written and kept against the question as it stood
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, expectedItemRevisionId: drawn, payload: {} },
            s1,
          )

          // the administrator changes what the question asks for
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '4.00' } },
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
              reason: 'worth more now',
            },
            admin,
          )
          const moved = (yield* assessment.getItem(f.t, g.item.id, admin)).currentRevision!.id

          // three writes, each naming the question the screen had; none of
          // them may land, and the refusal is about the question rather than
          // about a field the writer never saw
          const revising = yield* Effect.exit(
            assessment.appendEntryRevision(
              f.t,
              entry.id,
              { payload: {}, expectedItemRevisionId: drawn },
              s1,
            ),
          )
          const submitting = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1, drawn),
          )
          const filing = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              {
                itemId: g.item.id,
                participantId: g.p2,
                expectedItemRevisionId: drawn,
                payload: {},
              },
              f.principal(f.s2),
            ),
          )

          // and the same acts, now that the writer has seen what it says
          const revised = yield* assessment.appendEntryRevision(
            f.t,
            entry.id,
            { payload: {}, expectedItemRevisionId: moved },
            s1,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1, moved)
          return { drawn, moved, revising, submitting, filing, revised, submitted }
        }),
      ),
    )

    expect(result.moved).not.toBe(result.drawn)
    for (const refused of [result.revising, result.submitting, result.filing]) {
      expect(errorOf<{ _tag: string; currentRevisionId: string }>(refused)?._tag).toBe(
        'ASSESSMENT_ITEM_REVISION_CONFLICT',
      )
      expect(errorOf<{ currentRevisionId: string }>(refused)?.currentRevisionId).toBe(result.moved)
    }
    expect(result.revised.status).toBe('draft')
    expect(result.submitted.status).toBe('in_review')
  })

  it('lets a claim be worked while it is the owner’s to work, and only then', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-lifecycle')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const secondClaim = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )
          const edited = yield* assessment.appendEntryRevision(
            f.t,
            entry.id,
            { payload: {}, note: 'clarified' },
            s1,
          )
          const editedByOther = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, f.principal(f.s2)),
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const editWhileInReview = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1),
          )
          const doubleSubmit = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          const withdrawn = yield* assessment.setEntryStatus(f.t, entry.id, 'draft', s1)
          const resubmitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instances = yield* runSql(
            sql`select round_no, state, outcome from review_instances where entry_id = ${entry.id} order by round_no`,
          )
          const events = yield* runSql(
            sql`select kind from review_events re join review_instances ri on ri.id = re.review_instance_id
                where ri.entry_id = ${entry.id} order by re.created_at`,
          )
          return {
            entry,
            secondClaim,
            edited,
            editedByOther,
            submitted,
            editWhileInReview,
            doubleSubmit,
            withdrawn,
            resubmitted,
            instances: (instances as { rows: unknown[] }).rows,
            events: (events as { rows: { kind: string }[] }).rows.map((row) => row.kind),
          }
        }),
      ),
    )

    expect(refusalOf(result.secondClaim)?.reason).toBe('max-entries-reached')
    expect(result.edited.currentRevision?.revisionNo).toBe(2)
    expect(refusalOf(result.editedByOther)?.reason).toBe('not-your-entry')
    expect(result.submitted.status).toBe('in_review')
    expect(result.submitted.currentReviewInstanceId).not.toBeNull()
    expect(refusalOf(result.editWhileInReview)?.reason).toBe('entry-not-editable')
    expect(refusalOf(result.doubleSubmit)?.reason).toBe('entry-not-submittable')
    expect(result.withdrawn.status).toBe('draft')
    expect(result.withdrawn.currentReviewInstanceId).toBeNull()
    expect(result.resubmitted.status).toBe('in_review')
    // two rounds: the first completed as cancelled, the second open
    expect(result.instances).toEqual([
      { round_no: 1, state: 'completed', outcome: 'cancelled' },
      { round_no: 2, state: 'active', outcome: null },
    ])
    expect(result.events).toEqual(['submitted', 'cancelled-by-submitter', 'submitted'])
  })

  it('lets a submission waiting on an empty level be withdrawn like any other', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-blocked-withdraw')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          yield* runSql(
            sql`update role_grants set revoked_at = now() where user_id = ${f.reviewer}`,
          )
          const waiting = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const state = yield* runSql(
            sql`select state from review_instances where entry_id = ${entry.id}`,
          )
          // Waiting for somebody to be appointed is a running state, not a
          // conclusion. Refusing to end it left the claim stuck for good:
          // its owner could not take it back, and no reviewer existed to
          // move it on.
          const back = yield* assessment.setEntryStatus(f.t, entry.id, 'draft', s1)
          const after = yield* runSql(sql`
            select state, outcome from review_instances where entry_id = ${entry.id}`)
          const said = yield* runSql(sql`
            select kind from review_events
            where review_instance_id = (
              select id from review_instances where entry_id = ${entry.id})
            order by created_at, id`)
          return {
            waiting,
            state: one<{ state: string }>(state),
            back,
            after: one<{ state: string; outcome: string | null }>(after),
            said: (said as { rows: { kind: string }[] }).rows.map((row) => row.kind),
          }
        }),
      ),
    )

    expect(result.waiting.status).toBe('in_review')
    expect(result.state.state).toBe('blocked')
    expect(result.back.status).toBe('draft')
    expect(result.back.currentReviewInstanceId).toBeNull()
    expect(result.after).toEqual({ state: 'completed', outcome: 'cancelled' })
    expect(result.said).toEqual(['submitted', 'assignee-not-found', 'cancelled-by-submitter'])
  })

  it('takes a submission into a stage nobody can judge yet, and lets it wait', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-reviewer')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          // the only holder is revoked: nobody left at the class
          yield* runSql(
            sql`update role_grants set revoked_at = now() where user_id = ${f.reviewer}`,
          )
          const nobody = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          // the round waits with the roles and the node frozen, written down
          // as blocked so the patrol owns it and it heals on appointment
          const reviewer = yield* runSql(
            sql`select state from review_instances where entry_id = ${entry.id}`,
          )
          const said = yield* runSql(sql`
            select kind from review_events
            where review_instance_id = (
              select id from review_instances where entry_id = ${entry.id})
            order by created_at, id`)
          // an item whose stage names a level this person has no unit of
          // cannot be anchored at all, and that is the configuration's fault
          const noSuchLevel = yield* runSql(sql`
            update assessment_item_revisions
            set review_policy = jsonb_set(
              review_policy,
              '{normal,stages,0,selector,nodeTypeId}',
              to_jsonb(gen_random_uuid()::text))
            where id = (select current_revision_id from assessment_items where id = ${g.item.id})`)
          void noSuchLevel
          const second = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          const unanchorable = yield* Effect.exit(
            assessment.setEntryStatus(f.t, second.id, 'in_review', f.principal(f.s2)),
          )
          return {
            nobody,
            instance: one<{ state: string }>(reviewer),
            said: (said as { rows: { kind: string }[] }).rows.map((row) => row.kind),
            unanchorable,
          }
        }),
      ),
    )

    // the student is not held responsible for an empty roster of judges
    expect(ok(result.nobody).status).toBe('in_review')
    expect(result.instance.state).toBe('blocked')
    expect(result.said).toEqual(['submitted', 'assignee-not-found'])
    expect(refusalOf(result.unanchorable)?.reason).toBe('review-level-missing')
  })

  it('binds cited files in the same breath as the revision, or not at all', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-attach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const mine = yield* staged(f.t, f.s1)
          const created = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [mine] } },
            s1,
          )
          const bound = yield* runSql(
            sql`select status from storage_attachments where id = ${mine}`,
          )
          // somebody else citing my bound file, on their own entry
          const theirs = yield* staged(f.t, f.s2)
          const crossEntry = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: { files: [mine] } },
              f.principal(f.s2),
            ),
          )
          // citing somebody else's staged file
          const notYours = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, created.id, { payload: { files: [theirs] } }, s1),
          )
          // re-citing my own bound file in my own next revision is the point
          const recited = yield* assessment.appendEntryRevision(
            f.t,
            created.id,
            { payload: { files: [mine] } },
            s1,
          )
          // one good citation and one broken one leave nothing behind
          const fresh = yield* staged(f.t, f.s2, 64)
          const before = yield* runSql(
            sql`select count(*)::int as n from entries where tenant_id = ${f.t}`,
          )
          const half = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: { files: [fresh, randomUUID()] } },
              f.principal(f.s2),
            ),
          )
          const after = yield* runSql(
            sql`select count(*)::int as n from entries where tenant_id = ${f.t}`,
          )
          const freshState = yield* runSql(
            sql`select status from storage_attachments where id = ${fresh}`,
          )
          return {
            created,
            bound: one<{ status: string }>(bound).status,
            crossEntry,
            notYours,
            recited,
            half,
            unchanged: one<{ n: number }>(before).n === one<{ n: number }>(after).n,
            freshState: one<{ status: string }>(freshState).status,
          }
        }),
      ),
    )

    expect(result.created.currentRevision?.attachments).toHaveLength(1)
    expect(result.bound).toBe('bound')
    const crossIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.crossEntry)
    expect(crossIssues?.issues.map((issue) => issue.reason)).toContain('attachment-cross-entry')
    const yoursIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.notYours)
    expect(yoursIssues?.issues.map((issue) => issue.reason)).toContain('attachment-not-yours')
    expect(result.recited.currentRevision?.attachments).toHaveLength(1)
    const halfIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.half)
    expect(halfIssues?.issues.map((issue) => issue.reason)).toContain('attachment-not-found')
    // the refused create left no entry, and the good file is still only staged
    expect(result.unchanged).toBe(true)
    expect(result.freshState).toBe('staged')
  })

  it('submits into today\u2019s procedure, and holds the draft to today\u2019s form', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-anchor')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const admin = f.principal(f.admin)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const config = (over: Record<string, unknown>) => ({
            entrySource: 'student' as const,
            formConfig: { files: {} },
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: '3.00' } },
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
            ...over,
          })

          // the form gains something this draft has never been asked for
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: config({ formConfig: { required: ['certificate'], files: {} } }),
              reason: 'tightened after filing',
            },
            admin,
          )
          // nothing has begun for this draft, so there is nothing to
          // grandfather: it is simply not finished
          const stale = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )

          // the form goes back and the procedure moves instead: a level
          // nobody holds, which is exactly what an administrator edits a
          // question to fix
          const ghostRole = randomUUID()
          const moved = yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: config({
                reviewPolicy: {
                  normal: {
                    stages: [
                      {
                        id: 's1',
                        selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [ghostRole] },
                        quorum: { type: 'any' },
                      },
                    ],
                  },
                  escalation: { stages: [] },
                },
              }),
              reason: 'rerouted after filing',
            },
            admin,
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const round = one<{
            effective_chain: { normal: { selector: { roleIds: string[] } }[] }
            policy_revision_id: string
            state: string
          }>(
            yield* runSql(sql`
              select effective_chain, policy_revision_id, state from review_instances
              where id = ${submitted.currentReviewInstanceId}`),
          )
          // what is being judged is still the filing as it was written
          const judged = one<{ item_revision_id: string }>(
            yield* runSql(sql`
              select item_revision_id from entry_revisions
              where id = ${submitted.currentRevision!.id}`),
          )
          return {
            stale,
            submitted,
            round,
            judged,
            ghostRole,
            liveRevision: moved.currentRevision!.id,
          }
        }),
      ),
    )

    expect(refusalOf(result.stale)?.reason).toBe('entry-needs-revision')
    // the round walks the procedure in force when it opened, and says so
    expect(result.submitted.status).toBe('in_review')
    expect(result.round.policy_revision_id).toBe(result.liveRevision)
    expect(result.round.effective_chain.normal[0]!.selector.roleIds).toEqual([result.ghostRole])
    // nobody holds that role there, so it waits rather than refusing
    expect(result.round.state).toBe('blocked')
    // and the filing under judgment is still the one that was written
    expect(result.judged.item_revision_id).not.toBe(result.liveRevision)
  })

  it('lets one staged file into exactly one entry, however the requests race', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-race')
          const assessment = yield* Assessment
          const a = yield* runningBatch(f)
          const b = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1)
          const pOf = (batchId: string) =>
            Effect.map(
              runSql(
                sql`select id from batch_participants where batch_id = ${batchId} and user_id = ${f.s1}`,
              ),
              (result_) => one<{ id: string }>(result_).id,
            )
          const pa = yield* pOf(a.batch.id)
          const pb = yield* pOf(b.batch.id)
          // two rounds, one file, at the same moment: the batch locks do not
          // meet, only the attachment lock stands between this and a file
          // bound into two histories
          const [left, right] = yield* Effect.all(
            [
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  { itemId: a.item.id, participantId: pa, payload: { files: [file] } },
                  s1,
                ),
              ),
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  { itemId: b.item.id, participantId: pb, payload: { files: [file] } },
                  s1,
                ),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          const relations = yield* runSql(
            sql`select count(distinct er.entry_id)::int as n
                from entry_revision_attachments era
                join entry_revisions er on er.id = era.revision_id
                where era.attachment_id = ${file}`,
          )
          return { left, right, families: one<{ n: number }>(relations).n }
        }),
      ),
    )

    const outcomes = [result.left, result.right]
    expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1)
    const refused = outcomes.find(Exit.isFailure)!
    const issues = errorOf<{ issues: readonly { reason: string }[] }>(refused)
    expect(issues?.issues.map((issue) => issue.reason)).toContain('attachment-cross-entry')
    expect(result.families).toBe(1)
  })

  it('refuses a participant of another round before anything reaches the database', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-xbatch')
          const assessment = yield* Assessment
          const a = yield* runningBatch(f)
          const b = yield* runningBatch(f)
          const pInB = one<{ id: string }>(
            yield* runSql(
              sql`select id from batch_participants where batch_id = ${b.batch.id} and user_id = ${f.s1}`,
            ),
          ).id
          // the same person, the wrong round's membership row: a policy
          // refusal, never a foreign-key surprise
          const crossed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: a.item.id, participantId: pInB, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { crossed }
        }),
      ),
    )

    expect(refusalOf(result.crossed)?._tag).toBe('ASSESSMENT_ENTRY_ACTION_REFUSED')
    expect(refusalOf(result.crossed)?.reason).toBe('participant-not-found')
  })

  it('refuses one file claiming to back two fields, and re-holds re-used files to current limits', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-dupes')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1, 4096)
          // the test driver cites payload.files twice when asked twice; a
          // duplicate across fields is simulated by repeating the id, which
          // the driver leaves undeduplicated across ref entries
          const doubled = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: { files: [file, file] } },
              s1,
            ),
          )
          // bind it once, then tighten the field's limit under the file
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            s1,
          )
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student',
                formConfig: { files: { maxFileBytes: 1024 } },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
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
                  escalation: { stages: [] },
                },
              },
              reason: 'limit lowered mid-round',
            },
            admin,
          )
          const reusedOverLimit = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: { files: [file] } }, s1),
          )
          return { doubled, reusedOverLimit }
        }),
      ),
    )

    const doubledIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.doubled)
    expect(doubledIssues?.issues.map((issue) => issue.reason)).toContain('duplicate-attachment')
    const reuseIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.reusedOverLimit)
    expect(reuseIssues?.issues.map((issue) => issue.reason)).toContain('attachment-too-large')
  })

  it('keeps reading rights and acting rights apart', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-read')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const stranger = yield* Effect.exit(assessment.getEntry(f.t, entry.id, f.principal(f.s2)))
          const admin = yield* assessment.getEntry(f.t, entry.id, f.principal(f.admin))
          // excluded: history stays readable, the pen is gone (§32.56)
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'left the college',
            f.principal(f.admin),
          )
          const ownRead = yield* assessment.getEntry(f.t, entry.id, s1)
          const ownEdit = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1),
          )
          return { stranger, admin, ownRead, ownEdit }
        }),
      ),
    )

    // another student learns nothing, not even that it exists
    expect(refusalOf(result.stranger)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
    expect(result.admin.id).toBeDefined()
    // an excluded person is offered nothing, not even disabled buttons:
    // the acts are not theirs any more, so they are not spoken of
    const nothing = { state: 'hidden', reason: null }
    expect(result.ownRead.capabilities).toEqual({
      edit: nothing,
      submit: nothing,
      withdraw: nothing,
      appeal: nothing,
      abandon: nothing,
    })
    expect(refusalOf(result.ownEdit)?.reason).toBe('participant-not-active')
  })
  // Recording on a roster reads it, but only as far as the recording
  // authority reaches. A staff member anchored to one college is given that
  // college's people: a page they may not act on is a page they should not
  // have been shown, counted or paged through.
  it('gives a recorder the people their authority covers, and no more', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-recorder-reach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const mine = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { limit: 50 },
            f.principal(f.recorder),
          )
          const all = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { limit: 50 },
            f.principal(f.admin),
          )
          return {
            mine: mine.map((row) => row.id).sort(),
            all: all.map((row) => row.id).sort(),
            underA: [g.p1, g.p2].sort(),
            elsewhere: g.p3,
          }
        }),
      ),
    )
    // the roster really does hold somebody outside the recorder's college,
    // so there is something to be kept out of the page
    expect(result.all).toContain(result.elsewhere)
    expect(result.mine).not.toContain(result.elsewhere)
    // and everybody the recorder's college does cover is still there
    for (const under of result.underA) expect(result.mine).toContain(under)
    expect(result.mine.length).toBeLessThan(result.all.length)
  })
})
