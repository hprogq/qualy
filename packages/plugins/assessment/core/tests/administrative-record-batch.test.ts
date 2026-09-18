import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { recordItem } from './support/administrative.ts'
import { errorOf, ok, one, run, runningBatch, seed } from './support/round.ts'

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
  const ready = (slug: string, over?: { maxEntries?: number | null }) =>
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
