import { randomUUID } from 'node:crypto'
import { defineEntity } from '@mikro-orm/core'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  Orm,
  entityManager,
  kyselyOf,
  transaction,
  type ClosureEntityManager,
} from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// Does a peer called from inside a transaction run on that transaction?
//
// This is the property the whole data layer rests on. A structural write locks
// the tenant, then asks other plugins whether the change is allowed - and each
// answer has to be about what this transaction is about to commit, not about
// what is committed. Under the previous arrangement the handle was an argument
// every caller had to remember to pass, and forgetting it read the wrong state
// silently, only under concurrency.
//
// So `peer` below takes no handle. It asks for a manager exactly as a service
// in another plugin would, and what it sees is decided entirely by where it
// was called from.

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

/** a service in some other plugin: it is handed nothing and asks for its own */
const peer = Effect.gen(function* () {
  const em = yield* entityManager<typeof entities>()
  return yield* Effect.promise(() => kyselyOf(em).selectFrom('Tenant').select(['slug']).execute())
})

/**
 * A reader that deliberately does not join: forked straight off the orm.
 *
 * The cast is the same one `entityManager` makes, written out because this is
 * the one place that must not go through it. Without it `orm.em` carries no
 * tuple and every table name is `never` - which is precisely the widening the
 * aggregate exists to prevent.
 */
const outsider = Effect.gen(function* () {
  const orm = yield* Orm
  const em = orm.em.fork() as unknown as ClosureEntityManager<typeof entities>
  return yield* Effect.promise(() => kyselyOf(em).selectFrom('Tenant').select(['slug']).execute())
})

// The id is supplied although the column defaults to uuidv7(). A raw sql
// default is not mapped to a generated column, so kysely requires a value;
// see docs/notes/mikro-orm.md.
const insert = (slug: string) =>
  Effect.gen(function* () {
    const em = yield* entityManager<typeof entities>()
    yield* Effect.promise(() =>
      kyselyOf(em)
        .insertInto('Tenant')
        .values({ id: randomUUID(), slug, name: slug, enabled: true })
        .execute(),
    )
  })

class Refused extends Error {
  readonly _tag = 'Refused'
}

describe.runIf(postgresAvailable)('a transaction', () => {
  it('is joined by a peer that was handed nothing, and by nobody else', async () => {
    const db = await createTestContext('tx-join')
    try {
      const [joined, outside] = await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* insert('acme')
            // Both halves are the assertion. That the peer sees the row is
            // only meaningful next to a reader that does not: without the
            // second, a peer running entirely outside the transaction would
            // read its own uncommitted-nowhere insert and look correct.
            return [yield* peer, yield* outsider] as const
          }),
        ).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(joined).toEqual([{ slug: 'acme' }])
      expect(outside).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('takes the peer down with it when the body fails', async () => {
    // the peer wrote inside the transaction, so a rollback has to undo its
    // write too; a peer on its own connection would have committed already
    const db = await createTestContext('tx-rollback')
    try {
      const services = databaseFor(db.url, { entities })
      const exit = await Effect.runPromiseExit(
        transaction(
          Effect.gen(function* () {
            yield* insert('doomed')
            return yield* Effect.fail(new Refused())
          }),
        ).pipe(Effect.provide(services)),
      )
      expect(exit._tag).toBe('Failure')

      const after = await Effect.runPromise(peer.pipe(Effect.provide(services)))
      expect(after).toEqual([])
    } finally {
      await db.dispose()
    }
  })

  it('commits what the body wrote when it succeeds', async () => {
    const db = await createTestContext('tx-commit')
    try {
      const services = databaseFor(db.url, { entities })
      await Effect.runPromise(transaction(insert('kept')).pipe(Effect.provide(services)))
      expect(await Effect.runPromise(peer.pipe(Effect.provide(services)))).toEqual([
        { slug: 'kept' },
      ])
    } finally {
      await db.dispose()
    }
  })

  it('joins the open one rather than opening a second', async () => {
    // A nested transaction would be a second connection, and it would not see
    // what the outer one has not committed - which is exactly the state a
    // structural write takes a tenant lock to reason about.
    const db = await createTestContext('tx-nested')
    try {
      const seen = await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* insert('outer')
            return yield* transaction(peer)
          }),
        ).pipe(Effect.provide(databaseFor(db.url, { entities }))),
      )
      expect(seen).toEqual([{ slug: 'outer' }])
    } finally {
      await db.dispose()
    }
  })
})
