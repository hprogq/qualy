import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'

// A published version is a permanent execution fact. The database itself
// holds the line: deleting its parent function is refused while any version
// stands (23001, restrict), archiving the function flips one column and the
// version row does not move - and a tenant's whole lifecycle still cascades,
// because restrict judges the statement's final state, where the versions
// were already removed through their own tenant edge. The same diamond is
// probed and CI-held in org's schema suite; this one keeps the promise
// pinned to THESE tables.

describe.runIf(postgresAvailable)('formula version permanence', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-permanence')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  const world = async (slug: string) => {
    const tenantId = (
      await db.row<{ id: string }>(
        `insert into tenants (slug, name) values ($1, $1) returning id`,
        [slug],
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
         values ($1, $2, 'Root', $3, 0) returning id`,
        [tenantId, orgTypeId, slug.replaceAll('-', '_')],
      )
    ).id
    const userTypeId = (
      await db.row<{ id: string }>(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'staff', 'Staff', 'unrestricted') returning id`,
        [tenantId],
      )
    ).id
    const userId = (
      await db.row<{ id: string }>(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Author', $2, $3) returning id`,
        [tenantId, userTypeId, nodeId],
      )
    ).id
    const functionId = (
      await db.row<{ id: string }>(
        `insert into assessment_formula_functions
           (tenant_id, name, draft_source_ts, draft_tests, created_by, updated_by)
         values ($1, 'Kept', 'export {}', '[]'::jsonb, $2, $2) returning id`,
        [tenantId, userId],
      )
    ).id
    const versionId = (
      await db.row<{ id: string }>(
        `insert into assessment_formula_versions
           (tenant_id, function_id, version_no, source_ts, runtime_js,
            input_schema, output_schema, source_sha256, runtime_sha256, contract_sha256,
            typescript_version, esbuild_version, formula_abi_version, formula_runtime_sha256,
            quickjs_engine_version, tests, test_report, published_by)
         values ($1, $2, 1, 'export {}', '/*artifact*/',
                 '{}'::jsonb, '{}'::jsonb, repeat('a', 64), repeat('b', 64), repeat('c', 64),
                 '7.0.0', '0.28.0', 1, repeat('d', 64),
                 'quickjs-test', '[]'::jsonb, '[]'::jsonb, $3)
         returning id`,
        [tenantId, functionId, userId],
      )
    ).id
    return { tenantId, functionId, versionId }
  }

  it('refuses to delete a function while a published version stands', async () => {
    const w = await world('perm-keep')
    expect(
      await pgCode(
        db.query(`delete from assessment_formula_functions where id = $1`, [w.functionId]),
      ),
    ).toBe('23001')
    const kept = await db.row<{ functions: number; versions: number }>(
      `select
         (select count(*)::int from assessment_formula_functions where id = $1) as functions,
         (select count(*)::int from assessment_formula_versions where id = $2) as versions`,
      [w.functionId, w.versionId],
    )
    expect(kept).toEqual({ functions: 1, versions: 1 })
  })

  it('keeps the version readable when its function is archived', async () => {
    const w = await world('perm-archive')
    await db.query(`update assessment_formula_functions set archived_at = now() where id = $1`, [
      w.functionId,
    ])
    const still = await db.row<{ runtime_js: string }>(
      `select runtime_js from assessment_formula_versions where id = $1`,
      [w.versionId],
    )
    expect(still.runtime_js).toBe('/*artifact*/')
  })

  it('still lets a whole tenant leave, versions and all', async () => {
    const w = await world('perm-tenant')
    await db.query(`delete from tenants where id = $1`, [w.tenantId])
    const gone = await db.row<{ functions: number; versions: number }>(
      `select
         (select count(*)::int from assessment_formula_functions where tenant_id = $1) as functions,
         (select count(*)::int from assessment_formula_versions where tenant_id = $1) as versions`,
      [w.tenantId],
    )
    expect(gone).toEqual({ functions: 0, versions: 0 })
  })
})
