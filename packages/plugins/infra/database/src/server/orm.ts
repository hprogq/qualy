import { MikroORM, type EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { type EntitySchema } from '@mikro-orm/core'
import type { Pool } from 'pg'
import { Context, Effect, Exit, Fiber, Layer, Metric, Option, Redacted } from 'effect'
import { QualyNamingStrategy } from '../naming.ts'
import { DatabaseConfig } from './config.ts'
import { unwrapPgError } from '../pg-errors.ts'

// The ORM as an Effect resource, built from an entity set the host hands in.
//
// The plugin does not discover entities. Discovery would have to read files
// the assembly decides, which is exactly the question the manifest already
// answers - and a glob would find the tables of plugins this assembly does not
// include. What runs is what the aggregate says, and the aggregate is derived
// from the lock.

/**
 * Every entity this assembly retains, in the order the database capability
 * decided.
 *
 * Widened to the schema array here on purpose. The tuple type matters to the
 * plugins that write queries, and each of them narrows the manager to its own
 * closure rather than to this one: org may reach org's tables and the ones it
 * declares a database dependency on, and taking the aggregate's type would let
 * it reach rbac by accident while making it depend on the host.
 */
export class Entities extends Context.Service<Entities, readonly EntitySchema[]>()(
  '@qualy/plugin-database/Entities',
) {}

export class Orm extends Context.Service<Orm, MikroORM>()('@qualy/plugin-database/Orm') {}

export { QualyNamingStrategy } from '../naming.ts'

/**
 * The manager a plugin writes its queries against.
 *
 * `'~entities'` is the phantom property MikroORM carries from `init` into the
 * manager, and it is where `getKysely()` reads column types back out of. A
 * plugin declares its own closure as this parameter, so its queries reach its
 * tables and stop there.
 */
export type ClosureEntityManager<T extends readonly unknown[]> = PostgresEntityManager & {
  '~entities': T
}

/**
 * The manager an open transaction is running on.
 *
 * Present only inside `transaction`, and the reason `entityManager` is an
 * effect rather than a value: a service called from inside a transaction has
 * to run on that transaction's connection, and it must not have to be handed
 * anything to do so. Passing the handle down was the previous arrangement, and
 * forgetting it read committed state instead of what the transaction was about
 * to commit - silently, and only under concurrency.
 */
class TransactionManager extends Context.Service<TransactionManager, PostgresEntityManager>()(
  '@qualy/plugin-database/TransactionManager',
) {}

/**
 * A manager typed for the caller's own tables.
 *
 * Inside a transaction this is that transaction's manager, so a peer reached
 * across a service boundary joins it by being called there. Outside one it is
 * a fresh fork, because the manager carries an identity map and one shared
 * across requests is one request seeing another's rows.
 *
 * The ORM was built from the whole assembly, so its manager is wider than any
 * one plugin's closure and has to be narrowed. Narrowing is the safe
 * direction - a plugin that names fewer tables reaches fewer tables - but it
 * is still an assertion, so it is made once here instead of at every call
 * site, where fifteen copies would eventually disagree about which one lies.
 */
export const entityManager = <const T extends readonly unknown[]>(): Effect.Effect<
  ClosureEntityManager<T>,
  never,
  Orm
> =>
  Effect.gen(function* () {
    const open = yield* Effect.serviceOption(TransactionManager)
    if (Option.isSome(open)) return open.value as unknown as ClosureEntityManager<T>
    const orm = yield* Orm
    return orm.em.fork() as unknown as ClosureEntityManager<T>
  })

/**
 * Runs a body inside one database transaction.
 *
 * Committed when the body succeeds, rolled back when it fails or is
 * interrupted. Both of those are done through `Effect.promise`, so a pool that
 * cannot commit dies rather than joining the failures a caller chooses
 * between: it is not a decision anyone made.
 *
 * The propagation is JOIN-EXISTING, and only that. Called from inside an open
 * transaction it joins that one; it never opens a second, and it never takes a
 * savepoint. Two transactions would be two connections, and the inner one
 * would not see what the outer has not committed - which is the entire reason
 * a structural write takes a tenant lock first.
 *
 * A caller that one day needs to undo part of a transaction without losing the
 * rest wants a savepoint, and that is a second function. Changing what this
 * one means would silently give every existing nested call a connection that
 * cannot see its caller's writes.
 */
/**
 * The database boundary in a trace, and nothing more.
 *
 * pg auto-instrumentation was considered and refused for now: it needs the
 * `@opentelemetry/*` SDK family this process deliberately does not run (the
 * Effect tracer owns the spans; there is no OTel context for a patched driver
 * to parent into without the bridge package), plus an ESM loader hook whose
 * reliability under Node 24 + tsx the observability design itself flags. What
 * a slow request needs first is the boundary: these spans say the time went
 * to the database and inside which transaction, and deliberately carry no
 * SQL text, parameters or rows - this layer only ever sees an opaque thunk.
 */
const DB_SPAN = { kind: 'client', attributes: { 'db.system.name': 'postgresql' } } as const

/**
 * The stable-semconv duration of every database operation, recorded at the
 * same funnel the span wraps. Success and failure both count: a query that
 * fails still held a connection for that long. A failure carries the
 * SQLSTATE as `error.type` and `db.response.status_code` when the driver
 * gave a valid one - five characters, a bounded vocabulary - and the class
 * name otherwise; never the message.
 */
const operationDuration = Metric.histogram('db.client.operation.duration', {
  description: 'Duration of database client operations.',
  boundaries: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
})

const DB_METRIC = { 'db.system.name': 'postgresql', unit: 's' } as const

const SQLSTATE = /^[0-9A-Z]{5}$/

const operationAttributes = (exit: Exit.Exit<unknown, QueryFailed>): Record<string, string> => {
  if (Exit.isSuccess(exit)) return DB_METRIC
  let code: string | undefined
  for (const reason of exit.cause.reasons) {
    if (reason._tag !== 'Fail') continue
    const pg = unwrapPgError(reason.error)
    if (pg?.code !== undefined && SQLSTATE.test(pg.code)) code = pg.code
  }
  return {
    ...DB_METRIC,
    'error.type': code ?? 'QueryFailed',
    ...(code === undefined ? {} : { 'db.response.status_code': code }),
  }
}

export interface TransactionOptions {
  /**
   * Ask for a consistent view instead of PostgreSQL's default.
   *
   * `repeatable read` is what a reader wants when it assembles one answer
   * out of several statements: under the default, each statement sees its
   * own moment, so a report can be built from a combination of rows that
   * never existed together. Only honoured by the transaction that actually
   * begins - an effect joining an open one runs at that one's isolation.
   */
  readonly isolation?: 'repeatable read' | 'serializable'
  /** declares the intent, and lets PostgreSQL refuse a write that slips in */
  readonly readOnly?: boolean
}

/** how often a pool that will not close reports what it is still holding */
const POOL_CLOSE_REPORT_MS = 5_000

export const transaction = <A, E, R>(
  body: Effect.Effect<A, E, R>,
  options?: TransactionOptions,
): Effect.Effect<A, E, R | Orm> =>
  Effect.gen(function* () {
    const open = yield* Effect.serviceOption(TransactionManager)
    // joining is not opening: the span belongs to the transaction that
    // actually begins and commits, so the join branch adds none
    if (Option.isSome(open)) return yield* body

    const orm = yield* Orm
    const em = orm.em.fork()
    // the mode has to be set before the transaction reads anything, which is
    // why it is spelled here and not by the caller's first query
    const mode = [
      ...(options?.isolation === undefined ? [] : [`isolation level ${options.isolation}`]),
      ...(options?.readOnly === true ? ['read only'] : []),
    ].join(', ')
    return yield* Effect.acquireUseRelease(
      Effect.promise(() => em.begin()),
      () =>
        (mode === ''
          ? body
          : Effect.promise(() => em.execute(`set transaction ${mode}`)).pipe(Effect.andThen(body))
        ).pipe(Effect.provideService(TransactionManager, em)),
      (_, exit) =>
        Exit.isSuccess(exit)
          ? Effect.promise(() => em.commit())
          : Effect.promise(() => em.rollback()),
    ).pipe(Effect.withSpan('db.transaction', DB_SPAN))
  })

/**
 * Supplies the database to an effect, for a layer whose product may carry no
 * requirements of its own.
 *
 * An http middleware is the case: its handler type fixes what the request
 * context contains, so an effect needing `Orm` does not fit, and the layer has
 * to close over the database while it is being built.
 *
 * What comes back can only put the database into another effect. It is not the
 * ORM, so it cannot be asked for a manager off the pool - which is the whole
 * reason `Orm` is not exported as a value.
 */
export const withDatabase: Effect.Effect<
  <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>,
  never,
  Orm
> = Effect.gen(function* () {
  const orm = yield* Orm
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, Orm, orm) as Effect.Effect<A, E, Exclude<R, Orm>>
})

export class QueryFailed extends Error {
  readonly _tag = 'QueryFailed'
  // no parameter property: strip-only node loads this source when resolution
  // imports descriptors, and refuses syntax with runtime semantics
  constructor(cause: unknown) {
    super(`a database query failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    })
  }
}

/**
 * Runs a query, putting a driver failure in the error channel.
 *
 * Not `Effect.promise`, which makes it a defect. `translateConstraints` turns a
 * named constraint violation into the domain error a contract declares, and it
 * does that by catching from the error channel - so a query run as a defect
 * skips translation entirely and a delete blocked by a restrict foreign key
 * answers 500 where it should answer 409. Nothing about the call site would
 * look wrong.
 *
 * The driver's error is carried on `cause`, which is where the constraint
 * walker already looks.
 */
export const query = <A>(run: () => Promise<A>): Effect.Effect<A, QueryFailed> =>
  Effect.suspend(() => {
    const started = performance.now()
    return Effect.tryPromise({ try: run, catch: (cause) => new QueryFailed(cause) }).pipe(
      Effect.onExit((exit) =>
        Metric.update(
          Metric.withAttributes(operationDuration, operationAttributes(exit)),
          (performance.now() - started) / 1000,
        ),
      ),
      Effect.withSpan('db.query', DB_SPAN),
    )
  })

/**
 * Kysely, told to speak entity and property names.
 *
 * Generic over the manager rather than over one assembly's entity set: bound
 * to a concrete one it would stop accepting any other, so every plugin would
 * need a copy of this helper, and the copies would differ in exactly the
 * option that decides whether a uuid compares as a uuid.
 */
export const kyselyOf = <T extends PostgresEntityManager>(em: T) =>
  em.getKysely({
    tableNamingStrategy: 'entity',
    columnNamingStrategy: 'property',
    convertValues: true,
  })

/**
 * The connection could not be opened at all.
 *
 * An unreachable server, a connection string the driver rejects, entity
 * metadata that does not validate. In the error channel rather than as a
 * defect, because the plugin's whole claim is that these are visible in the
 * type of its layer - as a defect the type said `never` and the process died
 * with a driver stack trace, which is what it did under cordis.
 *
 * It never reaches an HTTP handler: nothing serves a request until this layer
 * has been built.
 */
export class DatabaseStartupFailed extends Error {
  readonly _tag = 'DatabaseStartupFailed'
  constructor(cause: unknown) {
    super(
      `could not open the database: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    )
  }
}

/**
 * The ORM, closed when the layer that built it is.
 *
 * It does not migrate: the lineage is applied by the layer that owns the
 * connection, before anything is built on top of it, and a second thing
 * deciding whether the schema is current is a second answer.
 */
/**
 * What the pool is doing, from its documented public counters.
 *
 * `driverOptions.onPoolCreated` is the driver's own hook handing out the
 * `pg.Pool` it builds, and `totalCount`/`idleCount`/`waitingCount` are
 * documented pg API - no private field is read. The connection-count
 * conventions these feed are still Development-status in OTel semconv, so
 * the names may follow upstream renames; acquisition WAIT TIME is the one
 * pool number deliberately not collected, because measuring it means
 * wrapping the acquire path itself - if it becomes diagnostically
 * necessary, that is the §12.1 re-evaluation trigger, not a hack here.
 */
// UpDownCounters per semconv, not gauges: a non-incremental effect counter
// exports as a non-monotonic sum, and the sampler below feeds it deltas so
// the cumulative value IS the pool's current number. The pool name is
// required by the convention; this process has one pool, named plainly.
// The braces units reach the wire and, unlike the unitless default, keep
// Prometheus from suffixing a count with _ratio.
const POOL_NAME = { 'db.client.connection.pool.name': 'primary' } as const
const connectionCount = Metric.counter('db.client.connection.count', {
  description: 'Open database connections, by state.',
})
const pendingRequestsCount = Metric.counter('db.client.connection.pending_requests', {
  description: 'Requests waiting for a database connection.',
})
const idleConnections = Metric.withAttributes(connectionCount, {
  ...POOL_NAME,
  'db.client.connection.state': 'idle',
  unit: '{connection}',
})
const usedConnections = Metric.withAttributes(connectionCount, {
  ...POOL_NAME,
  'db.client.connection.state': 'used',
  unit: '{connection}',
})
const pendingRequests = Metric.withAttributes(pendingRequestsCount, {
  ...POOL_NAME,
  unit: '{request}',
})

export const layer: Layer.Layer<Orm, DatabaseStartupFailed, DatabaseConfig | Entities> =
  Layer.effect(
    Orm,
    Effect.gen(function* () {
      const config = yield* DatabaseConfig
      const entities = yield* Entities
      let pool: Pool | undefined
      const orm = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            MikroORM.init({
              entities: entities as EntitySchema[],
              clientUrl: Redacted.value(config.url),
              namingStrategy: QualyNamingStrategy,
              ...(config.poolSize === undefined ? {} : { pool: { min: 0, max: config.poolSize } }),
              driverOptions: {
                onPoolCreated: (created: Pool) => {
                  pool = created
                },
              },
              // an assembly part way through the migration has entities for
              // some of its tables and none for the rest, which is not a
              // mistake
              discovery: { warnWhenNoEntities: false },
            }),
          catch: (cause) => new DatabaseStartupFailed(cause),
        }),
        // a release that fails is nobody's decision to make: the scope is
        // already closing and there is no caller left to hand it to
        (orm) =>
          Effect.gen(function* () {
            const closing = yield* Effect.forkChild(Effect.promise(() => orm.close()))
            // A pool closes when every connection has come back. One that
            // never does waits forever, and a shutdown stuck here says only
            // that this plugin is still releasing - which is where the
            // search used to stop. Nothing below shortens the wait: a
            // release that gave up would turn a leaked connection into a
            // silent success. It only says, while it waits, what the pool
            // is still holding, so the next occurrence names the leak.
            const stuck = yield* Effect.forkChild(
              Effect.logWarning('the connection pool is still closing', {
                total: pool?.totalCount,
                idle: pool?.idleCount,
                waiting: pool?.waitingCount,
              }).pipe(Effect.delay(POOL_CLOSE_REPORT_MS), Effect.forever),
            )
            yield* Fiber.join(closing)
            yield* Fiber.interrupt(stuck)
          }),
      )
      // Wall-clock sampling on purpose. A node timer instead of an Effect
      // sleep keeps the loop off the ambient Clock - test suites replace
      // that with a TestClock whose quiescence-wait a forever-sleeping
      // fiber would deadlock (found the hard way). init does not connect
      // either: the driver builds its pool lazily on the first query, so
      // every tick re-reads the slot instead of deciding at build time.
      const services = yield* Effect.context<never>()
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          // deltas against the last sample, so the non-monotonic sums the
          // exporter reports always equal the pool's current numbers
          const last = { idle: 0, used: 0, pending: 0 }
          const timer = setInterval(() => {
            if (pool === undefined) return
            const idle = pool.idleCount
            const used = pool.totalCount - pool.idleCount
            const pending = pool.waitingCount
            idleConnections.updateUnsafe(idle - last.idle, services)
            usedConnections.updateUnsafe(used - last.used, services)
            pendingRequests.updateUnsafe(pending - last.pending, services)
            last.idle = idle
            last.used = used
            last.pending = pending
          }, 15_000)
          timer.unref()
          return timer
        }),
        (timer) => Effect.sync(() => clearInterval(timer)),
      )
      return orm
    }),
  )
