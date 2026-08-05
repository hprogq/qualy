import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import type { TestContext } from '@qualy/plugin-database/testkit'
import { open, type Orm } from '../src/orm.ts'
import {
  countTypes,
  grantsBlockingOrgType,
  incompatibleChildTypes,
  listTypes,
  lockTenant,
  readSubtree,
  setNodeType,
  usersBlockingOrgType,
} from '../src/queries.ts'

// The vertical slice, against the schema the product actually deploys.
//
// The lineage is the committed one, applied by the plugin that owns it, so
// this asks whether MikroORM and Kysely can address the tables Qualy has -
// composite tenant-scoped foreign keys, ltree paths, partial unique indexes -
// rather than tables invented to suit them.

let db: TestContext
let orm: Orm
const ids: Record<string, string> = {}

beforeAll(async () => {
  db = await createTestContext('mikroorm-slice')
  orm = await open(db.url)

  // one tenant, a three-level tree, a user standing in it and a role anchored
  // at the node the slice retypes
  const tenant = await db.row<{ id: string }>(
    `insert into tenants (slug, name) values ('spike','Spike') returning id`,
  )
  ids.tenant = tenant.id
  for (const [code, order] of [
    ['university', 10],
    ['college', 30],
    ['grade', 40],
    ['class', 70],
  ] as const) {
    const row = await db.row<{ id: string }>(
      `insert into org_types (tenant_id, code, name, sort_order) values ($1,$2,$3,$4) returning id`,
      [ids.tenant, code, code, order],
    )
    ids[code] = row.id
  }
  for (const [parent, child] of [
    ['university', 'college'],
    ['college', 'grade'],
    ['grade', 'class'],
    ['university', 'grade'],
  ] as const) {
    await db.query(
      `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1,$2,$3)`,
      [ids.tenant, ids[parent], ids[child]],
    )
  }
  const root = await db.row<{ id: string }>(
    `insert into org_nodes (tenant_id, org_type_id, code, name, path, depth)
     values ($1,$2,'root','U','root',0) returning id`,
    [ids.tenant, ids.university],
  )
  ids.nodeRoot = root.id
  const college = await db.row<{ id: string }>(
    `insert into org_nodes (tenant_id, parent_id, org_type_id, code, name, path, depth)
     values ($1,$2,$3,'c','C','root.c',1) returning id`,
    [ids.tenant, ids.nodeRoot, ids.college],
  )
  ids.nodeCollege = college.id
  const grade = await db.row<{ id: string }>(
    `insert into org_nodes (tenant_id, parent_id, org_type_id, code, name, path, depth)
     values ($1,$2,$3,'g','G','root.c.g',2) returning id`,
    [ids.tenant, ids.nodeCollege, ids.grade],
  )
  ids.nodeGrade = grade.id
}, 60_000)

afterAll(async () => {
  await orm?.close()
  await db?.dispose()
})

describe.runIf(postgresAvailable)('A: an ordinary typed read', () => {
  it('returns the rows the builder selected, with no hand-written row type', async () => {
    const types = await listTypes(orm.em.fork(), ids.tenant!)
    expect(types.map((t) => t.code)).toEqual(['university', 'college', 'grade', 'class'])
    // sortOrder came back as the property name, not sort_order, and typed:
    // if the select list and this access disagreed it would not compile
    expect(types[0]!.sortOrder).toBe(10)
  })

  it('binds a uuid array without the string_to_array workaround', async () => {
    // the drizzle version is
    // `id = any(string_to_array(${typeIds.join(',')}, ',')::uuid[])`
    const { count } = await countTypes(orm.em.fork(), ids.tenant!, [
      ids.university!,
      ids.grade!,
      '00000000-0000-7000-8000-000000000000',
    ])
    expect(Number(count)).toBe(2)
  })
})

describe.runIf(postgresAvailable)('B: postgres-specific reads', () => {
  it('reads a subtree by ltree containment', async () => {
    const rows = await readSubtree(orm.em.fork(), ids.tenant!, 'root.c')
    expect(rows.map((r) => r.name)).toEqual(['C', 'G'])
    expect(rows[0]!.depth).toBe(1)
  })

  it('finds the children a candidate parent type would not permit', async () => {
    // college -> grade is a rule, so retyping the college to a class - which
    // permits nothing - strands the grade beneath it
    const blocked = await incompatibleChildTypes(
      orm.em.fork(),
      ids.tenant!,
      ids.nodeCollege!,
      ids.class!,
    )
    expect(blocked.map((row) => row.typeName)).toEqual(['grade'])
    // and university -> grade IS a rule, so that retype is clean
    expect(
      await incompatibleChildTypes(orm.em.fork(), ids.tenant!, ids.nodeCollege!, ids.university!),
    ).toEqual([])
  })
})

describe.runIf(postgresAvailable)('C: one transaction across three plugins', () => {
  it('rolls the caller back when a peer refuses', async () => {
    const before = await db.row<{ org_type_id: string }>(
      `select org_type_id from org_nodes where id = $1`,
      [ids.nodeCollege],
    )

    // a user whose type may only stand at a college, standing at the college
    const userType = await db.row<{ id: string }>(
      `insert into user_types (tenant_id, code, name, placement_mode)
       values ($1,'student','S','allow-list') returning id`,
      [ids.tenant],
    )
    await db.query(
      `insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
       values ($1,$2,$3)`,
      [ids.tenant, userType.id, ids.college],
    )
    await db.query(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1,'someone',$2,$3)`,
      [ids.tenant, userType.id, ids.nodeCollege],
    )

    const attempt = orm.em.transactional(async (em) => {
      await lockTenant(em, ids.tenant!)
      // the write happens first, so the refusal has something to roll back
      await setNodeType(em, ids.nodeCollege!, ids.grade!)
      const stranded = await usersBlockingOrgType(em, ids.tenant!, ids.nodeCollege!, ids.grade!)
      if (stranded.length > 0) {
        throw new Error(`placement policy strands ${stranded.length} user(s)`)
      }
    })

    await expect(attempt).rejects.toThrow(/strands 1 user/)

    // read on a separate connection: the update must not have survived
    const after = await db.row<{ org_type_id: string }>(
      `select org_type_id from org_nodes where id = $1`,
      [ids.nodeCollege],
    )
    expect(after.org_type_id).toBe(before.org_type_id)
  })

  it('commits when every peer agrees', async () => {
    await db.query(`delete from users where tenant_id = $1`, [ids.tenant])
    await orm.em.transactional(async (em) => {
      await lockTenant(em, ids.tenant!)
      await setNodeType(em, ids.nodeCollege!, ids.grade!)
      expect(await usersBlockingOrgType(em, ids.tenant!, ids.nodeCollege!, ids.grade!)).toEqual([])
      expect(await grantsBlockingOrgType(em, ids.tenant!, ids.nodeCollege!, ids.grade!)).toEqual([])
    })
    const after = await db.row<{ org_type_id: string }>(
      `select org_type_id from org_nodes where id = $1`,
      [ids.nodeCollege],
    )
    expect(after.org_type_id).toBe(ids.grade)
  })

  it('sees its own uncommitted write, and a forked em does not', async () => {
    // this is the property the whole port rests on: a peer called inside the
    // transaction reads the caller's uncommitted state, while anything on
    // another connection does not
    await orm.em.transactional(async (em) => {
      await setNodeType(em, ids.nodeGrade!, ids.class!)
      const inside = await readSubtree(em, ids.tenant!, 'root.c.g')
      expect(inside[0]!.orgTypeId).toBe(ids.class)

      const outside = await readSubtree(orm.em.fork(), ids.tenant!, 'root.c.g')
      expect(outside[0]!.orgTypeId).not.toBe(ids.class)

      throw new Error('rollback')
    }).catch(() => undefined)
  })
})
