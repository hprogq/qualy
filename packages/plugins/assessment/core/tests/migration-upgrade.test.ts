import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'

// The scope migration carries a data step - every batch's single scope node
// moves into batch_scope_nodes before the columns drop - and replaying the
// lineage into an empty database proves nothing about it. This builds the
// shape the step upgrades FROM, puts a live batch in it, and only then lets
// the migration run.

const TARGET = '20260809085658_batch-scope-node-set.sql'

describe.runIf(postgresAvailable)('the batch-scope-node-set migration', () => {
  it('carries an existing batch scope into the join table before dropping it', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, TARGET))).toBe(true)
    // the lineage up to, but not including, the migration under test; the
    // migrator's ledger makes the later full run apply exactly the remainder
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-scope-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== TARGET) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('scope-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('upgrade', 'Upgrade') returning id`,
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, code, name) values ($1, 'college', 'College') returning id`,
          [tenant],
        )
      ).id
      const node = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'College', 'upg', 0) returning id`,
          [tenant, orgType],
        )
      ).id
      const batch = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, scope_node_id, scope_path, material_range)
           values ($1, 'Old shape', $2, 'upg', daterange('2026-03-01', '2026-09-01')) returning id`,
          [tenant, node],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const moved = await db.row<{ node_id: string }>(
        `select node_id from batch_scope_nodes where tenant_id = $1 and batch_id = $2`,
        [tenant, batch],
      )
      expect(moved.node_id).toBe(node)
      const leftover = await db.query(
        `select column_name from information_schema.columns
         where table_name = 'assessment_batches' and column_name in ('scope_node_id', 'scope_path')`,
      )
      expect(leftover.rows).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

// Taking the participant actions out of the rbac catalog leaves rows behind:
// a role somebody had already ticked "submit an entry" on, and the catalog
// entries themselves. Replaying the lineage into an empty database proves
// nothing about either, because neither was ever inserted there.

const CLEANUP = '20260811225407_drop-participant-action-permissions.sql'

describe.runIf(postgresAvailable)('the participant-action cleanup migration', () => {
  it('takes the codes off the roles that had them, and out of the catalog', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, CLEANUP))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-participant-actions-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== CLEANUP) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('participant-action-cleanup', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('cleanup', 'Cleanup') returning id`,
        )
      ).id
      // the world as it was: the code in the catalog, and a role carrying it
      const permission = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.entry.submit', 'assessment', 'Submit', 'tenant') returning id`,
        )
      ).id
      const kept = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.review.process', 'assessment', 'Review', 'org-node') returning id`,
        )
      ).id
      const role = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode)
           values ($1, 'reviewer', 'Reviewer', 'org', 'active', 'explicit') returning id`,
          [tenant],
        )
      ).id
      for (const id of [permission, kept]) {
        await db.query(
          `insert into role_permissions (tenant_id, role_id, permission_id) values ($1, $2, $3)`,
          [tenant, role, id],
        )
      }

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const codes = await db.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
          where rp.role_id = $1`,
        [role],
      )
      // the grant is gone, and so is the code nobody may grant any more
      expect(codes.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
      // the catalog row is gone too, so the tenant administrator - who holds
      // every active definition by definition - stops holding this one
      const left = await db.query<{ code: string }>(
        `select code from permissions where plugin = 'assessment' order by code`,
      )
      expect(left.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
    } finally {
      await db.dispose()
    }
  })
})
