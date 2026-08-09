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
