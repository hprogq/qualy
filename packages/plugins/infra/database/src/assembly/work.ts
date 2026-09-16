import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import { declaredEntityModules, type EntityModule } from './entities.ts'
import { asState, type DatabaseState } from './state.ts'
import { GENERATION_URL_VARIABLE, LOCAL_FALLBACK, MIGRATIONS_FOLDER } from '../defaults.ts'

// Where this assembly keeps its lineage, what the lineage is built from, and
// which databases the work addresses.

export { LOCAL_FALLBACK } from '../defaults.ts'

export interface DatabaseWork {
  migrations: string
  /** every retained plugin's declared entities, in database dependency order */
  modules: EntityModule[]
  /** the database deploy applies to */
  url: string
  /**
   * The server generation builds its two scratch databases on, asked for
   * only when generation runs: a deploy never needs it, and a work context
   * can be built without deciding it.
   */
  generationUrl: () => string
}

/**
 * Which database this run addresses.
 *
 * The same rule the process applies at startup (src/server/config.ts): a
 * production run will not assume one, and a development run says which one it
 * assumed. The CLI used to take the fallback in silence, so `qualy deploy` in
 * a shell whose DATABASE_URL was never exported applied the lineage to
 * whatever postgres answers on localhost and printed the success line it
 * prints when it reached the right one.
 */
function targetUrl(): string {
  const configured = process.env.DATABASE_URL
  if (configured !== undefined) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is not set; a production run will not assume a database')
  }
  console.warn(`database: DATABASE_URL is not set, addressing ${LOCAL_FALLBACK}`)
  return LOCAL_FALLBACK
}

/**
 * Where generation creates its scratch databases.
 *
 * `QUALY_GENERATION_DATABASE_URL` first; otherwise the server DATABASE_URL
 * names, which is what a developer's machine and CI want. Generation is
 * theirs alone - a production deployment applies what was committed and
 * never generates - so there is nothing to warn about here. A role that may
 * not CREATE DATABASE is told about the variable by the refusal itself.
 */
export function generationUrl(target: string, env: NodeJS.ProcessEnv = process.env): string {
  const declared = env[GENERATION_URL_VARIABLE]
  return declared !== undefined && declared !== '' ? declared : target
}

/**
 * The target a success line may name: host, port and database, never the
 * password. A run that reached the wrong server is otherwise indistinguishable
 * from one that reached the right one.
 */
export function databaseTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return 'the configured database'
  }
}

/**
 * The lineage is the product's committed `db/migrations`, beside the manifest
 * at the product root - the same folder the runtime resolves - so generation
 * and application can never disagree about which history they mean.
 */
export function databaseWork(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): DatabaseWork {
  const config = (context.providerConfig ?? {}) as Record<string, unknown>
  // This provider reads no manifest configuration, and a key is refused rather
  // than ignored: an unrecognised key changes the manifest hash, so resolve
  // succeeds and a frozen start passes, and the setting reads as applied when
  // nothing consumed it. `migrationsFolder` was one, until there was one
  // product with one committed history and nothing left for it to choose.
  const given = Object.keys(config)
  if (given.length > 0) {
    const hint = given.includes('url')
      ? '. Set DATABASE_URL in the environment instead, so the lineage and the application cannot address different databases; a manifest is committed, so a connection string in it is a credential in version control'
      : given.includes('migrationsFolder')
        ? `. The lineage is always ${path.join(path.dirname(context.manifestPath), MIGRATIONS_FOLDER)}, the product's own committed history`
        : '. This plugin reads everything from the environment'
    throw new Error(
      `${context.manifestPath}: @qualy/plugin-database takes no configuration, and was given config.${given.join(', config.')}${hint}`,
    )
  }
  const migrations = path.resolve(path.dirname(context.manifestPath), MIGRATIONS_FOLDER)
  const url = targetUrl()
  return {
    migrations,
    modules: declaredEntityModules(context, asState(context.state)),
    url,
    generationUrl: () => generationUrl(url),
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
