import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@qualy/plugin-database/migrator'
import Database from '@qualy/plugin-database'
import Server from '@qualy/plugin-server'
import UiRegistry from '@qualy/plugin-ui-registry'
import Auth from '@qualy/plugin-auth'
import { hashPassword } from '../src/password.ts'
import * as authLocal from '../src/index.ts'

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
if (!available) console.warn('postgres unreachable, local login tests skipped')

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

const PRIMARY_PASSWORD = 'alice-primary-pass-1'
const SECONDARY_PASSWORD = 'alice-secondary-pass-1'

describe.runIf(available)('local login through the auth core', () => {
  const admin = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_authflow_${randomUUID().slice(0, 8)}`
  let pool: Pool
  let ctx: Context
  let base: string
  const ids = {
    tenant: '',
    root: '',
    memberType: '',
    noLoginType: '',
    primary: '',
    secondary: '',
    alice: '',
  }

  const login = (providerCode: string, identifier: string, password: string) =>
    fetch(`${base}/auth/local/${providerCode}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    })

  const me = (cookie?: string) => fetch(`${base}/auth/me`, { headers: cookie ? { cookie } : {} })

  const sessionCookieOf = (res: Response) => {
    const header = res.headers.get('set-cookie') ?? ''
    return header.split(';')[0] ?? ''
  }

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
    // two local provider instances plus a driverless cas row
    ids.primary = await row(
      `insert into auth_providers (tenant_id, code, type, name, sort_order)
       values ($1, 'local-primary', 'local', '本地账号', 10) returning id`,
      [ids.tenant],
    )
    ids.secondary = await row(
      `insert into auth_providers (tenant_id, code, type, name, sort_order)
       values ($1, 'local-secondary', 'local', '备用账号', 20) returning id`,
      [ids.tenant],
    )
    await pool.query(
      `insert into auth_providers (tenant_id, code, type, name, sort_order)
       values ($1, 'campus-cas', 'cas', '校园统一认证', 30)`,
      [ids.tenant],
    )
    ids.alice = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Alice', $2, $3) returning id`,
      [ids.tenant, ids.memberType, ids.root],
    )
    // the same identifier bound to both instances with different passwords
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, 'alice', $4)`,
      [ids.tenant, ids.alice, ids.primary, await hashPassword(PRIMARY_PASSWORD)],
    )
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, 'alice', $4)`,
      [ids.tenant, ids.alice, ids.secondary, await hashPassword(SECONDARY_PASSWORD)],
    )
    const bob = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Bob', $2, $3) returning id`,
      [ids.tenant, bobTypeId(), ids.root],
    )
    await pool.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, 'bob', $4)`,
      [ids.tenant, bob, ids.primary, await hashPassword(PRIMARY_PASSWORD)],
    )

    ctx = new Context()
    await ctx.plugin(Database, { url: url.href, migrations: 'off' })
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    await ctx.plugin(Auth, { defaultTenantSlug: 'flow' })
    await ctx.plugin(authLocal)
    base = `http://127.0.0.1:${ctx.server.port}/api`
  })

  function bobTypeId() {
    return ids.noLoginType
  }

  afterAll(async () => {
    await ctx?.fiber.dispose()
    await pool?.end()
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.end()
  })

  it('lists only methods whose driver plugin is active, sorted', async () => {
    const res = await fetch(`${base}/auth/methods`)
    expect(res.status).toBe(200)
    const { methods } = (await res.json()) as {
      methods: { code: string; mode: string; component?: string }[]
    }
    // the cas row exists in the database but no cas driver is installed
    expect(methods.map((method) => method.code)).toEqual(['local-primary', 'local-secondary'])
    // the driver owns its presentation: an embedded renderer component
    expect(methods[0]!.mode).toBe('component')
    expect(methods[0]!.component).toBe('auth-local/LoginMethod')
  })

  it('selects the provider instance by code', async () => {
    // each instance only accepts its own credential
    expect((await login('local-primary', 'alice', PRIMARY_PASSWORD)).status).toBe(200)
    expect((await login('local-secondary', 'alice', SECONDARY_PASSWORD)).status).toBe(200)
    expect((await login('local-primary', 'alice', SECONDARY_PASSWORD)).status).toBe(401)
    expect((await login('local-secondary', 'alice', PRIMARY_PASSWORD)).status).toBe(401)
    // unknown instance and a cas row through the local route are both refused
    expect((await login('nonexistent', 'alice', PRIMARY_PASSWORD)).status).toBe(401)
    expect((await login('campus-cas', 'alice', PRIMARY_PASSWORD)).status).toBe(401)
  })

  it('logs in with normalized identifier and http-only cookie, storing only the hash', async () => {
    const res = await login('local-primary', '  ALICE ', PRIMARY_PASSWORD)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('qualy_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const body = (await res.json()) as { user: Record<string, any> }
    expect(body.user.userType.code).toBe('member')
    expect(body.user.primaryOrgNode.code).toBe('root')
    expect(body.user.tenant.slug).toBe('flow')

    const raw = sessionCookieOf(res).split('=')[1]!
    const stored = await pool.query(
      `select token_hash from sessions order by created_at desc limit 1`,
    )
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.rows[0].token_hash).not.toBe(raw)
  })

  it('answers one uniform 401 for every login failure', async () => {
    for (const [identifier, password] of [
      ['alice', 'wrong-password-000'],
      ['ghost', PRIMARY_PASSWORD],
      ['bob', PRIMARY_PASSWORD], // user type forbids local login
    ] as const) {
      const res = await login('local-primary', identifier, password)
      expect(res.status).toBe(401)
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_CREDENTIALS')
    }
  })

  it('serves /auth/me and expires sessions with cleanup', async () => {
    await pool.query(`delete from sessions`)
    const cookie = sessionCookieOf(await login('local-primary', 'alice', PRIMARY_PASSWORD))
    expect((await me(cookie)).status).toBe(200)
    expect((await me()).status).toBe(401)

    await pool.query(`update sessions set expires_at = now() - interval '1 minute'`)
    const expired = await me(cookie)
    expect(expired.status).toBe(401)
    expect(((await expired.json()) as { code: string }).code).toBe('SESSION_EXPIRED')
    expect(expired.headers.get('set-cookie')).toContain('qualy_session=;')
    expect(Number((await pool.query(`select count(*) from sessions`)).rows[0].count)).toBe(0)
  })

  it('revokes sessions when user, user type, tenant or provider state changes', async () => {
    const cookie = sessionCookieOf(await login('local-primary', 'alice', PRIMARY_PASSWORD))
    const expect401 = async () => expect((await me(cookie)).status).toBe(401)

    await pool.query(`update users set enabled = false where id = $1`, [ids.alice])
    await expect401()
    await pool.query(`update users set enabled = true where id = $1`, [ids.alice])

    await pool.query(`update user_types set enabled = false where id = $1`, [ids.memberType])
    await expect401()
    await pool.query(`update user_types set enabled = true where id = $1`, [ids.memberType])

    await pool.query(`update tenants set enabled = false where id = $1`, [ids.tenant])
    await expect401()
    expect((await login('local-primary', 'alice', PRIMARY_PASSWORD)).status).toBe(401)
    await pool.query(`update tenants set enabled = true where id = $1`, [ids.tenant])

    // a disabled provider blocks new logins but existing sessions live on
    await pool.query(`update auth_providers set enabled = false where id = $1`, [ids.primary])
    expect((await login('local-primary', 'alice', PRIMARY_PASSWORD)).status).toBe(401)
    expect((await me(cookie)).status).toBe(200)
    await pool.query(`update auth_providers set enabled = true where id = $1`, [ids.primary])
  })

  it('logs out idempotently and clears the cookie', async () => {
    const cookie = sessionCookieOf(await login('local-primary', 'alice', PRIMARY_PASSWORD))
    const first = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })
    expect(first.status).toBe(200)
    expect(first.headers.get('set-cookie')).toContain('qualy_session=;')
    expect((await me(cookie)).status).toBe(401)
    const second = await fetch(`${base}/auth/logout`, { method: 'POST' })
    expect(((await second.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('drops login methods when a driver deactivates, keeping the rows', async () => {
    const scoped = ctx.plugin({
      name: 'driver-probe',
      inject: ['auth'],
      apply: (child: Context) => {
        child.auth.registerProviderType({
          type: 'probe',
          describe: (provider) => ({
            mode: 'redirect',
            href: `/api/auth/probe/${provider.code}/start`,
          }),
        })
      },
    })
    await scoped
    await pool.query(
      `insert into auth_providers (tenant_id, code, type, name) values ($1, 'probe-x', 'probe', 'P')`,
      [ids.tenant],
    )
    let res = (await (await fetch(`${base}/auth/methods`)).json()) as {
      methods: { code: string }[]
    }
    expect(res.methods.map((method) => method.code)).toContain('probe-x')
    await scoped.dispose()
    res = (await (await fetch(`${base}/auth/methods`)).json()) as { methods: { code: string }[] }
    expect(res.methods.map((method) => method.code)).not.toContain('probe-x')
    await pool.query(`delete from auth_providers where code = 'probe-x'`)
  })

  it('drops methods whose driver returns a non-relative redirect target', async () => {
    const scoped = ctx.plugin({
      name: 'evil-driver-probe',
      inject: ['auth'],
      apply: (child: Context) => {
        child.auth.registerProviderType({
          type: 'evil',
          describe: () => ({ mode: 'redirect', href: 'https://evil.example/phish' }),
        })
      },
    })
    await scoped
    await pool.query(
      `insert into auth_providers (tenant_id, code, type, name) values ($1, 'evil-x', 'evil', 'E')`,
      [ids.tenant],
    )
    const res = (await (await fetch(`${base}/auth/methods`)).json()) as {
      methods: { code: string }[]
    }
    expect(res.methods.map((method) => method.code)).not.toContain('evil-x')
    await scoped.dispose()
    await pool.query(`delete from auth_providers where code = 'evil-x'`)
  })
})
