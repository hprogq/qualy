import { defineEntity } from '@mikro-orm/core'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { Orm, entityManager, kyselyOf } from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// Does an entity tuple handed to this plugin come out the other end as a query
// that runs?
//
// The tuple is the whole mechanism. It travels from a plugin's own module,
// through a generated aggregate, into `MikroORM.init`, and out again as the
// phantom `'~entities'` the query builder reads its column types from. Every
// step of that is a place it can be widened to an array, and widening it fails
// nothing here: table names become `never`, queries stop compiling at their
// call sites, and the wiring looks fine.
//
// The entities are declared here rather than imported from a plugin because
// this asserts the plugin's wiring, not any plugin's schema. `tenants` is a
// table the committed lineage already has.

const p = defineEntity.properties

const Tenant = defineEntity({
  name: 'Tenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary(),
    slug: p.string().length(63),
    name: p.string().length(255),
    enabled: p.boolean(),
  },
})

const entities = [Tenant] as const

describe.runIf(postgresAvailable)('the orm this plugin builds', () => {
  it('answers a query written against the tuple it was given', async () => {
    const db = await createTestContext('orm-wiring')
    try {
      const slugs = await Effect.runPromise(
        Effect.gen(function* () {
          const em = yield* entityManager<typeof entities>()
          // entity names and property names, which is what the naming
          // strategy in kyselyOf asks for. A helper configured differently
          // would need `tenants` and `slug` here, and one configured without
          // convertValues would compare a uuid as text.
          return yield* Effect.promise(() =>
            kyselyOf(em).selectFrom('Tenant').select(['slug', 'enabled']).execute(),
          )
        }).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(slugs).toEqual([])

      await db.query(`insert into tenants (slug, name, enabled) values ('acme', 'Acme', true)`)
      const found = await Effect.runPromise(
        Effect.gen(function* () {
          const em = yield* entityManager<typeof entities>()
          return yield* Effect.promise(() =>
            kyselyOf(em).selectFrom('Tenant').select(['slug', 'enabled']).execute(),
          )
        }).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(found).toEqual([{ slug: 'acme', enabled: true }])
    } finally {
      await db.dispose()
    }
  })

  it('closes its connections when the scope that built it closes', async () => {
    // A pool left open outlives the test that opened it, and the way a suite
    // finds out is that dropping the database fails - somewhere else, later,
    // and reading as a teardown problem rather than as a missing finalizer.
    const db = await createTestContext('orm-close')
    try {
      const scope = await Effect.runPromise(Scope.make())
      const orm = await Effect.runPromise(
        Effect.gen(function* () {
          const built = yield* Layer.buildWithScope(databaseFor(db.url, { entities }), scope)
          const instance = Context.get(built, Orm)
          yield* Effect.promise(() => instance.em.fork().execute('select 1'))
          return instance
        }),
      )
      expect(await orm.isConnected()).toBe(true)

      await Effect.runPromise(Scope.close(scope, Exit.void))
      expect(await orm.isConnected()).toBe(false)
    } finally {
      await db.dispose()
    }
  })
})
