import { manifestPath } from '../lib/manifest.ts'
import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../fixtures/seed.ts'
import { resolvePluginModuleUrl } from '@qualy/assembly/host'
import { testDatabaseUrl } from '@qualy/plugin-database/testkit'

// the same server the testkit uses: this suite builds scratch databases too
const baseUrl = testDatabaseUrl

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
    const { runMigrations, MIGRATIONS_FOLDER } = (await import(
      resolvePluginModuleUrl('@qualy/plugin-database/migrator', manifestPath())
    )) as typeof import('../../packages/plugins/infra/database/src/migrator.ts')
    // the lineage is plain sql; the orm the migrator opens needs no entity
    // metadata to apply it, which is also how a deployment job runs it
    await runMigrations(url.href, { folder: MIGRATIONS_FOLDER, entities: [] })
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
      // the whole preset structure: the root's own type, no rules, one node.
      // The university vocabulary moved into the demo, where an example
      // belongs; a real tenant names its own kinds of organization.
      orgTypes: 1,
      rules: 0,
      root: 1,
      userTypes: 1,
      provider: 1,
      // the catalogue, the canonical tenant-admin role and the one grant
      // that hands it to the recovery account. The role maps no permissions
      // of its own: it reaches every active capability by mode rather than
      // by a mapping that a new plugin would have to backfill. Nothing is
      // granted to a user type, because a type confers no authority at all.
      permissions: 27,
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
    // the root type's name is a default, not an identity: the root is found
    // by structure, so renaming the type must not make the seed recreate it
    await pool.query(`update org_types set name = '集团'`)
    await pool.query(`update org_nodes set name = '改名大学' where parent_id is null`)
    const report = await inTransaction((client) => seed(client, ADMIN))
    expect(Object.values(report.created).every((count) => count === 0)).toBe(true)
    const renamed = await pool.query(`select name from org_types`)
    expect(renamed.rows.map((row) => row.name)).toEqual(['集团'])
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
      resolvePluginModuleUrl('@qualy/plugin-auth-local/password', manifestPath())
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
    // the example brings its own vocabulary: four types, their chain, and
    // the rule hanging the college under whatever the root stands on
    expect(demo.created.orgTypes).toBe(4)
    expect(demo.created.rules).toBe(4)
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
    const modes = await pool.query(`select code, placement_mode from user_types order by code`)
    expect(modes.rows.map((row) => [row.code, row.placement_mode])).toEqual([
      ['faculty', 'allow-list'],
      ['student', 'allow-list'],
      // the system identity is pinned to the root by rule, not by a stored
      // allow-list that nothing consults
      ['system-account', 'unrestricted'],
    ])

    const again = await inTransaction((client) =>
      seed(client, { ...ADMIN, demo: true, demoPassword: 'demo-test-password-1' }),
    )
    expect(again.created.demoNodes).toBe(0)
    expect(again.created.demoUsers).toBe(0)

    const depths = await pool.query(
      `select name, depth, nlevel(path) as levels from org_nodes order by path`,
    )
    expect(depths.rows.map((row) => [row.name, row.depth, Number(row.levels)])).toEqual([
      ['改名大学', 0, 1],
      ['软件学院', 1, 2],
      ['2023级', 2, 3],
      ['计算机科学与技术', 3, 4],
      ['软件2023级1班', 4, 5],
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
