import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@qualy/plugin-database/migrator'
import Database from '@qualy/plugin-database'
import Server from '@qualy/plugin-server'
import UiRegistry from '@qualy/plugin-ui-registry'
import { hashPassword } from '../src/password.ts'
import * as auth from '../src/index.ts'

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
if (!available) console.warn('postgres unreachable, auth tests skipped')

const PASSWORD = 'alice-password-123'

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('auth', () => {
  const admin = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_auth_${randomUUID().slice(0, 8)}`
  let pool: Pool
  let ctx: Context
  let base: string
  const ids = {
    tenant: '',
    otherTenant: '',
    root: '',
    memberType: '',
    noLoginType: '',
    provider: '',
    alice: '',
  }

  const login = (identifier: string, password: string) =>
    fetch(`${base}/auth/local/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    })

  const me = (cookie?: string) => fetch(`${base}/auth/me`, { headers: cookie ? { cookie } : {} })

  const sessionCookieOf = (res: Response) => {
    const header = res.headers.get('set-cookie') ?? ''
    return header.split(';')[0] ?? ''
  }

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
    ids.tenant = await row(
      `insert into tenants (slug, name) values ('flow', 'Flow') returning id`,
      [],
    )
    ids.otherTenant = await row(
      `insert into tenants (slug, name) values ('other', 'Other') returning id`,
      [],
    )
    const orgType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'unit', 'U') returning id`,
      [ids.tenant],
    )
    ids.root = await row(
      `insert into org_nodes (tenant_id, org_type_id, code, name, path, depth)
       values ($1, $2, 'root', 'Flow Root', 'flowroot', 0) returning id`,
      [ids.tenant, orgType],
    )
    ids.memberType = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login) values ($1, 'member', '成员', true) returning id`,
      [ids.tenant],
    )
    ids.noLoginType = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login) values ($1, 'nologin', '禁登录', false) returning id`,
      [ids.tenant],
    )
    ids.provider = await row(
      `insert into auth_providers (tenant_id, code, type, name) values ($1, 'local', 'local', '本地') returning id`,
      [ids.tenant],
    )
    const hash = await hashPassword(PASSWORD)
    ids.alice = await row(
      `insert into users (tenant_id, business_no, display_name, user_type_id, primary_org_node_id)
       values ($1, 'a-001', 'Alice', $2, $3) returning id`,
      [ids.tenant, ids.memberType, ids.root],
    )
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, 'alice', $4)`,
      [ids.tenant, ids.alice, ids.provider, hash],
    )
    const bob = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Bob', $2, $3) returning id`,
      [ids.tenant, ids.noLoginType, ids.root],
    )
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, 'bob', $4)`,
      [ids.tenant, bob, ids.provider, hash],
    )

    ctx = new Context()
    await ctx.plugin(Database, { url: url.href, migrations: 'off' })
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    await ctx.plugin(auth, { defaultTenantSlug: 'flow' })
    base = `http://127.0.0.1:${ctx.server.port}/api`
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    await pool?.end()
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.end()
  })

  it('keeps the tenant boundary inside the database', async () => {
    // a user of tenant A cannot reference tenant B's user type or org node
    expect(
      await pgCode(
        pool.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'X', $2, $3)`,
          [ids.otherTenant, ids.memberType, ids.root],
        ),
      ),
    ).toBe('23503')
    // duplicate identifier under one provider conflicts, business numbers are
    // tenant-scoped
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

  it('logs in with normalized identifier and http-only session cookie', async () => {
    const res = await login('  ALICE ', PASSWORD)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('qualy_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const body = (await res.json()) as { user: Record<string, any> }
    expect(body.user.displayName).toBe('Alice')
    expect(body.user.businessNo).toBe('a-001')
    expect(body.user.userType.code).toBe('member')
    expect(body.user.primaryOrgNode.code).toBe('root')
    expect(body.user.tenant.slug).toBe('flow')

    // the database stores only the sha256, never the raw token
    const raw = sessionCookieOf(res).split('=')[1]!
    const stored = await pool.query(`select token_hash from sessions where user_id = $1`, [
      ids.alice,
    ])
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.rows[0].token_hash).not.toBe(raw)
  })

  it('answers one uniform 401 for every login failure', async () => {
    for (const [identifier, password] of [
      ['alice', 'wrong-password-000'],
      ['ghost', PASSWORD],
      ['bob', PASSWORD], // user type forbids local login
    ] as const) {
      const res = await login(identifier, password)
      expect(res.status).toBe(401)
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_CREDENTIALS')
    }
  })

  it('serves /auth/me with a valid cookie and 401 without', async () => {
    const cookie = sessionCookieOf(await login('alice', PASSWORD))
    const ok = await me(cookie)
    expect(ok.status).toBe(200)
    const anonymous = await me()
    expect(anonymous.status).toBe(401)
    expect(((await anonymous.json()) as { code: string }).code).toBe('AUTH_REQUIRED')
  })

  it('expires sessions, deletes the row and reports SESSION_EXPIRED', async () => {
    await pool.query(`delete from sessions`)
    const cookie = sessionCookieOf(await login('alice', PASSWORD))
    await pool.query(`update sessions set expires_at = now() - interval '1 minute'`)
    const res = await me(cookie)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('SESSION_EXPIRED')
    expect(res.headers.get('set-cookie')).toContain('qualy_session=;')
    const rows = await pool.query(`select count(*) from sessions`)
    expect(Number(rows.rows[0].count)).toBe(0)
  })

  it('revokes existing sessions when user, user type or tenant is disabled', async () => {
    const cookie = sessionCookieOf(await login('alice', PASSWORD))
    const expect401 = async () => expect((await me(cookie)).status).toBe(401)

    await pool.query(`update users set enabled = false where id = $1`, [ids.alice])
    await expect401()
    await pool.query(`update users set enabled = true where id = $1`, [ids.alice])

    await pool.query(`update user_types set enabled = false where id = $1`, [ids.memberType])
    await expect401()
    await pool.query(`update user_types set enabled = true where id = $1`, [ids.memberType])

    await pool.query(`update tenants set enabled = false where id = $1`, [ids.tenant])
    await expect401()
    expect((await login('alice', PASSWORD)).status).toBe(401)
    await pool.query(`update tenants set enabled = true where id = $1`, [ids.tenant])

    await pool.query(`update tenants set expires_at = now() - interval '1 day' where id = $1`, [
      ids.tenant,
    ])
    await expect401()
    await pool.query(`update tenants set expires_at = null where id = $1`, [ids.tenant])

    expect((await me(cookie)).status).toBe(200)
  })

  it('rejects logins while the provider is disabled', async () => {
    await pool.query(`update auth_providers set enabled = false where id = $1`, [ids.provider])
    expect((await login('alice', PASSWORD)).status).toBe(401)
    await pool.query(`update auth_providers set enabled = true where id = $1`, [ids.provider])
  })

  it('logs out idempotently and clears the cookie', async () => {
    const cookie = sessionCookieOf(await login('alice', PASSWORD))
    const first = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })
    expect(first.status).toBe(200)
    expect(first.headers.get('set-cookie')).toContain('qualy_session=;')
    expect((await me(cookie)).status).toBe(401)
    const second = await fetch(`${base}/auth/logout`, { method: 'POST' })
    expect(((await second.json()) as { ok: boolean }).ok).toBe(true)
  })
})
