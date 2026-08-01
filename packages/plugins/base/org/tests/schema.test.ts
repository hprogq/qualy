import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runMigrations } from '@qualy/plugin-database/migrator'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// the tenant boundary lives in the database itself (composite foreign keys,
// partial unique indexes, ltree): these assertions need a real postgres —
// PGlite has ltree but the point is the committed migration lineage plus
// constraint semantics under the production server.

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
if (!available) console.warn('postgres unreachable, org schema tests skipped')

describe.runIf(available)('org schema tenant boundary', () => {
  const admin = new Pool({ connectionString: baseUrl })
  const dbName = `qualy_org_${randomUUID().slice(0, 8)}`
  let pool: Pool

  const pgCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'no error',
      (error) => (error as { code?: string }).code,
    )

  const createTenant = async (slug: string) =>
    (await pool.query(`insert into tenants (slug, name) values ($1, $1) returning id`, [slug]))
      .rows[0].id as string

  const createType = async (tenantId: string, code: string) =>
    (
      await pool.query(
        `insert into org_types (tenant_id, code, name) values ($1, $2, $2) returning id`,
        [tenantId, code],
      )
    ).rows[0].id as string

  const createNode = async (
    tenantId: string,
    typeId: string,
    parentId: string | null,
    name: string,
    path: string,
  ) =>
    (
      await pool.query(
        `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
         values ($1, $2, $3, $4, $5, nlevel($5::ltree) - 1) returning id`,
        [tenantId, typeId, parentId, name, path],
      )
    ).rows[0].id as string

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = new Pool({ connectionString: url.href })
    await runMigrations(pool, { folder: migrationsFolder })
  })

  afterAll(async () => {
    await pool?.end()
    await admin.query(`drop database if exists "${dbName}" with (force)`)
    await admin.end()
  })

  it('rejects cross-tenant parents and types at the database level', async () => {
    const tenantA = await createTenant('tenant-a')
    const tenantB = await createTenant('tenant-b')
    const typeA = await createType(tenantA, 'college')
    const typeB = await createType(tenantB, 'college')
    const rootB = await createNode(tenantB, typeB, null, 'B Root', 'rootb')

    // a node of tenant A referencing tenant B's node as parent
    expect(await pgCode(createNode(tenantA, typeA, rootB, 'A child of B', 'rootb.intruder'))).toBe(
      '23503',
    )
    // a node of tenant A using tenant B's org type
    expect(await pgCode(createNode(tenantA, typeB, null, 'A with B type', 'roota'))).toBe('23503')
  })

  it('enforces sibling and root name uniqueness per tenant only', async () => {
    const tenantA = await createTenant('names-a')
    const tenantB = await createTenant('names-b')
    const typeA = await createType(tenantA, 'unit')
    const typeB = await createType(tenantB, 'unit')

    const rootA = await createNode(tenantA, typeA, null, 'Root', 'na')
    await createNode(tenantA, typeA, rootA, 'Child', 'na.c1')
    // same parent, same name
    expect(await pgCode(createNode(tenantA, typeA, rootA, 'Child', 'na.c2'))).toBe('23505')
    // second root with the same name in the same tenant
    expect(await pgCode(createNode(tenantA, typeA, null, 'Root', 'na2'))).toBe('23505')
    // the same names in another tenant are fine
    const rootB = await createNode(tenantB, typeB, null, 'Root', 'nb')
    await createNode(tenantB, typeB, rootB, 'Child', 'nb.c1')
  })

  it('rejects self-loop type rules', async () => {
    const tenant = await createTenant('rules-a')
    const type = await createType(tenant, 'college')
    expect(
      await pgCode(
        pool.query(
          `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1, $2, $2)`,
          [tenant, type],
        ),
      ),
    ).toBe('23514')
  })

  it('honors cascade and restrict deletion semantics', async () => {
    const tenant = await createTenant('del-a')
    const type = await createType(tenant, 'unit')
    const root = await createNode(tenant, type, null, 'Root', 'da')
    await createNode(tenant, type, root, 'Child', 'da.c')

    // row-level protection: a referenced type or parent cannot go away alone
    expect(await pgCode(pool.query(`delete from org_types where id = $1`, [type]))).toBe('23001')
    expect(await pgCode(pool.query(`delete from org_nodes where id = $1`, [root]))).toBe('23001')

    // restrict checks the statement's final state, so one statement may
    // remove a whole tree, and the tenant cascade is real (probed on pg18)
    await pool.query(`delete from org_nodes where tenant_id = $1`, [tenant])
    const root2 = await createNode(tenant, type, null, 'Root', 'da')
    await createNode(tenant, type, root2, 'Child', 'da.c')
    await pool.query(`delete from tenants where id = $1`, [tenant])
    const left = await pool.query(
      `select (select count(*) from org_nodes where tenant_id = $1)::int
            + (select count(*) from org_types where tenant_id = $1)::int as count`,
      [tenant],
    )
    expect(left.rows[0].count).toBe(0)
  })

  it('serves subtree queries through the gist-indexed ltree path', async () => {
    const indexes = await pool.query(
      `select indexdef from pg_indexes where tablename = 'org_nodes' and indexdef ilike '%using gist%'`,
    )
    expect(indexes.rows).toHaveLength(1)

    const tenant = await createTenant('tree-a')
    const type = await createType(tenant, 'unit')
    const root = await createNode(tenant, type, null, 'Root', 'tr')
    const mid = await createNode(tenant, type, root, 'Mid', 'tr.m')
    await createNode(tenant, type, mid, 'Leaf', 'tr.m.l')

    const subtree = await pool.query(
      `select count(*) from org_nodes where tenant_id = $1 and path <@ 'tr.m'::ltree`,
      [tenant],
    )
    expect(Number(subtree.rows[0].count)).toBe(2)
    // ids come from postgres 18's native uuidv7()
    expect(root).toMatch(/^[0-9a-f-]{14}7/)
  })
})
