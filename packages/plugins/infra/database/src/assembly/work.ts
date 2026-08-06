import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import { entityContributions, type EntityContribution } from './entities.ts'
import { asState, type DatabaseState } from './state.ts'

// Where this assembly keeps its lineage, and what the lineage is built from.

export const LOCAL_FALLBACK = 'postgres://qualy:qualy@localhost:5432/qualy'

/** ledger location, which the runtime migrator has to agree with */
export const LEDGER = { schema: 'cordis_meta', table: 'schema_migrations' }

export interface DatabaseWork {
  migrations: string
  /** every retained plugin that ships entities, in database dependency order */
  entities: EntityContribution[]
  url: string
}

/**
 * The folder is the provider plugin's own manifest config, the same
 * declaration the runtime reads, so generation and application can never
 * disagree about which lineage they mean.
 */
export function databaseWork(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): DatabaseWork {
  const config = (context.providerConfig ?? {}) as { migrationsFolder?: string; url?: string }
  // Every key this provider reads. Anything else is refused rather than
  // ignored: an unrecognised key in the manifest changes the manifest hash, so
  // resolve succeeds and a frozen start passes, and the setting reads as
  // applied when nothing consumed it. `migrations: off` is the one that would
  // hurt - the mode is real, it just belongs in QUALY_MIGRATIONS.
  const unknown = Object.keys(config).filter((key) => key !== 'migrationsFolder')
  if (unknown.length > 0) {
    const hint = unknown.includes('url')
      ? '. Set DATABASE_URL in the environment instead, so the lineage and the application cannot address different databases; a manifest is committed, so a connection string in it is a credential in version control'
      : '. This plugin reads everything else from the environment'
    throw new Error(
      `${context.manifestPath}: @qualy/plugin-database does not read config.${unknown.join(', config.')}${hint}`,
    )
  }
  const declared = config.migrationsFolder ?? 'db/migrations'
  const migrations = path.isAbsolute(declared)
    ? declared
    : path.resolve(path.dirname(context.manifestPath), declared)
  return {
    migrations,
    entities: entityContributions(context, asState(context.state)),
    url: process.env.DATABASE_URL ?? LOCAL_FALLBACK,
  }
}

export const migrationDirs = (migrations: string): string[] =>
  fs.existsSync(migrations)
    ? fs
        .readdirSync(migrations)
        .filter((dir) => fs.existsSync(path.join(migrations, dir, 'migration.sql')))
        .sort()
    : []

/**
 * A new, empty migration directory.
 *
 * The prefix is fourteen UTC digits because that is what the applier reads
 * back out of the folder name to order the lineage and to stamp the ledger;
 * the name after it is for the people reading `git log`.
 */
export function createMigrationDir(migrations: string, name: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const dir = `${stamp}_${name}`
  const target = path.join(migrations, dir)
  if (fs.existsSync(target)) {
    throw new Error(`database: ${dir} already exists`)
  }
  fs.mkdirSync(target, { recursive: true })
  return dir
}

/** the name given on the command line, reduced to what a directory may be called */
export const migrationName = (given: string | undefined, fallback: string): string => {
  const slug = (given ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`database: --name ${given} has no usable characters`)
  return slug
}

/**
 * Two migrations sharing a prefix apply in an order that depends on the
 * checkout, which is what happens when two branches both generate one.
 */
export function assertDistinctPrefixes(migrations: string): void {
  const seen = new Map<string, string>()
  const clashes: string[] = []
  for (const dir of migrationDirs(migrations)) {
    const prefix = dir.slice(0, 14)
    const other = seen.get(prefix)
    if (other) clashes.push(`${other} and ${dir}`)
    else seen.set(prefix, dir)
  }
  if (clashes.length > 0) {
    throw new Error(`database: migrations share a timestamp, so their order is undefined:
  ${clashes.join('\n  ')}`)
  }
}
