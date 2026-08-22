import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'

// The tenant boundary for identities lives in the database itself (composite
// foreign keys, partial unique indexes, check constraints), so these
// assertions build illegal rows on purpose and expect postgres to refuse
// them. Going through the service instead would only prove the service is
// careful, which says nothing about what psql, an import script or a future
// migration can write.
//
// The connection belongs to the database plugin: this file decides what sql
// to run, not who owns the pool.

describe.runIf(postgresAvailable)('auth schema tenant boundary', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  const ids = { tenant: '', otherTenant: '', root: '', memberType: '', provider: '', alice: '' }

  beforeAll(async () => {
    db = await createTestContext('auth-schema')

    const row = async (text: string, params: unknown[] = []) =>
      (await db.query(text, params)).rows[0]!.id as string
    ids.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    ids.otherTenant = await row(`insert into tenants (slug, name) values ('b', 'B') returning id`)
    const orgType = await row(
      `insert into org_types (tenant_id, name) values ($1, 'U') returning id`,
      [ids.tenant],
    )
    ids.root = await row(
      `insert into org_nodes (tenant_id, org_type_id, name, path) values ($1, $2, 'R', 'r') returning id`,
      [ids.tenant, orgType],
    )
    ids.memberType = await row(
      `insert into user_types (tenant_id, code, name, placement_mode) values ($1, 'member', 'M', 'unrestricted') returning id`,
      [ids.tenant],
    )
    ids.provider = await row(
      `insert into auth_providers (tenant_id, code, type, name) values ($1, 'local', 'local', 'L') returning id`,
      [ids.tenant],
    )
    ids.alice = await row(
      `insert into users (tenant_id, business_no, display_name, user_type_id, primary_org_node_id)
       values ($1, 'a-001', 'Alice', $2, $3) returning id`,
      [ids.tenant, ids.memberType, ids.root],
    )
    await db.query(
      `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier)
       values ($1, $2, $3, 'alice')`,
      [ids.tenant, ids.alice, ids.provider],
    )
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('rejects cross-tenant references at the database level', async () => {
    // tenant B user referencing tenant A's user type / org node
    expect(
      await pgCode(
        db.query(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'X', $2, $3)`,
          [ids.otherTenant, ids.memberType, ids.root],
        ),
      ),
    ).toBe('23503')
  })

  it('enforces identifier and business number uniqueness per tenant', async () => {
    expect(
      await pgCode(
        db.query(
          `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier)
           values ($1, $2, $3, 'alice')`,
          [ids.tenant, ids.alice, ids.provider],
        ),
      ),
    ).toBe('23505')
    expect(
      await pgCode(
        db.query(
          `insert into users (tenant_id, business_no, display_name, user_type_id, primary_org_node_id)
           values ($1, 'a-001', 'Copycat', $2, $3)`,
          [ids.tenant, ids.memberType, ids.root],
        ),
      ),
    ).toBe('23505')
  })

  it('rejects provider codes that are not route-safe', async () => {
    expect(
      await pgCode(
        db.query(
          `insert into auth_providers (tenant_id, code, type, name) values ($1, 'Bad Code', 'local', 'X')`,
          [ids.tenant],
        ),
      ),
    ).toBe('23514')
  })
})
