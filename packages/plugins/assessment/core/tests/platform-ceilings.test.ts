import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ScoringRuntimeCatalog } from '../src/plugin.ts'
import { MAX_ACCOUNT_EVALUATIONS, MAX_ENTRIES_PER_ITEM } from '../src/api.ts'
import { recordItem } from './support/administrative.ts'
import {
  errorOf,
  ok,
  one,
  refusalOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// "No limit" on a question means no business rule, not no ceiling (ruling
// of 2026-09-25). Every door that adds a claim stops at the platform
// ceiling, and one reading of an account refuses outright past the most
// evaluations it may run, rather than scoring part of it.

/** this many live claims for one person on one question, written around the service */
const hold = (f: Seeded, batchId: string, itemId: string, participantId: string, count: number) =>
  runSql(sql`
    insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
    select ${f.t}, ${batchId}, ${itemId}, ${participantId}, 'record', 'draft'
    from generate_series(1, ${count}::int)`)

describe.runIf(postgresAvailable)('the platform ceilings', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-platform-ceilings')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('refuses a claim past the ceiling on a question with no limit, by every door', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pc-entries')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          // the participant's own question, unlimited
          yield* runSql(sql`update assessment_items set max_entries = null where id = ${g.item.id}`)
          yield* hold(f, g.batch.id, g.item.id, g.p1, MAX_ENTRIES_PER_ITEM)
          const s1 = f.principal(f.s1)
          const filed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )
          // a voided claim holds no place: one gone, one more fits
          yield* runSql(sql`
            update entries set status = 'voided'
            where id = (select id from entries where item_id = ${g.item.id}
                          and participant_id = ${g.p1} limit 1)`)
          const fitted = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )

          // the office's question, unlimited, at the ceiling for the same person
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          yield* hold(f, g.batch.id, recorded.id, g.p1, MAX_ENTRIES_PER_ITEM)
          const recorder = f.principal(f.recorder)
          const single = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId: g.p1, payload: {}, note: '校发〔2026〕1 号' },
              recorder,
            ),
          )
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${recorded.id}`,
            ),
          ).id
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            {
              itemId: recorded.id,
              expectedItemRevisionId: revision,
              target: { kind: 'people', participantIds: [g.p1, g.p2] },
              payload: {},
              basis: '校发〔2026〕2 号',
            },
            recorder,
          )
          return { filed, fitted, single, blocked: seen.blocked, eligible: seen.eligibleCount }
        }),
      ),
    )
    expect(refusalOf(result.filed)?.reason).toBe('entry-ceiling-reached')
    expect(Exit.isSuccess(result.fitted)).toBe(true)
    expect(refusalOf(result.single)?.reason).toBe('entry-ceiling-reached')
    expect(result.blocked.map((one) => one.reason)).toEqual(['entry-ceiling-reached'])
    expect(result.eligible).toBe(1)
  })

  it('evaluates claims determined alike once, and refuses an account past the ceiling', async () => {
    let evaluations = 0
    const counting = ScoringRuntimeCatalog.of({
      compile: () => {
        throw new Error('compile is not part of reading an account')
      },
      verify: () => {
        throw new Error('verify is not part of reading an account')
      },
      prepare: () =>
        Effect.succeed({
          evaluate: () =>
            Effect.sync(() => {
              evaluations += 1
              return '1.00'
            }),
        }),
    })
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pc-account')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const recorder = f.principal(f.recorder)
          const record = (participantId: string, note: string) =>
            assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId, payload: {}, note },
              recorder,
            )
          // three findings on one person, determined alike
          for (const note of ['一', '二', '三']) yield* record(g.p1, note)
          const alike = yield* assessment
            .getMyResult(f.t, g.batch.id, f.principal(f.s1))
            .pipe(Effect.provideService(ScoringRuntimeCatalog, counting))
          const evaluatedAlike = evaluations

          // the second person: one finding through the service, then more
          // approved claims than one reading may evaluate, each determined
          // differently, written around it
          const first = yield* record(g.p2, '一')
          const cloned = (yield* runSql(sql`
            insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
            select tenant_id, batch_id, item_id, participant_id, source, 'draft'
            from entries, generate_series(1, ${MAX_ACCOUNT_EVALUATIONS}::int)
            where id = ${first.id}
            returning id`)) as unknown as { rows: { id: string }[] }
          const ids = cloned.rows.map((row) => row.id)
          yield* runSql(sql`
            insert into entry_revisions
              (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload,
               actor_id, subject_id, source, note)
            select er.tenant_id, e.id, er.item_id, er.item_revision_id, 1, er.payload,
                   er.actor_id, er.subject_id, er.source, er.note
            from entry_revisions er
            join entries src on src.current_revision_id = er.id and src.id = ${first.id}
            cross join entries e
            where e.id = any(${ids}::uuid[])`)
          yield* runSql(sql`
            insert into entry_recognitions
              (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
               values, source, created_by)
            select rec.tenant_id, rec.batch_id, e.id, er.id, rec.item_id, rec.item_revision_id,
                   jsonb_build_object('n', row_number() over (order by e.id)), rec.source,
                   rec.created_by
            from entry_recognitions rec
            join entries src on src.current_recognition_id = rec.id and src.id = ${first.id}
            cross join entries e
            join entry_revisions er on er.entry_id = e.id
            where e.id = any(${ids}::uuid[])`)
          yield* runSql(sql`
            update entries e
            set status = 'approved',
                current_revision_id = (select id from entry_revisions where entry_id = e.id),
                current_recognition_id = (select id from entry_recognitions where entry_id = e.id)
            where e.id = any(${ids}::uuid[])`)
          const before = evaluations
          const past = yield* Effect.exit(
            assessment
              .getMyResult(f.t, g.batch.id, f.principal(f.s2))
              .pipe(Effect.provideService(ScoringRuntimeCatalog, counting)),
          )
          return { alike, evaluatedAlike, past, spentPast: evaluations - before }
        }),
      ),
    )
    // three claims, one piece of arithmetic, and every claim still counted
    expect(result.evaluatedAlike).toBe(1)
    expect(result.alike.total).toBe('3.00')
    // refused whole, before any arithmetic ran
    expect(errorOf<{ _tag: string; limit: number; evaluations: number }>(result.past)).toEqual(
      expect.objectContaining({
        _tag: 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE',
        limit: MAX_ACCOUNT_EVALUATIONS,
        evaluations: MAX_ACCOUNT_EVALUATIONS + 1,
      }),
    )
    expect(result.spentPast).toBe(0)
  })
})
