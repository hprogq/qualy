import { Cause, type Context, Deferred, Effect, Exit, Fiber, Layer, Redacted, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import { unavailable, unavailableDependencies } from '@qualy/api-kit/unavailable'
import { DATABASE_TIMEOUTS, type DatabaseTimeouts } from '../src/defaults.ts'
import { failedWith } from '../src/server/constraints.ts'
import {
  DatabaseConfig,
  Entities,
  entityManager,
  kyselyOf,
  query,
  QueryFailed,
  transaction,
} from '../src/server/index.ts'
import { layer as ormLayer, type Orm } from '../src/server/orm.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// How long the application waits on its database, and what a request is told
// when the wait runs out.
//
// Before these limits a lock queue, or a database that stopped answering,
// held every request and the readiness probe for as long as it lasted: the
// pool queued callers without a deadline, and no session had a statement or
// lock timeout. Each limit here is exercised against a real server with a
// value small enough to watch it fire, and each failure has to say that the
// database was unavailable - which is what the http boundary answers 503 -
// while a refusal the data itself earns must not.

const CLOSE_BUDGET_MS = 3_000

/** the orm alone, over one scratch database, with the limits a case names */
const ormFor = (url: string, poolSize: number, timeouts: Partial<DatabaseTimeouts> = {}) =>
  ormLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          DatabaseConfig,
          DatabaseConfig.of({
            url: Redacted.make(url),
            migrations: 'off',
            migrationsFolder: '/nowhere',
            poolSize,
            timeouts: { ...DATABASE_TIMEOUTS, ...timeouts },
          }),
        ),
        Layer.succeed(Entities, []),
      ),
    ),
  )

const run = (text: string) =>
  Effect.gen(function* () {
    const em = yield* entityManager<readonly []>()
    return yield* query(() => sql.raw(text).execute(kyselyOf(em)))
  })

/** the query failure an exit carries, whether a caller could catch it or it died */
const queryFailure = (exit: Exit.Exit<unknown, unknown>): QueryFailed => {
  if (Exit.isSuccess(exit)) throw new Error('the statement succeeded when it should not have')
  for (const reason of exit.cause.reasons) {
    const candidate =
      reason._tag === 'Fail' ? reason.error : reason._tag === 'Die' ? reason.defect : undefined
    if (candidate instanceof QueryFailed) return candidate
  }
  throw new Error(`no query failure in ${Cause.pretty(exit.cause)}`)
}

/**
 * Holds a connection inside an open transaction until let go, having run
 * `first` on it; resolves once the statement has run.
 */
const holding = async (built: Context.Context<Orm>, first: string) => {
  const letGo = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const held = Effect.runFork(
    transaction(
      Effect.gen(function* () {
        yield* run(first)
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(letGo)
      }),
    ).pipe(Effect.provide(built)),
  )
  await Effect.runPromise(Deferred.await(entered))
  return async () => {
    await Effect.runPromise(Deferred.succeed(letGo, undefined))
    await Effect.runPromise(Fiber.await(held))
  }
}

const closeWithin = (scope: Scope.Closeable) =>
  Promise.race([
    Effect.runPromise(Scope.close(scope, Exit.void)).then(() => 'closed' as const),
    new Promise<'still closing'>((resolve) =>
      setTimeout(() => resolve('still closing'), CLOSE_BUDGET_MS),
    ),
  ])

/** a built orm for one case, closed with it */
const withOrm = async (
  label: string,
  poolSize: number,
  timeouts: Partial<DatabaseTimeouts>,
  body: (
    built: Context.Context<Orm>,
    db: Awaited<ReturnType<typeof createTestContext>>,
  ) => Promise<void>,
) => {
  const db = await createTestContext(label)
  const scope = await Effect.runPromise(Scope.make())
  try {
    const context = await Effect.runPromise(
      Layer.buildWithScope(ormFor(db.url, poolSize, timeouts), scope),
    )
    await body(context, db)
  } finally {
    expect(await closeWithin(scope)).toBe('closed')
    await db.dispose()
  }
}

describe.runIf(postgresAvailable)('how long the application waits on its database', () => {
  it('stops waiting for a connection at the pool timeout, and calls it unavailable', async () => {
    await withOrm('timeouts-connect', 1, { connectMs: 300 }, async (built) => {
      const letGo = await holding(built, 'select 1')
      try {
        const started = Date.now()
        const outside = queryFailure(
          await Effect.runPromiseExit(run('select 1').pipe(Effect.provide(built))),
        )
        expect(Date.now() - started).toBeLessThan(CLOSE_BUDGET_MS)
        expect(outside[unavailable]).toBe('database')

        // a transaction that cannot begin says the same, although it dies
        const begun = await Effect.runPromiseExit(
          transaction(run('select 1')).pipe(Effect.provide(built)),
        )
        expect(queryFailure(begun)[unavailable]).toBe('database')
      } finally {
        await letGo()
      }
      // and the slot was never lost: the next caller is served
      expect(
        Exit.isSuccess(await Effect.runPromiseExit(run('select 1').pipe(Effect.provide(built)))),
      ).toBe(true)
    })
  }, 30_000)

  it('gives up a lock wait at the lock timeout', async () => {
    await withOrm('timeouts-lock', 2, { lockMs: 300 }, async (built, db) => {
      await db.query('create table contended (id int primary key)')
      await db.query('insert into contended values (1)')
      const letGo = await holding(built, 'select id from contended where id = 1 for update')
      try {
        const refused = queryFailure(
          await Effect.runPromiseExit(
            transaction(run('select id from contended where id = 1 for update')).pipe(
              Effect.provide(built),
            ),
          ),
        )
        expect(failedWith(refused, '55P03')).toBe(true)
        expect(refused[unavailable]).toBe('database')
      } finally {
        await letGo()
      }
    })
  }, 30_000)

  it('cancels a statement at the statement timeout', async () => {
    await withOrm('timeouts-statement', 1, { statementMs: 300 }, async (built) => {
      const started = Date.now()
      const cancelled = queryFailure(
        await Effect.runPromiseExit(run('select pg_sleep(5)').pipe(Effect.provide(built))),
      )
      expect(Date.now() - started).toBeLessThan(CLOSE_BUDGET_MS)
      expect(failedWith(cancelled, '57014')).toBe(true)
      expect(cancelled[unavailable]).toBe('database')
    })
  }, 30_000)

  it('ends a transaction left idle, and hands its connection back', async () => {
    await withOrm('timeouts-idle', 1, { idleInTransactionMs: 300 }, async (built) => {
      const abandoned = await Effect.runPromiseExit(
        transaction(
          Effect.gen(function* () {
            yield* run('select 1')
            yield* Effect.sleep('1500 millis')
            yield* run('select 1')
          }),
        ).pipe(Effect.provide(built)),
      )
      expect(queryFailure(abandoned)[unavailable]).toBe('database')
      // the session is gone, and the pool opened another for the next caller
      expect(
        Exit.isSuccess(await Effect.runPromiseExit(run('select 1').pipe(Effect.provide(built)))),
      ).toBe(true)
    })
  }, 30_000)

  it('does not call a refusal the data earned unavailable', async () => {
    await withOrm('timeouts-refusal', 1, {}, async (built, db) => {
      await db.query('create table once (id int primary key)')
      const refused = queryFailure(
        await Effect.runPromiseExit(
          run('insert into once values (1), (1)').pipe(Effect.provide(built)),
        ),
      )
      expect(failedWith(refused, '23505')).toBe(true)
      expect(refused[unavailable]).toBeUndefined()
    })
  }, 30_000)

  it('opens every session with the limits, unless the url says otherwise', async () => {
    const db = await createTestContext('timeouts-defaults')
    const settings = (url: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(databaseFor(url, { migrations: 'off' }))
            const { rows } = yield* run(
              `select current_setting('statement_timeout') as statement,
                      current_setting('lock_timeout') as lock,
                      current_setting('idle_in_transaction_session_timeout') as idle`,
            ).pipe(Effect.provide(context))
            return rows[0]
          }),
        ),
      )
    try {
      expect(await settings(db.url)).toEqual({ statement: '30s', lock: '10s', idle: '1min' })
      // a parameter on the connection string is the operator's override
      const url = new URL(db.url)
      url.searchParams.set('statement_timeout', '0')
      expect(await settings(url.href)).toEqual({ statement: '0', lock: '10s', idle: '1min' })
    } finally {
      await db.dispose()
    }
  }, 30_000)

  it('is answered 503 at the http boundary, and a fault that is not is still a 500', async () => {
    await withOrm('timeouts-http', 1, { connectMs: 300 }, async (built, db) => {
      await db.query('create table once (id int primary key)')
      const answering = (text: string) =>
        run(text).pipe(
          // what every service does with a query failure it did not expect
          Effect.orDie,
          Effect.as(HttpServerResponse.text('ok')),
          Effect.provide(built),
        )
      const { handler, dispose } = HttpRouter.toWebHandler(
        Layer.mergeAll(
          HttpRouter.add('GET', '/busy', answering('select 1')),
          HttpRouter.add('GET', '/twice', answering('insert into once values (1), (1)')),
          unavailableDependencies,
        ),
        { disableLogger: true },
      )
      try {
        const letGo = await holding(built, 'select 1')
        try {
          const busy = await handler(new Request('http://qualy.test/busy'))
          expect(busy.status).toBe(503)
          expect(((await busy.json()) as { _tag?: string })._tag).toBe('SERVICE_UNAVAILABLE')
        } finally {
          await letGo()
        }
        expect((await handler(new Request('http://qualy.test/twice'))).status).toBe(500)
      } finally {
        await dispose()
      }
    })
  }, 30_000)
})
