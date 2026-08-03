import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runMigrations } from '@qualy/plugin-database/migrator'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const migrationsFolder = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

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
if (!available) console.warn('postgres unreachable, auth schema tests skipped')

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('auth schema tenant boundary', () => {
  const admin = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_authschema_${randomUUID().slice(0, 8)}`
  let pool: Pool
  const ids = { tenant: '', otherTenant: '', root: '', memberType: '', provider: '', alice: '' }

  const pgCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'no error',
      (error) => (error as { code?: string }).code,
    )

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = quietPool({ connectionString: url.href })
    await runMigrations(pool, { folder: migrationsFolder })

    const row = async (text: string, params: unknown[]) =>
      (await pool.query(text, params)).rows[0].id as string
    ids.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`, [])
    ids.otherTenant = await row(
      `insert into tenants (slug, name) values ('b', 'B') returning id`,
      [],
    )
    const orgType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'unit', 'U') returning id`,
      [ids.tenant],
    )
    ids.root = await row(
      `insert into org_nodes (tenant_id, org_type_id, name, path) values ($1, $2, 'R', 'r') returning id`,
      [ids.tenant, orgType],
    )
    ids.memberType = await row(
      `insert into user_types (tenant_id, code, name, placement_mode) values ($1, 'member', 'M', 'unrestricted') returning id`,
      [ids.tenant],
    )
    ids.provider = await row(
      `insert into auth_providers (tenant_id, code, type, name) values ($1, 'local', 'local', 'L') returning id`,
      [ids.tenant],
    )
    ids.alice = await row(
      `insert into users (tenant_id, business_no, display_name, user_type_id, primary_org_node_id)
       values ($1, 'a-001', 'Alice', $2, $3) returning id`,
      [ids.tenant, ids.memberType, ids.root],
    )
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier)
       values ($1, $2, $3, 'alice')`,
      [ids.tenant, ids.alice, ids.provider],
    )
  })

  afterAll(async () => {
    await pool?.end()
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.end()
  })

  it('rejects cross-tenant references at the database level', async () => {
    // tenant B user referencing tenant A's user type / org node
    expect(
      await pgCode(
        pool.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'X', $2, $3)`,
          [ids.otherTenant, ids.memberType, ids.root],
        ),
      ),
    ).toBe('23503')
  })

  it('enforces identifier and business number uniqueness per tenant', async () => {
    expect(
      await pgCode(
        pool.query(
          `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier)
           values ($1, $2, $3, 'alice')`,
          [ids.tenant, ids.alice, ids.provider],
        ),
      ),
    ).toBe('23505')
    expect(
      await pgCode(
        pool.query(
          `insert into users (tenant_id, business_no, display_name, user_type_id, primary_org_node_id)
           values ($1, 'a-001', 'Copycat', $2, $3)`,
          [ids.tenant, ids.memberType, ids.root],
        ),
      ),
    ).toBe('23505')
  })

  it('rejects provider codes that are not route-safe', async () => {
    expect(
      await pgCode(
        pool.query(
          `insert into auth_providers (tenant_id, code, type, name) values ($1, 'Bad Code', 'local', 'X')`,
          [ids.tenant],
        ),
      ),
    ).toBe('23514')
  })
})
