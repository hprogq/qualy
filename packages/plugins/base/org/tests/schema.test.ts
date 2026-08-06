import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'

// The tenant boundary lives in the database itself (composite foreign keys,
// partial unique indexes, ltree), so these assertions build illegal rows on
// purpose and expect postgres to refuse them. Going through the service
// instead would only prove the service is careful, which says nothing about
// what psql, an import script or a future migration can write.
//
// The connection belongs to the database plugin: this file decides what sql
// to run, not who owns the pool.

describe.runIf(postgresAvailable)('org schema tenant boundary', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  // row() rather than rows[0]!: an insert that returned nothing is a fault
  // worth naming where it happens, not a null dereference three lines later
  const createTenant = async (slug: string) =>
    (
      await db.row<{ id: string }>(
        `insert into tenants (slug, name) values ($1, $1) returning id`,
        [slug],
      )
    ).id

  const createType = async (tenantId: string, code: string) =>
    (
      await db.row<{ id: string }>(
        `insert into org_types (tenant_id, code, name) values ($1, $2, $2) returning id`,
        [tenantId, code],
      )
    ).id

  const createNode = async (
    tenantId: string,
    typeId: string,
    parentId: string | null,
    name: string,
    path: string,
  ) =>
    (
      await db.row<{ id: string }>(
        `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
         values ($1, $2, $3, $4, $5, nlevel($5::ltree) - 1) returning id`,
        [tenantId, typeId, parentId, name, path],
      )
    ).id

  beforeAll(async () => {
    db = await createTestContext('org-schema')
  })

  afterAll(async () => {
    await db?.dispose()
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

  it('allows a single root per tenant and tracks tenant access state', async () => {
    const tenantA = await createTenant('root-a')
    const tenantB = await createTenant('root-b')
    const typeA = await createType(tenantA, 'unit')
    const typeB = await createType(tenantB, 'unit')

    await createNode(tenantA, typeA, null, 'Root A', 'ra')
    // a second root in the same tenant violates the single-root invariant
    expect(await pgCode(createNode(tenantA, typeA, null, 'Root A2', 'ra2'))).toBe('23505')
    // other tenants keep their own root
    await createNode(tenantB, typeB, null, 'Root B', 'rb')

    await db.query(
      `update tenants set enabled = false, expires_at = now() - interval '1 day' where id = $1`,
      [tenantA],
    )
    const state = await db.row<{ enabled: boolean; expires_at: unknown }>(
      `select enabled, expires_at from tenants where id = $1`,
      [tenantA],
    )
    expect(state.enabled).toBe(false)
    // the moment it lapsed, asserted as a value rather than as whatever js
    // type the driver happens to hand back for a timestamptz
    expect(new Date(String(state.expires_at)).getTime()).toBeLessThan(Date.now())
  })

  it('rejects self-loop type rules', async () => {
    const tenant = await createTenant('rules-a')
    const type = await createType(tenant, 'college')
    expect(
      await pgCode(
        db.query(
          `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1, $2, $2)`,
          [tenant, type],
        ),
      ),
    ).toBe('23514')
  })

  it('honors cascade and restrict deletion semantics', async () => {
    const tenant = await createTenant('del-a')
    const type = await createType(tenant, 'unit')
    const childType = await createType(tenant, 'unit-child')
    await db.query(
      `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1, $2, $3)`,
      [tenant, type, childType],
    )
    const root = await createNode(tenant, type, null, 'Root', 'da')
    await createNode(tenant, childType, root, 'Child', 'da.c')

    // row-level protection: a referenced type or parent cannot go away alone
    expect(await pgCode(db.query(`delete from org_types where id = $1`, [type]))).toBe('23001')
    expect(await pgCode(db.query(`delete from org_nodes where id = $1`, [root]))).toBe('23001')

    // restrict checks the statement's final state, so one statement may
    // remove a whole tree, and the tenant cascade is real (probed on pg18)
    await db.query(`delete from org_nodes where tenant_id = $1`, [tenant])
    const root2 = await createNode(tenant, type, null, 'Root', 'da')
    await createNode(tenant, childType, root2, 'Child', 'da.c')
    await db.query(`delete from tenants where id = $1`, [tenant])
    const left = await db.row<{ count: number }>(
      `select (select count(*) from org_nodes where tenant_id = $1)::int
            + (select count(*) from org_types where tenant_id = $1)::int
            + (select count(*) from org_type_rules where tenant_id = $1)::int
            + (select count(*) from tenants where id = $1)::int as count`,
      [tenant],
    )
    expect(left.count).toBe(0)
  })

  it('serves subtree queries through the gist-indexed ltree path', async () => {
    const indexes = await db.query(
      `select indexdef from pg_indexes where tablename = 'org_nodes' and indexdef ilike '%using gist%'`,
    )
    expect(indexes.rows).toHaveLength(1)

    const tenant = await createTenant('tree-a')
    const type = await createType(tenant, 'unit')
    const root = await createNode(tenant, type, null, 'Root', 'tr')
    const mid = await createNode(tenant, type, root, 'Mid', 'tr.m')
    await createNode(tenant, type, mid, 'Leaf', 'tr.m.l')

    const subtree = await db.row<{ count: string }>(
      `select count(*) from org_nodes where tenant_id = $1 and path <@ 'tr.m'::ltree`,
      [tenant],
    )
    expect(Number(subtree.count)).toBe(2)
    // ids come from postgres 18's native uuidv7()
    expect(root).toMatch(/^[0-9a-f-]{14}7/)
  })
})
