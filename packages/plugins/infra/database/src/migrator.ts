import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Migration, Migrator } from '@mikro-orm/migrations'
import type { EntitySchema, MigrationObject } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { driverConnection } from './connection.ts'
import { QualyNamingStrategy } from './naming.ts'

// Applying the committed lineage, and nothing else.
//
// Ordering, the ledger, the transaction around each migration and the record
// of what ran are MikroORM's `Migrator`. None of that is worth owning.
//
// What is not MikroORM's is the file format. Its generator writes TypeScript
// modules that `import { Migration }`, and a lineage is generated into
// whatever directory an assembly points at - a temp workspace in a test, a
// deployment's config volume - where that import does not resolve. A lineage
// is also the last thing standing in a disaster, and `psql -f` has to be able
// to run it. So a migration here is a .sql file, handed to the migrator
// through `migrationsList`, which is the seam upstream provides for exactly
// this.
//
// Generation does not live here. It compares two databases and needs the whole
// assembly to say what the second one contains, so it belongs to the capability
// provider; this module is what an application process is allowed to run.
//
// One writer at a time. Two deployments of the same release racing to apply
// the same lineage, or a deployment beside a development boot that also
// applies, would each run the migrator's own transaction and one of them
// would fail halfway with a duplicate object. So a run that writes takes a
// database-scoped advisory lock first, on a session of its own. A second run
// WAITS for the first - it then finds nothing pending and reports itself up
// to date, which is what a boot racing a deploy, or two suites building a
// layer over one database, want - and only a wait past the bound is a
// refusal, naming the target. The lock lives where the side effect lives:
// in the database.

export { MIGRATIONS_FOLDER } from './defaults.ts'

export interface MigrationOptions {
  folder: string
  /** the entity set the lineage builds; the migrator needs metadata to connect */
  entities: readonly EntitySchema[]
}

/**
 * The advisory lock every migration run of a database takes: one fixed key,
 * derived from a name rather than configured, so two processes cannot be
 * told two different keys for one database.
 */
export const MIGRATION_LOCK_KEY = BigInt.asIntN(
  64,
  BigInt(`0x${createHash('sha256').update('qualy:migrations').digest('hex').slice(0, 15)}`),
).toString()

/**
 * How long a run waits for another run to release the lock before it gives
 * up. Long enough for any migration this lineage has ever carried, short
 * enough that a holder that died without releasing - a killed deploy whose
 * session postgres has not yet reaped - is a reported failure rather than a
 * hang. Overridable for a suite that asserts the refusal.
 */
export const MIGRATION_LOCK_TIMEOUT_VARIABLE = 'QUALY_MIGRATION_LOCK_TIMEOUT_MS'
const DEFAULT_LOCK_TIMEOUT_MS = 120_000

const lockTimeoutMs = (): number => {
  const declared = Number(process.env[MIGRATION_LOCK_TIMEOUT_VARIABLE])
  return Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_LOCK_TIMEOUT_MS
}

/** the body under the database's migration lock, waiting its turn, or a refusal that names the target */
async function withMigrationLock<A>(url: string, body: () => Promise<A>): Promise<A> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // `lock_timeout` bounds the wait on the advisory lock itself; the value
    // is a whole number of milliseconds and cannot be bound as a parameter
    await client.query(`set lock_timeout = ${Math.round(lockTimeoutMs())}`)
    try {
      await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    } catch (error) {
      // 55P03 lock_not_available: the wait ran out
      if ((error as { code?: string }).code === '55P03') {
        const target = new URL(url)
        throw new Error(
          `another migration run has held the lock on ${target.host}${target.pathname} for ${String(lockTimeoutMs())}ms; if it is still running, wait for it and retry - if it died, its session will be released by the server`,
          { cause: error },
        )
      }
      throw error
    }
    try {
      return await body()
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {})
    }
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * The lineage on disk, as migrations the migrator can run.
 *
 * A folder that is not there is a misconfiguration, not an empty lineage:
 * reading it as empty lets a process start against a database nothing ever
 * built and report itself up to date.
 *
 * The whole file is one statement to the driver. Postgres takes a
 * multi-statement query, the migration is already inside a transaction, and a
 * separator convention in the file would be one more thing to get right - the
 * previous format had one, inherited, and nothing but the migrator ever read
 * it.
 */
export function migrationsIn(folder: string): MigrationObject[] {
  if (!fs.existsSync(folder)) {
    throw new Error(`there is no migration lineage at ${folder}`)
  }
  return fs
    .readdirSync(folder)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(folder, name), 'utf8')
      return {
        name,
        class: class extends Migration {
          override up(): void {
            this.addSql(sql)
          }
        },
      }
    })
}

/**
 * The database has to be there already.
 *
 * `Migrator.init()` calls `ensureDatabase()` unconditionally, and that CREATES
 * the database through the management connection when it is missing - so a
 * typo in DATABASE_URL turned every entry point here into a server-mutating
 * write, including the boot path whose whole contract is to validate and
 * refuse. Worse than the stray database is what follows: the lineage applies
 * cleanly to it, the application comes up green and empty, and nothing ever
 * says the name was wrong. Every scratch database in this repository is
 * created explicitly by the code that owns it, so nothing needs the implicit
 * creation and refusing costs one connection.
 *
 * The connection is to the target itself: a missing database is the server
 * refusing it by name (3D000). Asking the `postgres` database instead made
 * every start - the validate-only production one included - depend on a
 * database the deployment never named, which a pooler configured for the
 * application's database alone, or a role without CONNECT on `postgres`,
 * refused with an error about the wrong database.
 */
async function assertDatabaseExists(url: string): Promise<void> {
  const client = new Client({ connectionString: url })
  try {
    await client.connect()
  } catch (error) {
    // 3D000 invalid_catalog_name
    if ((error as { code?: string }).code === '3D000') {
      const target = new URL(url)
      const name = decodeURIComponent(target.pathname.replace(/^\//, ''))
      throw new Error(
        `there is no database named ${name} on ${target.host}. Check DATABASE_URL; create it deliberately if it really is new.`,
        { cause: error },
      )
    }
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * A connection with a migrator on it, closed whatever happens to the body.
 *
 * Migrations run before anything else exists, so this opens its own ORM rather
 * than borrowing the application's - and it takes one connection, because the
 * lineage is a sequence. A full pool held during layer construction is a pool
 * every suite in a parallel run is also holding.
 */
export async function withMigrator<A>(
  url: string,
  options: MigrationOptions,
  body: (migrator: Migrator, orm: MikroORM) => Promise<A>,
): Promise<A> {
  await assertDatabaseExists(url)
  const orm = await MikroORM.init({
    entities: [...options.entities] as EntitySchema[],
    ...driverConnection(url),
    namingStrategy: QualyNamingStrategy,
    discovery: { warnWhenNoEntities: false },
    pool: { min: 1, max: 1 },
    extensions: [Migrator],
    migrations: { migrationsList: migrationsIn(options.folder), snapshot: false },
  })
  try {
    return await body(orm.migrator as Migrator, orm)
  } finally {
    await orm.close()
  }
}

export interface MigrationResult {
  applied: number
  elapsed: number
}

/**
 * Records the whole lineage as applied, without running any of it.
 *
 * For a database that already holds the schema the lineage builds but has no
 * record of it: one that predates the ledger, or one whose lineage was
 * squashed underneath it. The caller is responsible for having checked that
 * the schema actually matches - this only writes the ledger, and writing it
 * over a database that does not match hides the mismatch instead of fixing it.
 */
export const adoptMigrations = (url: string, options: MigrationOptions): Promise<string[]> =>
  withMigrationLock(url, () =>
    withMigrator(url, options, async (migrator) => {
      const storage = migrator.getStorage()
      await storage.ensureTable()
      const executed = new Set(await storage.executed())
      const pending = migrationsIn(options.folder).filter((entry) => !executed.has(entry.name))
      for (const entry of pending) {
        await storage.logMigration({ name: entry.name })
      }
      return pending.map((entry) => entry.name)
    }),
  )

/**
 * How many committed migrations this database has not run yet, read without
 * writing anything.
 *
 * The migrator's own `getPending` reaches `getExecutedMigrations`, which
 * calls `ensureTable` first (@mikro-orm/migrations 7.2.0,
 * MigrationStorage.js:37-38) - so asking the question CREATED the ledger.
 * A validate-only start is the one path whose whole purpose is to leave the
 * database exactly as it found it, and production's default is exactly that
 * path. A database with no ledger has run nothing, which is the answer its
 * absence already gives.
 */
export const pendingMigrations = (url: string, options: MigrationOptions): Promise<number> =>
  withMigrator(url, options, async (migrator, orm) => {
    const { tableName, schemaName } = migrator.getStorage().getTableName()
    const qualified = schemaName === undefined ? tableName : `${schemaName}.${tableName}`
    const connection = orm.em.getConnection()
    const present = await connection.execute<{ here: string | null }[]>(
      `select to_regclass('${qualified}')::text as here`,
    )
    const all = migrationsIn(options.folder)
    if (present[0]?.here == null) return all.length
    const executed = await connection.execute<{ name: string }[]>(`select name from ${qualified}`)
    const ran = new Set(executed.map((row) => row.name))
    return all.filter((entry) => !ran.has(entry.name)).length
  })

export const runMigrations = async (
  url: string,
  options: MigrationOptions,
): Promise<MigrationResult> => {
  const started = performance.now()
  // the database has to be there before a lock session can be opened on it,
  // and the refusal for a missing one is the one that names DATABASE_URL
  await assertDatabaseExists(url)
  const applied = await withMigrationLock(url, () =>
    withMigrator(url, options, async (migrator) => (await migrator.up()).length),
  )
  return { applied, elapsed: Math.round(performance.now() - started) }
}
