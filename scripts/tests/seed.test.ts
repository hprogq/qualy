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

const ADMIN = { adminPassword: 'seed-test-password-123' }

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('tenant bootstrap seed', () => {
  const admin = quietPool({ connectionString: baseUrl })
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
    pool = quietPool({ connectionString: url.href })
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

  it('provisions a fresh tenant and converges to a no-op', async () => {
    const first = await inTransaction((client) => seed(client, ADMIN))
    expect(first.created).toEqual({
      tenant: 1,
      orgTypes: 8,
      rules: 9,
      root: 1,
      userTypes: 1,
      provider: 1,
      // the catalogue, the canonical tenant-admin role and the one grant
      // that hands it to the recovery account. The role maps no permissions
      // of its own: it reaches every active capability by mode rather than
      // by a mapping that a new plugin would have to backfill. Nothing is
      // granted to a user type, because a type confers no authority at all.
      permissions: 16,
      roles: 1,
      rolePermissions: 0,
      userTypeGrants: 0,
      assignments: 1,
      demoNodes: 0,
      demoUsers: 0,
    })
    expect(first.admin).toBe('created')
    expect(first.demo).toBe('skipped')

    // no demo descendants without the explicit flag
    const nodes = await pool.query(`select count(*) from org_nodes`)
    expect(Number(nodes.rows[0].count)).toBe(1)

    const second = await inTransaction((client) => seed(client, ADMIN))
    expect(Object.values(second.created).every((count) => count === 0)).toBe(true)
    expect(second.admin).toBe('unchanged')
  })

  it('leaves business-edited display fields alone', async () => {
    await pool.query(`update tenants set name = '改名大学'`)
    await pool.query(`update org_types set name = '书院' where code = 'college'`)
    await pool.query(`update org_nodes set name = '改名大学' where parent_id is null`)
    const report = await inTransaction((client) => seed(client, ADMIN))
    expect(Object.values(report.created).every((count) => count === 0)).toBe(true)
    const college = await pool.query(`select name from org_types where code = 'college'`)
    expect(college.rows[0].name).toBe('书院')
  })

  it('never resets the admin password without the explicit flag', async () => {
    const before = await pool.query(
      `select credential_hash from user_identities where identifier = 'admin'`,
    )
    await inTransaction((client) => seed(client, { adminPassword: 'a-different-password-1' }))
    const unchanged = await pool.query(
      `select credential_hash from user_identities where identifier = 'admin'`,
    )
    expect(unchanged.rows[0].credential_hash).toBe(before.rows[0].credential_hash)

    const reset = await inTransaction((client) =>
      seed(client, { adminPassword: 'a-brand-new-password-1', resetAdminPassword: true }),
    )
    expect(reset.admin).toBe('reset')
    const after = await pool.query(
      `select credential_hash from user_identities where identifier = 'admin'`,
    )
    expect(after.rows[0].credential_hash).not.toBe(before.rows[0].credential_hash)
    const { verifyPassword } = (await import(
      resolvePluginModuleUrl('@qualy/plugin-auth-local/password')
    )) as typeof import('../../packages/plugins/base/auth-local/src/password.ts')
    expect(await verifyPassword(after.rows[0].credential_hash, 'a-brand-new-password-1')).toBe(true)
  })

  it('creates demo data only when asked and idempotently', async () => {
    const demo = await inTransaction((client) =>
      seed(client, { ...ADMIN, demo: true, demoPassword: 'demo-test-password-1' }),
    )
    expect(demo.demo).toBe('created')
    expect(demo.created.demoNodes).toBe(4)
    expect(demo.created.demoUsers).toBe(2)
    expect(demo.created.userTypes).toBe(2)
    // org-manager with its six permissions and the manager's college/subtree
    // grant. No user type receives anything: what a kind of person may do is
    // decided entirely by the roles they hold.
    expect(demo.created.roles).toBe(1)
    expect(demo.created.rolePermissions).toBe(6)
    expect(demo.created.userTypeGrants).toBe(0)
    expect(demo.created.assignments).toBe(1)

    // The invariant both plugins can break, asked of the whole tenant at
    // once: every enabled person stands where their type permits, and a
    // system identity stands at the root. Checked here because this is the
    // one place a migration and a seed have both just run.
    const violations = await pool.query(`
      select count(*)::int as count
      from users u
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
      where not case
        when t.is_system then n.parent_id is null
        when t.placement_mode = 'unrestricted' then true
        else exists (
          select 1 from user_type_allowed_org_types a
          where a.tenant_id = u.tenant_id and a.user_type_id = u.user_type_id
            and a.org_type_id = n.org_type_id)
      end`)
    expect(violations.rows[0].count).toBe(0)

    // and every type says which of the two it means, rather than leaving it
    // to be inferred from whether a list happens to be empty
    const modes = await pool.query(
      `select code, placement_mode from user_types order by code`,
    )
    expect(modes.rows.map((row) => [row.code, row.placement_mode])).toEqual([
      ['faculty', 'allow-list'],
      ['student', 'allow-list'],
      ['system-account', 'allow-list'],
    ])

    const again = await inTransaction((client) =>
      seed(client, { ...ADMIN, demo: true, demoPassword: 'demo-test-password-1' }),
    )
    expect(again.created.demoNodes).toBe(0)
    expect(again.created.demoUsers).toBe(0)

    const depths = await pool.query(
      `select code, depth, nlevel(path) as levels from org_nodes order by path`,
    )
    expect(depths.rows.map((row) => [row.code, row.depth, Number(row.levels)])).toEqual([
      ['root', 0, 1],
      ['software-college', 1, 2],
      ['grade-2023', 2, 3],
      ['computer-science', 3, 4],
      ['class-2023-1', 4, 5],
    ])
  })

  it('fails loudly on stable platform semantics drift without partial writes', async () => {
    await pool.query(`update auth_providers set type = 'cas' where code = 'local'`)
    await expect(inTransaction((client) => seed(client, ADMIN))).rejects.toThrow(
      /seed drift: auth provider local/,
    )
    await pool.query(`update auth_providers set type = 'local' where code = 'local'`)
  })

  it('demands an admin password only when the admin must be created', async () => {
    // admin exists: no password needed at all
    const report = await inTransaction((client) => seed(client, {}))
    expect(report.admin).toBe('unchanged')
    // a fresh database without a password fails with a clear message
    await pool.query(`delete from user_identities where identifier = 'admin'`)
    await pool.query(`delete from users where display_name = '系统管理员'`)
    await expect(inTransaction((client) => seed(client, {}))).rejects.toThrow(
      /QUALY_ADMIN_PASSWORD/,
    )
    await inTransaction((client) => seed(client, ADMIN))
  })
})
