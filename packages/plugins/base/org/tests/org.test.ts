import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@qualy/plugin-database/migrator'
import Database from '@qualy/plugin-database'
import Server, { type AuthPrincipal } from '@qualy/plugin-server'
import UiRegistry from '@qualy/plugin-ui-registry'
import Rbac from '@qualy/plugin-rbac'
import { isAccessDeniedError, isDomainError, type DomainError } from '@qualy/api-contract'
import Org from '../src/index.ts'

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
if (!available) console.warn('postgres unreachable, org tests skipped')

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('org tree domain', () => {
  const adminPool = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_org_domain_${randomUUID().slice(0, 8)}`
  let pool: Pool
  let ctx: Context
  let httpBase: string
  // the test enricher reads this box: set before a request, clear for anon
  const principalBox: { current?: AuthPrincipal } = {}

  const f = {
    tenant: '',
    tenantB: '',
    universityType: '',
    collegeType: '',
    classType: '',
    root: '',
    collegeA: '',
    collegeB: '',
    class1: '',
    admin: '',
    manager: '',
    student: '',
    adminB: '',
    rootB: '',
    tenantAdminRole: '',
    managerRole: '',
  }

  const tree = () => ctx.org.tree
  const principal = (userId: string, tenantId = f.tenant): AuthPrincipal => ({
    tenantId,
    userId,
    sessionId: 'test-session',
  })

  const orgCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error) =>
        isDomainError(error)
          ? error.code
          : isAccessDeniedError(error)
            ? 'ACCESS_DENIED'
            : ((error as Error).message ?? 'error'),
    )

  // every node must agree with its parent chain: path is parent path plus
  // the node's own uuid label, depth is parent depth + 1
  const assertTreeConsistent = async () => {
    const broken = await pool.query(`
      select count(*)::int as count
      from org_nodes n
      left join org_nodes p on p.tenant_id = n.tenant_id and p.id = n.parent_id
      where (n.parent_id is null
              and (n.depth <> 0 or n.path::text <> replace(n.id::text, '-', '')))
         or (n.parent_id is not null
              and (p.id is null
                or n.depth <> p.depth + 1
                or n.path::text <> p.path::text || '.' || replace(n.id::text, '-', '')))`)
    expect(broken.rows[0].count).toBe(0)
  }

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    as?: AuthPrincipal,
  ): Promise<Response> => {
    principalBox.current = as
    try {
      return await fetch(`${httpBase}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } finally {
      principalBox.current = undefined
    }
  }

  beforeAll(async () => {
    await adminPool.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = quietPool({ connectionString: url.href })
    await runMigrations(pool, { folder: migrationsFolder })

    const row = async (text: string, params: unknown[] = []) =>
      (await pool.query(text, params)).rows[0].id as string
    // roots are provisioned by the seed in production; tests create them the
    // same way (label = uuid without hyphens, written atomically)
    const insertRoot = (tenantId: string, typeId: string, name: string) =>
      row(
        `insert into org_nodes (id, tenant_id, org_type_id, name, path, depth)
         select v.id, $1, $2, $3, replace(v.id::text, '-', '')::ltree, 0
         from (select uuidv7() as id) v returning id`,
        [tenantId, typeId, name],
      )

    f.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    f.tenantB = await row(`insert into tenants (slug, name) values ('b', 'B') returning id`)

    ctx = new Context()
    await ctx.plugin(Database, { url: url.href, migrations: 'off' })
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    await ctx.plugin(Rbac)
    await ctx.plugin(Org)
    await ctx.plugin({
      name: 'test-principal',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.enrich('test-principal', (context) => {
          context.principal = principalBox.current
        })
      },
    })
    await ctx.rbac.whenSynced()
    httpBase = `http://127.0.0.1:${ctx.server.port}/api`

    // types and rules through the real service (university -> college -> class)
    f.universityType = (await tree().createType(f.tenant, { code: 'university', name: '大学' })).id
    f.collegeType = (await tree().createType(f.tenant, { code: 'college', name: '学院' })).id
    f.classType = (await tree().createType(f.tenant, { code: 'class', name: '班级' })).id
    await tree().createRule(f.tenant, f.universityType, f.collegeType)
    await tree().createRule(f.tenant, f.collegeType, f.classType)

    f.root = await insertRoot(f.tenant, f.universityType, 'A 大学')
    f.collegeA = (
      await tree().createNode(f.tenant, {
        parentId: f.root,
        orgTypeId: f.collegeType,
        name: '软件学院',
        code: 'software',
      })
    ).id
    f.collegeB = (
      await tree().createNode(f.tenant, {
        parentId: f.root,
        orgTypeId: f.collegeType,
        name: '理学院',
      })
    ).id
    f.class1 = (
      await tree().createNode(f.tenant, {
        parentId: f.collegeA,
        orgTypeId: f.classType,
        name: '软件2301',
      })
    ).id

    // principals: admin (tenant-admin at root), manager (org role on
    // collegeA subtree with read+manage), student (no org grants)
    const typeAdmin = await row(
      `insert into user_types (tenant_id, code, name) values ($1, 'administrator', 'Admin') returning id`,
      [f.tenant],
    )
    const typeFaculty = await row(
      `insert into user_types (tenant_id, code, name) values ($1, 'faculty', 'Faculty') returning id`,
      [f.tenant],
    )
    const user = (name: string, typeId: string, node: string, tenant = f.tenant) =>
      row(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, $2, $3, $4) returning id`,
        [tenant, name, typeId, node],
      )
    f.admin = await user('Admin', typeAdmin, f.root)
    f.manager = await user('Manager', typeFaculty, f.collegeA)
    f.student = await user('Student', typeFaculty, f.class1)

    f.tenantAdminRole = await row(
      `insert into roles (tenant_id, code, name, kind, is_system)
       values ($1, 'tenant-admin', 'TA', 'tenant', true) returning id`,
      [f.tenant],
    )
    f.managerRole = await row(
      `insert into roles (tenant_id, code, name, kind) values ($1, 'org-manager', 'OM', 'org') returning id`,
      [f.tenant],
    )
    await pool.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, typeFaculty],
    )
    await pool.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.collegeType],
    )
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, r.id, p.id from roles r, permissions p
       where r.id = any($2::uuid[]) and p.code in ('org.tree.read', 'org.tree.manage')`,
      [f.tenant, [f.tenantAdminRole, f.managerRole]],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.admin, f.tenantAdminRole, f.root],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.manager, f.managerRole, f.collegeA],
    )

    // tenant B: its own root and admin, to prove isolation
    const typeB = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'university', 'U') returning id`,
      [f.tenantB],
    )
    f.rootB = await insertRoot(f.tenantB, typeB, 'B 大学')
    const typeAdminB = await row(
      `insert into user_types (tenant_id, code, name) values ($1, 'administrator', 'Admin') returning id`,
      [f.tenantB],
    )
    f.adminB = await user('Admin B', typeAdminB, f.rootB, f.tenantB)
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    await pool?.end()
    await adminPool.query(`drop database if exists "${dbName}" with (force)`)
    await adminPool.end()
  })

  it('enforces type rules and sibling names on creation', async () => {
    // class directly under the university root: no rule allows it
    expect(
      await orgCode(
        tree().createNode(f.tenant, {
          parentId: f.root,
          orgTypeId: f.classType,
          name: '违规班级',
        }),
      ),
    ).toBe('ORG_NODE_RULE_VIOLATION')
    // duplicate sibling name
    expect(
      await orgCode(
        tree().createNode(f.tenant, {
          parentId: f.root,
          orgTypeId: f.collegeType,
          name: '软件学院',
        }),
      ),
    ).toBe('ORG_NODE_CONFLICT')
    // unknown parent / unknown type
    expect(
      await orgCode(
        tree().createNode(f.tenant, {
          parentId: randomUUID(),
          orgTypeId: f.collegeType,
          name: 'X',
        }),
      ),
    ).toBe('ORG_NODE_NOT_FOUND')
    // a second root cannot even be expressed through the api (parentId is
    // required); the bare-sql path dies on the partial unique index
    const secondRoot = pool
      .query(
        `insert into org_nodes (id, tenant_id, org_type_id, name, path, depth)
         select v.id, $1, $2, 'Root 2', replace(v.id::text, '-', '')::ltree, 0
         from (select uuidv7() as id) v`,
        [f.tenant, f.universityType],
      )
      .then(
        () => 'ok',
        (error) => (error as { code?: string }).code,
      )
    expect(await secondRoot).toBe('23505')
    await assertTreeConsistent()
  })

  it('keeps the type rule graph acyclic', async () => {
    expect(await orgCode(tree().createRule(f.tenant, f.collegeType, f.collegeType))).toBe(
      'ORG_RULE_INVALID',
    )
    // direct back edge: college -> university while university -> college exists
    expect(await orgCode(tree().createRule(f.tenant, f.collegeType, f.universityType))).toBe(
      'ORG_RULE_CYCLE',
    )
    // transitive back edge: class -> university closes a 3-cycle
    expect(await orgCode(tree().createRule(f.tenant, f.classType, f.universityType))).toBe(
      'ORG_RULE_CYCLE',
    )
    // duplicate rule
    expect(await orgCode(tree().createRule(f.tenant, f.universityType, f.collegeType))).toBe(
      'ORG_RULE_CONFLICT',
    )
    // unknown type
    expect(await orgCode(tree().createRule(f.tenant, f.universityType, randomUUID()))).toBe(
      'ORG_TYPE_NOT_FOUND',
    )
  })

  it('protects the root from move and delete', async () => {
    expect(await orgCode(tree().moveNode(f.tenant, f.root, f.collegeA))).toBe('ORG_NODE_IS_ROOT')
    expect(await orgCode(tree().deleteNode(f.tenant, f.root))).toBe('ORG_NODE_IS_ROOT')
    // renaming the root is business as usual
    const renamed = await tree().updateNode(f.tenant, f.root, { name: 'A 大学(改)' })
    expect(renamed.name).toBe('A 大学(改)')
  })

  it('rejects self moves and moves into the own subtree', async () => {
    expect(await orgCode(tree().moveNode(f.tenant, f.collegeA, f.collegeA))).toBe(
      'ORG_NODE_INVALID_MOVE',
    )
    expect(await orgCode(tree().moveNode(f.tenant, f.collegeA, f.class1))).toBe(
      'ORG_NODE_INVALID_MOVE',
    )
    // move without a matching rule: class under university root
    expect(await orgCode(tree().moveNode(f.tenant, f.class1, f.root))).toBe(
      'ORG_NODE_RULE_VIOLATION',
    )
  })

  it('rewrites path and depth for the whole subtree on move', async () => {
    // a campus level between root and college gives the move real depth:
    // moving collegeA (with class1 inside) from the root under campus1
    const campus = await tree().createType(f.tenant, { code: 'campus', name: '校区' })
    await tree().createRule(f.tenant, f.universityType, campus.id)
    await tree().createRule(f.tenant, campus.id, f.collegeType)
    const campus1 = await tree().createNode(f.tenant, {
      parentId: f.root,
      orgTypeId: campus.id,
      name: '东校区',
    })
    const moved = await tree().moveNode(f.tenant, f.collegeA, campus1.id)
    expect(moved.parent_id).toBe(campus1.id)
    expect(moved.depth).toBe(2)
    expect(moved.path).toBe(`${campus1.path}.${f.collegeA.replaceAll('-', '')}`)
    const class1 = (
      await pool.query(`select depth, path::text as path from org_nodes where id = $1`, [f.class1])
    ).rows[0]
    expect(class1.depth).toBe(3)
    expect(class1.path).toBe(`${moved.path}.${f.class1.replaceAll('-', '')}`)
    await assertTreeConsistent()
    // move back and verify the projection again
    const back = await tree().moveNode(f.tenant, f.collegeA, f.root)
    expect(back.depth).toBe(1)
    await assertTreeConsistent()
    await tree().deleteNode(f.tenant, campus1.id)
    await tree().deleteRule(f.tenant, f.universityType, campus.id)
    await tree().deleteRule(f.tenant, campus.id, f.collegeType)
    await tree().deleteType(f.tenant, campus.id)
  })

  it('serializes concurrent writes that would corrupt the tree together', async () => {
    // with an acyclic rule graph a parent cycle is not even expressible, so
    // the door a cross move would need is concurrent rule creation: two
    // reverse rules whose cycle checks each miss the other. The tenant lock
    // serializes them and exactly one survives.
    const x = await tree().createType(f.tenant, { code: 'cycle-x', name: '环X' })
    const y = await tree().createType(f.tenant, { code: 'cycle-y', name: '环Y' })
    const rules = await Promise.allSettled([
      tree().createRule(f.tenant, x.id, y.id),
      tree().createRule(f.tenant, y.id, x.id),
    ])
    expect(rules.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const lost = rules.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect((lost.reason as DomainError).code).toBe('ORG_RULE_CYCLE')

    // concurrent create-under vs delete-parent: the lock admits either
    // order, but never both succeeding (an orphan under a deleted parent)
    const doomed = await tree().createNode(f.tenant, {
      parentId: f.collegeA,
      orgTypeId: f.classType,
      name: '并发目标',
    })
    const outcome = await Promise.allSettled([
      tree().createNode(f.tenant, {
        parentId: doomed.id,
        orgTypeId: f.classType,
        name: '孤儿候选',
      }),
      tree().deleteNode(f.tenant, doomed.id),
    ])
    // the create can fail on rule or parent, the delete on children; the
    // invariant is that create-child and delete-parent never both succeed
    expect(outcome.every((result) => result.status === 'fulfilled')).toBe(false)
    await assertTreeConsistent()
    await pool.query(`delete from org_nodes where name in ('孤儿候选', '并发目标')`)
    const cleanup =
      rules[0].status === 'fulfilled'
        ? tree().deleteRule(f.tenant, x.id, y.id)
        : tree().deleteRule(f.tenant, y.id, x.id)
    await cleanup
    await tree().deleteType(f.tenant, x.id)
    await tree().deleteType(f.tenant, y.id)
  })

  it('validates parent, children and assignments on type change', async () => {
    // parent rule: collegeA under root cannot become a class
    expect(await orgCode(tree().changeNodeType(f.tenant, f.collegeA, f.classType))).toBe(
      'ORG_NODE_RULE_VIOLATION',
    )
    // children rule: allow university -> class, then collegeA (with class1
    // child) still fails because class -> class is not allowed
    await tree().createRule(f.tenant, f.universityType, f.classType)
    expect(await orgCode(tree().changeNodeType(f.tenant, f.collegeA, f.classType))).toBe(
      'ORG_NODE_RULE_VIOLATION',
    )
    // assignment rule: collegeB has no children, but give it an org-manager
    // assignment (allowed org types: college only) and the change is blocked
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.managerRole, f.collegeB],
    )
    expect(await orgCode(tree().changeNodeType(f.tenant, f.collegeB, f.classType))).toBe(
      'ORG_NODE_ASSIGNMENT_INCOMPATIBLE',
    )
    await pool.query(`delete from user_role_assignments where org_node_id = $1`, [f.collegeB])
    // now the change works both ways
    await tree().changeNodeType(f.tenant, f.collegeB, f.classType)
    await tree().changeNodeType(f.tenant, f.collegeB, f.collegeType)
    await tree().deleteRule(f.tenant, f.universityType, f.classType)
  })

  it('protects nodes and types that are still in use on delete', async () => {
    expect(await orgCode(tree().deleteNode(f.tenant, f.collegeA))).toBe('ORG_NODE_HAS_CHILDREN')
    // class1 carries the student user through the restrict fk
    expect(await orgCode(tree().deleteNode(f.tenant, f.class1))).toBe('ORG_NODE_IN_USE')
    // assignments anchor collegeA even without users
    const empty = await tree().createNode(f.tenant, {
      parentId: f.collegeA,
      orgTypeId: f.classType,
      name: '空班级',
    })
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.managerRole, empty.id],
    )
    expect(await orgCode(tree().deleteNode(f.tenant, empty.id))).toBe('ORG_NODE_IN_USE')
    await pool.query(`delete from user_role_assignments where org_node_id = $1`, [empty.id])
    await tree().deleteNode(f.tenant, empty.id)

    // types: in use by nodes, then by rules, then by role allowed lists
    expect(await orgCode(tree().deleteType(f.tenant, f.collegeType))).toBe('ORG_TYPE_IN_USE')
    const spare = await tree().createType(f.tenant, { code: 'spare', name: '备用类型' })
    await tree().createRule(f.tenant, f.universityType, spare.id)
    expect(await orgCode(tree().deleteType(f.tenant, spare.id))).toBe('ORG_TYPE_IN_USE')
    await tree().deleteRule(f.tenant, f.universityType, spare.id)
    await pool.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, spare.id],
    )
    expect(await orgCode(tree().deleteType(f.tenant, spare.id))).toBe('ORG_TYPE_IN_USE')
    await pool.query(`delete from role_allowed_org_types where org_type_id = $1`, [spare.id])
    await tree().deleteType(f.tenant, spare.id)

    // rules: an existing parent-child node pair blocks the rule delete
    expect(await orgCode(tree().deleteRule(f.tenant, f.collegeType, f.classType))).toBe(
      'ORG_RULE_IN_USE',
    )
    expect(await orgCode(tree().deleteRule(f.tenant, f.classType, f.collegeType))).toBe(
      'ORG_RULE_NOT_FOUND',
    )
  })

  it('keeps tenants isolated at the service level', async () => {
    expect(await orgCode(tree().getSubtree(f.tenantB, f.collegeA))).toBe('ORG_NODE_NOT_FOUND')
    expect(await orgCode(tree().moveNode(f.tenantB, f.collegeA, f.rootB))).toBe(
      'ORG_NODE_NOT_FOUND',
    )
  })

  it('serves the authorized forest over http', async () => {
    // admin sees the whole tree rooted at the root, everything manageable
    const adminTree = await call('GET', '/org/tree', undefined, principal(f.admin))
    expect(adminTree.status).toBe(200)
    const adminBody = (await adminTree.json()) as {
      roots: string[]
      nodes: { id: string; manageable: boolean }[]
    }
    expect(adminBody.roots).toEqual([f.root])
    expect(adminBody.nodes.length).toBeGreaterThanOrEqual(4)
    expect(adminBody.nodes.every((node) => node.manageable)).toBe(true)

    // manager sees exactly the collegeA subtree
    const managerTree = await call('GET', '/org/tree', undefined, principal(f.manager))
    const managerBody = (await managerTree.json()) as {
      roots: string[]
      nodes: { id: string; manageable: boolean }[]
    }
    expect(managerBody.roots).toEqual([f.collegeA])
    expect(managerBody.nodes.map((node) => node.id).sort()).toEqual(
      [f.collegeA, f.class1].sort(),
    )
    expect(managerBody.nodes.every((node) => node.manageable)).toBe(true)

    // a user without any org grant gets an empty forest, not an error
    const studentTree = await call('GET', '/org/tree', undefined, principal(f.student))
    expect(studentTree.status).toBe(200)
    expect(((await studentTree.json()) as { roots: string[] }).roots).toEqual([])

    // anonymous is 401, cross-tenant admin is 403 on an explicit node
    expect((await call('GET', '/org/tree')).status).toBe(401)
    expect(
      (await call('GET', `/org/tree?nodeId=${f.collegeA}`, undefined, principal(f.adminB, f.tenantB)))
        .status,
    ).toBe(403)
  })

  it('rejects unauthorized mutations over http with correct statuses', async () => {
    const manager = principal(f.manager)
    // outside the managed subtree: 403 both for direct mutation and for the
    // destination side of a move
    expect(
      (await call('PATCH', `/org/nodes/${f.collegeB}`, { name: 'X' }, manager)).status,
    ).toBe(403)
    expect(
      (
        await call(
          'POST',
          '/org/nodes',
          { parentId: f.collegeB, orgTypeId: f.classType, name: 'Y' },
          manager,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call('POST', `/org/nodes/${f.class1}/move`, { newParentId: f.collegeB }, manager)
      ).status,
    ).toBe(403)
    // type/rule management targets the root: manager holds no grant there
    expect(
      (await call('POST', '/org/types', { code: 'nope', name: '不行' }, manager)).status,
    ).toBe(403)

    // domain errors map to their statuses (409 conflict, 422 invalid move)
    const admin = principal(f.admin)
    const conflict = await call('PATCH', `/org/nodes/${f.collegeA}`, { name: '理学院' }, admin)
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as { code: string }).code).toBe('ORG_NODE_CONFLICT')
    const invalid = await call(
      'POST',
      `/org/nodes/${f.collegeA}/move`,
      { newParentId: f.class1 },
      admin,
    )
    expect(invalid.status).toBe(422)
    expect(((await invalid.json()) as { code: string }).code).toBe('ORG_NODE_INVALID_MOVE')

    // typed errors carry structured data, not a prebuilt sentence: the
    // browser formats the count into its own locale. collegeB needs a legal
    // target type (university -> class) so the check reaches the assignment
    // rule instead of failing on the parent rule first.
    await tree().createRule(f.tenant, f.universityType, f.classType)
    const guarded = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self') returning id`,
      [f.tenant, f.manager, f.managerRole, f.collegeB],
    )
    try {
      const incompatible = await call(
        'PUT',
        `/org/nodes/${f.collegeB}/type`,
        { orgTypeId: f.classType },
        admin,
      )
      expect(incompatible.status).toBe(409)
      const payload = (await incompatible.json()) as {
        code: string
        message: string
        data?: { assignmentCount?: number }
      }
      expect(payload.code).toBe('ORG_NODE_ASSIGNMENT_INCOMPATIBLE')
      expect(payload.data).toEqual({ assignmentCount: 1 })
      // the english message stays a developer/protocol fallback and never
      // interpolates the count
      expect(payload.message).not.toMatch(/\d/)
    } finally {
      await pool.query(`delete from user_role_assignments where id = $1`, [guarded.rows[0].id])
      await tree().deleteRule(f.tenant, f.universityType, f.classType)
    }
    const missing = await call('DELETE', `/org/nodes/${randomUUID()}`, undefined, admin)
    expect(missing.status).toBe(403)

    // manager can mutate inside the granted subtree
    const create = await call(
      'POST',
      '/org/nodes',
      { parentId: f.collegeA, orgTypeId: f.classType, name: '软件2302' },
      manager,
    )
    expect(create.status).toBe(200)
    const created = ((await create.json()) as { node: { id: string } }).node
    expect((await call('DELETE', `/org/nodes/${created.id}`, undefined, manager)).status).toBe(200)
  })

  it('projects self anchors as bare nodes even for explicit node requests', async () => {
    // a self-scope read grant must never widen into the subtree through the
    // nodeId branch of getTree
    const selfGrant = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self') returning id`,
      [f.tenant, f.student, f.managerRole, f.collegeA],
    )
    const explicit = await call(
      'GET',
      `/org/tree?nodeId=${f.collegeA}`,
      undefined,
      principal(f.student),
    )
    expect(explicit.status).toBe(200)
    const body = (await explicit.json()) as { roots: string[]; nodes: { id: string }[] }
    expect(body.roots).toEqual([f.collegeA])
    // bare: class1 must NOT be disclosed
    expect(body.nodes.map((node) => node.id)).toEqual([f.collegeA])
    // an uncovered node stays indistinguishable from a missing one
    expect(
      (await call('GET', `/org/tree?nodeId=${f.collegeB}`, undefined, principal(f.student))).status,
    ).toBe(403)
    // the subtree-covered manager still gets the whole subtree explicitly
    const managed = await call(
      'GET',
      `/org/tree?nodeId=${f.collegeA}`,
      undefined,
      principal(f.manager),
    )
    expect(((await managed.json()) as { nodes: unknown[] }).nodes.length).toBeGreaterThan(1)
    await pool.query(`delete from user_role_assignments where id = $1`, [selfGrant.rows[0].id])
  })

  it('refuses to move a subtree the caller only holds a self anchor on', async () => {
    // escalation attempt: self anchor on collegeA (whose subtree is not
    // granted) plus a managed destination must not relocate the descendants
    const selfGrant = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self') returning id`,
      [f.tenant, f.student, f.managerRole, f.collegeA],
    )
    const destGrant = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree') returning id`,
      [f.tenant, f.student, f.managerRole, f.collegeB],
    )
    const response = await call(
      'POST',
      `/org/nodes/${f.collegeA}/move`,
      { newParentId: f.collegeB },
      principal(f.student),
    )
    expect(response.status).toBe(403)
    // the tree is untouched
    const row = await pool.query(`select parent_id from org_nodes where id = $1`, [f.collegeA])
    expect(row.rows[0].parent_id).toBe(f.root)
    await pool.query(`delete from user_role_assignments where id = any($1::uuid[])`, [
      [selfGrant.rows[0].id, destGrant.rows[0].id],
    ])
  })

  it('reports subtree capability separately from single-node capability', async () => {
    // a self manage grant can rename but never move: the ui must see the
    // difference instead of offering a move the server will refuse
    const selfGrant = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self') returning id`,
      [f.tenant, f.student, f.managerRole, f.collegeA],
    )
    const selfView = await call('GET', '/org/tree', undefined, principal(f.student))
    const selfNode = ((await selfView.json()) as {
      nodes: { id: string; manageable: boolean; subtreeManageable: boolean }[]
    }).nodes.find((node) => node.id === f.collegeA)
    expect(selfNode).toMatchObject({ manageable: true, subtreeManageable: false })

    const managerView = await call('GET', '/org/tree', undefined, principal(f.manager))
    const managerNode = ((await managerView.json()) as {
      nodes: { id: string; manageable: boolean; subtreeManageable: boolean }[]
    }).nodes.find((node) => node.id === f.collegeA)
    expect(managerNode).toMatchObject({ manageable: true, subtreeManageable: true })
    await pool.query(`delete from user_role_assignments where id = $1`, [selfGrant.rows[0].id])
  })

  it('re-validates type and rule management at the root inside the lock', async () => {
    // service-level calls carrying a principal without root manage fail even
    // though no router pre-check ran
    expect(
      await orgCode(
        tree().createType(f.tenant, { code: 'nope', name: '不行' }, principal(f.manager)),
      ),
    ).toBe('ACCESS_DENIED')
    expect(
      await orgCode(
        tree().deleteRule(f.tenant, f.collegeType, f.classType, principal(f.manager)),
      ),
    ).toBe('ACCESS_DENIED')
    // the admin passes the same in-lock check
    const spare = await tree().createType(
      f.tenant,
      { code: 'inlock-spare', name: '锁内备用' },
      principal(f.admin),
    )
    await tree().deleteType(f.tenant, spare.id, principal(f.admin))
  })

  it('re-validates authorization inside the locked transaction', async () => {
    // the in-lock check stands alone: a service call carrying a principal
    // whose anchors do not cover the target fails even though no router
    // pre-check ran (this is the mechanism that closes the check-then-lock
    // window against concurrent moves)
    expect(
      await orgCode(
        tree().updateNode(f.tenant, f.collegeB, { name: '越权' }, principal(f.manager)),
      ),
    ).toBe('ACCESS_DENIED')
    // inside the granted subtree the same call passes
    const renamed = await tree().updateNode(
      f.tenant,
      f.class1,
      { name: '软件2301' },
      principal(f.manager),
    )
    expect(renamed.name).toBe('软件2301')
  })

  it('reduces overlapping anchors and keeps self anchors bare', async () => {
    // a second, nested subtree grant collapses into the root grant; a self
    // grant on an uncovered node surfaces as a bare node
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.admin, f.tenantAdminRole, f.root],
    ).catch(() => {})
    const managerSelf = await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self') returning id`,
      [f.tenant, f.manager, f.managerRole, f.collegeB],
    )
    const response = await call('GET', '/org/tree', undefined, principal(f.manager))
    const body = (await response.json()) as {
      roots: string[]
      nodes: { id: string; manageable: boolean }[]
    }
    expect(body.roots.sort()).toEqual([f.collegeA, f.collegeB].sort())
    // collegeB appears bare: no children of it are included
    const ids = new Set(body.nodes.map((node) => node.id))
    expect(ids.has(f.collegeB)).toBe(true)
    expect(ids.has(f.class1)).toBe(true)
    await pool.query(`delete from user_role_assignments where id = $1`, [
      managerSelf.rows[0].id,
    ])
  })
})
