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

async function appliedCount(pool: Pool, schema: string, table: string) {
  try {
    const result = await pool.query(`select count(*) from "${schema}"."${table}"`)
    return Number(result.rows[0].count)
  } catch {
    return 0
  }
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
  const before = await appliedCount(pool, schema, table)
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: folder,
    migrationsSchema: schema,
    migrationsTable: table,
  })
  return {
    applied: (await appliedCount(pool, schema, table)) - before,
    elapsed: Math.round(performance.now() - started),
  }
}
