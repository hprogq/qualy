import { defineEntity } from '@mikro-orm/core'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { entityManager, kyselyOf, query } from '../src/server/index.ts'
import { translateConstraints } from '../src/server/constraints.ts'
// the value, reached inside the plugin that owns it: `/server` exports only
// the type, so nothing outside can fork a manager off the pool
import { Orm } from '../src/server/orm.ts'
import { unwrapPgError } from '../src/pg-errors.ts'
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
    id: p.uuid().primary().defaultRaw('uuidv7()'),
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

  it('lets a constraint violation through with its sqlstate and name intact', async () => {
    // Drizzle wraps the driver's error and hangs the original on `cause`, so
    // the shared unwrapper looks there first. This stack does not wrap at all,
    // which the unwrapper already handles - but nothing said so, and the whole
    // translation of postgres errors into domain errors reads `code` and
    // `constraint` off whatever comes out. If a version starts wrapping,
    // every translated constraint quietly becomes an opaque 500.
    const db = await createTestContext('orm-constraint')
    try {
      // the driver's error is caught where it is raised rather than after
      // Effect has wrapped it in a fiber failure: what is asserted is the
      // shape the translator will be handed
      const refused = await Effect.runPromise(
        Effect.gen(function* () {
          const em = yield* entityManager<typeof entities>()
          const insert = () =>
            kyselyOf(em)
              .insertInto('Tenant')
              .values({ slug: 'twice', name: 'Twice', enabled: true })
              .execute()
          return yield* Effect.promise(async () => {
            await insert()
            try {
              await insert()
              return undefined
            } catch (error) {
              return unwrapPgError(error)
            }
          })
        }).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(refused).toMatchObject({ code: '23505', constraint: 'tenants_slug_key' })
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

// The chain a caller actually depends on: a named constraint refuses a write,
// and what comes back is the domain error the contract declares rather than an
// opaque failure. Asserting the driver error's shape is not the same claim -
// it says nothing about whether translation still fires.
describe.runIf(postgresAvailable)('a refused write', () => {
  class SlugTaken extends Error {
    readonly _tag = 'SlugTaken'
  }

  it('comes back as the domain error the constraint means', async () => {
    const db = await createTestContext('orm-translate')
    try {
      const insert = Effect.gen(function* () {
        const em = yield* entityManager<typeof entities>()
        return yield* query(() =>
          kyselyOf(em)
            .insertInto('Tenant')
            .values({ slug: 'taken', name: 'Taken', enabled: true })
            .execute(),
        )
      }).pipe(translateConstraints({ tenants_slug_key: () => new SlugTaken() }))

      const services = databaseFor(db.url, { entities })
      await Effect.runPromise(insert.pipe(Effect.provide(services)))
      const exit = await Effect.runPromiseExit(insert.pipe(Effect.provide(services)))

      // in the error channel and named, not a defect and not a 500
      expect(Exit.isFailure(exit)).toBe(true)
      expect(JSON.stringify(Exit.isFailure(exit) ? exit.cause : {})).toContain('SlugTaken')
    } finally {
      await db.dispose()
    }
  })
})
