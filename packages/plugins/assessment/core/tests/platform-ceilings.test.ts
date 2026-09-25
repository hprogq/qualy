import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ScoringRuntimeCatalog } from '../src/plugin.ts'
import {
  MAX_ACCOUNT_EVALUATIONS,
  MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT,
  MAX_ENTRIES_PER_ACCOUNT,
  MAX_ENTRIES_PER_ITEM,
  MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT,
} from '../src/api.ts'
import { ITEMS_PER_BATCH_MOST } from '../src/item/config.ts'
import { currentRevisionOf, numbered, recordItem, workbook } from './support/administrative.ts'
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

/**
 * This many live claims for one person on one question, written around the
 * service: recorded by the office unless said otherwise, or filed by the
 * person themselves.
 */
const hold = (
  f: Seeded,
  batchId: string,
  itemId: string,
  participantId: string,
  count: number,
  source: 'record' | 'self' = 'record',
) =>
  runSql(sql`
    insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
    select ${f.t}, ${batchId}, ${itemId}, ${participantId}, ${source}, 'draft'
    from generate_series(1, ${count}::int)`)

describe('the ceilings together', () => {
  it('leave every account the writes admit readable', () => {
    // one evaluation per granted question and at most one per live claim:
    // a round of the most questions, with a participant at both of the
    // round's allowances, is still one reading
    expect(MAX_ENTRIES_PER_ACCOUNT).toBe(
      MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT + MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT,
    )
    expect(ITEMS_PER_BATCH_MOST + MAX_ENTRIES_PER_ACCOUNT).toBeLessThanOrEqual(
      MAX_ACCOUNT_EVALUATIONS,
    )
    // a question with no limit of its own fits in either allowance
    expect(MAX_ENTRIES_PER_ITEM).toBeLessThanOrEqual(MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT)
    expect(MAX_ENTRIES_PER_ITEM).toBeLessThanOrEqual(MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT)
  })
})

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

  it('refuses the bulk record write at the ceiling it previewed below', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pc-record-write')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const recorder = f.principal(f.recorder)
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${recorded.id}`,
            ),
          ).id
          const input = {
            itemId: recorded.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: {},
            basis: '校发〔2026〕3 号',
          }
          // one place left when the act is looked at, none when it is pressed
          yield* hold(f, g.batch.id, recorded.id, g.p1, MAX_ENTRIES_PER_ITEM - 1)
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            recorder,
          )
          yield* hold(f, g.batch.id, recorded.id, g.p1, 1)
          const written = yield* Effect.exit(
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              {
                ...input,
                excludedParticipantIds: [],
                expectedTargetFingerprint: seen.targetFingerprint,
              },
              recorder,
            ),
          )
          return { eligible: seen.eligibleCount, written }
        }),
      ),
    )
    expect(result.eligible).toBe(1)
    expect(
      errorOf<{ blocked: { reason: string }[] }>(result.written)?.blocked.map((one) => one.reason),
    ).toEqual(['entry-ceiling-reached'])
  })

  it('refuses a finding past the office allowance by every administrative door, and the participant still files', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pc-round')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          // the office's whole allowance held on a question of its own, so
          // the questions asked below still have every place free
          const elsewhere = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          yield* hold(f, g.batch.id, elsewhere.id, g.p1, MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT - 1)
          const recorder = f.principal(f.recorder)
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${recorded.id}`,
            ),
          ).id
          const input = {
            itemId: recorded.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: {},
            basis: '校发〔2026〕4 号',
          }
          const below = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            recorder,
          )
          yield* hold(f, g.batch.id, elsewhere.id, g.p1, 1)
          const written = yield* Effect.exit(
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              {
                ...input,
                excludedParticipantIds: [],
                expectedTargetFingerprint: below.targetFingerprint,
              },
              recorder,
            ),
          )
          const single = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId: g.p1, payload: {}, note: '校发〔2026〕5 号' },
              recorder,
            ),
          )
          const at = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            { ...input, target: { kind: 'people', participantIds: [g.p1, g.p2] } },
            recorder,
          )
          // the office's findings take no place in the participant's own
          // allowance: offered, and taken
          const offered = (yield* assessment.listMyEntries(
            f.t,
            g.batch.id,
            {},
            f.principal(f.s1),
          )).filing.find((one) => one.itemId === g.item.id)?.create
          const filed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              f.principal(f.s1),
            ),
          )
          // a voided finding holds no place in the round either
          yield* runSql(sql`
            update entries set status = 'voided'
            where id = (select id from entries where item_id = ${elsewhere.id}
                          and participant_id = ${g.p1} limit 1)`)
          const fitted = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId: g.p1, payload: {}, note: '校发〔2026〕6 号' },
              recorder,
            ),
          )
          return { written, single, at, offered, filed, fitted }
        }),
      ),
    )
    expect(
      errorOf<{ blocked: { reason: string }[] }>(result.written)?.blocked.map((one) => one.reason),
    ).toEqual(['account-ceiling-reached'])
    expect(refusalOf(result.single)?.reason).toBe('account-ceiling-reached')
    expect(result.at.blocked.map((one) => one.reason)).toEqual(['account-ceiling-reached'])
    expect(result.at.eligibleCount).toBe(1)
    expect(result.offered).toEqual({ state: 'available', reason: null })
    expect(Exit.isSuccess(result.filed)).toBe(true)
    expect(Exit.isSuccess(result.fitted)).toBe(true)
  })

  // A participant who could use up a pool shared with the office would shut
  // the office out of recording anything about them - a deduction included
  // - and nobody else may give up those drafts for them.
  it('refuses a filing past the participant allowance, and every administrative door still takes a finding', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pc-own')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const s1 = f.principal(f.s1)
          const recorder = f.principal(f.recorder)
          const offer = Effect.map(
            assessment.listMyEntries(f.t, g.batch.id, {}, s1),
            (mine) => mine.filing.find((one) => one.itemId === g.item.id)?.create,
          )
          // the participant's whole allowance held in drafts on a question
          // of its own, so the questions asked below still have every place
          const elsewhere = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          yield* hold(
            f,
            g.batch.id,
            elsewhere.id,
            g.p1,
            MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT - 1,
            'self',
          )
          const offeredBelow = yield* offer
          yield* hold(f, g.batch.id, elsewhere.id, g.p1, 1, 'self')
          const offered = yield* offer
          const filed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )

          // one finding at a time
          const single = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId: g.p1, payload: {}, note: '校发〔2026〕7 号' },
              recorder,
            ),
          )
          // one finding for several people, looked at and then written
          const input = {
            itemId: recorded.id,
            expectedItemRevisionId: yield* currentRevisionOf(recorded.id),
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: {},
            basis: '校发〔2026〕8 号',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            recorder,
          )
          const bulk = yield* Effect.exit(
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              {
                ...input,
                excludedParticipantIds: [],
                expectedTargetFingerprint: seen.targetFingerprint,
              },
              recorder,
            ),
          )
          // and a workbook, previewed and committed
          const importing = {
            attachmentId: yield* workbook(f, recorded.id, f.recorder, [
              ['2023001', 'Zhang San', '校发〔2026〕9 号'],
            ]),
            itemId: recorded.id,
            expectedItemRevisionId: input.expectedItemRevisionId,
          }
          const previewed = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            importing,
            recorder,
          )
          const imported = yield* Effect.exit(
            assessment.commitAdministrativeImport(f.t, g.batch.id, importing, recorder),
          )
          return { offeredBelow, offered, filed, single, seen, bulk, previewed, imported }
        }),
      ),
    )
    expect(result.offeredBelow).toEqual({ state: 'available', reason: null })
    expect(result.offered).toEqual({ state: 'blocked', reason: 'account-ceiling-reached' })
    expect(refusalOf(result.filed)?.reason).toBe('account-ceiling-reached')
    expect(Exit.isSuccess(result.single)).toBe(true)
    expect(result.seen.blocked).toEqual([])
    expect(result.seen.eligibleCount).toBe(1)
    expect(Exit.isSuccess(result.bulk)).toBe(true)
    expect(result.previewed.rows.flatMap((row) => row.issues)).toEqual([])
    expect(Exit.isSuccess(result.imported)).toBe(true)
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
