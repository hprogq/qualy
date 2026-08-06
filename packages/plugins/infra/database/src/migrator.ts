import fs from 'node:fs'
import path from 'node:path'
import { Migration, Migrator } from '@mikro-orm/migrations'
import type { EntitySchema, MigrationObject } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
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

export const MIGRATIONS_FOLDER = 'db/migrations'

export interface MigrationOptions {
  folder: string
  /** the entity set the lineage builds; the migrator needs metadata to connect */
  entities: readonly EntitySchema[]
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
  body: (migrator: Migrator) => Promise<A>,
): Promise<A> {
  const orm = await MikroORM.init({
    entities: [...options.entities] as EntitySchema[],
    clientUrl: url,
    namingStrategy: QualyNamingStrategy,
    discovery: { warnWhenNoEntities: false },
    pool: { min: 1, max: 1 },
    extensions: [Migrator],
    migrations: { migrationsList: migrationsIn(options.folder), snapshot: false },
  })
  try {
    return await body(orm.migrator as Migrator)
  } finally {
    await orm.close()
  }
}

export interface MigrationResult {
  applied: number
  elapsed: number
}

/** how many committed migrations this database has not run yet */
export const pendingMigrations = (url: string, options: MigrationOptions): Promise<number> =>
  withMigrator(url, options, async (migrator) => (await migrator.getPending()).length)

export const runMigrations = async (
  url: string,
  options: MigrationOptions,
): Promise<MigrationResult> => {
  const started = performance.now()
  const applied = await withMigrator(url, options, async (migrator) => (await migrator.up()).length)
  return { applied, elapsed: Math.round(performance.now() - started) }
}
