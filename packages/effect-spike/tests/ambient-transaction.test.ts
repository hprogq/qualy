import { sql } from 'drizzle-orm'
import { Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { tenants } from '@qualy/plugin-org/schema'
import { Database, databaseLayer } from '../src/index.ts'

// M4 rests on a claim worth proving before designing around it.
//
// Today every cross-plugin authorization check takes a `handle?: RbacDbHandle`
// so it lands on the caller's locked connection. That parameter exists because
// three plugins each own a transaction, and a second pool connection taken
// while a tenant row lock is held deadlocks the pool. It is enforced by
// discipline: forget the argument and the check silently reads committed state
// instead of the state the caller is about to write.
//
// Upstream says the connection lives in the fiber context, not in a parameter:
// SqlClient.make resolves each statement's connection from
// `Effect.serviceOption(transactionService)` and falls back to the acquirer
// only when absent (repos/effect/packages/effect/src/unstable/sql/SqlClient.ts:139-146),
// and withTransaction installs it with `Effect.provideContext`, taking a
// savepoint rather than a second BEGIN when one is already there (:243-261).
//
// If that holds through drizzle, a peer service needs no handle at all: it
// joins whatever transaction its caller is in, by construction.

/** the caller changing its mind, as a tagged failure rather than a bare Error */
class Abandoned extends Schema.ErrorClass<Abandoned>('Abandoned')({}) {}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromiseExit(Effect.provide(effect, databaseLayer(url)))

const expectSuccess = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got: ${JSON.stringify(exit.cause)}`)
}

/**
 * A peer service, written the way rbac would be: it takes no handle and knows
 * nothing about who called it. It only asks for the Database service.
 */
const peerCountsTenants = Effect.fn('peer.countTenants')(function* () {
  const database = yield* Database
  const result = yield* database.execute(sql`select count(*)::int as count from tenants`)
  return Number((result as unknown as { rows: Array<{ count: number }> }).rows[0]!.count)
})

const peerBackendPid = Effect.fn('peer.backendPid')(function* () {
  const database = yield* Database
  const result = yield* database.execute(sql`select pg_backend_pid()::int as pid`)
  return Number((result as unknown as { rows: Array<{ pid: number }> }).rows[0]!.pid)
})

describe.runIf(postgresAvailable)('the transaction is ambient, not a parameter', () => {
  it('lets a peer service see what its caller has written but not committed', async () => {
    const db = await createTestContext('ambient-tx')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const database = yield* Database
          const before = yield* peerCountsTenants()

          const inside = yield* database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert(tenants).values({ slug: 'ambient', name: 'ambient' })
              // the peer uses the outer handle, never tx: if the connection
              // were resolved per call this would read the committed count
              return yield* peerCountsTenants()
            }),
          )

          const after = yield* peerCountsTenants()
          return { before, inside, after }
        }),
      )
      const { before, inside, after } = expectSuccess(exit)
      expect(inside).toBe(before + 1)
      expect(after).toBe(before + 1)
    } finally {
      await db.dispose()
    }
  })

  it('runs the peer on the very same backend connection', async () => {
    const db = await createTestContext('ambient-tx-pid')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const database = yield* Database
          return yield* database.transaction((tx) =>
            Effect.gen(function* () {
              const result = yield* tx.execute(sql`select pg_backend_pid()::int as pid`)
              const caller = Number(
                (result as unknown as { rows: Array<{ pid: number }> }).rows[0]!.pid,
              )
              const peer = yield* peerBackendPid()
              return { caller, peer }
            }),
          )
        }),
      )
      const { caller, peer } = expectSuccess(exit)
      // the same backend pid is the thing that makes the pool deadlock
      // structurally impossible rather than avoided by convention
      expect(peer).toBe(caller)
    } finally {
      await db.dispose()
    }
  })

  it('can hand out more than one connection, so sharing one is a real result', async () => {
    // without this the pid test above proves nothing: a pool of size one would
    // make every caller and peer agree by accident
    const db = await createTestContext('ambient-tx-pool')
    try {
      const exit = await run(
        db.url,
        Effect.forEach(
          Array.from({ length: 8 }, (_, i) => i),
          () => peerBackendPid(),
          { concurrency: 8 },
        ),
      )
      const pids = expectSuccess(exit)
      expect(new Set(pids).size).toBeGreaterThan(1)
    } finally {
      await db.dispose()
    }
  })

  it('undoes a peer service write when the caller rolls back', async () => {
    const db = await createTestContext('ambient-tx-rollback')
    try {
      // the peer writes, the caller then fails: if they were on separate
      // connections the peer's row would survive
      const peerWrites = Effect.fn('peer.write')(function* () {
        const database = yield* Database
        yield* database.insert(tenants).values({ slug: 'peer-written', name: 'peer written' })
      })

      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const database = yield* Database
          const attempt = yield* Effect.result(
            database.transaction(() =>
              Effect.gen(function* () {
                yield* peerWrites()
                return yield* new Abandoned()
              }),
            ),
          )
          const result = yield* database.execute(
            sql`select count(*)::int as count from tenants where slug = 'peer-written'`,
          )
          return {
            failed: attempt._tag === 'Failure',
            survivors: Number(
              (result as unknown as { rows: Array<{ count: number }> }).rows[0]!.count,
            ),
          }
        }),
      )
      const { failed, survivors } = expectSuccess(exit)
      expect(failed).toBe(true)
      expect(survivors).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('nests as a savepoint, so a peer can fail without losing the caller', async () => {
    const db = await createTestContext('ambient-tx-savepoint')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const database = yield* Database
          yield* database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert(tenants).values({ slug: 'outer-survives', name: 'outer survives' })
              // a peer that opens its own transaction gets a savepoint, so its
              // failure does not take the caller's work with it
              yield* Effect.result(
                database.transaction((inner) =>
                  Effect.gen(function* () {
                    yield* inner.insert(tenants).values({ slug: 'inner-discarded', name: 'inner discarded' })
                    return yield* new Abandoned()
                  }),
                ),
              )
            }),
          )
          const result = yield* database.execute(
            sql`select slug from tenants where slug in ('outer-survives', 'inner-discarded')`,
          )
          return (result as unknown as { rows: Array<{ slug: string }> }).rows.map(
            (row) => row.slug,
          )
        }),
      )
      const names = expectSuccess(exit)
      expect(names).toEqual(['outer-survives'])
    } finally {
      await db.dispose()
    }
  })
})
