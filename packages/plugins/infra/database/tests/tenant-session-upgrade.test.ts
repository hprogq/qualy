import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'
import { runMigrations } from '../src/migrator.ts'

const lineage = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))
const migration = '20261110122501.sql'

describe.runIf(postgresAvailable)('tenant session lifecycle upgrade', () => {
  it('revokes existing disabled-tenant sessions and serializes old writers with disable', async () => {
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-tenant-prefix-'))
    for (const name of fs
      .readdirSync(lineage)
      .filter((name) => name.endsWith('.sql') && name !== migration)) {
      fs.copyFileSync(path.join(lineage, name), path.join(prefix, name))
    }
    const db = await createTestContext('tenant-session-upgrade', { migrationsFolder: prefix })
    const pool = new Pool({ connectionString: db.url })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          "insert into tenants (slug, name) values ('upgrade', 'Upgrade') returning id",
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          "insert into org_types (tenant_id, name) values ($1, 'Org') returning id",
          [tenant],
        )
      ).id
      const org = (
        await db.row<{ id: string }>(
          "insert into org_nodes (tenant_id, org_type_id, name, path, depth) values ($1, $2, 'Root', 'r', 0) returning id",
          [tenant, orgType],
        )
      ).id
      const type = (
        await db.row<{ id: string }>(
          "insert into user_types (tenant_id, code, name, placement_mode) values ($1, 'staff', 'Staff', 'unrestricted') returning id",
          [tenant],
        )
      ).id
      const user = (
        await db.row<{ id: string }>(
          "insert into users (tenant_id, display_name, user_type_id, primary_org_node_id) values ($1, 'Ada', $2, $3) returning id",
          [tenant, type, org],
        )
      ).id
      const provider = (
        await db.row<{ id: string }>(
          "insert into auth_providers (tenant_id, code, type, name) values ($1, 'local', 'local', 'Local') returning id",
          [tenant],
        )
      ).id
      const insert =
        "insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')"
      const args = (token: string) => [tenant, user, provider, token]
      const count = async () =>
        Number(
          (
            await db.row<{ count: number }>(
              'select count(*)::int as count from sessions where tenant_id = $1',
              [tenant],
            )
          ).count,
        )
      await db.query(insert, args('before-upgrade'))
      await db.query('update tenants set enabled = false where id = $1', [tenant])
      await runMigrations(db.url, { folder: lineage, entities: [] })
      expect(await count()).toBe(0)
      await db.query('update tenants set enabled = true where id = $1', [tenant])
      await db.query(insert, args('rollback'))
      const rollback = await pool.connect()
      try {
        await rollback.query('begin')
        await rollback.query('update tenants set enabled = false where id = $1', [tenant])
        expect(
          (
            await rollback.query(
              'select count(*)::int as count from sessions where tenant_id = $1',
              [tenant],
            )
          ).rows[0].count,
        ).toBe(0)
        await rollback.query('rollback')
      } finally {
        rollback.release()
      }
      expect(await count()).toBe(1)
      await db.query('update tenants set enabled = false where id = $1', [tenant])
      await db.query('update tenants set enabled = true where id = $1', [tenant])
      expect(await count()).toBe(0)

      // A pre-upgrade writer takes only KEY SHARE, like the older application.
      const old = await pool.connect()
      const admin = await pool.connect()
      try {
        const oldPid = (await old.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!
          .pid
        const adminPid = (await admin.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]!.pid
        const blockedBy = async (blocked: number, blocker: number) => {
          let blockers: number[] = []
          for (let attempt = 0; attempt < 100; attempt++) {
            blockers = (
              await db.row<{ blockers: number[] }>('select pg_blocking_pids($1) as blockers', [
                blocked,
              ])
            ).blockers
            if (blockers.includes(blocker)) break
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
          expect(blockers).toContain(blocker)
        }
        await old.query('begin')
        await old.query('select id from tenants where id = $1 for key share', [tenant])
        await admin.query('begin')
        await admin.query('update tenants set enabled = false where id = $1', [tenant])
        const pending = old.query(insert, args('old-after-disable'))
        // The database may reject immediately after commit, before this
        // test reaches its assertion. Keep the original promise observed.
        void pending.catch(() => {})
        await blockedBy(oldPid, adminPid)
        await admin.query('commit')
        await expect(pending).rejects.toMatchObject({ code: '23514' })
        await old.query('rollback')
        expect(await count()).toBe(0)
        await db.query('update tenants set enabled = true where id = $1', [tenant])
        await old.query('begin')
        await old.query('select id from tenants where id = $1 for key share', [tenant])
        await old.query(insert, args('old-before-disable'))
        await admin.query('begin')
        const disabled = admin.query('update tenants set enabled = false where id = $1', [tenant])
        void disabled.catch(() => {})
        await blockedBy(adminPid, oldPid)
        await old.query('commit')
        await disabled
        await admin.query('commit')
        expect(await count()).toBe(0)
      } finally {
        old.release()
        admin.release()
      }
    } finally {
      await pool.end()
      await db.dispose()
      fs.rmSync(prefix, { recursive: true, force: true })
    }
  }, 120_000)
})
