import { Effect, Layer, Option, Redacted } from 'effect'
import { Readiness } from '@qualy/api-kit/readiness'
import { sql as rawSql } from 'kysely'
import { DatabaseConfig } from './config.ts'
import { DatabaseNotifications } from './notifications.ts'
import {
  DatabaseStartupFailed,
  Entities,
  Orm,
  QueryFailed,
  entityManager,
  kyselyOf,
  layer as ormLayer,
  query,
  withDatabase,
} from './orm.ts'
import { pendingMigrations, runMigrations } from '../migrator.ts'
import { failedWith } from './constraints.ts'

// The database as an Effect resource.
//
// Where the failures live is the whole difference from what came before. Under
// cordis a missing migration, an unreachable server and a bad connection
// string were all throws inside Service.init that nothing in the type system
// mentioned. Here they are in the layer's error channel - `StartupFailure`,
// which is all three - so a composition that does not deal with them does not
// compile.
//
// That claim was half true for a while: `MigrationsBehind` was typed, while an
// unreachable server and a migration that would not apply were still defects
// and the type still said the layer could only fail one way.

export { DatabaseConfig, config } from './config.ts'
export { DatabaseListenFailed, DatabaseNotifications, pgNotify } from './notifications.ts'
export { LOCAL_FALLBACK, MIGRATIONS_FOLDER } from '../defaults.ts'
export {
  DatabaseStartupFailed,
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
 * Registered rather than exported for the host to call. Only this plugin can
 * supply the ORM the probe needs, so it binds it here and hands over an effect
 * that needs nothing - which is what lets a readiness endpoint exist in an
 * assembly that has no database at all.
 */
const ping: Effect.Effect<void, QueryFailed, Orm> = Effect.gen(function* () {
  const em = yield* entityManager<readonly []>()
  yield* query(() => rawSql`select 1`.execute(kyselyOf(em)))
}).pipe(Effect.withSpan('Database.ping'))

/**
 * Offers the probe, without demanding somewhere to put it.
 *
 * `serviceOption` rather than a requirement: a readiness registry is the
 * server base's, and a suite that only wants a database should not have to
 * know the concept exists. Demanding it made every harness in the repository
 * provide one, which is the coupling this whole change is removing, pointed
 * the other way.
 */
const registerProbe: Layer.Layer<never, never, Orm> = Layer.effectDiscard(
  Effect.gen(function* () {
    const readiness = yield* Effect.serviceOption(Readiness)
    if (Option.isNone(readiness)) return
    const withDb = yield* withDatabase
    yield* readiness.value.register({ name: 'database', probe: withDb(ping) })
  }),
)

export class MigrationsBehind extends Error {
  readonly _tag = 'MigrationsBehind'
  // plain fields, not parameter properties: plugin sources are loaded as
  // TypeScript by plain node when resolution imports descriptors, and
  // strip-only mode refuses syntax with runtime semantics
  readonly pending: number
  constructor(pending: number) {
    super(
      `database is ${pending} migration(s) behind and this process does not apply them; run the migration job (pnpm qualy deploy) before starting`,
    )
    this.pending = pending
  }
}

/**
 * A migration would not apply, or the ledger would not be read.
 *
 * This is also what an unreachable server looks like at boot, whichever
 * migration mode is set: `MikroORM.init` discovers metadata and creates an
 * entity manager without opening a connection (upstream
 * packages/core/src/MikroORM.ts, where `init` does not call `connect`), so the
 * migrator - which opens one of its own either way - is what finds out first.
 *
 * Distinct from `MigrationsBehind`, which is a database this process refuses to
 * serve rather than one it could not bring up to date. Both are in the error
 * channel so the layer's type says a database can stop an assembly from being
 * built - as a defect this one said `never`, which is the claim this module's
 * comment makes about all of them.
 */
export class MigrationFailed extends Error {
  readonly _tag = 'MigrationFailed'
  readonly attempted: string
  constructor(attempted: string, cause: unknown, advice?: string | null) {
    const said = cause instanceof Error ? cause.message : String(cause)
    super(`could not ${attempted}: ${said}${advice ? ` (${advice})` : ''}`, {
      cause,
    })
    this.attempted = attempted
  }
}

/** everything a database can say to stop this assembly from being built */
export type StartupFailure = DatabaseStartupFailed | MigrationFailed | MigrationsBehind

/**
 * What a boot-time driver failure means in operator terms, or null when the
 * cause is not a connection-class one.
 *
 * The migrator is the first thing here to open a connection, so a server that
 * is off or misconfigured surfaces through it. Naming the target host is the
 * point: "connection refused" without an address reads like an application
 * bug, and a foreign postgres squatting on the configured port answers
 * `role "qualy" does not exist` - which reads like a broken installation
 * until the message says which server was asked.
 */
const adviseOn = (url: string, cause: unknown): string | null => {
  let host = 'the configured host'
  try {
    const target = new URL(url)
    host = `${target.hostname}:${target.port === '' ? '5432' : target.port}`
  } catch {
    // an unparseable url will have failed on its own terms already
  }
  const carries = (codes: readonly string[]) => codes.some((code) => failedWith(cause, code))
  if (carries(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'])) {
    return `postgres is not reachable at ${host}; start the database, or fix DATABASE_URL`
  }
  // 28P01 invalid_password, 28000 invalid_authorization_specification
  if (carries(['28P01', '28000'])) {
    return `postgres at ${host} rejected the credentials; check DATABASE_URL, and check that the server on this port is the one this assembly means`
  }
  // 57P03 cannot_connect_now: reachable, but still starting or shutting down
  if (carries(['57P03'])) {
    return `postgres at ${host} is not ready to accept connections yet; retry shortly`
  }
  return null
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
  const attempt = <A>(attempted: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new MigrationFailed(attempted, cause, adviseOn(url, cause)),
    })
  if (config.migrations === 'apply') {
    const { applied, elapsed } = yield* attempt('apply the lineage', () =>
      runMigrations(url, options),
    )
    return yield* Effect.logInfo(
      applied > 0
        ? `applied ${applied} migration(s) (${elapsed}ms)`
        : `migrations up to date (${elapsed}ms)`,
    )
  }
  // Refuse to start against a database the deployment job has not brought up
  // to date. Without this the process comes up on a stale schema and fails
  // later as missing columns, far from the cause.
  const pending = yield* attempt('read the migration ledger', () => pendingMigrations(url, options))
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
export const layer: Layer.Layer<
  Orm | DatabaseNotifications,
  StartupFailure,
  DatabaseConfig | Entities
> = ormLayer.pipe(
  Layer.provideMerge(Layer.effectDiscard(prepare())),
  // the probe closes over the orm, so it is registered from a layer built on
  // top of one rather than beside it
  (built) => Layer.merge(built, registerProbe.pipe(Layer.provide(built))),
  // the notification transport shares nothing with the ORM but the
  // connection string; it stands beside it, not on it
  (built) => Layer.merge(built, DatabaseNotifications.layer),
)
