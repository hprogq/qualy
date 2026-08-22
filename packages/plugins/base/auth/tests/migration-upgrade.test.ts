import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'

// The audience migration carries a data step - each local provider inherits
// the old per-type password flags as its own allow-list - and replaying the
// lineage into an empty database proves nothing about it. This builds the
// old shape, with one type allowed and one shut out, and only then lets the
// migration run.

const AUDIENCE = '20260822150000_provider-audience.sql'
const DROP = '20260822150100_login-flags-drop.sql'

describe.runIf(postgresAvailable)('the provider-audience migration', () => {
  it('inherits the password flags as the local door audience', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, AUDIENCE))).toBe(true)
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, DROP))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-audience-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file < AUDIENCE) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('audience-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('audience', 'Audience') returning id`,
        )
      ).id
      const open = (
        await db.row<{ id: string }>(
          `insert into user_types (tenant_id, code, name, placement_mode, allow_local_login)
           values ($1, 'staff', 'Staff', 'unrestricted', true) returning id`,
          [tenant],
        )
      ).id
      await db.row(
        `insert into user_types (tenant_id, code, name, placement_mode, allow_local_login)
         values ($1, 'guest', 'Guest', 'unrestricted', false) returning id`,
        [tenant],
      )
      const provider = (
        await db.row<{ id: string }>(
          `insert into auth_providers (tenant_id, code, type, name)
           values ($1, 'local', 'local', 'Local') returning id`,
          [tenant],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      // the local door narrowed to exactly the types the flags admitted
      const mode = await db.row<{ audience_mode: string }>(
        `select audience_mode from auth_providers where id = $1`,
        [provider],
      )
      expect(mode.audience_mode).toBe('allow-list')
      const { rows: admitted } = await db.query<{ user_type_id: string }>(
        `select user_type_id from auth_provider_user_types
         where tenant_id = $1 and auth_provider_id = $2`,
        [tenant, provider],
      )
      expect(admitted.map((row) => row.user_type_id)).toEqual([open])
      // and the flags themselves are gone
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'user_types' and column_name like 'allow%'`,
      )
      expect(columns.rows).toEqual([])
    } finally {
      await db.dispose()
    }
  })
})
