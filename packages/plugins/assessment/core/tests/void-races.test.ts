import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, run, runningBatch, seed } from './support/round.ts'

// A void racing every write it is supposed to stop. Whichever side takes
// the batch lock first, the end state must satisfy one invariant: after a
// void has committed, no live work exists under the question - anything the
// void could not have seen was refused, anything it saw was swept. These
// cases run the pairs genuinely concurrently and then hold the survivors to
// that; the sequential refusals live in the lifecycle suite.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

const VOID = { status: 'voided', reason: 'withdrawn mid-round' } as const

describe.runIf(postgresAvailable)('a void against everything it must stop', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-void-races')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const liveWorkOn = (itemId: string) =>
    Effect.map(
      runSql(sql`
        select count(*)::int as n from entries
        where item_id = ${itemId} and status in ('draft', 'in_review')`),
      (rows) => one<{ n: number }>(rows).n,
    )

  const activeRoundsOf = (entryId: string) =>
    Effect.map(
      runSql(sql`
        select count(*)::int as n from review_instances
        where entry_id = ${entryId} and state = 'active'`),
      (rows) => one<{ n: number }>(rows).n,
    )

  it('create against void: the question dies with no new work under it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('vr-create')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const [creating, voiding] = yield* Effect.all(
            [
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  { itemId: g.item.id, participantId: g.p1, payload: {} },
                  f.principal(f.s1),
                ),
              ),
              Effect.exit(assessment.setItemStatus(f.t, g.item.id, VOID, f.principal(f.admin))),
            ],
            { concurrency: 'unbounded' },
          )
          return { creating, voiding, live: yield* liveWorkOn(g.item.id) }
        }),
      ),
    )

    expect(result.live).toBe(0)
  })

  it('edit and submit against void: nothing moves after the sweep', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('vr-move')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const editing = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const submitting = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p2, payload: {} },
            f.principal(f.s2),
          )
          yield* Effect.all(
            [
              Effect.exit(
                assessment.appendEntryRevision(
                  f.t,
                  editing.id,
                  { payload: { touched: true } },
                  f.principal(f.s1),
                ),
              ),
              Effect.exit(
                assessment.setEntryStatus(f.t, submitting.id, 'in_review', f.principal(f.s2)),
              ),
              Effect.exit(assessment.setItemStatus(f.t, g.item.id, VOID, f.principal(f.admin))),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            live: yield* liveWorkOn(g.item.id),
            editorRounds: yield* activeRoundsOf(editing.id),
            submitterRounds: yield* activeRoundsOf(submitting.id),
          }
        }),
      ),
    )

    // whoever won, the end is the same: no live entry, no active round - a
    // submit that beat the void was swept, one that lost was refused, and
    // in neither order may a round survive on a voided entry
    expect(result.live).toBe(0)
    expect(result.editorRounds).toBe(0)
    expect(result.submitterRounds).toBe(0)
  })

  it('reconfigure and decide against void: one closure each, consistently told', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('vr-close')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const sent = yield* assessment.setEntryStatus(
            f.t,
            entry.id,
            'in_review',
            f.principal(f.s1),
          )
          const instanceId = sent.currentReviewInstanceId!
          yield* Effect.all(
            [
              Effect.exit(
                assessment.updateItem(
                  f.t,
                  g.item.id,
                  { title: '改名了', reason: 'rename mid-void' },
                  f.principal(f.admin),
                ),
              ),
              Effect.exit(
                assessment.decideReview(
                  f.t,
                  instanceId,
                  { decision: 'approve' },
                  f.principal(f.reviewer),
                ),
              ),
              Effect.exit(assessment.setItemStatus(f.t, g.item.id, VOID, f.principal(f.admin))),
            ],
            { concurrency: 'unbounded' },
          )
          const item = one<{ status: string }>(
            yield* runSql(sql`select status from assessment_items where id = ${g.item.id}`),
          )
          const instance = one<{ state: string; outcome: string }>(
            yield* runSql(
              sql`select state, outcome from review_instances where id = ${instanceId}`,
            ),
          )
          const entryRow = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${entry.id}`),
          )
          const kinds = (
            (yield* runSql(sql`
              select kind from review_events where review_instance_id = ${instanceId}
              order by created_at, id`)) as { rows: { kind: string }[] }
          ).rows.map((row) => row.kind)
          return { item, instance, entryRow, kinds }
        }),
      ),
    )

    expect(result.item.status).toBe('voided')
    // the round closed exactly once, and the entry agrees with the outcome
    expect(result.instance.state).toBe('completed')
    if (result.instance.outcome === 'approved') {
      expect(result.entryRow.status).toBe('approved')
      expect(result.kinds).toEqual(['submitted', 'approved'])
    } else {
      expect(result.instance.outcome).toBe('cancelled')
      expect(result.entryRow.status).toBe('voided')
      expect(result.kinds).toEqual(['submitted', 'cancelled-item-voided'])
    }
  })
})
