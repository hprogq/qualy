import { defineEntity, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { describe, expect, it } from 'vitest'
import { postgresAvailable } from '@qualy/plugin-database/testkit'
import { fullEntities } from '../src/full-entity.ts'

// Can the schema this product has be emitted from entities?
//
// The query side could be answered by reading; this cannot. The lineage
// carries 30 check constraints, 8 partial unique indexes, 19 tenant-scoped
// composite foreign keys and 11 database-side defaults, and a route that
// cannot reproduce them builds a different database than the one the product
// runs on. Everything here is asserted against generated DDL rather than
// against documentation.

const p = defineEntity.properties
const probeUrl = 'postgres://qualy:qualy@localhost:5432/postgres'

const ddlOf = async (entities: readonly unknown[]) => {
  const orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    entities: entities as never,
    clientUrl: probeUrl,
    discovery: { warnWhenNoEntities: false },
  })
  try {
    return await orm.schema.getCreateSchemaSQL()
  } finally {
    await orm.close()
  }
}

describe.runIf(postgresAvailable)('the ddl entities can emit', () => {
  it('keeps the database-side defaults, the ltree column and every check', async () => {
    const ddl = await ddlOf(fullEntities)
    // uuidv7() belongs to the database, so that a psql insert gets an id too
    expect(ddl).toContain('"id" uuid not null default uuidv7()')
    expect(ddl).toContain('"path" ltree not null')
    expect(ddl).toContain('timestamptz not null default now()')
    for (const check of [
      'chk_org_nodes_code_format',
      'chk_org_nodes_name_not_blank',
      'chk_org_nodes_depth_non_negative',
      'chk_org_nodes_sort_order_non_negative',
      'chk_org_nodes_parent_not_self',
    ]) {
      expect(ddl, `${check} is missing`).toContain(check)
    }
    // the expression survives verbatim, not normalised into something else
    expect(ddl).toContain(`check (parent_id IS NULL OR parent_id <> id)`)
  }, 60_000)

  it('emits a partial unique index and a gist index', async () => {
    const ddl = await ddlOf(fullEntities)
    expect(ddl).toContain('where code is not null')
    expect(ddl).toContain('using gist (path)')
  }, 60_000)

  it('emits a tenant-scoped composite foreign key, under the name it is given', async () => {
    // This is the one that decides whether the route survives. Tenant
    // isolation is a database fact here - a node may only reference a parent
    // and a type of its own tenant - and the constraint NAME is load-bearing
    // too: pg errors are translated to domain errors by name, and a gate in
    // the repository checks every translated name against the lineage.
    const OrgType = defineEntity({
      name: 'ProbeOrgType',
      tableName: 'org_types',
      properties: { id: p.uuid().primary(), tenantId: p.uuid() },
      uniques: [{ name: 'uq_org_types_tenant_id_id', properties: ['tenantId', 'id'] }],
    })
    const OrgNode = defineEntity({
      name: 'ProbeOrgNode',
      tableName: 'org_nodes',
      properties: {
        id: p.uuid().primary(),
        tenantId: p.uuid(),
        orgType: () =>
          p
            .manyToOne(OrgType)
            .joinColumns('tenant_id', 'org_type_id')
            .referencedColumnNames('tenant_id', 'id')
            .foreignKeyName('fk_org_nodes_org_type')
            .deleteRule('restrict'),
      },
    })

    const ddl = await ddlOf([OrgType, OrgNode])
    expect(ddl).toContain(
      'add constraint "fk_org_nodes_org_type" foreign key ("tenant_id", "org_type_id") references "org_types" ("tenant_id", "id") on delete restrict',
    )
  }, 60_000)

  it('takes the entity set it is handed, which is where disabled and detached live', async () => {
    // MikroORM has no notion of a plugin being switched off, and does not need
    // one: the schema it diffs against is whatever set it was given. So the
    // rule that survives the port unchanged is the existing one - the database
    // capability hands over the RETAINED order (active + disabled + detached),
    // not the active set - and a table whose plugin left the manifest stays in
    // the metadata, so nothing diffs it into a DROP.
    const own = (name: string, table: string) =>
      defineEntity({ name, tableName: table, properties: { id: p.uuid().primary() } })
    const fromOrg = own('AggA', 'agg_a')
    const fromPing = own('AggB', 'agg_b')
    const fromDetached = own('AggC', 'agg_c')

    expect(await ddlOf([fromOrg, fromPing, fromDetached])).toContain('"agg_c"')
    // handed the active set instead, the detached plugin's table is simply
    // absent - which under a diffing generator is how data gets dropped
    expect(await ddlOf([fromOrg, fromPing])).not.toContain('"agg_c"')
  }, 60_000)

  it('does not emit the extension its own column type needs', async () => {
    // The same gap the baseline fragments exist to fill, and it does not close
    // by changing orm: the ltree column is emitted, `create extension ltree`
    // is not, and a from-scratch deployment fails on the first table. So
    // baselineDir survives the port intact - it compiles plain SQL into the
    // lineage and never knew which orm produced the rest.
    const ddl = await ddlOf(fullEntities)
    expect(ddl).toContain('ltree')
    expect(ddl.toLowerCase()).not.toContain('create extension')
  }, 60_000)

  it('drops the foreign key entirely when the relation does not persist', async () => {
    // The trap, recorded because it cost an hour and fails silently: a
    // relation marked persist(false) emits no constraint at all. Read as
    // "this column is managed elsewhere", it is the natural way to model a
    // foreign key whose column already exists as a plain property - and it
    // deletes the tenant isolation the database was enforcing.
    const OrgType = defineEntity({
      name: 'SilentOrgType',
      tableName: 'org_types',
      properties: { id: p.uuid().primary(), tenantId: p.uuid() },
      uniques: [{ name: 'uq_org_types_tenant_id_id', properties: ['tenantId', 'id'] }],
    })
    const OrgNode = defineEntity({
      name: 'SilentOrgNode',
      tableName: 'org_nodes',
      properties: {
        id: p.uuid().primary(),
        tenantId: p.uuid(),
        orgTypeId: p.uuid(),
        orgType: () =>
          p
            .manyToOne(OrgType)
            .joinColumns('tenant_id', 'org_type_id')
            .referencedColumnNames('tenant_id', 'id')
            .persist(false),
      },
    })

    expect(await ddlOf([OrgType, OrgNode])).not.toContain('foreign key')
  }, 60_000)
})
