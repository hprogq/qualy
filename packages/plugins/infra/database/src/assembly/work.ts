import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import { entityContributions, type EntityContribution } from './entities.ts'
import { asState, type DatabaseState } from './state.ts'
import { LOCAL_FALLBACK, MIGRATIONS_FOLDER } from '../defaults.ts'

// Where this assembly keeps its lineage, and what the lineage is built from.

export { LOCAL_FALLBACK } from '../defaults.ts'

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
  const declared = config.migrationsFolder ?? MIGRATIONS_FOLDER
  const migrations = path.isAbsolute(declared)
    ? declared
    : path.resolve(path.dirname(context.manifestPath), declared)
  return {
    migrations,
    entities: entityContributions(context, asState(context.state)),
    url: process.env.DATABASE_URL ?? LOCAL_FALLBACK,
  }
}

/**
 * Two migrations sharing a timestamp apply in an order that depends on the
 * checkout, which is what happens when two branches both generate one.
 */
export function assertDistinctPrefixes(migrations: string): void {
  const seen = new Map<string, string>()
  const clashes: string[] = []
  for (const entry of fs.existsSync(migrations) ? fs.readdirSync(migrations).sort() : []) {
    if (!entry.endsWith('.sql')) continue
    const prefix = /\d{14}/.exec(entry)?.[0]
    if (!prefix) continue
    const other = seen.get(prefix)
    if (other) clashes.push(`${other} and ${entry}`)
    else seen.set(prefix, entry)
  }
  if (clashes.length > 0) {
    throw new Error(`database: migrations share a timestamp, so their order is undefined:
  ${clashes.join('\n  ')}`)
  }
}
