import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import { schemaEntries } from './schema.ts'
import { asState, type DatabaseState } from './state.ts'

// drizzle-kit is a command line tool, so running it means handing it a config
// file. The config is written per invocation from the resolved assembly rather
// than committed, because a committed one would be a second place where the
// schema set is decided, and it would be wrong for any assembly but this
// repository's own.

export const LOCAL_FALLBACK = 'postgres://qualy:qualy@localhost:5432/qualy'

/** ledger location, which the runtime migrator has to agree with */
export const LEDGER = { schema: 'cordis_meta', table: 'schema_migrations' }

const require_ = createRequire(import.meta.url)

const drizzleKitBin = (): string => {
  // resolved from this package, so the tool comes from the plugin that uses it
  // rather than from whatever the repository root happens to have. Its
  // package.json is not an exported subpath, so the root is found by walking
  // up from the module it does export.
  let dir: string
  try {
    dir = path.dirname(require_.resolve('drizzle-kit'))
  } catch {
    throw new Error(
      'drizzle-kit is not installed; migration generation is a development dependency of @qualy/plugin-database',
    )
  }
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('cannot locate the drizzle-kit package root')
    dir = parent
  }
  const bin = path.join(
    dir,
    JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).bin['drizzle-kit'],
  )
  if (!fs.existsSync(bin)) throw new Error(`drizzle-kit declares a bin that does not exist: ${bin}`)
  return bin
}

export interface DatabaseWork {
  migrations: string
  schema: string[]
  url: string
}

/**
 * Where this assembly keeps its migrations, and what goes into them.
 *
 * The folder is the provider plugin's own manifest config, the same
 * declaration the runtime reads, so generation and application can never
 * disagree about which lineage they mean.
 */
export function databaseWork(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): DatabaseWork {
  const config = (context.providerConfig ?? {}) as { migrationsFolder?: string; url?: string }
  const declared = config.migrationsFolder ?? 'db/migrations'
  const migrations = path.isAbsolute(declared)
    ? declared
    : path.resolve(path.dirname(context.manifestPath), declared)
  return {
    migrations,
    schema: schemaEntries(context, asState(context.state)),
    url: config.url ?? process.env.DATABASE_URL ?? LOCAL_FALLBACK,
  }
}

/** run drizzle-kit against a config written from this assembly */
export function drizzleKit(work: DatabaseWork, args: readonly string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-drizzle-'))
  const config = path.join(dir, 'drizzle.config.ts')
  // a plain object rather than drizzle-kit's defineConfig, which is an
  // identity function: the file lives in a temporary directory with no
  // node_modules above it, so it must not import anything
  fs.writeFileSync(
    config,
    `export default ${JSON.stringify(
      {
        dialect: 'postgresql',
        schema: work.schema,
        out: work.migrations,
        migrations: LEDGER,
        dbCredentials: { url: work.url },
      },
      null,
      2,
    )}\n`,
  )
  try {
    return execFileSync(process.execPath, [drizzleKitBin(), ...args, '--config', config], {
      encoding: 'utf8',
      stdio: args.includes('studio') ? 'inherit' : 'pipe',
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
    })
  } catch (error) {
    // stdio 'pipe' captures what drizzle-kit said, and the config it names is
    // about to be deleted, so both have to travel with the failure rather than
    // leaving "Command failed" and a path that no longer exists
    const failure = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(
      [`drizzle-kit ${args.join(' ')} failed`, failure.stderr, failure.stdout]
        .filter(Boolean)
        .join('\n')
        .trim(),
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export const migrationDirs = (migrations: string): string[] =>
  fs.existsSync(migrations)
    ? fs
        .readdirSync(migrations)
        .filter((dir) => fs.existsSync(path.join(migrations, dir, 'migration.sql')))
        .sort()
    : []
