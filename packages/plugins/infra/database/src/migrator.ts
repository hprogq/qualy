import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { Pool } from 'pg'

// cordis-free migration executor shared by the database plugin lifecycle and
// the standalone db:migrate command. It only ever applies migrations already
// committed under the migrations folder; generation stays in the dev
// toolchain (drizzle-kit) and must never run from application code.

// ledger location must match the migrations section of drizzle.config.ts
export const migrationDefaults = {
  folder: 'db/migrations',
  schema: 'cordis_meta',
  table: 'schema_migrations',
}

async function appliedCount(pool: Pool, schema: string, table: string, allowMissing: boolean) {
  try {
    const result = await pool.query(`select count(*) from "${schema}"."${table}"`)
    return Number(result.rows[0].count)
  } catch (error) {
    // a fresh database legitimately lacks the ledger (3F000 schema missing,
    // 42P01 table missing); anything else — permissions, broken connection —
    // must surface, especially on the recount after a successful migrate
    const code = (error as { code?: string }).code
    if (allowMissing && (code === '3F000' || code === '42P01')) return 0
    throw error
  }
}

/**
 * How many committed migrations the database has not run yet.
 *
 * The ledger records what was applied and the folder holds the whole
 * lineage, so the difference is the gap. It is only a count: identifying
 * which ones would mean reimplementing the migrator's own hashing, and the
 * count is what a caller needs in order to refuse to start.
 */
export async function pendingMigrations(
  pool: Pool,
  options: Partial<typeof migrationDefaults> = {},
): Promise<number> {
  const { folder, schema, table } = { ...migrationDefaults, ...options }
  const applied = await appliedCount(pool, schema, table, true)
  const committed = (await readdir(folder, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && existsSync(join(folder, entry.name, 'migration.sql')),
  ).length
  return Math.max(0, committed - applied)
}

export interface MigrationResult {
  applied: number
  elapsed: number
}

export async function runMigrations(
  pool: Pool,
  options: Partial<typeof migrationDefaults> = {},
): Promise<MigrationResult> {
  const { folder, schema, table } = { ...migrationDefaults, ...options }
  const started = performance.now()
  const before = await appliedCount(pool, schema, table, true)
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: folder,
    migrationsSchema: schema,
    migrationsTable: table,
  })
  return {
    applied: (await appliedCount(pool, schema, table, false)) - before,
    elapsed: Math.round(performance.now() - started),
  }
}
