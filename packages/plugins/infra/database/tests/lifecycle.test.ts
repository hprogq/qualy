import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import Database from '../src/index.ts'

// exercises the production boot path (pg Pool + runMigrations inside
// Service.init) against a real postgres; PGlite cannot stand in here.
// Skipped when no server is reachable — CI provides one as a service.

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const migrationsFolder = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

const scratchUrl = (name: string) => {
  const url = new URL(baseUrl)
  url.pathname = `/${name}`
  return url.href
}

const available = await (async () => {
  const probe = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 1500 })
  try {
    await probe.query('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => {})
  }
})()

if (!available && process.env.QUALY_REQUIRE_POSTGRES_TESTS === '1') {
  throw new Error('postgres-backed tests are required but the server is unreachable')
}
if (!available) console.warn('postgres unreachable, database lifecycle tests skipped')

describe.runIf(available)('database plugin lifecycle on real postgres', () => {
  const admin = new Pool({ connectionString: baseUrl })
  const scratches: string[] = []

  const createScratch = async () => {
    const name = `qualy_lifecycle_${randomUUID().slice(0, 8)}`
    await admin.query(`create database "${name}"`)
    scratches.push(name)
    return name
  }

  const tableCount = async (db: string) => {
    const probe = new Pool({ connectionString: scratchUrl(db) })
    try {
      const tables = await probe.query(
        `select count(*) from information_schema.tables where table_name = 'ping_logs'`,
      )
      return Number(tables.rows[0].count)
    } finally {
      await probe.end()
    }
  }

  afterAll(async () => {
    for (const name of scratches) {
      await admin.query(`drop database if exists "${name}" with (force)`)
    }
    await admin.end()
  })

  it('applies committed migrations before activation and re-runs idempotently', async () => {
    const db = await createScratch()
    const ctx = new Context()
    const fiber = ctx.plugin(Database, { url: scratchUrl(db), migrationsFolder })
    await fiber
    expect(await tableCount(db)).toBe(1)

    await fiber.dispose()
    // a reload re-checks the ledger and must not fail or duplicate DDL
    const again = ctx.plugin(Database, { url: scratchUrl(db), migrationsFolder })
    await again
    expect(await tableCount(db)).toBe(1)
    await again.dispose()
  })

  it('leaves the schema untouched with migrations off', async () => {
    const db = await createScratch()
    const ctx = new Context()
    const fiber = ctx.plugin(Database, {
      url: scratchUrl(db),
      migrations: 'off',
      migrationsFolder,
    })
    await fiber
    expect(await tableCount(db)).toBe(0)
    await fiber.dispose()
  })

  it('fails activation on a bad migrations folder and closes the pool', async () => {
    const db = await createScratch()
    const ctx = new Context()
    const fiber = ctx.plugin(Database, {
      url: scratchUrl(db),
      migrationsFolder: `${migrationsFolder}-nonexistent`,
    })
    await expect(Promise.resolve(fiber)).rejects.toThrow()
    // the failed init must not leave connections behind
    const active = await admin.query(`select count(*) from pg_stat_activity where datname = $1`, [
      db,
    ])
    expect(Number(active.rows[0].count)).toBe(0)
  })
})
