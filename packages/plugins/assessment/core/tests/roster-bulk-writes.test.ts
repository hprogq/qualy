import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ok, one, run, seed } from './support/round.ts'

// What an intake costs the rest of the batch.
//
// Admitting people takes the batch row lock, and the lock is the front door
// for filing a claim and for recording a decision, so the number of
// statements an import spends inside it is not an implementation detail: it
// is how long the batch stops. The roster itself has always been one
// statement; its membership events were one per person.
//
// Counted at the database rather than in process: a statement-level trigger
// fires once per statement whatever the ORM does above it, which is the fact
// under test.

const countStatements = (label: string) =>
  Effect.gen(function* () {
    yield* runSql(sql`create table if not exists ${sql.raw(label)} (n int not null)`)
    yield* runSql(sql`delete from ${sql.raw(label)}`)
    yield* runSql(sql`insert into ${sql.raw(label)} (n) values (0)`)
    yield* runSql(sql`
      create or replace function ${sql.raw(`${label}_bump`)}() returns trigger
      language plpgsql as $$
      begin update ${sql.raw(label)} set n = n + 1; return null; end $$`)
    yield* runSql(sql`
      create or replace trigger ${sql.raw(`${label}_trigger`)}
      after insert on batch_participant_events
      for each statement execute function ${sql.raw(`${label}_bump`)}()`)
  })

const statementsSeen = (label: string) =>
  Effect.map(runSql(sql`select n from ${sql.raw(label)}`), (result) => one<{ n: number }>(result).n)

describe.runIf(postgresAvailable)('the cost of an intake', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-roster-bulk')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('writes a whole intake of admission events in one statement', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('bulk-intake')
          const assessment = yield* Assessment
          const batch = yield* assessment.createBatch(
            f.t,
            {
              name: 'Round',
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              import: { orgNodeIds: [f.classA], userTypeIds: [f.studentType] },
            },
            f.principal(f.admin),
          )
          // three more people turn up in the same class after the first draw
          for (const name of ['Late One', 'Late Two', 'Late Three']) {
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, ${name}, ${f.studentType}, ${f.classA})`)
          }
          yield* countStatements('intake_statements')
          const imported = yield* assessment.importParticipants(
            f.t,
            batch.id,
            { orgNodeIds: [f.classA], userTypeIds: [f.studentType] },
            f.principal(f.admin),
          )
          const statements = yield* statementsSeen('intake_statements')
          const events = one<{ n: string }>(
            yield* runSql(sql`
              select count(*) as n from batch_participant_events
              where batch_id = ${batch.id} and kind = 'included'`),
          )
          const admitted = one<{ n: string }>(
            yield* runSql(sql`
              select count(*) as n from batch_participants
              where batch_id = ${batch.id} and status = 'active'`),
          )
          return {
            added: imported.added,
            statements,
            events: Number(events.n),
            admitted: Number(admitted.n),
          }
        }),
      ),
    )

    // everybody who turned up is in, and each of them has their line of history
    expect(result.added).toBe(3)
    expect(result.admitted).toBe(6)
    expect(result.events).toBe(6)
    // and the three of them cost the lock one statement, not three
    expect(result.statements).toBe(1)
  })
})
