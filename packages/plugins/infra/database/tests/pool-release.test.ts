import { Context, Deferred, Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { sql } from 'kysely'
import { describe, expect, it, vi } from 'vitest'
import { entityManager, kyselyOf, query, transaction } from '../src/server/index.ts'
import { Orm } from '../src/server/orm.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// What happens to a pool connection when its transaction cannot end cleanly,
// and what a pool that will not close says about the one it is waiting for.
//
// The driver returns a transaction's connection only after COMMIT or ROLLBACK
// succeeded. A commit the server refuses therefore kept the slot for the life
// of the process, and a shutdown waited for it forever - measured, and the
// same shape as the CI teardown that stays open: the backend idle, nothing
// waiting, one client never coming back. These bear that the slot comes
// back whatever the server said, and that the wait, when it does happen,
// names its holder.

const CLOSE_BUDGET_MS = 3_000

/** closes the scope, or says it could not within the budget */
const closeWithin = (scope: Scope.Closeable, budget = CLOSE_BUDGET_MS) =>
  Promise.race([
    Effect.runPromise(Scope.close(scope, Exit.void)).then(() => 'closed' as const),
    new Promise<'still closing'>((resolve) => setTimeout(() => resolve('still closing'), budget)),
  ])

const backendPid = Effect.gen(function* () {
  const em = yield* entityManager<readonly []>()
  const { rows } = yield* query(() =>
    sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(kyselyOf(em)),
  )
  return rows[0]!.pid
})

describe.runIf(postgresAvailable)('a transaction that cannot end cleanly', () => {
  it('returns its connection when the server refuses the commit', async () => {
    const db = await createTestContext('pool-release-refused')
    // a violation the server only sees at COMMIT, so the failure is the
    // commit's own and not a statement's
    await db.query(
      `create table refused (id int constraint refused_id unique deferrable initially deferred)`,
    )
    const scope = await Effect.runPromise(Scope.make())
    const built = await Effect.runPromise(Layer.buildWithScope(databaseFor(db.url), scope))
    try {
      let session = 0
      const refused = await Effect.runPromiseExit(
        transaction(
          Effect.gen(function* () {
            session = yield* backendPid
            const em = yield* entityManager<readonly []>()
            yield* query(() => sql`insert into refused values (1), (1)`.execute(kyselyOf(em)))
          }),
        ).pipe(Effect.provide(built)),
      )
      // the refusal still reaches the caller, as a defect: nobody chose it
      expect(Exit.isFailure(refused)).toBe(true)
      expect(String(refused).includes('refused_id')).toBe(true)

      // and the slot came back whole: the next transaction runs on the very
      // same session, because a refused commit costs a rollback, not a
      // connection
      const pid = await Effect.runPromise(transaction(backendPid).pipe(Effect.provide(built)))
      expect(pid).toBe(session)
    } finally {
      // the layer closes at once, because nothing is still checked out
      expect(await closeWithin(scope)).toBe('closed')
      await db.dispose()
    }
  }, 30_000)

  it('returns its connection when the session died underneath it', async () => {
    const db = await createTestContext('pool-release-died')
    const scope = await Effect.runPromise(Scope.make())
    const built = await Effect.runPromise(Layer.buildWithScope(databaseFor(db.url), scope))
    try {
      const died = await Effect.runPromiseExit(
        transaction(
          Effect.gen(function* () {
            const pid = yield* backendPid
            // the server ends this very session while the transaction is open;
            // COMMIT then fails, and so does the ROLLBACK that would have
            // returned the client
            yield* Effect.promise(() => db.query(`select pg_terminate_backend($1)`, [pid]))
          }),
        ).pipe(Effect.provide(built)),
      )
      expect(Exit.isFailure(died)).toBe(true)

      // a fresh session serves the next transaction
      const pid = await Effect.runPromise(transaction(backendPid).pipe(Effect.provide(built)))
      expect(pid).toEqual(expect.any(Number))
    } finally {
      expect(await closeWithin(scope)).toBe('closed')
      await db.dispose()
    }
  }, 30_000)
})

describe.runIf(postgresAvailable)('a pool that will not close', () => {
  it('names the checkout it is waiting for, and what the server thinks of it', async () => {
    const db = await createTestContext('pool-release-named')
    const scope = await Effect.runPromise(Scope.make())
    const built = await Effect.runPromise(Layer.buildWithScope(databaseFor(db.url), scope))
    const lines: string[] = []
    const capture = Logger.layer([
      Logger.make(({ message, fiber }) => {
        const annotations = fiber.getRef(References.CurrentLogAnnotations)
        lines.push(
          `${Array.isArray(message) ? message.join(' ') : String(message)} ${JSON.stringify(annotations)}`,
        )
      }),
    ])

    // a transaction nobody will interrupt, held open past the close: the
    // shape of a leak, without the mechanism of one
    const letGo = Deferred.makeUnsafe<void>()
    const entered = Deferred.makeUnsafe<number>()
    Effect.runFork(
      transaction(
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, yield* backendPid)
          yield* Deferred.await(letGo)
        }),
      ).pipe(
        Effect.withSpan('PoolRelease.holder'),
        Effect.annotateLogs({ source: 'pool-release.test' }),
        Effect.provide(built),
      ),
    )
    const pid = await Effect.runPromise(Deferred.await(entered))
    // and one idle connection beside it, which the close will remove at
    // once: what the report says about idle is then only right if it reads
    // the pool as it is, not as it was when the wait began
    await Effect.runPromise(
      Effect.gen(function* () {
        const em = yield* entityManager<readonly []>()
        yield* query(() => sql`select 1`.execute(kyselyOf(em)))
      }).pipe(Effect.provide(built)),
    )

    const closing = Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.provide(capture)))
    try {
      await vi.waitFor(
        () => {
          const report = lines.find((line) => line.includes('the connection pool is still closing'))
          if (report === undefined) throw new Error('no report yet')
          // whose checkout, on which backend, doing what, for whom
          expect(report).toContain(`pid ${pid}`)
          expect(report).toContain('by transaction')
          expect(report).toContain('PoolRelease.holder')
          expect(report).toContain('pool-release.test')
          // the counters are live: the idle ones are gone, this one is not
          expect(report).toContain('"total":1')
          expect(report).toContain('"idle":0')
        },
        { timeout: 12_000, interval: 200 },
      )
      await vi.waitFor(
        () => {
          const backend = lines.find((line) => line.startsWith(`pid ${pid} (ours)`))
          if (backend === undefined) throw new Error('no autopsy yet')
          expect(backend).toContain('idle in transaction')
        },
        { timeout: 10_000, interval: 200 },
      )
    } finally {
      await Effect.runPromise(Deferred.succeed(letGo, undefined))
      await closing
      await db.dispose()
    }
  }, 40_000)
})
