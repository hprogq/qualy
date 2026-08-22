import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'

// The anchor-mode migration carries a data step - every tenant role's
// stand-in "allow-list over nothing" becomes null before the constraint
// lands that says it must be - and replaying the lineage into an empty
// database proves nothing about it. This builds the shape the step upgrades
// FROM and only then lets the migration run.

const TARGET = '20260822134000_tenant-role-anchor-null.sql'

describe.runIf(postgresAvailable)('the tenant-role-anchor-null migration', () => {
  it('nulls the stand-in policy before the constraint arrives', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, TARGET))).toBe(true)
    // the lineage up to, but not including, the migration under test; the
    // migrator's ledger makes the later full run apply exactly the remainder
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-anchor-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== TARGET) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('anchor-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('anchor-upgrade', 'Upgrade') returning id`,
        )
      ).id
      // the old shape: a tenant role wearing the allow-list that stood in
      // for "not applicable", and an org role whose policy is real
      await db.row(
        `insert into roles (tenant_id, code, name, kind, status, anchor_mode)
         values ($1, 'keeper', 'Keeper', 'tenant', 'active', 'allow-list') returning id`,
        [tenant],
      )
      const org = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status, anchor_mode)
           values ($1, 'warden', 'Warden', 'org', 'active', 'unrestricted') returning id`,
          [tenant],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const { rows } = await db.query<{ code: string; anchor_mode: string | null }>(
        `select code, anchor_mode from roles where tenant_id = $1 order by code`,
        [tenant],
      )
      expect(rows).toEqual([
        { code: 'keeper', anchor_mode: null },
        { code: 'warden', anchor_mode: 'unrestricted' },
      ])
      // and the constraint that makes the stand-in unwritable is really there
      await expect(
        db.row(
          `insert into roles (tenant_id, code, name, kind, status, anchor_mode)
           values ($1, 'stray', 'Stray', 'tenant', 'draft', 'allow-list') returning id`,
          [tenant],
        ),
      ).rejects.toThrow(/chk_roles_anchor_kind/)
      void org
    } finally {
      await db.dispose()
    }
  })
})
