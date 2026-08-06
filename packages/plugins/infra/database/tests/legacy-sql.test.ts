import { defineEntity } from '@mikro-orm/core'
import { sql } from 'drizzle-orm'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { LegacySql, entityManager, kyselyOf, transaction } from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// The shim that lets drizzle-authored statements run on the orm's connection,
// which is what makes the three coupled plugins switchable one at a time.
//
// What has to hold is not that it runs sql - it is that a statement written
// the old way lands on the SAME connection as one written the new way. Nothing
// else about the migration is safe otherwise, and the failure is silent: a
// peer on its own connection answers about committed state and looks right.

const p = defineEntity.properties

const Tenant = defineEntity({
  name: 'Tenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    slug: p.string().length(63),
    name: p.string().length(255),
    enabled: p.boolean(),
  },
})

const entities = [Tenant] as const

const insertNewWay = (slug: string) =>
  Effect.gen(function* () {
    const em = yield* entityManager<typeof entities>()
    yield* Effect.promise(() =>
      kyselyOf(em).insertInto('Tenant').values({ slug, name: slug, enabled: true }).execute(),
    )
  })

class Refused extends Error {
  readonly _tag = 'Refused'
}

describe.runIf(postgresAvailable)('drizzle-authored sql on the orm connection', () => {
  it('keeps its parameters rather than inlining them', async () => {
    const db = await createTestContext('legacy-params')
    try {
      const rows = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* LegacySql
          yield* database.execute(
            sql`insert into tenants (slug, name, enabled) values ('acme', 'acme', true)`,
          )
          // a value that would change the statement's meaning if it were
          // pasted in as text rather than bound
          const result = yield* database.execute(
            sql`select slug from tenants where slug = ${"acme' or true --"}`,
          )
          return result.rows
        }).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(rows).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('reads what the new runtime wrote in the same open transaction', async () => {
    const db = await createTestContext('legacy-join')
    try {
      const rows = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* LegacySql
          return yield* transaction(
            Effect.gen(function* () {
              yield* insertNewWay('acme')
              const result = yield* database.execute(sql`select slug from tenants`)
              return result.rows
            }),
          )
        }).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(rows).toEqual([{ slug: 'acme' }])
    } finally {
      await db.dispose()
    }
  })

  it('opens a transaction the new runtime joins, and rolls both back together', async () => {
    const db = await createTestContext('legacy-rollback')
    try {
      const services = databaseFor(db.url, { entities })
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const database = yield* LegacySql
          return yield* database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.execute(
                sql`insert into tenants (slug, name, enabled) values ('old', 'old', true)`,
              )
              yield* insertNewWay('new')
              return yield* Effect.fail(new Refused())
            }),
          )
        }).pipe(Effect.provide(services)),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      // neither statement survives, which is only true if both were on the
      // one connection the transaction was opened on
      const left = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* LegacySql
          const result = yield* database.execute(sql`select slug from tenants`)
          return result.rows
        }).pipe(Effect.provide(services)),
      )
      expect(left).toEqual([])
    } finally {
      await db.dispose()
    }
  })
})
