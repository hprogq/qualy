import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../lib/seed.ts'
import { resolvePluginModuleUrl } from '../lib/schema-entries.ts'

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'

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
if (!available) console.warn('postgres unreachable, seed tests skipped')

describe.runIf(available)('bootstrap seed', () => {
  const admin = new Pool({ connectionString: baseUrl })
  const dbName = `qualy_seed_${randomUUID().slice(0, 8)}`
  let pool: Pool

  const inTransaction = async <T>(fn: (client: PoolClient) => Promise<T>) => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const result = await fn(client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = new Pool({ connectionString: url.href })
    const { runMigrations } = (await import(
      resolvePluginModuleUrl('@qualy/plugin-database/migrator')
    )) as typeof import('../../packages/plugins/infra/database/src/migrator.ts')
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool?.end()
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.end()
  })

  it('creates the hierarchy once and is a no-op on the second run', async () => {
    const first = await inTransaction(seed)
    expect(first).toEqual({ tenants: 1, types: 4, rules: 3, nodes: 4 })

    const second = await inTransaction(seed)
    expect(second).toEqual({ tenants: 0, types: 0, rules: 0, nodes: 0 })

    const nodes = await pool.query(
      `select code, depth, nlevel(path) as levels from org_nodes order by path`,
    )
    expect(nodes.rows.map((row) => [row.code, row.depth, Number(row.levels)])).toEqual([
      ['qualy-university', 0, 1],
      ['software-college', 1, 2],
      ['computer-science', 2, 3],
      ['class-1', 3, 4],
    ])
  })

  it('fails loudly when an existing row drifted from the seed definition', async () => {
    await pool.query(`update org_nodes set parent_id = null where code = 'software-college'`)
    await expect(inTransaction(seed)).rejects.toThrow(/seed drift: org node software-college/)
    // drift detection aborts before creating anything
    const count = await pool.query(`select count(*) from org_nodes`)
    expect(Number(count.rows[0].count)).toBe(4)
  })
})
