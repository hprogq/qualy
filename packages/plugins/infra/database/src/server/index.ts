import { PgClient } from '@effect/sql-pg'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { Context, Effect, Layer, Redacted } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { sql as rawSql } from 'drizzle-orm'
import { Pool } from 'pg'
import { DatabaseConfig } from './config.ts'
import { Entities, Orm, layer as ormLayer } from './orm.ts'
import { pendingMigrations, runMigrations } from '../migrator.ts'

// The database as an Effect resource.
//
// The cordis service and this one describe the same thing and will not both
// survive; while they coexist they share the migrator, so there is one
// implementation of "apply the committed lineage" and not two.
//
// What changed in the translation is where the failures live. Under cordis a
// missing migration, an unreachable server and a bad connection string were
// all throws inside Service.init that nothing in the type system mentioned.
// Here they are in the layer's error channel, so a composition that does not
// deal with them does not compile.

export type Db = Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults>>

export class Database extends Context.Service<Database, Db>()('@qualy/plugin-database/Database') {}

export { DatabaseConfig } from './config.ts'
export {
  Entities,
  QualyNamingStrategy,
  entityManager,
  transaction,
  query,
  QueryFailed,
  withDatabase,
  kyselyOf,
  type ClosureEntityManager,
} from './orm.ts'

/**
 * The ORM itself, as a type only.
 *
 * Deliberately not a value out here. Holding it means being able to call
 * `orm.em.fork()`, which produces a manager bound to a pool connection - so a
 * service inside a transaction could leave it without anything looking wrong,
 * and the answer it gave would be about committed state. The layer's own type
 * has to name this service, which a type export is enough for; asking for it
 * with `yield*` is not.
 */
export type { Orm } from './orm.ts'

/**
 * Does the database still answer?
 *
 * Exported so a readiness probe can ask without reaching through the ORM: the
 * composition root should not have to depend on drizzle to find out whether
 * the plugin that owns the connection is healthy.
 */
export const ping = Effect.fn('Database.ping')(function* () {
  const database = yield* Database
  yield* database.execute(rawSql`select 1`)
})

export class MigrationsBehind extends Error {
  readonly _tag = 'MigrationsBehind'
  constructor(readonly pending: number) {
    super(
      `database is ${pending} migration(s) behind and this process does not apply them; run the migration job (pnpm qualy deploy) before starting`,
    )
  }
}

/**
 * Bring the database to the state this assembly expects, before anything that
 * depends on it is built.
 *
 * A pool is borrowed for the duration rather than taken from the client,
 * because this runs before the client exists: the point is to fail assembly
 * rather than to serve traffic against a schema that is a version behind.
 */
const prepare = Effect.fn('Database.prepare')(function* () {
  const config = yield* DatabaseConfig
  const url = Redacted.value(config.url)
  const folder = config.migrationsFolder
  yield* Effect.acquireUseRelease(
    Effect.sync(() => new Pool({ connectionString: url })),
    (pool) =>
      Effect.gen(function* () {
        if (config.migrations === 'apply') {
          const { applied, elapsed } = yield* Effect.promise(() => runMigrations(pool, { folder }))
          yield* Effect.logInfo(
            applied > 0
              ? `applied ${applied} migration(s) (${elapsed}ms)`
              : `migrations up to date (${elapsed}ms)`,
          )
          return
        }
        // Refuse to start against a database the deployment job has not
        // brought up to date. Without this the process comes up on a stale
        // schema and fails later as missing columns, far from the cause.
        const pending = yield* Effect.promise(() => pendingMigrations(pool, { folder }))
        if (pending > 0) return yield* Effect.fail(new MigrationsBehind(pending))
        yield* Effect.logInfo('migration execution disabled, schema is up to date')
      }),
    (pool) => Effect.promise(() => pool.end()),
  )
})

/**
 * The connection, ready to be used.
 *
 * `Layer.effect` supplies and then strips the Scope, so the pool's finalizer is
 * tied to this layer's lifetime and nothing leaks into its type.
 */
const connection: Layer.Layer<Database, SqlError.SqlError | MigrationsBehind, DatabaseConfig> =
  Layer.effect(
    Database,
    Effect.gen(function* () {
      yield* prepare()
      return yield* PgDrizzle.makeWithDefaults()
    }),
  ).pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const config = yield* DatabaseConfig
          return PgClient.layer({ url: config.url })
        }),
      ),
    ),
  )

/**
 * Everything this plugin owns.
 *
 * Two access paths to one database while the tables move from one to the
 * other, and the order between them is not incidental: `provideMerge` builds
 * its argument first, so the lineage has been applied by the time the ORM
 * exists. Building them side by side would let queries run against a schema
 * that is still being brought up to date.
 */
export const layer: Layer.Layer<
  Database | Orm,
  SqlError.SqlError | MigrationsBehind,
  DatabaseConfig | Entities
> = ormLayer.pipe(Layer.provideMerge(connection))
