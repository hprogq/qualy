import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'

// The upgrade a database that already holds formulas actually takes.
//
// Two things have to survive it and one has to disappear. What survives is
// the formulas themselves and the authorship that was always recorded
// beside them; what disappears is the owning node and the permission that
// belonged to the model it served. The permission is the part worth a
// suite: rbac only ever inserts codes, so a retired one lives on in every
// role that had it ticked, and a stale grant reads as a promise.
//
// What must NOT happen is a carry-over. The old code was org-node scoped
// and meant "administer this unit's formulas"; the new one is tenant-wide
// and means "may write formulas of your own". Turning one into the other
// would hand somebody authority nobody granted.

/**
 * The lineage up to, but not including, one migration - which the migrator's
 * ledger then completes with exactly the remainder.
 *
 * Everything that sorts BEFORE the target, not "everything except it": a
 * suite written the second way passes only while its target happens to be
 * the newest file in the folder, and quietly starts applying the lineage out
 * of order the day another migration lands after it.
 */
const lineageBefore = (target: string, label: string): string => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `qualy-${label}-`))
  for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
    if (file.endsWith('.sql') && file < target) {
      fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(folder, file))
    }
  }
  return folder
}

const OWNERSHIP = '20260901014046_formula-author-ownership.sql'
const SHARING = '20260901064240_formula-version-sharing.sql'

describe.runIf(postgresAvailable)('the formula author-ownership migration', () => {
  it('drops the owning node, retires its permission, and keeps every author', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, OWNERSHIP))).toBe(true)
    const before = lineageBefore(OWNERSHIP, 'formula-ownership')
    const db = await createTestContext('formula-ownership-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenantId = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('own-up', 'Own') returning id`,
        )
      ).id
      const orgTypeId = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
          [tenantId],
        )
      ).id
      const nodeId = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'Root', 'own_up', 0) returning id`,
          [tenantId, orgTypeId],
        )
      ).id
      const userTypeId = (
        await db.row<{ id: string }>(
          `insert into user_types (tenant_id, code, name, placement_mode)
           values ($1, 'staff', 'Staff', 'unrestricted') returning id`,
          [tenantId],
        )
      ).id
      const authorId = (
        await db.row<{ id: string }>(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'Author', $2, $3) returning id`,
          [tenantId, userTypeId, nodeId],
        )
      ).id

      // a formula in the OLD shape: owned by a node, written by a person
      const functionId = (
        await db.row<{ id: string }>(
          `insert into assessment_formula_functions
             (tenant_id, owner_node_id, name, draft_source_ts, draft_tests, created_by, updated_by)
           values ($1, $2, 'Kept', 'export {}', '[]'::jsonb, $3, $3) returning id`,
          [tenantId, nodeId, authorId],
        )
      ).id

      // a role holding the doomed code, and one holding a keeper beside it
      const roleId = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status)
           values ($1, 'formula-admin', 'Formula admin', 'tenant', 'active') returning id`,
          [tenantId],
        )
      ).id
      for (const code of ['assessment.formula.manage', 'assessment.batch.manage']) {
        await db.query(
          `insert into permissions (code, plugin, name, target_kind)
           values ($1, 'assessment-formula', $1, 'org-node') on conflict (code) do nothing`,
          [code],
        )
        await db.query(
          `insert into role_permissions (tenant_id, role_id, permission_id)
           select $1, $2, p.id from permissions p where p.code = $3`,
          [tenantId, roleId, code],
        )
      }
      // the two assessment tables that copy a code as text and never cascade
      const batchId = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, material_range)
           values ($1, 'Round', daterange('2026-03-01','2026-09-01')) returning id`,
          [tenantId],
        )
      ).id
      const sourceId = (
        await db.row<{ id: string }>(
          `insert into batch_access_sources
             (tenant_id, batch_id, role_assignment_id, subject_id, origin)
           values ($1, $2, $3, $4, 'inherited') returning id`,
          [tenantId, batchId, roleId, authorId],
        )
      ).id
      await db.query(
        `insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
         values ($1, $2, 'assessment.formula.manage')`,
        [tenantId, sourceId],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      // the column is gone, and the index that replaced it is really there
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'assessment_formula_functions'`,
      )
      expect(columns.rows.map((row) => row.column_name)).not.toContain('owner_node_id')
      const indexes = await db.query<{ indexname: string }>(
        `select indexname from pg_indexes where tablename = 'assessment_formula_functions'`,
      )
      expect(indexes.rows.map((row) => row.indexname)).toContain(
        'idx_assessment_formula_functions_tenant_author_updated',
      )

      // the formula and its author are untouched: authorship was always
      // recorded, and this migration only stops pretending a node owned it
      const kept = await db.row<{ name: string; created_by: string }>(
        `select name, created_by from assessment_formula_functions where id = $1`,
        [functionId],
      )
      expect(kept).toEqual({ name: 'Kept', created_by: authorId })

      // the retired code is gone from the catalog and from the role, and
      // nothing was granted in its place
      const codes = await db.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
         where rp.tenant_id = $1 and rp.role_id = $2 order by p.code`,
        [tenantId, roleId],
      )
      expect(codes.rows.map((row) => row.code)).toEqual(['assessment.batch.manage'])
      const catalogued = await db.query<{ code: string }>(
        `select code from permissions where code = 'assessment.formula.manage'`,
      )
      expect(catalogued.rows).toEqual([])
      const copied = await db.query<{ permission_code: string }>(
        `select permission_code from batch_access_source_permissions where tenant_id = $1`,
        [tenantId],
      )
      expect(copied.rows).toEqual([])
    } finally {
      await db.dispose()
    }
  }, 180_000)
})

// Offering a version to an audience, and where a fork came from.
//
// The part worth a suite is what the new edges do when the world moves
// under them. An audience names a unit; a unit can be dissolved, and when
// it is, the offer it carried is not a fact worth keeping - while the
// version it pointed at is a permanent publication and must not move at
// all. Those two lifetimes meet on one row, which is exactly where a
// cascade rule gets written the wrong way round.
describe.runIf(postgresAvailable)('the formula version-sharing migration', () => {
  it('adds an audience nobody has yet, and lets a unit go without taking the version', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, SHARING))).toBe(true)
    const before = lineageBefore(SHARING, 'formula-sharing')
    const db = await createTestContext('formula-sharing-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenantId = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('share-up', 'Share') returning id`,
        )
      ).id
      const orgTypeId = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
          [tenantId],
        )
      ).id
      const rootId = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'Root', 'share_up', 0) returning id`,
          [tenantId, orgTypeId],
        )
      ).id
      const collegeId = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
           values ($1, $2, $3, 'College', 'share_up.a', 1) returning id`,
          [tenantId, orgTypeId, rootId],
        )
      ).id
      const userTypeId = (
        await db.row<{ id: string }>(
          `insert into user_types (tenant_id, code, name, placement_mode)
           values ($1, 'staff', 'Staff', 'unrestricted') returning id`,
          [tenantId],
        )
      ).id
      const authorId = (
        await db.row<{ id: string }>(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'Author', $2, $3) returning id`,
          [tenantId, userTypeId, rootId],
        )
      ).id
      // a formula that already exists when the audience model arrives
      const functionId = (
        await db.row<{ id: string }>(
          `insert into assessment_formula_functions
             (tenant_id, name, draft_source_ts, draft_tests, created_by, updated_by)
           values ($1, 'Existing', 'export {}', '[]'::jsonb, $2, $2) returning id`,
          [tenantId, authorId],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      // nothing was invented on anybody's behalf: the formula that was here
      // before is still private, and came from nowhere
      const carried = await db.row<{ copied_from_version_id: string | null }>(
        `select copied_from_version_id from assessment_formula_functions where id = $1`,
        [functionId],
      )
      expect(carried.copied_from_version_id).toBeNull()
      const offers = await db.query<{ count: string }>(
        `select count(*)::text as count from assessment_formula_share_scopes`,
      )
      expect(offers.rows[0]?.count).toBe('0')

      // now a published version, offered to the college
      const versionId = (
        await db.row<{ id: string }>(
          `insert into assessment_formula_versions
             (tenant_id, function_id, version_no, source_ts, runtime_js, input_schema,
              output_schema, source_sha256, runtime_sha256, contract_sha256,
              typescript_version, esbuild_version, formula_abi_version,
              formula_runtime_sha256, quickjs_engine_version, tests, test_report, published_by)
           values ($1, $2, 1, 'export {}', '/*a*/', '{}'::jsonb, '{}'::jsonb,
                   repeat('a', 64), repeat('b', 64), repeat('c', 64),
                   '7.0.0', '0.28.0', 1, repeat('d', 64), 'quickjs-test',
                   '[]'::jsonb, '[]'::jsonb, $3) returning id`,
          [tenantId, functionId, authorId],
        )
      ).id
      await db.query(
        `insert into assessment_formula_share_scopes (tenant_id, version_id, org_node_id, shared_by)
         values ($1, $2, $3, $4)`,
        [tenantId, versionId, collegeId, authorId],
      )

      // the unit is dissolved: the offer it carried goes with it, and the
      // publication does not move
      await db.query(`delete from org_nodes where id = $1`, [collegeId])
      const afterNode = await db.query<{ count: string }>(
        `select count(*)::text as count from assessment_formula_share_scopes`,
      )
      expect(afterNode.rows[0]?.count).toBe('0')
      const version = await db.query<{ id: string }>(
        `select id from assessment_formula_versions where id = $1`,
        [versionId],
      )
      expect(version.rows).toHaveLength(1)

      // and the whole graph still leaves with its tenant
      await db.query(`delete from tenants where id = $1`, [tenantId])
      for (const table of [
        'assessment_formula_functions',
        'assessment_formula_versions',
        'assessment_formula_share_scopes',
      ]) {
        const left = await db.query<{ count: string }>(
          `select count(*)::text as count from ${table} where tenant_id = $1`,
          [tenantId],
        )
        expect({ table, count: left.rows[0]?.count }).toEqual({ table, count: '0' })
      }
    } finally {
      await db.dispose()
    }
  }, 180_000)
})
