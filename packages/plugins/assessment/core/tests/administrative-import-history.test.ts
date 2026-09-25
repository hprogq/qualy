import { createHash } from 'node:crypto'
import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { imported, numbered, recordItem } from './support/administrative.ts'
import { GATED, errorOf, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// What an import is afterwards: something that happened, that a reader can
// look back on and take back what is left of - and never a second copy of
// the facts it created.
//
// The reversal is the part with teeth. It withdraws only what the import's
// own rows point at, each withdrawal exactly the single one, and when any of
// them would be refused none of them happen.

const APPEALABLE = [
  ...GATED,
  'assessment.review.process',
  'assessment.review.escalate',
  'assessment.entry.appeal',
]

/** the facts an import created, by the participant each is about */
const factsOf = (importId: string) =>
  Effect.map(
    runSql(sql`
      select r.participant_id as participant, r.entry_id as entry, e.status
        from administrative_entry_import_rows r
        join entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id
       where r.import_id = ${importId}
       order by r.source_row_no`),
    (result) =>
      (result as unknown as { rows: { participant: string; entry: string; status: string }[] })
        .rows,
  )

const eventsOf = (importId: string) =>
  Effect.map(
    runSql(sql`
      select kind, reason, affected_count as affected from administrative_entry_import_events
       where import_id = ${importId} order by created_at`),
    (result) =>
      (result as unknown as { rows: { kind: string; reason: string; affected: number }[] }).rows,
  )

/** a round with an administrative question, and Zhang San and Li Si imported into it */
const importedPair = (slug: string, over?: { profile?: readonly string[] }) =>
  Effect.gen(function* () {
    const f = yield* seed(slug)
    const g = yield* runningBatch(f, over?.profile ? { profile: over.profile } : undefined)
    yield* numbered(f)
    const item = yield* recordItem(f, g.batch.id)
    const done = yield* imported(
      f,
      g.batch.id,
      item.id,
      f.recorder,
      [
        ['2023001', 'Zhang San', '校发〔2026〕12 号'],
        ['2023002', 'Li Si', ''],
      ],
      { defaultBasis: '学院统一依据' },
    )
    return { f, g, item, done }
  })

const reverse = (f: Seeded, importId: string, reason: string, who?: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return yield* assessment.reverseAdministrativeImport(
      f.t,
      importId,
      { reason },
      f.principal(who ?? f.recorder),
    )
  })

describe.runIf(postgresAvailable)('an import, looked back on', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-administrative-import-history')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('shows anybody who may record in the round what it was, and nobody else anything', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, done, item } = yield* importedPair('aih-detail')
          const assessment = yield* Assessment
          const detail = yield* assessment.getAdministrativeImport(
            f.t,
            done.importId,
            f.principal(f.recorder),
          )
          const stored = one<{ algorithm: string; value: string }>(
            yield* runSql(sql`
              select integrity_algorithm as algorithm, integrity_value as value
                from storage_attachments where id = ${done.attachmentId}`),
          )
          // the round's administrator did not make this import and sees it
          // all the same: it is the round's record, not the recorder's
          const asAdmin = yield* assessment.getAdministrativeImport(
            f.t,
            done.importId,
            f.principal(f.admin),
          )
          const asStudent = yield* Effect.exit(
            assessment.getAdministrativeImport(f.t, done.importId, f.principal(f.s1)),
          )
          return { detail, stored, asAdmin, asStudent, item }
        }),
      ),
    )
    expect(found.detail.importedCount).toBe(2)
    expect(found.detail.item).toEqual({ id: found.item.id, title: '违纪扣分' })
    expect(found.detail.itemRevision.revisionNo).toBeGreaterThanOrEqual(1)
    expect(found.detail.defaultBasis).toBe('学院统一依据')
    expect(found.detail.actor?.name).toBe('Recorder')
    expect(found.detail.standing).toEqual({
      approved: 2,
      inReview: 0,
      rejected: 0,
      voided: 0,
      other: 0,
    })
    expect(found.detail.reversals).toEqual([])
    expect(found.detail.capabilities.reverse).toBe(true)
    // what the store verified the original to be, never a browser's word
    expect(found.detail.source.available && found.detail.source.integrity).toEqual(found.stored)
    // the same import, with the same provenance, for whoever holds the
    // recording authority now
    expect(found.asAdmin.actor?.name).toBe('Recorder')
    expect(found.asAdmin.importedCount).toBe(2)
    expect(found.asAdmin.capabilities.reverse).toBe(true)
    // a participant is nobody here, and is told it does not exist
    expect(errorOf<{ _tag: string }>(found.asStudent)?._tag).toBe(
      'ASSESSMENT_ADMINISTRATIVE_IMPORT_NOT_FOUND',
    )
  })

  it('holds the original file back from a reader who reaches only part of it', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('aih-partial')
          const g = yield* runningBatch(f)
          yield* numbered(f)
          const item = yield* recordItem(f, g.batch.id)
          const assessment = yield* Assessment
          // an import the ADMINISTRATOR makes, covering one person in the
          // recorder's college and one in the college their authority does
          // not reach - the shape of a registrar whose scope covers part of
          // a round
          const done = yield* imported(
            f,
            g.batch.id,
            item.id,
            f.admin,
            [
              ['2023001', 'Zhang San', '校发〔2026〕12 号'],
              ['2023003', 'Wang Wu', '校发〔2026〕12 号'],
            ],
            { defaultBasis: '学院统一依据' },
          )
          const recorder = f.principal(f.recorder)
          yield* reverse(f, done.importId, '王五申诉成功撤回', f.admin)
          const whole = yield* assessment.getAdministrativeImport(
            f.t,
            done.importId,
            f.principal(f.admin),
          )
          const partial = yield* assessment.getAdministrativeImport(f.t, done.importId, recorder)
          const listed = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 10 },
            recorder,
          )
          const rows = yield* Effect.exit(
            assessment.listAdministrativeImportRows(f.t, done.importId, { limit: 10 }, recorder),
          )
          const source = yield* Effect.exit(
            assessment.describeAdministrativeImportSource(f.t, done.importId, recorder),
          )
          return { whole, partial, listed, rows, source, item }
        }),
      ),
    )
    // reaching everyone: the file is theirs to see
    expect(found.whole.source).toMatchObject({ available: true, filename: 'import.xlsx' })
    expect(found.whole.defaultBasis).toBe('学院统一依据')
    expect(found.whole.reversals.map((one) => one.reason)).toEqual(['王五申诉成功撤回'])
    // reaching only part of it: the import is still the round's record, so
    // what it was and what it did stay readable
    expect(found.partial.item).toEqual({ id: found.item.id, title: '违纪扣分' })
    expect(found.partial.importedCount).toBe(2)
    expect(found.partial.actor?.name).toBe('Admin')
    // but the file's own name is a list of names, and waits with the rows,
    // as does the free text written about it
    expect(found.partial.source).toEqual({ available: false })
    expect(found.partial.defaultBasis).toBe(null)
    expect(found.partial.reversals.map((one) => [one.affectedCount, one.reason])).toEqual([
      [2, null],
    ])
    expect(found.listed.map((one) => one.source)).toEqual([{ available: false }])
    expect(errorOf<{ _tag: string }>(found.rows)?._tag).toBe('ACCESS_DENIED')
    expect(errorOf<{ _tag: string }>(found.source)?._tag).toBe('ACCESS_DENIED')
  })

  it('lists its rows in the order of the file, each with what it became', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, done } = yield* importedPair('aih-rows')
          const assessment = yield* Assessment
          const reader = f.principal(f.recorder)
          const first = yield* assessment.listAdministrativeImportRows(
            f.t,
            done.importId,
            { limit: 1 },
            reader,
          )
          const second = yield* assessment.listAdministrativeImportRows(
            f.t,
            done.importId,
            { afterRowNo: first[0]!.rowNo, limit: 1 },
            reader,
          )
          const past = yield* assessment.listAdministrativeImportRows(
            f.t,
            done.importId,
            { afterRowNo: second[0]!.rowNo, limit: 1 },
            reader,
          )
          return { first, second, past, g }
        }),
      ),
    )
    expect(found.first.map((row) => row.rowNo)).toEqual([2])
    expect(found.second.map((row) => row.rowNo)).toEqual([3])
    expect(found.past).toEqual([])
    const row = found.first[0]!
    expect(row.participant).toMatchObject({ id: found.g.p1, displayName: 'Zhang San' })
    expect(row.businessNoSnapshot).toBe('2023001')
    expect(row.displayNameSnapshot).toBe('Zhang San')
    expect(row.status).toBe('approved')
    // a question that determines nothing still carries its empty determination
    expect(row.recognition?.values).toEqual({})
  })

  it('hands back the original workbook byte for byte', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, done } = yield* importedPair('aih-source')
          const assessment = yield* Assessment
          const reader = f.principal(f.recorder)
          const described = yield* assessment.describeAdministrativeImportSource(
            f.t,
            done.importId,
            reader,
          )
          const opened = yield* assessment.openAdministrativeImportSource(
            f.t,
            done.importId,
            reader,
          )
          const chunks: Uint8Array[] = []
          if (opened.target.kind === 'stream') {
            const body = opened.target.body
            yield* Effect.promise(async () => {
              for await (const chunk of body) chunks.push(chunk)
            })
          }
          const detail = yield* assessment.getAdministrativeImport(f.t, done.importId, reader)
          // the administrator reaches everybody in the round, so the file is
          // theirs to read too; the door is reach, not having uploaded it
          const asAdmin = yield* assessment.describeAdministrativeImportSource(
            f.t,
            done.importId,
            f.principal(f.admin),
          )
          return {
            described,
            digest: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
            integrity: detail.source.available ? detail.source.integrity : null,
            asAdmin,
          }
        }),
      ),
    )
    expect(found.described.filename).toBe('import.xlsx')
    expect(found.described.delivery.kind).toBe('content')
    // the bytes that come back are the bytes the store verified at import
    expect(found.integrity?.algorithm).toBe('sha256')
    expect(found.digest).toBe(found.integrity?.value)
    expect(found.asAdmin.filename).toBe('import.xlsx')
  })

  // An import belongs to the round. The person who made it may lose their
  // post, their reach or their account, and a person in it may leave the
  // roster; none of that rewrites what happened, and none of it takes the
  // record away from whoever holds the recording authority now.
  it('belongs to the round, not to the person who made it', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, done } = yield* importedPair('aih-institutional')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // somebody else takes the whole import back, for the round
          const reversed = yield* reverse(f, done.importId, '名单有误,整批撤回', f.admin)
          // the uploader's account is disabled, and one of the people leaves the roster
          yield* runSql(sql`update users set enabled = false where id = ${f.recorder}`)
          yield* runSql(sql`update batch_participants set status = 'excluded' where id = ${g.p2}`)
          const listed = yield* assessment.listAdministrativeImports(
            f.t,
            g.batch.id,
            { limit: 10 },
            admin,
          )
          const detail = yield* assessment.getAdministrativeImport(f.t, done.importId, admin)
          const rows = yield* assessment.listAdministrativeImportRows(
            f.t,
            done.importId,
            { limit: 10 },
            admin,
          )
          const source = yield* assessment.describeAdministrativeImportSource(
            f.t,
            done.importId,
            admin,
          )
          return { reversed, listed, detail, rows, source, facts: yield* factsOf(done.importId) }
        }),
      ),
    )
    expect(found.reversed.affectedCount).toBe(2)
    expect(found.facts.map((one) => one.status)).toEqual(['voided', 'voided'])
    // the history is whole: who made it, who took it back, every row, the file
    expect(found.listed.map((one) => one.id)).toEqual([found.detail.id])
    expect(found.detail.actor?.name).toBe('Recorder')
    expect(found.detail.reversals.map((one) => [one.actor?.name, one.affectedCount])).toEqual([
      ['Admin', 2],
    ])
    expect(found.rows.map((one) => one.rowNo)).toEqual([2, 3])
    expect(found.source.filename).toBe('import.xlsx')
    // and nothing is left to take back
    expect(found.detail.capabilities.reverse).toBe(false)
  })

  describe('taken back', () => {
    it('withdraws everything still in effect, for one reason, and says it did', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, done } = yield* importedPair('aih-reverse')
            const assessment = yield* Assessment
            const reversed = yield* reverse(f, done.importId, '文件撤回')
            const withdrawn = (yield* runSql(sql`
              select ev.kind, ev.reason from entry_events ev
                join administrative_entry_import_rows r on r.entry_id = ev.entry_id
               where r.import_id = ${done.importId}
               order by ev.created_at`)) as unknown as { rows: { kind: string; reason: string }[] }
            const detail = yield* assessment.getAdministrativeImport(
              f.t,
              done.importId,
              f.principal(f.recorder),
            )
            return {
              reversed,
              facts: yield* factsOf(done.importId),
              events: yield* eventsOf(done.importId),
              withdrawn: withdrawn.rows,
              detail,
            }
          }),
        ),
      )
      expect(found.reversed.affectedCount).toBe(2)
      expect(found.facts.map((one) => one.status)).toEqual(['voided', 'voided'])
      // each fact's own history says it was withdrawn, and why
      expect(found.withdrawn).toEqual([
        { kind: 'voided-by-staff', reason: '文件撤回' },
        { kind: 'voided-by-staff', reason: '文件撤回' },
      ])
      // and the import's says these went together
      expect(found.events).toEqual([{ kind: 'reversed', reason: '文件撤回', affected: 2 }])
      // the import itself is still there, as history
      expect(found.detail.standing.voided).toBe(2)
      expect(found.detail.reversals).toHaveLength(1)
      expect(found.detail.capabilities.reverse).toBe(false)
    })

    it('counts only what was still in effect', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, done } = yield* importedPair('aih-partly')
            const assessment = yield* Assessment
            const before = yield* factsOf(done.importId)
            yield* assessment.interveneOnEntry(
              f.t,
              before[0]!.entry,
              { kind: 'void', reason: '单独撤销' },
              f.principal(f.recorder),
            )
            const reversed = yield* reverse(f, done.importId, '整批撤回')
            const reasons = (yield* runSql(sql`
              select reason from entry_events
               where entry_id = ${before[0]!.entry} and kind = 'voided-by-staff'`)) as unknown as {
              rows: { reason: string }[]
            }
            // pressing it again finds nothing left, and says nothing
            const again = yield* reverse(f, done.importId, '再点一次')
            return {
              reversed,
              again,
              events: yield* eventsOf(done.importId),
              reasons: reasons.rows.map((row) => row.reason),
            }
          }),
        ),
      )
      expect(found.reversed.affectedCount).toBe(1)
      expect(found.events).toEqual([{ kind: 'reversed', reason: '整批撤回', affected: 1 }])
      // the one withdrawn on its own keeps its own reason, and only that
      expect(found.reasons).toEqual(['单独撤销'])
      expect(found.again.affectedCount).toBe(0)
    })

    it('closes an appeal the fact was carrying', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, done } = yield* importedPair('aih-appeal', { profile: APPEALABLE })
            const assessment = yield* Assessment
            const facts = yield* factsOf(done.importId)
            const appealed = yield* assessment.appealEntry(
              f.t,
              facts[0]!.entry,
              { reason: '当天我在校外实习' },
              f.principal(f.s1),
            )
            const reversed = yield* reverse(f, done.importId, '文件撤回')
            const round = one<{ state: string; outcome: string | null }>(
              yield* runSql(
                sql`select state, outcome from review_instances where id = ${appealed.id}`,
              ),
            )
            const cancelled = yield* runSql(sql`
              select kind from review_events where review_instance_id = ${appealed.id}
               and kind = 'cancelled-by-staff'`)
            return {
              reversed,
              round,
              cancelled: cancelled.rows.length,
              facts: yield* factsOf(done.importId),
            }
          }),
        ),
      )
      expect(found.reversed.affectedCount).toBe(2)
      expect(found.round).toEqual({ state: 'completed', outcome: 'cancelled' })
      expect(found.cancelled).toBe(1)
      expect(found.facts.map((one) => one.status)).toEqual(['voided', 'voided'])
    })

    it('leaves alone a correction recorded by hand afterwards', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, item, done } = yield* importedPair('aih-replacement')
            const assessment = yield* Assessment
            const facts = yield* factsOf(done.importId)
            yield* assessment.interveneOnEntry(
              f.t,
              facts[0]!.entry,
              { kind: 'void', reason: '录错了' },
              f.principal(f.recorder),
            )
            // Zhang San's fact, recorded again by hand: the same person and
            // the same question, and not the import's
            const corrected = yield* assessment.createEntry(
              f.t,
              { itemId: item.id, participantId: g.p1, payload: {}, note: '更正后的依据' },
              f.principal(f.recorder),
            )
            const reversed = yield* reverse(f, done.importId, '文件撤回')
            const standing = one<{ status: string }>(
              yield* runSql(sql`select status from entries where id = ${corrected.id}`),
            ).status
            return { reversed, standing }
          }),
        ),
      )
      // Li Si's, and only Li Si's
      expect(found.reversed.affectedCount).toBe(1)
      expect(found.standing).toBe('approved')
    })

    it('withdraws nothing when one of them may not be withdrawn', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, done } = yield* importedPair('aih-one-refused')
            // a supplementary phase that admits Zhang San and nobody else:
            // the row that may not be withdrawn comes after one that may
            yield* runSql(sql`
              insert into phase_participant_scopes (tenant_id, phase_id, participant_id)
              select tenant_id, id, ${g.p1} from batch_phases where batch_id = ${g.batch.id}`)
            const refused = yield* Effect.exit(reverse(f, done.importId, '文件撤回'))
            return {
              refused,
              facts: yield* factsOf(done.importId),
              events: yield* eventsOf(done.importId),
            }
          }),
        ),
      )
      expect(
        errorOf<{ issues: { rowNo: number; reason: string }[] }>(found.refused)?.issues,
      ).toEqual([expect.objectContaining({ rowNo: 3, reason: 'participant-out-of-scope' })])
      // Zhang San's fact could have been withdrawn, and was not
      expect(found.facts.map((one) => one.status)).toEqual(['approved', 'approved'])
      expect(found.events).toEqual([])
    })

    it('refuses once the phase no longer admits recording', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, done } = yield* importedPair('aih-closed')
            const assessment = yield* Assessment
            yield* runSql(sql`
              update batch_phases
                 set permission_profile = permission_profile - 'assessment.entry.record'
               where batch_id = ${g.batch.id}`)
            const detail = yield* assessment.getAdministrativeImport(
              f.t,
              done.importId,
              f.principal(f.recorder),
            )
            const refused = yield* Effect.exit(reverse(f, done.importId, '文件撤回'))
            return { detail, refused, facts: yield* factsOf(done.importId) }
          }),
        ),
      )
      // not offered, and refused when pressed anyway
      expect(found.detail.capabilities.reverse).toBe(false)
      expect(
        errorOf<{ issues: { reason: string }[] }>(found.refused)?.issues.map((one) => one.reason),
      ).toEqual(['phase-closed', 'phase-closed'])
      expect(found.facts.map((one) => one.status)).toEqual(['approved', 'approved'])
    })

    it('refuses in an archived round', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, done } = yield* importedPair('aih-archived')
            yield* runSql(
              sql`update assessment_batches set status = 'archived' where id = ${g.batch.id}`,
            )
            const refused = yield* Effect.exit(reverse(f, done.importId, '文件撤回'))
            return { refused, facts: yield* factsOf(done.importId) }
          }),
        ),
      )
      expect(errorOf<{ _tag: string }>(found.refused)?._tag).toBe('ASSESSMENT_BATCH_READ_ONLY')
      expect(found.facts.map((one) => one.status)).toEqual(['approved', 'approved'])
    })

    it('keeps the record for a reader who no longer reaches everybody in it, and withholds the names', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, g, done } = yield* importedPair('aih-scope-lost')
            const assessment = yield* Assessment
            yield* runSql(sql`
              update batch_participants p
                 set assessment_anchor_node_id = moved.assessment_anchor_node_id,
                     anchor_path = moved.anchor_path
                from batch_participants moved
               where moved.id = ${g.p3} and p.id = ${g.p1}`)
            const refused = yield* Effect.exit(reverse(f, done.importId, '文件撤回'))
            // the import is still the round's history to them
            const detail = yield* assessment.getAdministrativeImport(
              f.t,
              done.importId,
              f.principal(f.recorder),
            )
            // the names in it are not: one of them is now somebody else's
            const rows = yield* Effect.exit(
              assessment.listAdministrativeImportRows(
                f.t,
                done.importId,
                { limit: 10 },
                f.principal(f.recorder),
              ),
            )
            const source = yield* Effect.exit(
              assessment.describeAdministrativeImportSource(
                f.t,
                done.importId,
                f.principal(f.recorder),
              ),
            )
            return { refused, detail, rows, source, facts: yield* factsOf(done.importId) }
          }),
        ),
      )
      expect(found.detail.importedCount).toBe(2)
      expect(found.detail.capabilities.reverse).toBe(false)
      for (const exit of [found.rows, found.source]) {
        expect(errorOf<{ _tag: string }>(exit)?._tag).toBe('ACCESS_DENIED')
      }
      // the reversal names the row it cannot touch, and touches none
      const refusal = errorOf<{ _tag: string; issues: { rowNo: number; reason: string }[] }>(
        found.refused,
      )
      expect(refusal?._tag).toBe('ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID')
      expect(refusal?.issues).toEqual([
        expect.objectContaining({ rowNo: 2, reason: 'participant-out-of-scope' }),
      ])
      expect(found.facts.map((one) => one.status)).toEqual(['approved', 'approved'])
    })

    it('wants a reason', async () => {
      const found = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const { f, done } = yield* importedPair('aih-reason')
            const refused = yield* Effect.exit(reverse(f, done.importId, '   '))
            return { refused, facts: yield* factsOf(done.importId) }
          }),
        ),
      )
      expect(Exit.isFailure(found.refused)).toBe(true)
      expect(errorOf<{ reason: string }>(found.refused)?.reason).toBe('reason-required')
      expect(found.facts.map((one) => one.status)).toEqual(['approved', 'approved'])
    })
  })
})
