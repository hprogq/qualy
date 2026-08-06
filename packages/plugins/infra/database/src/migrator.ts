import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'

// Applying the committed lineage, and nothing else.
//
// It only ever runs migrations already under the migrations folder; generation
// is a development tool and must never run from application code.
//
// The ledger's shape and the way a migration is read are not this file's
// invention - they are what drizzle-kit wrote and drizzle's migrator applied,
// and databases exist that were built by it. Reproducing them exactly is what
// lets the tool leave without the lineage being replayed on top of itself:
// same directory names, same `--> statement-breakpoint`, same sha256 over the
// whole file, same columns. What it does not reproduce is the upgrade path for
// older ledger layouts, which no database of ours has ever had.
//
// A statement at a time rather than one multi-statement string, so a failure
// names the statement that failed rather than the file.

export const migrationDefaults = {
  folder: 'db/migrations',
  schema: 'cordis_meta',
  table: 'schema_migrations',
}

const BREAKPOINT = '--> statement-breakpoint'

export interface Migration {
  /** the directory name, which is also the ledger's identity for it */
  name: string
  statements: string[]
  hash: string
  /** the fourteen-digit prefix as an instant, which is what the ledger stores */
  millis: number
}

/**
 * The lineage on disk, in the order it applies.
 *
 * A folder that is not there is a misconfiguration, not an empty lineage.
 * Reading it as empty would let a process start against a database nothing had
 * ever built, and report that its migrations were up to date.
 */
export async function readMigrations(folder: string): Promise<Migration[]> {
  if (!existsSync(folder)) {
    throw new Error(`there is no migration lineage at ${folder}`)
  }
  const dirs = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  return dirs.map((name) => {
    const sql = readFileSync(join(folder, name, 'migration.sql'), 'utf8')
    const stamp = name.slice(0, 14)
    return {
      name,
      statements: sql
        .split(BREAKPOINT)
        .map((statement) => statement.trim())
        .filter(Boolean),
      hash: createHash('sha256').update(sql).digest('hex'),
      millis: Date.UTC(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8)),
        Number(stamp.slice(8, 10)),
        Number(stamp.slice(10, 12)),
        Number(stamp.slice(12, 14)),
      ),
    }
  })
}

const qualified = (schema: string, table: string) => `"${schema}"."${table}"`

/**
 * What the database says it has already run.
 *
 * A fresh database legitimately lacks the ledger (3F000 schema missing, 42P01
 * table missing); anything else - permissions, a broken connection - has to
 * surface rather than read as "nothing applied yet".
 */
async function appliedNames(pool: Pool, schema: string, table: string): Promise<Set<string>> {
  let rows: { name: string | null }[]
  try {
    rows = (
      await pool.query<{ name: string | null }>(`select name from ${qualified(schema, table)}`)
    ).rows
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === '3F000' || code === '42P01') return new Set()
    throw error
  }
  // A row that does not say which migration it was cannot protect that
  // migration from running twice, and running twice is how a lineage of strict
  // CREATEs fails halfway. Refusing is the only answer that does not guess.
  if (rows.some((row) => row.name === null)) {
    throw new Error(
      `${qualified(schema, table)} contains a row with no migration name; this ledger predates named migrations and has to be repaired by hand before it can be applied against`,
    )
  }
  return new Set(rows.map((row) => row.name!))
}

/**
 * How many committed migrations the database has not run yet.
 *
 * The ledger records what was applied and the folder holds the whole lineage,
 * so the difference is the gap. It is only a count: which ones is a question
 * for the process that is going to apply them.
 */
export async function pendingMigrations(
  pool: Pool,
  options: Partial<typeof migrationDefaults> = {},
): Promise<number> {
  const { folder, schema, table } = { ...migrationDefaults, ...options }
  const applied = await appliedNames(pool, schema, table)
  return (await readMigrations(folder)).filter((migration) => !applied.has(migration.name)).length
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
  const applied = await appliedNames(pool, schema, table)
  const pending = (await readMigrations(folder)).filter((migration) => !applied.has(migration.name))

  const client = await pool.connect()
  try {
    await client.query(`create schema if not exists "${schema}"`)
    await client.query(`create table if not exists ${qualified(schema, table)} (
      id serial primary key,
      hash text not null,
      created_at bigint,
      name text,
      applied_at timestamp with time zone default now()
    )`)
    if (pending.length > 0) {
      // one transaction for the whole lineage: a database left halfway through
      // is one no later run can reason about, because the ledger would say the
      // migration did not happen while half of it had
      await client.query('begin')
      try {
        for (const migration of pending) {
          for (const statement of migration.statements) {
            await client.query(statement)
          }
          await client.query(
            `insert into ${qualified(schema, table)} (hash, created_at, name) values ($1, $2, $3)`,
            [migration.hash, migration.millis, migration.name],
          )
        }
        await client.query('commit')
      } catch (error) {
        await client.query('rollback').catch(() => {})
        throw error
      }
    }
  } finally {
    client.release()
  }
  return { applied: pending.length, elapsed: Math.round(performance.now() - started) }
}
