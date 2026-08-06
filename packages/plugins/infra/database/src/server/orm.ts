import { MikroORM, type EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { type EntitySchema } from '@mikro-orm/core'
import { Context, Effect, Exit, Layer, Option, Redacted } from 'effect'
import { QualyNamingStrategy } from '../naming.ts'
import { DatabaseConfig } from './config.ts'

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
export const transaction = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | Orm> =>
  Effect.gen(function* () {
    const open = yield* Effect.serviceOption(TransactionManager)
    if (Option.isSome(open)) return yield* body

    const orm = yield* Orm
    const em = orm.em.fork()
    return yield* Effect.acquireUseRelease(
      Effect.promise(() => em.begin()),
      () => body.pipe(Effect.provideService(TransactionManager, em)),
      (_, exit) =>
        Exit.isSuccess(exit)
          ? Effect.promise(() => em.commit())
          : Effect.promise(() => em.rollback()),
    )
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
  constructor(override readonly cause: unknown) {
    super(`a database query failed: ${cause instanceof Error ? cause.message : String(cause)}`)
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
  Effect.tryPromise({ try: run, catch: (cause) => new QueryFailed(cause) })

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
  constructor(override readonly cause: unknown) {
    super(`could not open the database: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * The ORM, closed when the layer that built it is.
 *
 * It does not migrate: the lineage is applied by the layer that owns the
 * connection, before anything is built on top of it, and a second thing
 * deciding whether the schema is current is a second answer.
 */
export const layer: Layer.Layer<Orm, DatabaseStartupFailed, DatabaseConfig | Entities> =
  Layer.effect(
    Orm,
    Effect.gen(function* () {
      const config = yield* DatabaseConfig
      const entities = yield* Entities
      return yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            MikroORM.init({
              entities: entities as EntitySchema[],
              clientUrl: Redacted.value(config.url),
              namingStrategy: QualyNamingStrategy,
              ...(config.poolSize === undefined ? {} : { pool: { min: 0, max: config.poolSize } }),
              // an assembly part way through the migration has entities for
              // some of its tables and none for the rest, which is not a
              // mistake
              discovery: { warnWhenNoEntities: false },
            }),
          catch: (cause) => new DatabaseStartupFailed(cause),
        }),
        // a release that fails is nobody's decision to make: the scope is
        // already closing and there is no caller left to hand it to
        (orm) => Effect.promise(() => orm.close()),
      )
    }),
  )
