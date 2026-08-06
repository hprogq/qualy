import { Effect, Layer, Redacted } from 'effect'
import { sql as rawSql } from 'kysely'
import { DatabaseConfig } from './config.ts'
import {
  Entities,
  Orm,
  QueryFailed,
  entityManager,
  kyselyOf,
  layer as ormLayer,
  query,
} from './orm.ts'
import { pendingMigrations, runMigrations } from '../migrator.ts'

// The database as an Effect resource.
//
// Where the failures live is the whole difference from what came before. Under
// cordis a missing migration, an unreachable server and a bad connection
// string were all throws inside Service.init that nothing in the type system
// mentioned. Here they are in the layer's error channel, so a composition that
// does not deal with them does not compile.

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
 * A value rather than a function, and it names `Orm` in its requirement, which
 * is the whole reason it can be exported at all: a readiness handler takes it
 * while its group is built, inside the composition that already has the ORM.
 * `Orm` being type-only stops the composition root holding one, not from a
 * layer built over this plugin's asking for it.
 */
export const ping: Effect.Effect<void, QueryFailed, Orm> = Effect.gen(function* () {
  const em = yield* entityManager<readonly []>()
  yield* query(() => rawSql`select 1`.execute(kyselyOf(em)))
}).pipe(Effect.withSpan('Database.ping'))

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
 * The migrator opens a connection of its own rather than borrowing the
 * application's, because this runs before the application's exists: the point
 * is to fail assembly rather than to serve traffic against a schema that is a
 * version behind.
 */
const prepare = Effect.fn('Database.prepare')(function* () {
  const config = yield* DatabaseConfig
  const entities = yield* Entities
  const options = { folder: config.migrationsFolder, entities }
  const url = Redacted.value(config.url)
  if (config.migrations === 'apply') {
    const { applied, elapsed } = yield* Effect.promise(() => runMigrations(url, options))
    return yield* Effect.logInfo(
      applied > 0
        ? `applied ${applied} migration(s) (${elapsed}ms)`
        : `migrations up to date (${elapsed}ms)`,
    )
  }
  // Refuse to start against a database the deployment job has not brought up
  // to date. Without this the process comes up on a stale schema and fails
  // later as missing columns, far from the cause.
  const pending = yield* Effect.promise(() => pendingMigrations(url, options))
  if (pending > 0) return yield* Effect.fail(new MigrationsBehind(pending))
  yield* Effect.logInfo('migration execution disabled, schema is up to date')
})

/**
 * Everything this plugin owns.
 *
 * The lineage is applied before the ORM exists, not beside it: a layer built
 * side by side would let queries run against a schema still being brought up
 * to date.
 */
export const layer: Layer.Layer<Orm, MigrationsBehind, DatabaseConfig | Entities> = ormLayer.pipe(
  Layer.provideMerge(Layer.effectDiscard(prepare())),
)
