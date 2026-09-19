import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { recordItem } from './support/administrative.ts'
import { probeScoring } from './support/catalogs.ts'
import { errorOf, ok, one, run, runningBatch, seed, staged } from './support/round.ts'

// One administrative finding, settled on several people at once.
//
// The whole of this is "all or nothing, on a set somebody actually looked
// at". Two different things have to hold for that, and they fail in
// different ways: the set has to still BE the set that was confirmed, which
// a count cannot tell you, and every person in it has to still be writable,
// which the set being unchanged does not tell you either.
//
// So the tests below are mostly about what does NOT get written.

describe.runIf(postgresAvailable).concurrent('recording one finding on a group', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-administrative-record-batch')
  }, 120_000)
  afterAll(async () => {
    await db?.dispose()
  })

  /** the round, a question the office settles, and who is in reach */
  const ready = (
    slug: string,
    over?: {
      maxEntries?: number | null
      formConfig?: Record<string, unknown>
      scoringConfig?: Record<string, unknown>
    },
  ) =>
    Effect.gen(function* () {
      const f = yield* seed(slug)
      const g = yield* runningBatch(f)
      const item = yield* recordItem(f, g.batch.id, over)
      const revision = one<{ id: string }>(
        yield* runSql(
          sql`select current_revision_id as id from assessment_items where id = ${item.id}`,
        ),
      ).id
      return { f, g, item, revision }
    })

  const participantsOf = (tenantId: string, batchId: string) =>
    Effect.map(
      runSql(sql`select id, user_id from batch_participants
                  where tenant_id = ${tenantId} and batch_id = ${batchId}`),
      (result) => (result as unknown as { rows: { id: string; user_id: string }[] }).rows,
    )

  it('binds the document it cites, so the staged sweep cannot take it away', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-binds', {
            formConfig: { files: {} },
          })
          const assessment = yield* Assessment
          const file = yield* staged(f.t, f.recorder)
          // one person: an act carrying a file is refused above one, because
          // one file belongs to one entry
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: { files: [file] },
            basis: '校发〔2026〕9 号',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const done = yield* assessment.recordAdministrativeBatch(
            f.t,
            g.batch.id,
            {
              ...input,
              excludedParticipantIds: [],
              expectedTargetFingerprint: seen.targetFingerprint,
            },
            f.principal(f.recorder),
          )
          const status = one<{ status: string }>(
            yield* runSql(sql`select status from storage_attachments where id = ${file}`),
          ).status
          const cited = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from entry_revision_attachments
                               where attachment_id = ${file}`),
          ).n
          return { status, cited, recorded: done.recordedCount }
        }),
      ),
    )
    // a revision cites it, so storage must already know it is spoken for. A
    // citation left pointing at a staged file is one whose bytes the sweep
    // deletes, before wedging on the row it then cannot delete.
    expect(found.recorded).toBe(1)
    expect(found.cited).toBe(1)
    expect(found.status).toBe('bound')
  })

  it('names in the act detail only the people the reader can reach', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-detail-reach')
          const assessment = yield* Assessment
          // the recorder's authority is widened to the whole tree, so one act
          // can settle on both colleges at once
          yield* runSql(sql`
            update role_grants set org_node_id = ${f.root}
             where tenant_id = ${f.t} and id = ${f.recordGrant}`)
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'organization' as const, orgNodeIds: [f.root], userTypeIds: [] },
            payload: {},
            basis: '校发〔2026〕8 号',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const done = yield* assessment.recordAdministrativeBatch(
            f.t,
            g.batch.id,
            {
              ...input,
              excludedParticipantIds: seen.blocked.map((one) => one.participantId),
              expectedTargetFingerprint: seen.targetFingerprint,
            },
            f.principal(f.recorder),
          )
          // and then narrowed back to one class, which is where most
          // recorders sit
          yield* runSql(sql`
            update role_grants set org_node_id = ${f.classA}
             where tenant_id = ${f.t} and id = ${f.recordGrant}`)
          const read = yield* assessment.getAdministrativeRecord(
            f.t,
            done.operationId,
            f.principal(f.recorder),
          )
          return {
            recorded: done.recordedCount,
            listed: read.rows.map((row) => row.participantId),
            inReach: g.p1,
            outOfReach: g.p3,
          }
        }),
      ),
    )
    // the act really did reach everyone, and the detail says so
    expect(found.recorded).toBeGreaterThan(found.listed.length)
    // but the rows carry names and student numbers, so they stop where the
    // reader's own standing stops - the same question its sibling asks
    // before offering a row for undoing
    expect(found.listed).toContain(found.inReach)
    expect(found.listed).not.toContain(found.outOfReach)
  })

  it('pages its acts on a cursor postgres can read back', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-paging')
          const assessment = yield* Assessment
          const settle = (participantId: string, basis: string) =>
            Effect.gen(function* () {
              const input = {
                itemId: item.id,
                expectedItemRevisionId: revision,
                target: { kind: 'people' as const, participantIds: [participantId] },
                payload: {},
                basis,
              }
              const seen = yield* assessment.previewAdministrativeRecord(
                f.t,
                g.batch.id,
                input,
                f.principal(f.recorder),
              )
              return yield* assessment.recordAdministrativeBatch(
                f.t,
                g.batch.id,
                {
                  ...input,
                  excludedParticipantIds: [],
                  expectedTargetFingerprint: seen.targetFingerprint,
                },
                f.principal(f.recorder),
              )
            })
          yield* settle(g.p1, '校发〔2026〕1 号')
          yield* settle(g.p2, '校发〔2026〕2 号')

          const first = yield* assessment.listAdministrativeRecords(
            f.t,
            g.batch.id,
            { limit: 1 },
            f.principal(f.recorder),
          )
          // the cursor is made of what the page handed back, so whatever
          // shape that is has to survive the trip to postgres and back
          const boundary = first[0]!
          const second = yield* assessment.listAdministrativeRecords(
            f.t,
            g.batch.id,
            { after: [boundary.createdAt, boundary.id] as const, limit: 10 },
            f.principal(f.recorder),
          )
          return { first: first.map((row) => row.id), second: second.map((row) => row.id) }
        }),
      ),
    )
    expect(found.first).toHaveLength(1)
    // the second act, and never the one the cursor was taken from
    expect(found.second).toHaveLength(1)
    expect(found.second[0]).not.toBe(found.first[0])
  })

  it('refuses an act that cites no document', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-basis')
          const assessment = yield* Assessment
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: {},
            basis: '   ',
          }
          const previewed = yield* Effect.exit(
            assessment.previewAdministrativeRecord(f.t, g.batch.id, input, f.principal(f.recorder)),
          )
          const written = yield* Effect.exit(
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              { ...input, excludedParticipantIds: [], expectedTargetFingerprint: 'whatever' },
              f.principal(f.recorder),
            ),
          )
          const entries = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from entries
                               where tenant_id = ${f.t} and item_id = ${item.id}`),
          ).n
          return { previewed: errorOf<{ _tag: string }>(previewed)?._tag, written: errorOf<{ _tag: string }>(written)?._tag, entries }
        }),
      ),
    )
    // the basis is the record: a finding whose document nobody can look up
    // is an assertion, and the single-entry door has refused one all along
    expect(found.previewed).toBe('ASSESSMENT_ENTRY_PAYLOAD_INVALID')
    expect(found.written).toBe('ASSESSMENT_ENTRY_PAYLOAD_INVALID')
    expect(found.entries).toBe(0)
  })

  it('judges the determination it is handed instead of proving whatever arrives', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-judged', {
            scoringConfig: probeScoring(),
          })
          const assessment = yield* Assessment
          const act = (values: Record<string, unknown>) => ({
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1] },
            payload: {},
            recognition: { values },
            basis: '校发〔2026〕6 号',
          })
          // a determination the plan cannot read: the level is not one of
          // the values its schema admits
          const nonsense = yield* Effect.exit(
            assessment.previewAdministrativeRecord(
              f.t,
              g.batch.id,
              act({ 'rec-level': 'not-a-level', 'rec-ordinal': 1 }),
              f.principal(f.recorder),
            ),
          )
          // and one carrying a key the plan never named
          const extra = yield* Effect.exit(
            assessment.previewAdministrativeRecord(
              f.t,
              g.batch.id,
              act({ 'rec-level': 'national', 'rec-ordinal': 1, 'rec-invented': 'x' }),
              f.principal(f.recorder),
            ),
          )
          return {
            nonsense: errorOf<{ _tag: string }>(nonsense)?._tag,
            extra: errorOf<{ _tag: string }>(extra)?._tag,
          }
        }),
      ),
    )
    // The other two doors that write determinations judge first. Without it
    // an unreadable one reached the scorer and died there as a defect - a
    // 500 for a bad request - and an invented key was stored verbatim in an
    // append-only table.
    expect(found.nonsense).toBe('ASSESSMENT_ENTRY_PAYLOAD_INVALID')
    expect(found.extra).toBe('ASSESSMENT_ENTRY_PAYLOAD_INVALID')
  })

  it('answers a repeated press with the act it already became', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-press')
          const assessment = yield* Assessment
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'people' as const, participantIds: [g.p1, g.p2] },
            payload: {},
            basis: '校发〔2026〕5 号',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const press = '01a0b900-0000-7000-8000-000000000001'
          const commit = () =>
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              {
                ...input,
                excludedParticipantIds: [],
                expectedTargetFingerprint: seen.targetFingerprint,
                idempotencyKey: press,
              },
              f.principal(f.recorder),
            )
          const first = yield* commit()
          // the answer went missing and the reader pressed again
          const again = yield* commit()
          const entries = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from entries
                               where tenant_id = ${f.t} and item_id = ${item.id}`),
          ).n
          const acts = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from administrative_record_operations
                               where tenant_id = ${f.t} and batch_id = ${g.batch.id}`),
          ).n
          return { first, again, entries, acts }
        }),
      ),
    )
    // Nothing else could notice the repeat: the fingerprint is unchanged by
    // the first press succeeding, and a question with no per-person ceiling
    // takes a second finding on everybody quite happily.
    expect(found.again.operationId).toBe(found.first.operationId)
    expect(found.again.recordedCount).toBe(found.first.recordedCount)
    expect(found.acts).toBe(1)
    expect(found.entries).toBe(found.first.recordedCount)
  })

  it('writes one fact per person, as ordinary records, under one act', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-ok')
          const assessment = yield* Assessment
          const target = {
            kind: 'organization' as const,
            orgNodeIds: [f.classA],
            userTypeIds: [],
          }
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target,
            payload: {},
            basis: '校发〔2026〕7 号',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const done = yield* assessment.recordAdministrativeBatch(
            f.t,
            g.batch.id,
            {
              ...input,
              excludedParticipantIds: seen.blocked.map((one) => one.participantId),
              expectedTargetFingerprint: seen.targetFingerprint,
            },
            f.principal(f.recorder),
          )
          // read from the tables, not from any view
          const written = (yield* runSql(sql`
            select e.source, e.status, v.note
              from entries e
              join entry_revisions v on v.tenant_id = e.tenant_id and v.id = e.current_revision_id
             where e.tenant_id = ${f.t} and e.item_id = ${item.id}`)) as unknown as {
            rows: { source: string; status: string; note: string }[]
          }
          const act = one<{ kind: string; count: number; spec: unknown }>(
            yield* runSql(sql`
              select target_kind as kind, recorded_count as count, target_spec as spec
                from administrative_record_operations
               where tenant_id = ${f.t} and id = ${done.operationId}`),
          )
          const rows = (yield* runSql(sql`
            select participant_id from administrative_record_operation_rows
             where tenant_id = ${f.t} and operation_id = ${done.operationId}`)) as unknown as {
            rows: { participant_id: string }[]
          }
          return { seen, done, written: written.rows, act, rows: rows.rows }
        }),
      ),
    )

    expect(found.seen.eligibleCount).toBeGreaterThan(1)
    expect(found.done.recordedCount).toBe(found.seen.eligibleCount)
    // a finding settled in the product is `record` however many people it
    // reached: the number of targets is not what tells record from import
    expect(found.written.every((row) => row.source === 'record')).toBe(true)
    expect(found.written.every((row) => row.status === 'approved')).toBe(true)
    expect(found.written.every((row) => row.note === '校发〔2026〕7 号')).toBe(true)
    expect(found.written).toHaveLength(found.done.recordedCount)
    // the act remembers how the people were found, and separately who it
    // actually reached
    expect(found.act.kind).toBe('organization')
    expect(found.act.count).toBe(found.done.recordedCount)
    expect(found.rows).toHaveLength(found.done.recordedCount)
  })

  it('refuses the recorder themselves, and says so before anything is written', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-self')
          const assessment = yield* Assessment
          const people = yield* participantsOf(f.t, g.batch.id)
          const mine = people.find((row) => row.user_id === f.recorder)
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            {
              itemId: item.id,
              expectedItemRevisionId: revision,
              // by name, and naming themselves among them
              target: {
                kind: 'people' as const,
                participantIds: people
                  .filter((row) => row.user_id === f.s1 || row.user_id === f.recorder)
                  .map((row) => row.id),
              },
              payload: {},
              basis: 'b',
            },
            f.principal(f.recorder),
          )
          return { seen, mine }
        }),
      ),
    )
    // a registrar who is also on the roster cannot hand themselves a finding
    // nobody reviewed - the same rule recording one at a time has
    expect(found.seen.blocked.map((one) => one.reason)).toEqual(['self-record-refused'])
    expect(found.seen.blocked[0]?.participantId).toBe(found.mine?.id)
    expect(found.seen.requestedCount).toBe(2)
    expect(found.seen.eligibleCount).toBe(1)
  })

  it('never reaches somebody the recorder has no authority over', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-reach')
          const assessment = yield* Assessment
          // s3 is in the other college; the recorder's authority stops at A
          const people = yield* participantsOf(f.t, g.batch.id)
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            {
              itemId: item.id,
              expectedItemRevisionId: revision,
              target: {
                kind: 'people' as const,
                participantIds: people
                  .filter((row) => row.user_id === f.s1 || row.user_id === f.s3)
                  .map((row) => row.id),
              },
              payload: {},
              basis: 'b',
            },
            f.principal(f.recorder),
          )
          return seen
        }),
      ),
    )
    // out of reach is not "blocked" - it never appears at all, because the
    // resolve is narrowed in sql rather than filtered afterwards
    expect(found.requestedCount).toBe(1)
    expect(found.blocked).toEqual([])
    expect(found.eligibleCount).toBe(1)
  })

  it('writes nothing when the people confirmed are no longer the people found', async () => {
    const outcome = await run(
      db.url,
      Effect.gen(function* () {
        const { f, g, item, revision } = yield* ready('ar-moved')
        const assessment = yield* Assessment
        const input = {
          itemId: item.id,
          expectedItemRevisionId: revision,
          target: { kind: 'organization' as const, orgNodeIds: [f.classA], userTypeIds: [] },
          payload: {},
          basis: 'b',
        }
        const seen = yield* assessment.previewAdministrativeRecord(
          f.t,
          g.batch.id,
          input,
          f.principal(f.recorder),
        )
        // between looking and pressing, somebody leaves the round
        const people = yield* participantsOf(f.t, g.batch.id)
        const leaving = people.find((row) => row.user_id === f.s1)!
        yield* runSql(
          sql`update batch_participants set status = 'excluded' where id = ${leaving.id}`,
        )
        return yield* assessment.recordAdministrativeBatch(
          f.t,
          g.batch.id,
          {
            ...input,
            excludedParticipantIds: seen.blocked.map((one) => one.participantId),
            expectedTargetFingerprint: seen.targetFingerprint,
          },
          f.principal(f.recorder),
        )
      }),
    )
    expect(errorOf<{ _tag?: string }>(outcome)?._tag).toBe(
      'ASSESSMENT_ADMINISTRATIVE_RECORD_TARGETS_CHANGED',
    )
  })

  it('writes nothing when one of the confirmed people has since filled their quota', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-quota', { maxEntries: 1 })
          const assessment = yield* Assessment
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'organization' as const, orgNodeIds: [f.classA], userTypeIds: [] },
            payload: {},
            basis: 'b',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          // the same people, but one of them is recorded on separately before
          // the act is pressed
          yield* assessment.createEntry(
            f.t,
            {
              itemId: item.id,
              participantId: (yield* participantsOf(f.t, g.batch.id)).find(
                (row) => row.user_id === f.s1,
              )!.id,
              payload: {},
              note: 'earlier',
              expectedItemRevisionId: revision,
            },
            f.principal(f.recorder),
          )
          const attempt = yield* Effect.exit(
            assessment.recordAdministrativeBatch(
              f.t,
              g.batch.id,
              {
                ...input,
                excludedParticipantIds: seen.blocked.map((one) => one.participantId),
                expectedTargetFingerprint: seen.targetFingerprint,
              },
              f.principal(f.recorder),
            ),
          )
          const acts = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from administrative_record_operations
                               where tenant_id = ${f.t}`),
          ).n
          // the one written above, and nothing the act added
          const facts = one<{ n: number }>(
            yield* runSql(sql`select count(*)::int as n from entries
                               where tenant_id = ${f.t} and item_id = ${item.id}`),
          ).n
          return { attempt, acts, facts, eligible: seen.eligibleCount }
        }),
      ),
    )

    // the set never moved, so the fingerprint is content; what changed is
    // whether one of them can still be written to, and that refuses it whole
    expect(errorOf<{ _tag?: string }>(found.attempt)?._tag).toBe(
      'ASSESSMENT_ADMINISTRATIVE_RECORD_REFUSED',
    )
    // nothing at all, not "everyone except the one that failed"
    expect(found.acts).toBe(0)
    expect(found.facts).toBe(1)
    expect(found.eligible).toBeGreaterThan(1)
  })

  it('withdraws what the act actually wrote, not what the selection would find today', async () => {
    const found = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const { f, g, item, revision } = yield* ready('ar-reverse')
          const assessment = yield* Assessment
          const input = {
            itemId: item.id,
            expectedItemRevisionId: revision,
            target: { kind: 'organization' as const, orgNodeIds: [f.classA], userTypeIds: [] },
            payload: {},
            basis: 'b',
          }
          const seen = yield* assessment.previewAdministrativeRecord(
            f.t,
            g.batch.id,
            input,
            f.principal(f.recorder),
          )
          const done = yield* assessment.recordAdministrativeBatch(
            f.t,
            g.batch.id,
            {
              ...input,
              excludedParticipantIds: seen.blocked.map((one) => one.participantId),
              expectedTargetFingerprint: seen.targetFingerprint,
            },
            f.principal(f.recorder),
          )

          // the world moves on: one of the people it reached is moved out of
          // class A - still within the recorder's authority, but no longer
          // anywhere the selection would find them - and somebody new
          // arrives in class A
          const college = one<{ id: string }>(
            yield* runSql(sql`select parent_id as id from org_nodes where id = ${f.classA}`),
          ).id
          const people = yield* participantsOf(f.t, g.batch.id)
          const moved = people.find((row) => row.user_id === f.s1)!
          yield* runSql(sql`
            update batch_participants
               set assessment_anchor_node_id = ${college},
                   anchor_path = (select path from org_nodes where id = ${college})
             where id = ${moved.id}`)
          const arrival = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Latecomer', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          yield* assessment.addParticipants(f.t, g.batch.id, [arrival], f.principal(f.admin))

          const undone = yield* assessment.reverseAdministrativeRecord(
            f.t,
            done.operationId,
            { reason: '认定有误' },
            f.principal(f.recorder),
          )
          const voided = one<{ n: number }>(
            yield* runSql(sql`
              select count(*)::int as n
                from administrative_record_operation_rows r
                join entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id
               where r.tenant_id = ${f.t} and r.operation_id = ${done.operationId}
                 and e.status = 'voided'`),
          ).n
          // the latecomer must not have been swept in by the unit's name
          const latecomer = one<{ n: number }>(
            yield* runSql(sql`
              select count(*)::int as n from entries e
                join batch_participants p
                  on p.tenant_id = e.tenant_id and p.id = e.participant_id
               where e.tenant_id = ${f.t} and p.user_id = ${arrival}`),
          ).n
          return { done, undone, voided, latecomer }
        }),
      ),
    )

    // everybody the act wrote is withdrawn, including the one who has since
    // moved out of the unit the selection named
    expect(found.undone.affectedCount).toBe(found.done.recordedCount)
    expect(found.voided).toBe(found.done.recordedCount)
    // and nobody who arrived afterwards was ever touched: withdrawal walks
    // the frozen rows, never the selection (§32.78)
    expect(found.latecomer).toBe(0)
  })
})
