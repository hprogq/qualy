import { sql } from 'kysely'
import { Deferred, Effect, Fiber, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { DatabaseNotifications, transaction, type Orm } from '@qualy/plugin-database/server'
import { Assessment } from '../src/server/index.ts'
import { ASSESSMENT_LIVE_CHANNEL } from '../src/live/events.ts'
import { counts, numbered, recordItem, workbook } from './support/administrative.ts'
import { errorOf, ok, one, run, runningBatch, seed } from './support/round.ts'
import { datedScoring, gradedScoring } from './support/catalogs.ts'
import ExcelJS from 'exceljs'
import { DATA_SHEET, META_SHEET } from '../src/administrative-import/workbook.ts'

// A whole workbook of administrative facts, written or not written.
//
// The claim this suite exists for is the one the preview cannot make: that
// the write reaches the same answer the preview did, and reaches it again
// under the batch lock for whatever could have moved - and that when any row
// fails, NOTHING is written. An import that kept the rows it could manage is
// an import nobody can explain afterwards.

/**
 * A commit let through its first reading of the file, then made to wait at
 * the batch lock while something else changes and commits.
 *
 * The change is made inside a transaction that takes the batch lock first, so
 * the commit's reading - which takes no lock - cannot see it and passes. The
 * commit then queues on the lock; only once it is seen waiting there is the
 * change let go. Whatever the commit refuses after that, it refused under the
 * lock, from what it read again there.
 *
 * The watching happens on the holding transaction's own connection. A suite's
 * pool is two, and while the commit waits the lock and the waiter hold both:
 * a watcher asking the pool for a third would wait forever for a lock that
 * only its own answer can release.
 */
const raced = <A, E, R>(
  batchId: string,
  change: Effect.Effect<unknown, never, Orm>,
  commit: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const changed = yield* Deferred.make<void>()
    const holder = yield* Effect.forkChild(
      transaction(
        Effect.gen(function* () {
          yield* runSql(sql`select 1 from assessment_batches where id = ${batchId} for update`)
          yield* change
          yield* Deferred.succeed(changed, undefined)
          for (let waited = 0; waited < 300; waited += 1) {
            // a transaction keeps its first look at the activity table
            // unless told to look again
            yield* runSql(sql`select pg_stat_clear_snapshot()`)
            const waiting = one<{ n: number }>(
              yield* runSql(sql`
                select count(*)::int as n from pg_stat_activity
                 where datname = current_database() and wait_event_type = 'Lock'`),
            ).n
            if (waiting > 0) return true
            yield* Effect.sleep('50 millis')
          }
          return false
        }),
      ),
    )
    yield* Deferred.await(changed)
    const outcome = yield* Effect.exit(commit)
    return { queued: yield* Fiber.join(holder), outcome }
  })

describe.runIf(postgresAvailable)('an administrative import', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-administrative-import')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  // The same fact twice is a warning somebody has to look at, and two rows
  // are the same fact once the question's own decoder and the determination's
  // canonicaliser have spoken. The reader keeps a decimal as the text
  // somebody typed - on purpose - so fingerprinting the readings saw 3.5 and
  // 3.50 as two facts, said nothing, and committed both.
  it('sees one fact twice when two rows spell the same decimal differently', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-spelling')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id, {
            formConfig: {
              fields: [{ key: 'amount', type: 'decimal', label: '金额', maxScale: 2 }],
            },
          })
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '校发〔2026〕12 号', 'national', '3.5'],
            // the same amount, spelt the other way, on a different basis -
            // and a basis is deliberately not part of what makes a fact
            ['2023001', 'Zhang San', '校发〔2026〕13 号', 'national', '3.50'],
          ])
          return yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
        }),
      ),
    )

    expect(found.rows[0]!.issues).toEqual([])
    expect(found.rows[1]!.issues.map((one) => one.reason)).toEqual(['duplicate-in-file'])
    // a warning, never a refusal: some questions are won more than once
    expect(found.summary.errors).toBe(0)
    expect(found.canCommit).toBe(true)
  })

  it('writes every row as an ordinary approved fact, with import provenance on all of it', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-ok')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '校发〔2026〕12 号'],
            ['2023002', 'Li Si', ''],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const done = yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            {
              attachmentId,
              itemId: item.id,
              expectedItemRevisionId: revision,
              defaultBasis: '学院统一依据',
            },
            f.principal(f.recorder),
          )
          // provenance, from the tables themselves rather than any view
          const sources = (yield* runSql(sql`
            select e.source as entry, v.source as revision, v.note, e.status
              from entries e
              join entry_revisions v on v.tenant_id = e.tenant_id and v.id = e.current_revision_id
             where e.tenant_id = ${f.t} and e.item_id = ${item.id}
             order by v.note`)) as unknown as {
            rows: { entry: string; revision: string; note: string; status: string }[]
          }
          const rows = (yield* runSql(sql`
            select source_row_no from administrative_entry_import_rows
             where tenant_id = ${f.t} and import_id = ${done.importId}
             order by source_row_no`)) as unknown as { rows: { source_row_no: number }[] }
          const bound = one<{ status: string }>(
            yield* runSql(
              sql`select status from storage_attachments where tenant_id = ${f.t} and id = ${attachmentId}`,
            ),
          ).status
          const book = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 10 },
            f.principal(f.recorder),
          )
          // one fact by its id, for a sheet opened on it from an address
          const single = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { entryId: book[1]!.entryId, limit: 10 },
            f.principal(f.recorder),
          )
          return { done, sources: sources.rows, rows: rows.rows, bound, book, single }
        }),
      ),
    )

    expect(found.done.importedCount).toBe(2)
    // import on the entry AND on its revision: a fact whose two halves name
    // two different origins has split its own history
    expect(found.sources.every((one) => one.entry === 'import')).toBe(true)
    expect(found.sources.every((one) => one.revision === 'import')).toBe(true)
    // effective the moment it is written, like any administrative record
    expect(found.sources.every((one) => one.status === 'approved')).toBe(true)
    // every revision carries its basis: the row's own where it gave one,
    // the shared one where it did not - never nothing
    expect(found.sources.map((one) => one.note).sort()).toEqual([
      '学院统一依据',
      '校发〔2026〕12 号',
    ])
    // and the file rows they came from, in the file's own numbering
    expect(found.rows.map((one) => one.source_row_no)).toEqual([2, 3])
    // the workbook entered history in the same transaction as the facts
    expect(found.bound).toBe('bound')
    // and the record book can say which import each of them arrived in
    expect(found.book.map((row) => row.importId)).toEqual([
      found.done.importId,
      found.done.importId,
    ])
    expect(found.single.map((row) => row.entryId)).toEqual([found.book[1]!.entryId])
  })

  // Every row of an import is written in one transaction, so every one of
  // them carries the same creation instant, to the microsecond. A cursor that
  // keeps only milliseconds of that instant sits BEFORE all of them, and the
  // next page starts after the whole import rather than after the last row.
  it('walks the record book across a page boundary inside one import', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-book-pages')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
            ['2023002', 'Li Si', '乙'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          const reader = f.principal(f.recorder)
          const first = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 1 },
            reader,
          )
          // the pair the list hands out is the pair the next request resumes from
          const second = yield* assessment.listAdministrativeEntries(
            f.t,
            g.batch.id,
            { limit: 1, after: first[0]!.cursor },
            reader,
          )
          return { first, second }
        }),
      ),
    )
    expect(found.first).toHaveLength(1)
    expect(found.second.map((row) => row.participant.displayName)).toHaveLength(1)
    expect(
      [...found.first, ...found.second].map((row) => row.participant.displayName).sort(),
    ).toEqual(['Li Si', 'Zhang San'])
  })

  // Two thousand rows must not be two thousand wake-ups for every open screen
  // on the round. The unread marks are per entry, because they are durable
  // state on each owner's row; the broadcast is what gets coalesced.
  //
  // Postgres already folds identical payloads sent inside one transaction, so
  // a round-wide event repeated per row would pass here unnoticed. What this
  // does catch is the per-person event a single record sends, which differs
  // row by row and would arrive once for every person in the file.
  it('wakes the round once for the whole file, not once a row', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-live')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
            ['2023002', 'Li Si', '乙'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const notifications = yield* DatabaseNotifications
          const heard: { kind: string; batchId: string; subjectUserId: string | null }[] = []
          const collector = yield* Effect.forkChild(
            notifications
              .listen(ASSESSMENT_LIVE_CHANNEL)
              .pipe(
                Stream.runForEach((payload) =>
                  Effect.sync(() => heard.push(JSON.parse(payload) as (typeof heard)[number])),
                ),
              ),
          )
          // LISTEN registers when the collector's stream starts
          yield* Effect.sleep('500 millis')
          yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          yield* Effect.sleep('500 millis')
          yield* Fiber.interrupt(collector)
          const attention = (yield* runSql(sql`
            select e.participant_id as id from entries e
             where e.item_id = ${item.id}
               and e.participant_attention_revision > e.participant_seen_revision
             order by e.participant_id`)) as unknown as { rows: { id: string }[] }
          return {
            heard: heard.filter((event) => event.batchId === g.batch.id),
            attention: attention.rows.map((row) => row.id),
            owners: [g.p1, g.p2].sort(),
          }
        }),
      ),
    )
    expect(found.heard.map((event) => event.kind).sort()).toEqual([
      'entries-changed',
      'result-changed',
    ])
    // a wake-up for the round, not for one person in it
    expect(found.heard.every((event) => event.subjectUserId === null)).toBe(true)
    // and both owners still hold their own unread mark
    expect(found.attention).toEqual(found.owners)
  })

  it('refuses the whole file when one row names somebody out of reach', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-all-or-nothing')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
            // college B: this recorder cannot reach Wang Wu
            ['2023003', 'Wang Wu', '乙'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            ),
          )
          const after = yield* counts(f)
          const bound = one<{ status: string }>(
            yield* runSql(
              sql`select status from storage_attachments where tenant_id = ${f.t} and id = ${attachmentId}`,
            ),
          ).status
          return { refused, after, bound }
        }),
      ),
    )

    const error = errorOf<{ _tag: string; issues: { rowNo: number; reason: string }[] }>(
      found.refused,
    )
    expect(error?._tag).toBe('ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID')
    // the row it failed at is named, and the refusal does not say WHY that
    // person could not be found - which would make this door a directory
    expect(error?.issues).toEqual([
      expect.objectContaining({ rowNo: 3, reason: 'participant-not-found' }),
    ])
    // zero, not one: Zhang San's perfectly lawful row was not kept either
    expect(found.after).toEqual({ imports: 0, entries: 0 })
    // and the file stays staged, for the storage sweeper rather than history
    expect(found.bound).toBe('staged')
  })

  // The test above is refused before a transaction ever opens: the first
  // reading of the file already knows that row is wrong. What it cannot show
  // is the property that matters once the lock IS held - that a row failing
  // after other rows have already been written takes all of them with it.
  // So the database is made to refuse the second write of an otherwise
  // lawful file, and nothing may survive.
  it('keeps nothing when a write fails partway through the transaction', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-partway')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
            ['2023002', 'Li Si', '乙'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          // both rows are lawful; the database refuses the second one only
          // once the first is already written inside the same transaction
          yield* runSql(
            sql.raw(`
            create or replace function refuse_second_import_row() returns trigger as $$
            begin
              if new.participant_id = '${g.p2}' and new.source = 'import' then
                raise exception 'refused partway, for the test';
              end if;
              return new;
            end $$ language plpgsql`),
          )
          yield* runSql(
            sql.raw(`
            create trigger refuse_second_import_row before insert on entries
            for each row execute function refuse_second_import_row()`),
          )
          const failed = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            ),
          )
          yield* runSql(sql.raw('drop trigger refuse_second_import_row on entries'))
          yield* runSql(sql.raw('drop function refuse_second_import_row()'))
          const after = yield* counts(f)
          const bound = one<{ status: string }>(
            yield* runSql(
              sql`select status from storage_attachments where tenant_id = ${f.t} and id = ${attachmentId}`,
            ),
          ).status
          return { failed: failed._tag, after, bound }
        }),
      ),
    )
    expect(found.failed).toBe('Failure')
    // Zhang San's row was written and then taken back with Li Si's: no entry,
    // no import, and no workbook bound into history for an import that never
    // happened
    expect(found.after).toEqual({ imports: 0, entries: 0 })
    expect(found.bound).toBe('staged')
  })

  it('refuses a row about the person importing it', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-self')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          // the recorder stands on this roster too: the round imported
          // everyone of the student type under the root, which includes them
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['9999999', 'Recorder', '自己给自己加分'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            ),
          )
          return { refused, after: yield* counts(f) }
        }),
      ),
    )
    const error = errorOf<{ issues: { reason: string }[] }>(found.refused)
    // a record is approved on write with no reviewer, so a spreadsheet is
    // not a way round the rule that the two people must be two
    expect(error?.issues.map((one) => one.reason)).toContain('self-record-refused')
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  it('counts the quota across what is stored and what the file adds', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-quota')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id, { maxEntries: 1 })
          // already holds the one place the question allows
          yield* assessment.createEntry(
            f.t,
            { itemId: item.id, participantId: g.p1, payload: {}, note: '先前手动认定' },
            f.principal(f.recorder),
          )
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '再来一条'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            ),
          )
          return { refused, after: yield* counts(f) }
        }),
      ),
    )
    const error = errorOf<{ issues: { reason: string }[] }>(found.refused)
    expect(error?.issues.map((one) => one.reason)).toContain('max-entries-reached')
    expect(found.after.imports).toBe(0)
  })

  it('refuses a file filled in against a question that has since moved', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-moved')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
          ])
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              {
                attachmentId,
                itemId: item.id,
                // a version that is not the current one
                expectedItemRevisionId: '00000000-0000-4000-8000-000000000000',
              },
              f.principal(f.recorder),
            ),
          )
          return { refused, after: yield* counts(f) }
        }),
      ),
    )
    // the conflict that already exists for exactly this, rather than a
    // second error meaning the same thing
    expect(errorOf<{ _tag: string }>(found.refused)?._tag).toBe('ASSESSMENT_ITEM_REVISION_CONFLICT')
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  // A file larger than the reader will ever open was stored, counted against
  // the uploader's quota, and refused by every preview after it.
  it('stores no file larger than the reader opens', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-upload-size')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const item = yield* recordItem(f, g.batch.id)
          const prepare = (size: number) =>
            Effect.exit(
              assessment.prepareAdministrativeImportUpload(
                f.t,
                g.batch.id,
                {
                  itemId: item.id,
                  filename: 'import.xlsx',
                  declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  size: String(size),
                },
                f.principal(f.recorder),
              ),
            )
          return { over: yield* prepare(20 * 1024 * 1024), within: yield* prepare(1024 * 1024) }
        }),
      ),
    )
    expect(
      errorOf<{ issues: { reason: string }[] }>(found.over)?.issues.map((one) => one.reason),
    ).toEqual(['file-too-large'])
    expect(found.within._tag).toBe('Success')
  })

  it('refuses an archived round outright', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-archived')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          yield* runSql(
            sql`update assessment_batches set status = 'archived' where id = ${g.batch.id}`,
          )
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            ),
          )
          return { refused, after: yield* counts(f) }
        }),
      ),
    )
    expect(errorOf<{ _tag: string }>(found.refused)?._tag).toBe('ASSESSMENT_BATCH_READ_ONLY')
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  // A spreadsheet is not a second form. Each row's material goes through the
  // same decoder a single record's does, and what gets written is what that
  // decoder hands back - never the cell text.
  it("holds every row to the question's own form", async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-own-form')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id, {
            formConfig: { required: ['claimed-level-slot'] },
          })
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const both = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲', 'national'],
            ['2023002', 'Li Si', '乙', ''],
          ])
          const preview = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId: both, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          const answered = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲', 'national'],
          ])
          const done = yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId: answered, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          const payload = one<{ payload: Record<string, unknown> }>(
            yield* runSql(sql`
              select v.payload from entries e
                join entry_revisions v on v.tenant_id = e.tenant_id and v.id = e.current_revision_id
               where e.item_id = ${item.id}`),
          ).payload
          return { preview, done, payload }
        }),
      ),
    )
    expect(found.preview.rows.map((row) => row.issues)).toEqual([
      [],
      [{ severity: 'error', field: 'evidence.claimed-level-slot', reason: 'required' }],
    ])
    expect(found.done.importedCount).toBe(1)
    expect(found.payload).toEqual({ 'claimed-level-slot': 'national' })
  })

  // A determined day the question holds to the round's material window is
  // held there by every door that approves: a review, the single record,
  // and this one. A file answering with a day the round does not cover is a
  // row to fix, not a fact to write.
  it('holds a determined day to the round', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-dated')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id, { scoringConfig: datedScoring() })
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          // the round runs from 2026-03-01 up to, not including, 2026-09-01
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '校发〔2026〕12 号', '', '2019-05-01'],
            ['2023002', 'Li Si', '校发〔2026〕12 号', '', '2026-05-01'],
          ])
          const input = { attachmentId, itemId: item.id, expectedItemRevisionId: revision }
          const preview = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(f.t, g.batch.id, input, f.principal(f.recorder)),
          )
          return { preview, refused, after: yield* counts(f) }
        }),
      ),
    )
    // the determination's column, by the identity the server minted for it
    expect(
      found.preview.rows.map((row) =>
        row.issues.map((one) => [one.severity, one.field?.split('.')[0], one.reason]),
      ),
    ).toEqual([[['error', 'recognition', 'out-of-material-range']], []])
    expect(found.preview.canCommit).toBe(false)
    expect(
      errorOf<{ issues: { reason: string }[] }>(found.refused)?.issues.map((one) => one.reason),
    ).toEqual(['out-of-material-range'])
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  it('leaves the bound field out of the template, and writes it from the determination', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-bound')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          // the level the office determines is the level a filing would
          // claim: asking the file for both would be asking twice
          const item = yield* recordItem(f, g.batch.id, { scoringConfig: gradedScoring })
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const template = yield* assessment.administrativeImportTemplate(
            f.t,
            item.id,
            'zh-CN',
            f.principal(f.recorder),
          )
          const book = new ExcelJS.Workbook()
          yield* Effect.promise(() => book.xlsx.load(template.bytes as unknown as ArrayBuffer))
          const meta = JSON.parse(String(book.getWorksheet(META_SHEET)!.getCell('A1').value)) as {
            columns: { kind: string; key: string }[]
          }
          // the first header is the tenant's own word for the identifier
          const identityHeader = String(book.getWorksheet(DATA_SHEET)!.getCell('A1').value)
          const filled = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲', 'provincial'],
          ])
          const done = yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId: filled, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          const payload = one<{ payload: Record<string, unknown> }>(
            yield* runSql(sql`
              select v.payload from entries e
                join entry_revisions v on v.tenant_id = e.tenant_id and v.id = e.current_revision_id
               where e.item_id = ${item.id}`),
          ).payload
          return { columns: meta.columns, done, payload, identityHeader }
        }),
      ),
    )
    // the header carries the tenant's word, as the harness resolves it
    expect(found.identityHeader).toBe('统一编号 *')
    // one column for the fact: the determination's, never a second one
    expect(found.columns.map((one) => [one.kind, one.key])).toEqual([['recognition', 'rec-level']])
    expect(found.done.importedCount).toBe(1)
    // and the filing side is written from what was determined
    expect(found.payload).toEqual({ 'claimed-level-slot': 'provincial' })
  })

  // A basis or a name the database has no room for passed every judgment the
  // preview made and failed only inside the commit's transaction, where the
  // column refused it: nothing was written, but the reader was told the
  // service had failed instead of which row to shorten. The preview holds the
  // text to the columns it lands in, so the same file is a row to fix.
  it('says which text is too long for where it is kept, before anything is written', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-too-long')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            // entry_revisions.note is 500 wide
            ['2023001', 'Zhang San', '依'.repeat(501)],
            // the row's name snapshot is 255 wide; a mismatch alone is a warning
            ['2023002', '李'.repeat(256), '校发〔2026〕12 号'],
          ])
          const input = { attachmentId, itemId: item.id, expectedItemRevisionId: revision }
          const preview = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { ...input, confirmWarnings: true },
              f.principal(f.recorder),
            ),
          )
          return { preview, refused, after: yield* counts(f) }
        }),
      ),
    )
    expect(found.preview.rows.map((row) => row.issues)).toEqual([
      [{ severity: 'error', field: 'basis', reason: 'too-long' }],
      [{ severity: 'error', field: 'displayName', reason: 'too-long' }],
    ])
    expect(found.preview.canCommit).toBe(false)
    // a refusal naming the rows, not a defect out of the transaction
    const error = errorOf<{ _tag: string; issues: { rowNo: number; reason: string }[] }>(
      found.refused,
    )
    expect(error?._tag).toBe('ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID')
    expect(error?.issues).toEqual([
      expect.objectContaining({ rowNo: 2, field: 'basis', reason: 'too-long' }),
      expect.objectContaining({ rowNo: 3, field: 'displayName', reason: 'too-long' }),
    ])
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  // A supplementary phase that admits only some people is a different answer
  // for each row. Refusing the whole question would shut the admitted people
  // out; admitting it would let the others in through a spreadsheet.
  it('asks a phase that admits some people about each row by name', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-phase-scope')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          yield* runSql(sql`
            insert into phase_participant_scopes (tenant_id, phase_id, participant_id)
            select tenant_id, id, ${g.p2} from batch_phases where batch_id = ${g.batch.id}`)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
            ['2023002', 'Li Si', '乙'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const input = { attachmentId, itemId: item.id, expectedItemRevisionId: revision }
          const preview = yield* assessment.previewAdministrativeImport(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const refused = yield* Effect.exit(
            assessment.commitAdministrativeImport(f.t, g.batch.id, input, f.principal(f.recorder)),
          )
          return { preview, refused, after: yield* counts(f) }
        }),
      ),
    )
    expect(found.preview.rows.map((row) => row.issues.map((one) => one.reason))).toEqual([
      ['participant-out-of-scope'],
      [],
    ])
    expect(errorOf<{ issues: { rowNo: number; reason: string }[] }>(found.refused)?.issues).toEqual(
      [expect.objectContaining({ rowNo: 2, reason: 'participant-out-of-scope' })],
    )
    expect(found.after).toEqual({ imports: 0, entries: 0 })
  })

  describe('what changed while the file was being read', () => {
    /** a round, an administrative question, and a one-row file ready to commit */
    const prepared = (
      slug: string,
      over?: { maxEntries?: number; formConfig?: Record<string, unknown> },
      row: readonly string[] = ['2023001', 'Zhang San', '甲'],
    ) =>
      Effect.gen(function* () {
        const f = yield* seed(slug)
        const g = yield* runningBatch(f)
        yield* numbered(f)
        const item = yield* recordItem(f, g.batch.id, over)
        const attachmentId = yield* workbook(f, item.id, f.recorder, [row])
        const revision = one<{ id: string }>(
          yield* runSql(
            sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
          ),
        ).id
        const commit = Effect.gen(function* () {
          const assessment = yield* Assessment
          return yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
        })
        return { f, g, item, revision, commit }
      })

    it('refuses when somebody took the last place first', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, item, commit } = yield* prepared('ai-race-quota', { maxEntries: 1 })
            const race = yield* raced(
              g.batch.id,
              // any claim that is not voided holds a place
              runSql(sql`
                insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
                values (${f.t}, ${g.batch.id}, ${item.id}, ${g.p1}, 'record', 'draft')`),
              commit,
            )
            return { ...race, after: yield* counts(f) }
          }),
        ),
      )
      expect(found.queued).toBe(true)
      expect(
        errorOf<{ issues: { reason: string }[] }>(found.outcome)?.issues.map((one) => one.reason),
      ).toEqual(['max-entries-reached'])
      expect(found.after).toEqual({ imports: 0, entries: 0 })
    })

    it('refuses when a person in it moved out of reach', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, commit } = yield* prepared('ai-race-scope')
            const race = yield* raced(
              g.batch.id,
              runSql(sql`
                update batch_participants p
                   set assessment_anchor_node_id = moved.assessment_anchor_node_id,
                       anchor_path = moved.anchor_path
                  from batch_participants moved
                 where moved.id = ${g.p3} and p.id = ${g.p1}`),
              commit,
            )
            return { ...race, after: yield* counts(f) }
          }),
        ),
      )
      expect(found.queued).toBe(true)
      // the same answer the first reading would have given, and no more
      expect(
        errorOf<{ issues: { reason: string }[] }>(found.outcome)?.issues.map((one) => one.reason),
      ).toEqual(['participant-not-found'])
      expect(found.after).toEqual({ imports: 0, entries: 0 })
    })

    // A narrowing of the material window is refused while a live fact falls
    // outside the new one, and the check sees only facts already written.
    // A file judged against the old window has to be judged again against
    // the window the narrowing left, or it writes exactly what that check
    // exists to keep out.
    it('refuses a day the round no longer covers', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, commit } = yield* prepared(
              'ai-race-window',
              { formConfig: { dated: true, withinRound: true } },
              ['2023001', 'Zhang San', '甲', '', '2026-07-15'],
            )
            const race = yield* raced(
              g.batch.id,
              runSql(sql`
                update assessment_batches
                   set material_range = daterange('2026-03-01', '2026-07-01')
                 where id = ${g.batch.id}`),
              commit,
            )
            return { ...race, after: yield* counts(f) }
          }),
        ),
      )
      expect(found.queued).toBe(true)
      expect(
        errorOf<{ issues: { field: string; reason: string }[] }>(found.outcome)?.issues.map(
          (one) => [one.field, one.reason],
        ),
      ).toEqual([['evidence.claimed-when-slot', 'out-of-range']])
      expect(found.after).toEqual({ imports: 0, entries: 0 })
    })

    it('refuses when the question moved on', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, revision, commit } = yield* prepared('ai-race-revision')
            const race = yield* raced(
              g.batch.id,
              runSql(sql`
                with moved as (
                  insert into assessment_item_revisions
                    (tenant_id, item_id, revision_no, entry_channels, form_config, scoring_config,
                     scoring_plan, review_policy, display_config, created_by, reason)
                  select tenant_id, item_id, revision_no + 1, entry_channels, form_config,
                         scoring_config, scoring_plan, review_policy, display_config, created_by,
                         'edited while a file was open'
                    from assessment_item_revisions where id = ${revision}
                  returning id, item_id
                )
                update assessment_items i set current_revision_id = moved.id
                  from moved where i.id = moved.item_id`),
              commit,
            )
            return { ...race, after: yield* counts(f) }
          }),
        ),
      )
      expect(found.queued).toBe(true)
      expect(errorOf<{ _tag: string }>(found.outcome)?._tag).toBe(
        'ASSESSMENT_ITEM_REVISION_CONFLICT',
      )
      expect(found.after).toEqual({ imports: 0, entries: 0 })
    })
  })

  it('lists every import of the round to whoever may record in it, newest first', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-history')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const reader = f.principal(f.recorder)
          const commit = (rows: readonly (readonly string[])[]) =>
            Effect.gen(function* () {
              const attachmentId = yield* workbook(f, item.id, f.recorder, rows)
              return yield* assessment.commitAdministrativeImport(
                f.t,
                g.batch.id,
                {
                  attachmentId,
                  itemId: item.id,
                  expectedItemRevisionId: revision,
                  confirmWarnings: true,
                },
                reader,
              )
            })
          const both = yield* commit([
            ['2023001', 'Zhang San', '甲'],
            ['2023002', 'Li Si', '乙'],
          ])
          const liSiOnly = yield* commit([['2023002', 'Li Si', '丙']])
          // somebody else's import in the same round, with the file it names:
          // the round's history too, not only what this reader made
          const theirFile = one<{ id: string }>(
            yield* runSql(sql`
              insert into storage_attachments
                (id, tenant_id, owner_user_id, backend, filename, declared_mime, size,
                 integrity_algorithm, integrity_value, storage_key, status)
              values (uuidv7(), ${f.t}, ${f.admin}, 'local', 'theirs.xlsx', 'application/octet-stream', 1,
                      'sha256', 'abc', ${`attachments/${f.t}/theirs`}, 'staged')
              returning id`),
          ).id
          const theirs = one<{ id: string }>(
            yield* runSql(sql`
              insert into administrative_entry_imports
                (tenant_id, batch_id, item_id, item_revision_id, source_attachment_id,
                 filename_snapshot, size_bytes, actor_id, imported_count)
              values (${f.t}, ${g.batch.id}, ${item.id}, ${revision}, ${theirFile},
                      'theirs.xlsx', 1, ${f.admin}, 0)
              returning id`),
          ).id
          // one of the first import's facts withdrawn on its own
          const zhangSan = one<{ id: string }>(
            yield* runSql(sql`
              select r.entry_id as id from administrative_entry_import_rows r
               where r.import_id = ${both.importId} and r.participant_id = ${g.p1}`),
          ).id
          yield* assessment.interveneOnEntry(
            f.t,
            zhangSan,
            { kind: 'void', reason: '录入有误' },
            reader,
          )

          const all = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 10 },
            reader,
          )
          const first = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 1 },
            reader,
          )
          const second = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 10, after: first[0]!.cursor },
            reader,
          )
          const student = yield* Effect.exit(
            assessment.listAdministrativeImports(f.t, g.batch.id, { limit: 10 }, f.principal(f.s1)),
          )

          // Zhang San's frozen position moves to college B: the recorder no
          // longer reaches one person in the first import
          yield* runSql(sql`
            update batch_participants p
               set assessment_anchor_node_id = moved.assessment_anchor_node_id,
                   anchor_path = moved.anchor_path
              from batch_participants moved
             where moved.id = ${g.p3} and p.id = ${g.p1}`)
          const afterMove = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 10 },
            reader,
          )
          return { both, liSiOnly, theirs, all, first, second, student, afterMove }
        }),
      ),
    )

    // newest first, and the administrator's as well as the recorder's own
    expect(found.all.map((row) => row.id)).toEqual([
      found.theirs,
      found.liSiOnly.importId,
      found.both.importId,
    ])
    expect(found.all[0]!.actor?.name).toBe('Admin')
    const first = found.all[2]!
    expect(first.importedCount).toBe(2)
    // what it comes to now, counted from its entries: one withdrawn since
    expect(first.standing).toEqual({ approved: 1, inReview: 0, rejected: 0, voided: 1, other: 0 })
    expect(first.actor?.name).toBe('Recorder')
    expect(first.item.title).toBe('违纪扣分')
    // the original file's identity is part of the list of names: this reader
    // reaches everyone in the import, so it is theirs to see
    expect(first.source).toMatchObject({ available: true, filename: 'import.xlsx' })
    // the cursor the first page hands out resumes exactly after it
    expect([...found.first, ...found.second].map((row) => row.id)).toEqual(
      found.all.map((row) => row.id),
    )
    // not a recorder here at all: refused, rather than an empty history
    expect(errorOf<{ _tag: string }>(found.student)?._tag).toBe('ACCESS_DENIED')
    // an import with one person now out of reach is still the round's
    // history: it stays listed; only its names are withheld (see the history
    // suite)
    expect(found.afterMove.map((row) => row.id)).toEqual(found.all.map((row) => row.id))
  })

  it('will not import a file whose warnings nobody confirmed', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-warnings')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            // a name that does not match: a warning, not an error
            ['2023001', 'Zhang Shan', '甲'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const input = { attachmentId, itemId: item.id, expectedItemRevisionId: revision }
          const unconfirmed = yield* Effect.exit(
            assessment.commitAdministrativeImport(f.t, g.batch.id, input, f.principal(f.recorder)),
          )
          const before = yield* counts(f)
          const confirmed = yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { ...input, confirmWarnings: true },
            f.principal(f.recorder),
          )
          return { unconfirmed, before, confirmed }
        }),
      ),
    )
    // what the server read still has a warning, and nobody said they saw it
    expect(
      errorOf<{ issues: { severity: string }[] }>(found.unconfirmed)?.issues[0]?.severity,
    ).toBe('warning')
    expect(found.before).toEqual({ imports: 0, entries: 0 })
    // confirmed, it goes in
    expect(found.confirmed.importedCount).toBe(1)
  })
  // The quota a question keeps counts the facts the first press wrote, so
  // judging the file again on a second press refused every row of the very
  // import it was asking about - and a reader told "all at the limit" goes
  // and uploads the file again.
  it('answers a second press with the import, on a question that allows one fact each', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-once-quota')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id, { maxEntries: 1 })
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '校发〔2026〕12 号'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const commit = () =>
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            )
          const first = yield* commit()
          const retried = yield* commit()
          return { first, retried, after: yield* counts(f) }
        }),
      ),
    )
    expect(found.retried).toEqual(found.first)
    expect(found.after).toEqual({ imports: 1, entries: 1 })
  })

  // Deletion frees a number for somebody new, and the roster keeps the
  // deleted person until an administrator takes them off it. A number is
  // answered by the living person who holds it, or by nobody.
  it('never finds a deleted person by the number they used to hold', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-deleted')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const preview = (attachmentId: string) =>
            assessment.previewAdministrativeImport(
              f.t,
              g.batch.id,
              { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
              f.principal(f.recorder),
            )
          yield* runSql(
            sql`update users set deleted_at = now(), enabled = false where id = ${f.s1}`,
          )
          const gone = yield* preview(
            yield* workbook(f, item.id, f.recorder, [['2023001', 'Zhang San', '甲']]),
          )
          // the number given to somebody new, who joins the same roster
          // where the deleted person still stands
          const successor = one<{ id: string }>(
            yield* runSql(sql`
              insert into users
                (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
              select tenant_id, display_name, user_type_id, primary_org_node_id, business_no
                from users where id = ${f.s1}
              returning id`),
          ).id
          const joined = one<{ id: string }>(
            yield* runSql(sql`
              insert into batch_participants
                (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path,
                 anchor_lineage, user_type_id)
              select tenant_id, batch_id, ${successor}, assessment_anchor_node_id, anchor_path,
                     anchor_lineage, user_type_id
                from batch_participants where id = ${g.p1}
              returning id`),
          ).id
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '甲'],
          ])
          const matched = yield* preview(attachmentId)
          yield* assessment.commitAdministrativeImport(
            f.t,
            g.batch.id,
            { attachmentId, itemId: item.id, expectedItemRevisionId: revision },
            f.principal(f.recorder),
          )
          const written = (yield* runSql(sql`
            select participant_id from entries
             where tenant_id = ${f.t} and item_id = ${item.id}`)) as unknown as {
            rows: { participant_id: string }[]
          }
          return { gone, matched, joined, written: written.rows }
        }),
      ),
    )
    expect(found.gone.rows[0]!.issues.map((one) => one.reason)).toEqual(['participant-not-found'])
    expect(found.matched.rows[0]!.matchedParticipant?.id).toBe(found.joined)
    expect(found.written).toEqual([{ participant_id: found.joined }])
  })

  it('makes one import of one upload, however many times it is committed', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ai-once')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const attachmentId = yield* workbook(f, item.id, f.recorder, [
            ['2023001', 'Zhang San', '校发〔2026〕12 号'],
            ['2023002', 'Li Si', '校发〔2026〕12 号'],
          ])
          const revision = one<{ id: string }>(
            yield* runSql(
              sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
            ),
          ).id
          const commit = () =>
            assessment.commitAdministrativeImport(
              f.t,
              g.batch.id,
              {
                attachmentId,
                itemId: item.id,
                expectedItemRevisionId: revision,
                defaultBasis: '学院统一依据',
              },
              f.principal(f.recorder),
            )
          // the ordinary shape of it: the response was lost and the person
          // pressed the button again
          const first = yield* commit()
          const retried = yield* commit()
          // and the shape a double click makes, which the batch lock has to
          // serialize rather than interleave
          const [a, b] = yield* Effect.all([commit(), commit()], { concurrency: 2 })
          // taking the whole import back does not make the file importable
          // again: the facts it wrote are withdrawn, the upload is spent
          yield* assessment.reverseAdministrativeImport(
            f.t,
            first.importId,
            { reason: '名单有误' },
            f.principal(f.recorder),
          )
          const afterReversal = yield* commit()
          const imports = (yield* runSql(sql`
            select id from administrative_entry_imports
             where tenant_id = ${f.t} and source_attachment_id = ${attachmentId}`)) as unknown as {
            rows: { id: string }[]
          }
          const entries = (yield* runSql(sql`
            select count(*)::int as n from entries
             where tenant_id = ${f.t} and item_id = ${item.id}`)) as unknown as {
            rows: { n: number }[]
          }
          return { first, retried, a, b, afterReversal, imports, entries }
        }),
      ),
    )
    // every answer is the same import, and it is the one the first call made
    const ids = [
      found.retried.importId,
      found.a.importId,
      found.b.importId,
      found.afterReversal.importId,
    ]
    expect(ids).toEqual(Array.from({ length: 4 }, () => found.first.importId))
    expect(found.retried.importedCount).toBe(found.first.importedCount)
    // one import row, and one set of facts - not five
    expect(found.imports.rows.map((one) => one.id)).toEqual([found.first.importId])
    expect(found.entries.rows[0]!.n).toBe(2)
  })
})
