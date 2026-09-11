import { Client } from 'pg'

// The one file of the benchmark that touches PostgreSQL directly, and the
// one file the ownership gate exempts for it: the benchmark database's
// lifetime, the raw statements the dataset is bulk-written with, and the
// server's own statistics views. Everything else in tools/benchmarks reaches
// the database through what this file hands back.

const DEFAULT_URL = 'postgres://qualy:qualy@localhost:5432/qualy'
const BENCHMARK_DATABASE = 'qualy_benchmark'

/** the benchmark's own database: explicit, or the compose stack's server with its own name */
export const benchmarkUrl = (): string => {
  const explicit = process.env.QUALY_BENCH_DATABASE_URL
  if (explicit) return explicit
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_URL)
  url.pathname = `/${BENCHMARK_DATABASE}`
  return url.toString()
}

const databaseNameOf = (url: string): string => {
  const name = decodeURIComponent(new URL(url).pathname.slice(1))
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`benchmark database name ${JSON.stringify(name)} is not a plain identifier`)
  }
  return name
}

const maintenanceUrl = (url: string): string => {
  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'
  return maintenance.toString()
}

/** the database exists afterwards; with `reseed` it is a fresh one */
export const ensureDatabase = async (url: string, reseed: boolean): Promise<'created' | 'kept'> => {
  const name = databaseNameOf(url)
  const client = new Client({ connectionString: maintenanceUrl(url) })
  await client.connect()
  try {
    if (reseed) await client.query(`drop database if exists "${name}" with (force)`)
    const found = await client.query('select 1 from pg_database where datname = $1', [name])
    if ((found.rowCount ?? 0) > 0) return 'kept'
    await client.query(`create database "${name}"`)
    return 'created'
  } finally {
    await client.end()
  }
}

export interface Db {
  readonly query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>
  readonly end: () => Promise<void>
}

export const openDb = async (url: string): Promise<Db> => {
  const client = new Client({ connectionString: url })
  await client.connect()
  return {
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
      (await client.query(text, params)).rows as T[],
    end: () => client.end(),
  }
}

/** counters the server keeps for us: cumulative, so a round reads a delta */
export interface PgStats {
  readonly formulaVersionsIdxScan: number
  readonly formulaVersionsSeqScan: number
  readonly entriesIdxScan: number
  readonly recognitionsIdxScan: number
  readonly xactCommit: number
}

export const pgStatSnapshot = async (db: Db): Promise<PgStats> => {
  const tables = await db.query<{ relname: string; idx_scan: string; seq_scan: string }>(
    `select relname, idx_scan::text, seq_scan::text from pg_stat_user_tables
     where relname in ('assessment_formula_versions', 'entries', 'entry_recognitions')`,
  )
  const of = (name: string) => tables.find((row) => row.relname === name)
  const [database] = await db.query<{ xact_commit: string }>(
    'select xact_commit::text from pg_stat_database where datname = current_database()',
  )
  return {
    formulaVersionsIdxScan: Number(of('assessment_formula_versions')?.idx_scan ?? 0),
    formulaVersionsSeqScan: Number(of('assessment_formula_versions')?.seq_scan ?? 0),
    entriesIdxScan: Number(of('entries')?.idx_scan ?? 0),
    recognitionsIdxScan: Number(of('entry_recognitions')?.idx_scan ?? 0),
    xactCommit: Number(database?.xact_commit ?? 0),
  }
}

export const pgStatDelta = (before: PgStats, after: PgStats): PgStats => ({
  formulaVersionsIdxScan: after.formulaVersionsIdxScan - before.formulaVersionsIdxScan,
  formulaVersionsSeqScan: after.formulaVersionsSeqScan - before.formulaVersionsSeqScan,
  entriesIdxScan: after.entriesIdxScan - before.entriesIdxScan,
  recognitionsIdxScan: after.recognitionsIdxScan - before.recognitionsIdxScan,
  xactCommit: after.xactCommit - before.xactCommit,
})
