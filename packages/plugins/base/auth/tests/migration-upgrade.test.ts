import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, lineageBefore, postgresAvailable } from '@qualy/plugin-database/testkit'
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
    const before = lineageBefore(AUDIENCE, 'audience-upgrade')
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

// Deletion became final: the migration that says so frees what a deleted
// person held and retires the permission to bring them back. Both are data
// steps over rows an earlier release wrote, so they are proved against that
// shape: a tombstone holding a number, and a role with the restore code
// ticked.
const TERMINAL = '20260922161147_user-terminal-delete.sql'

describe.runIf(postgresAvailable)('the terminal-delete migration', () => {
  it('frees a deleted person’s number and retires the restore permission', async () => {
    const before = lineageBefore(TERMINAL, 'terminal-delete-upgrade')
    const db = await createTestContext('terminal-delete-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('terminal', 'Terminal') returning id`,
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'U') returning id`,
          [tenant],
        )
      ).id
      const root = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'Root', 'r', 0) returning id`,
          [tenant, orgType],
        )
      ).id
      const staff = (
        await db.row<{ id: string }>(
          `insert into user_types (tenant_id, code, name, placement_mode)
           values ($1, 'staff', 'Staff', 'unrestricted') returning id`,
          [tenant],
        )
      ).id
      await db.row(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id,
                            business_no, enabled, deleted_at)
         values ($1, 'Gone', $2, $3, '20240001', false, now()) returning id`,
        [tenant, staff, root],
      )
      // the old index: the tombstone still holds the number
      await expect(
        db.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
           values ($1, 'Next', $2, $3, '20240001')`,
          [tenant, staff, root],
        ),
      ).rejects.toThrow()
      const permission = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('auth.user.restore', 'auth', 'restore', 'org-node')
           on conflict (code) do update set code = excluded.code returning id`,
        )
      ).id
      const role = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
           values ($1, 'desk', 'Desk', 'org', 'active', 'explicit', 'unrestricted') returning id`,
          [tenant],
        )
      ).id
      await db.row(
        `insert into role_permissions (tenant_id, role_id, permission_id)
         values ($1, $2, $3) returning role_id`,
        [tenant, role, permission],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const left = await db.query<{ code: string }>(
        `select code from permissions where code = 'auth.user.restore'`,
      )
      expect(left.rows).toEqual([])
      const ticked = await db.query(`select 1 from role_permissions where role_id = $1`, [role])
      expect(ticked.rows).toEqual([])
      // the living take the number again, and only one of them may
      await db.row(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id,
                            business_no, email)
         values ($1, 'Next', $2, $3, '20240001', 'next@school.edu') returning id`,
        [tenant, staff, root],
      )
      await expect(
        db.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, business_no)
           values ($1, 'Third', $2, $3, '20240001')`,
          [tenant, staff, root],
        ),
      ).rejects.toThrow(/uq_users_tenant_business_no/)
      // an address is stored in one spelling or not at all
      await expect(
        db.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
           values ($1, 'Loud', $2, $3, 'Loud@School.edu')`,
          [tenant, staff, root],
        ),
      ).rejects.toThrow(/chk_users_email_normalized/)
    } finally {
      await db.dispose()
    }
  })
})
