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

// Bindings take the place of identities, sessions learn the door they came
// in through, and a tenant keeps one password door. Every one of those is a
// data step over rows an earlier release wrote, so each is proved against
// that shape - including the one case the migration refuses to guess at.
const BINDINGS = '20260922164042_user-auth-bindings.sql'

type Db = Awaited<ReturnType<typeof createTestContext>>

/** a tenant as the release before bindings left it */
const oldTenant = async (db: Db, slug: string) => {
  const tenant = (
    await db.row<{ id: string }>(
      `insert into tenants (slug, name) values ($1, $1) returning id`,
      [slug],
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
  const system = (
    await db.row<{ id: string }>(
      `insert into user_types (tenant_id, code, name, placement_mode, is_system)
       values ($1, 'system-account', 'System', 'unrestricted', true) returning id`,
      [tenant],
    )
  ).id
  const admin = (
    await db.row<{ id: string }>(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Admin', $2, $3) returning id`,
      [tenant, system, root],
    )
  ).id
  return { tenant, admin }
}

const door = async (db: Db, tenant: string, code: string, isSystem: boolean) =>
  (
    await db.row<{ id: string }>(
      `insert into auth_providers (tenant_id, code, type, name, is_system)
       values ($1, $2, 'local', $2, $3) returning id`,
      [tenant, code, isSystem],
    )
  ).id

const identity = async (db: Db, tenant: string, user: string, provider: string, name: string) =>
  (
    await db.row<{ id: string }>(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
       values ($1, $2, $3, $4, 'digest') returning id`,
      [tenant, user, provider, name],
    )
  ).id

describe.runIf(postgresAvailable)('the user-auth-bindings migration', () => {
  it('renames identities to bindings, dates sessions by their door, and leaves one password door', async () => {
    const before = lineageBefore(BINDINGS, 'bindings-upgrade')
    const db = await createTestContext('bindings-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      // tenant one: the platform's door in use, a second password door nobody
      // uses, a session the sign-in record accounts for and one it does not
      const one = await oldTenant(db, 'one')
      const local = await door(db, one.tenant, 'local', true)
      await door(db, one.tenant, 'spare', false)
      const bound = await identity(db, one.tenant, one.admin, local, 'admin')
      const recorded = (
        await db.row<{ id: string }>(
          `insert into sessions (tenant_id, user_id, token_hash, expires_at)
           values ($1, $2, repeat('a', 64), now() + interval '1 day') returning id`,
          [one.tenant, one.admin],
        )
      ).id
      await db.row(
        `insert into sign_in_events (tenant_id, provider_id, provider_type, provider_code,
                                     user_id, identity_id, outcome, session_id)
         values ($1, $2, 'local', 'local', $3, $4, 'success', $5) returning id`,
        [one.tenant, local, one.admin, bound, recorded],
      )
      const unaccounted = (
        await db.row<{ id: string }>(
          `insert into sessions (tenant_id, user_id, token_hash, expires_at)
           values ($1, $2, repeat('b', 64), now() + interval '1 day') returning id`,
          [one.tenant, one.admin],
        )
      ).id
      // tenant two: no password door at all
      const two = await oldTenant(db, 'two')

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const binding = await db.row<{
        id: string
        subject: string | null
        credential_hash: string
        display_label: string | null
      }>(`select id, subject, credential_hash, display_label from user_auth_bindings where user_id = $1`, [
        one.admin,
      ])
      // same row, same credential; the sign-in name is gone, not moved
      expect(binding).toEqual({
        id: bound,
        subject: null,
        credential_hash: 'digest',
        display_label: null,
      })
      const email = await db.row<{ email: string | null }>(`select email from users where id = $1`, [
        one.admin,
      ])
      expect(email.email).toBeNull()
      const event = await db.row<{ binding_id: string }>(
        `select binding_id from sign_in_events where session_id = $1`,
        [recorded],
      )
      expect(event.binding_id).toBe(bound)
      const sessions = await db.query<{ id: string; auth_provider_id: string; auth_binding_id: string }>(
        `select id, auth_provider_id, auth_binding_id from sessions where tenant_id = $1`,
        [one.tenant],
      )
      // the accounted session names its door and binding; the other one ended
      expect(sessions.rows).toEqual([
        { id: recorded, auth_provider_id: local, auth_binding_id: bound },
      ])
      expect(sessions.rows.some((row) => row.id === unaccounted)).toBe(false)
      const doors = await db.query<{
        code: string
        is_system: boolean
        enabled: boolean
        deleted: boolean
      }>(
        `select code, is_system, enabled, deleted_at is not null as deleted
           from auth_providers where tenant_id = $1 order by code`,
        [one.tenant],
      )
      expect(doors.rows).toEqual([
        { code: 'local', is_system: true, enabled: true, deleted: false },
        // unused, so retired rather than kept as a second password door
        { code: 'spare', is_system: false, enabled: false, deleted: true },
      ])
      // a tenant without a password door is given the platform's one
      const provisioned = await db.query<{ code: string; type: string; is_system: boolean }>(
        `select code, type, is_system from auth_providers where tenant_id = $1`,
        [two.tenant],
      )
      expect(provisioned.rows).toEqual([{ code: 'local', type: 'local', is_system: true }])
      // and there is never a second one
      await expect(
        db.query(
          `insert into auth_providers (tenant_id, code, type, name, is_system)
           values ($1, 'another', 'local', 'Another', true)`,
          [two.tenant],
        ),
      ).rejects.toThrow(/uq_auth_providers_tenant_system_type/)
    } finally {
      await db.dispose()
    }
  })

  it('stops, naming the tenant and the door, when a second password door is in use', async () => {
    const before = lineageBefore(BINDINGS, 'bindings-refusal')
    const db = await createTestContext('bindings-refusal', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = await oldTenant(db, 'busy')
      await door(db, one.tenant, 'local', true)
      const staff = await door(db, one.tenant, 'staff-login', false)
      await identity(db, one.tenant, one.admin, staff, 'admin')
      await expect(
        runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] }),
      ).rejects.toThrow(/tenant busy has a second password door staff-login that is in use/)
    } finally {
      await db.dispose()
    }
  })
})

// An entrance's settings were written through the builder as a string for a
// json column, so the column encoded them a second time and the row held a
// json string. Nothing read them back until the settings screen did, which is
// what this migration repairs - over rows an earlier release wrote.

const CONFIG = '20260922174928_auth-provider-config-object.sql'

describe.runIf(postgresAvailable)('the entrance-settings migration', () => {
  it('turns settings a release stored as a json string back into an object', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, CONFIG))).toBe(true)
    const before = lineageBefore(CONFIG, 'config-upgrade')
    const db = await createTestContext('config-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('config', 'Config') returning id`,
        )
      ).id
      // what the old write path produced, and an entrance written correctly
      const doubled = (
        await db.row<{ id: string }>(
          `insert into auth_providers (tenant_id, code, type, name, config)
           values ($1, 'campus', 'campus', 'Campus', to_jsonb($2::text)) returning id`,
          [tenant, JSON.stringify({ server: 'https://cas.example.edu/' })],
        )
      ).id
      const plain = (
        await db.row<{ id: string }>(
          `insert into auth_providers (tenant_id, code, type, name, config)
           values ($1, 'other', 'campus', 'Other', $2::jsonb) returning id`,
          [tenant, JSON.stringify({ server: 'https://other.example.edu/' })],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const { rows } = await db.query<{ id: string; kind: string; server: string | null }>(
        `select id, jsonb_typeof(config) as kind, config ->> 'server' as server
           from auth_providers where tenant_id = $1 order by code`,
        [tenant],
      )
      expect(rows).toEqual([
        { id: doubled, kind: 'object', server: 'https://cas.example.edu/' },
        { id: plain, kind: 'object', server: 'https://other.example.edu/' },
      ])
    } finally {
      await db.dispose()
    }
  })
})
