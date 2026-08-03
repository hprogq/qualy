import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@qualy/plugin-database/migrator'
import Database from '@qualy/plugin-database'
import type { RbacService } from '@qualy/rbac-contract'
import Rbac from '../src/index.ts'
import { isDomainError } from '@qualy/api-contract'
import { Administration, type RoleRow } from '../src/administration.ts'

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
if (!available) console.warn('postgres unreachable, rbac tests skipped')

// drop database ... with (force) races graceful client teardown: a killed
// backend's fatal 57P01 lands on a closing socket and would surface as an
// unhandled error without a listener
const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

const CATALOG = [
  {
    code: 'test.portal.access',
    name: 'portal',
    scope: 'tenant',
    grantToUserType: true,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'test.role.manage',
    name: 'manage roles',
    scope: 'tenant',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'test.tree.manage',
    name: 'manage tree',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'test.user.manage',
    name: 'manage users',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    // a user-type-only permission: the role channel is declared closed
    code: 'test.usertype.only',
    name: 'user type only',
    scope: 'tenant',
    grantToUserType: true,
    grantToRole: false,
    defaultTenantAdmin: false,
  },
] as const

describe.runIf(available)('rbac', () => {
  const adminPool = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_rbac_${randomUUID().slice(0, 8)}`
  let pool: Pool
  let ctx: Context
  let rbac: RbacService
  // fixture ids
  const f = {
    tenant: '',
    tenantB: '',
    root: '',
    college: '',
    otherCollege: '',
    class1: '',
    typeAdmin: '',
    typeFaculty: '',
    typeStudent: '',
    admin: '',
    manager: '',
    student: '',
    adminB: '',
    tenantAdminRole: '',
    managerRole: '',
    collegeType: '',
    classType: '',
  }
  const principal = (userId: string, tenantId = f.tenant) => ({
    tenantId,
    userId,
    sessionId: 'test-session',
  })
  // the service owns the wired instance: administration now decides
  // authorization itself, so it needs the same authorization the api uses
  const administration = () => (rbac as unknown as { administration: Administration }).administration

  beforeAll(async () => {
    await adminPool.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = quietPool({ connectionString: url.href })
    await runMigrations(pool, { folder: migrationsFolder })

    const row = async (text: string, params: unknown[] = []) =>
      (await pool.query(text, params)).rows[0].id as string

    // two tenants with a small org tree, three user types, three users
    f.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    f.tenantB = await row(`insert into tenants (slug, name) values ('b', 'B') returning id`)
    const uniType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'university', 'U') returning id`,
      [f.tenant],
    )
    f.collegeType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'college', 'C') returning id`,
      [f.tenant],
    )
    f.classType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'class', 'K') returning id`,
      [f.tenant],
    )
    f.root = await row(
      `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
       values ($1, $2, 'Root', 'r', 0) returning id`,
      [f.tenant, uniType],
    )
    f.college = await row(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'College', 'r.c1', 1) returning id`,
      [f.tenant, f.collegeType, f.root],
    )
    f.otherCollege = await row(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'Other College', 'r.c2', 1) returning id`,
      [f.tenant, f.collegeType, f.root],
    )
    f.class1 = await row(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'Class 1', 'r.c1.k1', 2) returning id`,
      [f.tenant, f.classType, f.college],
    )
    f.typeAdmin = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'administrator', 'Admin', true, 'unrestricted') returning id`,
      [f.tenant],
    )
    f.typeFaculty = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'faculty', 'Faculty', true, 'unrestricted') returning id`,
      [f.tenant],
    )
    f.typeStudent = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'student', 'Student', true, 'unrestricted') returning id`,
      [f.tenant],
    )
    const user = (name: string, typeId: string, node: string, tenant = f.tenant) =>
      row(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, $2, $3, $4) returning id`,
        [tenant, name, typeId, node],
      )
    f.admin = await user('Admin', f.typeAdmin, f.root)
    f.manager = await user('Manager', f.typeFaculty, f.college)
    f.student = await user('Student', f.typeStudent, f.class1)

    // tenant B mirrors the admin setup to prove isolation
    const uniTypeB = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'university', 'U') returning id`,
      [f.tenantB],
    )
    const rootB = await row(
      `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
       values ($1, $2, 'Root B', 'rb', 0) returning id`,
      [f.tenantB, uniTypeB],
    )
    const typeAdminB = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'administrator', 'Admin', true, 'unrestricted') returning id`,
      [f.tenantB],
    )
    f.adminB = await user('Admin B', typeAdminB, rootB, f.tenantB)

    // roles: system tenant-admin plus an org role restricted to faculty@college
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
      [f.tenant, f.managerRole, f.typeFaculty],
    )
    await pool.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.collegeType],
    )

    ctx = new Context()
    await ctx.plugin(Database, { url: url.href, migrations: 'off' })
    await ctx.plugin(Rbac)
    rbac = ctx.rbac
    // register the test catalog through a scoped plugin and wait for the
    // database mirror (creates rows + tenant-admin mappings)
    await ctx.plugin({
      name: 'catalog',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('test', CATALOG)
      },
    })
    await rbac.whenSynced()

    // manager role gets the org-scope permissions; user types get portal
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code in ('test.tree.manage', 'test.user.manage')`,
      [f.tenant, f.managerRole],
    )
    await pool.query(
      `insert into user_type_permissions (tenant_id, user_type_id, permission_id)
       select $1, ut.id, p.id from user_types ut, permissions p
       where ut.tenant_id = $1 and p.code = 'test.portal.access'`,
      [f.tenant],
    )
    // assignments: admin over root/subtree, manager over college/subtree
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.admin, f.tenantAdminRole, f.root],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.manager, f.managerRole, f.college],
    )
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    await pool?.end()
    await adminPool.query(`drop database if exists "${dbName}" with (force)`)
    await adminPool.end()
  })

  // domain errors surface their code; anything else its message
  const domainCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error) => (isDomainError(error) ? error.code : ((error as Error).message ?? 'error')),
    )

  const orpcCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error) => (error as { code?: string }).code ?? (error as Error).message,
    )

  it('matches the access matrix for admin, manager and student', async () => {
    // portal access flows from the user type for everyone
    for (const user of [f.admin, f.manager, f.student]) {
      expect(await rbac.hasPermission(principal(user), 'test.portal.access')).toBe(true)
    }
    // role management is tenant scope: admin only
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('ok')
    expect(await orpcCode(rbac.require(principal(f.manager), 'test.role.manage'))).toBe('FORBIDDEN')
    expect(await orpcCode(rbac.require(principal(f.student), 'test.role.manage'))).toBe('FORBIDDEN')
    // college subtree: admin (root subtree) and manager (college subtree)
    expect(await rbac.canAt(principal(f.admin), 'test.tree.manage', f.class1)).toBe(true)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(true)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.class1)).toBe(true)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(false)
    // the other college stays out of the manager's reach
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.otherCollege)).toBe(false)
    expect(await rbac.canAt(principal(f.admin), 'test.user.manage', f.otherCollege)).toBe(true)
  })

  it('distinguishes 401 from 403 and validates scope usage', async () => {
    expect(await orpcCode(rbac.require(undefined, 'test.role.manage'))).toBe('AUTH_REQUIRED')
    expect(await orpcCode(rbac.requireAt(undefined, 'test.tree.manage', f.college))).toBe(
      'AUTH_REQUIRED',
    )
    expect(
      await orpcCode(rbac.requireAt(principal(f.student), 'test.tree.manage', f.college)),
    ).toBe('FORBIDDEN')
    // wrong scope is a programming error, not a 403
    await expect(rbac.require(principal(f.admin), 'test.tree.manage')).rejects.toThrow(
      /use requireAt/,
    )
    await expect(rbac.canAt(principal(f.admin), 'test.role.manage', f.root)).rejects.toThrow(
      /use require/,
    )
  })

  it('self scope covers exactly the node, subtree includes itself', async () => {
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.student, f.managerRole, f.college],
    )
    // wrong-typed grant on purpose: the check only cares about scope shape
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.college)).toBe(true)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(false)
    await pool.query(`delete from user_role_assignments where user_id = $1 and scope = 'self'`, [
      f.student,
    ])
  })

  it('fails closed on disabled roles, permissions and inactive plugins', async () => {
    await pool.query(`update roles set enabled = false where id = $1`, [f.managerRole])
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(false)
    await pool.query(`update roles set enabled = true where id = $1`, [f.managerRole])

    await pool.query(`update permissions set enabled = false where code = 'test.tree.manage'`)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(false)
    await pool.query(`update permissions set enabled = true where code = 'test.tree.manage'`)

    // deactivating the declaring plugin removes the codes from the active
    // set while rows and grants survive
    const scoped = ctx.plugin({
      name: 'transient',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('transient', [
          {
            code: 'transient.thing.use',
            name: 't',
            scope: 'tenant',
            grantToUserType: false,
            grantToRole: true,
            defaultTenantAdmin: true,
          },
        ])
      },
    })
    await scoped
    await rbac.whenSynced()
    expect(await orpcCode(rbac.require(principal(f.admin), 'transient.thing.use'))).toBe('ok')
    await scoped.dispose()
    expect(await orpcCode(rbac.require(principal(f.admin), 'transient.thing.use'))).toBe(
      'FORBIDDEN',
    )
    const rows = await pool.query(`select count(*) from permissions where code like 'transient.%'`)
    expect(Number(rows.rows[0].count)).toBe(1)
  })

  it('keeps tenants fully isolated', async () => {
    expect(await rbac.canAt(principal(f.adminB, f.tenantB), 'test.tree.manage', f.college)).toBe(
      false,
    )
    expect(await orpcCode(rbac.require(principal(f.adminB, f.tenantB), 'test.role.manage'))).toBe(
      'FORBIDDEN',
    )
    // a forged principal mixing tenant A's user with tenant B fails too
    expect(await orpcCode(rbac.require(principal(f.admin, f.tenantB), 'test.role.manage'))).toBe(
      'FORBIDDEN',
    )
  })

  it('reports the profile as the union of both grant sources', async () => {
    const admin = await rbac.getProfile(principal(f.admin))
    expect(admin.tenantPermissions).toContain('test.portal.access')
    expect(admin.tenantPermissions).toContain('test.role.manage')
    expect(admin.orgPermissions).toContain('test.tree.manage')
    const student = await rbac.getProfile(principal(f.student))
    expect(student.tenantPermissions).toEqual(['test.portal.access'])
    expect(student.orgPermissions).toEqual([])
  })

  it('rejects semantics drift by disabling the code', async () => {
    const scoped = ctx.plugin({
      name: 'drift',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('drift', [
          {
            // same code as the test catalog but org scope: the database row
            // wins, the definition is disabled loudly
            code: 'test.role.manage',
            name: 'drifted',
            scope: 'org',
            grantToUserType: false,
            grantToRole: true,
            defaultTenantAdmin: false,
          },
        ])
      },
    })
    // in-memory conflict with the active catalog fires first
    await expect(Promise.resolve(scoped)).rejects.toThrow('permission code conflict')
  })

  it('enforces assignment eligibility', async () => {
    // student type is not in the allowed set of the manager role
    await expect(
      rbac.createAssignment({
        tenantId: f.tenant,
        userId: f.student,
        roleId: f.managerRole,
        orgNodeId: f.college,
        scope: 'self',
      }),
    ).rejects.toThrow(/cannot be granted to this user at this node/)
    // class node type is not in the allowed org types
    await expect(
      rbac.createAssignment({
        tenantId: f.tenant,
        userId: f.manager,
        roleId: f.managerRole,
        orgNodeId: f.class1,
        scope: 'self',
      }),
    ).rejects.toThrow(/cannot be granted to this user at this node/)
    // tenant roles only bind to the root with subtree scope
    await expect(
      rbac.createAssignment({
        tenantId: f.tenant,
        userId: f.admin,
        roleId: f.tenantAdminRole,
        orgNodeId: f.college,
        scope: 'subtree',
      }),
    ).rejects.toThrow(/cannot be granted to this user at this node/)
    // duplicates are refused
    await expect(
      rbac.createAssignment({
        tenantId: f.tenant,
        userId: f.manager,
        roleId: f.managerRole,
        orgNodeId: f.college,
        scope: 'subtree',
      }),
    ).rejects.toThrow(/already exists/)
    // a valid one passes and can be removed again
    const id = await rbac.createAssignment({
      tenantId: f.tenant,
      userId: f.manager,
      roleId: f.managerRole,
      orgNodeId: f.college,
      scope: 'self',
    })
    await rbac.removeAssignment(f.tenant, id)
  })

  it('protects the last tenant administrator', async () => {
    const assignment = (
      await pool.query(
        `select id from user_role_assignments where tenant_id = $1 and role_id = $2`,
        [f.tenant, f.tenantAdminRole],
      )
    ).rows[0]
    await expect(rbac.removeAssignment(f.tenant, assignment.id)).rejects.toThrow(
      /must keep an administrator who can still sign in/,
    )
    // a second admin makes removal legal again
    const second = await rbac.createAssignment({
      tenantId: f.tenant,
      userId: f.manager,
      roleId: f.tenantAdminRole,
      orgNodeId: f.root,
      scope: 'subtree',
    })
    await rbac.removeAssignment(f.tenant, assignment.id)
    // and the survivor is now protected
    await expect(rbac.removeAssignment(f.tenant, second)).rejects.toThrow(
      /must keep an administrator who can still sign in/,
    )
  })

  it('serializes concurrent administrator removals', async () => {
    // two administrators, both assignments removed concurrently: the role
    // row lock forces the second transaction to see the first delete, so
    // exactly one removal wins
    await rbac.createAssignment({
      tenantId: f.tenant,
      userId: f.admin,
      roleId: f.tenantAdminRole,
      orgNodeId: f.root,
      scope: 'subtree',
    })
    const ids = (
      await pool.query(
        `select id from user_role_assignments where tenant_id = $1 and role_id = $2`,
        [f.tenant, f.tenantAdminRole],
      )
    ).rows.map((row) => row.id as string)
    expect(ids).toHaveLength(2)
    const results = await Promise.allSettled(ids.map((id) => rbac.removeAssignment(f.tenant, id)))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const left = await pool.query(
      `select count(distinct user_id) from user_role_assignments where tenant_id = $1 and role_id = $2`,
      [f.tenant, f.tenantAdminRole],
    )
    expect(Number(left.rows[0].count)).toBe(1)
  })

  it('validates catalogs before activation', () => {
    expect(() => rbac.definePermissions('dup', [CATALOG[0], CATALOG[0]])).toThrow(/twice/)
    expect(() =>
      rbac.definePermissions('bad', [
        {
          code: 'bad.thing.use',
          name: 'b',
          scope: 'tenant',
          grantToUserType: false,
          grantToRole: false,
          defaultTenantAdmin: true,
        },
      ]),
    ).toThrow(/requires grantToRole/)
  })

  it('rejects grant rows that violate the permission channels at the write path', async () => {
    const pgCode = (promise: Promise<unknown>) =>
      promise.then(
        () => 'no error',
        (error) => (error as { code?: string }).code,
      )
    const grantToType = (code: string) =>
      pool.query(
        `insert into user_type_permissions (tenant_id, user_type_id, permission_id)
         select $1, $2, p.id from permissions p where p.code = $3`,
        [f.tenant, f.typeStudent, code],
      )
    // org scope and a closed user-type channel are both refused
    expect(await pgCode(grantToType('test.tree.manage'))).toBe('23514')
    expect(await pgCode(grantToType('test.role.manage'))).toBe('23514')
    // a user-type-only permission cannot be granted to roles
    await pool.query(
      `insert into permissions (code, plugin, name, scope, grant_to_user_type, grant_to_role, default_tenant_admin)
       values ('usertype.only.use', 'test', 'UT only', 'tenant', true, false, false)`,
    )
    expect(
      await pgCode(
        pool.query(
          `insert into role_permissions (tenant_id, role_id, permission_id)
           select $1, $2, p.id from permissions p where p.code = 'usertype.only.use'`,
          [f.tenant, f.managerRole],
        ),
      ),
    ).toBe('23514')
    // defaultTenantAdmin without the role channel dies on the check constraint
    expect(
      await pgCode(
        pool.query(
          `insert into permissions (code, plugin, name, scope, grant_to_user_type, grant_to_role, default_tenant_admin)
           values ('bad.default.use', 'test', 'bad', 'tenant', true, false, true)`,
        ),
      ),
    ).toBe('23514')
  })

  it('ignores grants whose permission channel was turned off later', async () => {
    // triggers cannot retract rows that were legal when written; the read
    // path re-checks the channel flags so stale grants go dead immediately
    expect(await rbac.hasPermission(principal(f.student), 'test.portal.access')).toBe(true)
    await pool.query(`update permissions set grant_to_user_type = false
      where code = 'test.portal.access'`)
    expect(await rbac.hasPermission(principal(f.student), 'test.portal.access')).toBe(false)
    const profile = await rbac.getProfile(principal(f.student))
    expect(profile.tenantPermissions).not.toContain('test.portal.access')
    await pool.query(`update permissions set grant_to_user_type = true
      where code = 'test.portal.access'`)

    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(true)
    await pool.query(`update permissions set grant_to_role = false, default_tenant_admin = false
      where code = 'test.tree.manage'`)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(false)
    await pool.query(`update permissions set grant_to_role = true, default_tenant_admin = true
      where code = 'test.tree.manage'`)
  })

  it('never widens authorization when a closed channel is flipped open', async () => {
    // user-type channel: test.role.manage declares grantToUserType false.
    // Once the flag is flipped out of band, the trigger accepts the grant
    // row, but the query branch stays closed by the active definition
    await pool.query(`update permissions set grant_to_user_type = true
      where code = 'test.role.manage'`)
    await pool.query(
      `insert into user_type_permissions (tenant_id, user_type_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'test.role.manage'`,
      [f.tenant, f.typeStudent],
    )
    expect(await rbac.hasPermission(principal(f.student), 'test.role.manage')).toBe(false)
    expect(await orpcCode(rbac.require(principal(f.student), 'test.role.manage'))).toBe('FORBIDDEN')
    const studentProfile = await rbac.getProfile(principal(f.student))
    expect(studentProfile.tenantPermissions).not.toContain('test.role.manage')
    await pool.query(`delete from user_type_permissions where permission_id in
      (select id from permissions where code = 'test.role.manage')`)
    await pool.query(`update permissions set grant_to_user_type = false
      where code = 'test.role.manage'`)
    // legitimate grants recover once the row matches the definition again
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('ok')

    // role channel: test.usertype.only declares grantToRole false
    await pool.query(`update permissions set grant_to_role = true
      where code = 'test.usertype.only'`)
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'test.usertype.only'`,
      [f.tenant, f.tenantAdminRole],
    )
    expect(await rbac.hasPermission(principal(f.admin), 'test.usertype.only')).toBe(false)
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.usertype.only'))).toBe('FORBIDDEN')
    const adminProfile = await rbac.getProfile(principal(f.admin))
    expect(adminProfile.tenantPermissions).not.toContain('test.usertype.only')
    await pool.query(`delete from role_permissions where permission_id in
      (select id from permissions where code = 'test.usertype.only')`)
    await pool.query(`update permissions set grant_to_role = false
      where code = 'test.usertype.only'`)
  })

  it('fails closed when a declaration conflicts with the stored owner', async () => {
    // the stored row belongs to ghost and already carries a live grant, so a
    // pre-verification activation would authorize immediately
    await pool.query(
      `insert into permissions (code, plugin, name, scope, grant_to_user_type, grant_to_role, default_tenant_admin)
       values ('ghost.thing.use', 'ghost', 'G', 'tenant', false, true, false)`,
    )
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'ghost.thing.use'`,
      [f.tenant, f.tenantAdminRole],
    )
    const scoped = ctx.plugin({
      name: 'intruder',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('intruder', [
          {
            code: 'ghost.thing.use',
            name: 'G',
            scope: 'tenant',
            grantToUserType: false,
            grantToRole: true,
            defaultTenantAdmin: false,
          },
        ])
      },
    })
    await scoped
    // before the database sync settles the definition is pending, not
    // active: no fail-open window between registration and verification
    expect(await orpcCode(rbac.require(principal(f.admin), 'ghost.thing.use'))).toBe('FORBIDDEN')
    await expect(rbac.whenSynced()).rejects.toThrow(/rejected: ghost\.thing\.use/)
    expect(await orpcCode(rbac.require(principal(f.admin), 'ghost.thing.use'))).toBe('FORBIDDEN')
    // the stored row keeps its original owner
    const row = await pool.query(`select plugin from permissions where code = 'ghost.thing.use'`)
    expect(row.rows[0].plugin).toBe('ghost')

    // a later successful catalog must not mask the standing failure
    const clean = ctx.plugin({
      name: 'clean-after',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('clean-after', [
          {
            code: 'clean.thing.use',
            name: 'C',
            scope: 'tenant',
            grantToUserType: false,
            grantToRole: true,
            defaultTenantAdmin: false,
          },
        ])
      },
    })
    await clean
    await expect(rbac.whenSynced()).rejects.toThrow(/ghost\.thing\.use/)
    // disposing the failed registration clears the error, the clean one stays
    await scoped.dispose()
    await rbac.whenSynced()
    expect(await orpcCode(rbac.require(principal(f.admin), 'ghost.thing.use'))).toBe('FORBIDDEN')
    await clean.dispose()
    await pool.query(`delete from role_permissions where permission_id in
      (select id from permissions where code = 'ghost.thing.use')`)
  })

  it('re-checks the stored owner on every authorization', async () => {
    // hijacking the row's owner after activation kills the grant at read time
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('ok')
    await pool.query(`update permissions set plugin = 'hijacker' where code = 'test.role.manage'`)
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('FORBIDDEN')
    const profile = await rbac.getProfile(principal(f.admin))
    expect(profile.tenantPermissions).not.toContain('test.role.manage')
    await pool.query(`update permissions set plugin = 'test' where code = 'test.role.manage'`)
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('ok')
  })

  it('lets concurrent instances converge on a single owner', async () => {
    // two application instances race to claim the same fresh code with
    // different owners: insert-then-reread converges both on the stored row
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    const other = new Context()
    await other.plugin(Database, { url: url.href, migrations: 'off' })
    await other.plugin(Rbac)
    const definition = {
      code: 'contested.thing.use',
      name: 'contested',
      scope: 'tenant' as const,
      grantToUserType: false,
      grantToRole: true,
      defaultTenantAdmin: false,
    }
    const alpha = ctx.plugin({
      name: 'alpha',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('alpha', [definition])
      },
    })
    const beta = other.plugin({
      name: 'beta',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('beta', [definition])
      },
    })
    await Promise.all([alpha, beta])
    const settled = await Promise.allSettled([rbac.whenSynced(), other.rbac.whenSynced()])
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
    // the stored row names the winner
    const row = await pool.query(`select plugin from permissions where code = 'contested.thing.use'`)
    expect(row.rows[0].plugin).toBe(settled[0]!.status === 'fulfilled' ? 'alpha' : 'beta')
    await alpha.dispose()
    await other.fiber.dispose()
  })

  it('treats defaultTenantAdmin as stable semantics', async () => {
    await pool.query(
      `insert into permissions (code, plugin, name, scope, grant_to_user_type, grant_to_role, default_tenant_admin)
       values ('flip.thing.use', 'flipper', 'F', 'tenant', false, true, false)`,
    )
    const scoped = ctx.plugin({
      name: 'flipper',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('flipper', [
          {
            code: 'flip.thing.use',
            name: 'F',
            scope: 'tenant',
            grantToUserType: false,
            grantToRole: true,
            // true against a stored false: silently widening tenant-admin
            // is exactly what stable semantics forbid
            defaultTenantAdmin: true,
          },
        ])
      },
    })
    await scoped
    await expect(rbac.whenSynced()).rejects.toThrow(/rejected: flip\.thing\.use/)
    expect(await orpcCode(rbac.require(principal(f.admin), 'flip.thing.use'))).toBe('FORBIDDEN')
    // no tenant-admin mapping was injected on the way down
    const mapped = await pool.query(
      `select count(*) from role_permissions rp
       join permissions p on p.id = rp.permission_id where p.code = 'flip.thing.use'`,
    )
    expect(Number(mapped.rows[0].count)).toBe(0)
    await scoped.dispose()
  })

  it('administers roles without letting the tenant lock itself out', async () => {
    const admin = administration()
    const roles = await admin.listRoles(f.tenant)
    const canonical = roles.find((role: RoleRow) => role.code === 'tenant-admin')!
    const manager = roles.find((role: RoleRow) => role.code === 'org-manager')!

    // the canonical administrator role is immutable where it matters
    expect(await domainCode(admin.setRoleEnabled(f.tenant, canonical.id, false))).toBe(
      'ROLE_IS_SYSTEM',
    )
    expect(await domainCode(admin.deleteRole(f.tenant, canonical.id))).toBe('ROLE_IS_SYSTEM')
    expect(
      await domainCode(admin.updateRole(f.tenant, canonical.id, { assignable: false })),
    ).toBe('ROLE_IS_SYSTEM')
    expect(await domainCode(admin.syncRolePermissions(f.tenant, canonical.id, []))).toBe(
      'ROLE_IS_SYSTEM',
    )
    // its display name stays editable
    await admin.updateRole(f.tenant, canonical.id, { name: 'Tenant administrator' })

    // an org role may only hold org-scope permissions
    expect(
      await domainCode(admin.syncRolePermissions(f.tenant, manager.id, ['test.role.manage'])),
    ).toBe('ROLE_PERMISSION_NOT_GRANTABLE')
    await admin.syncRolePermissions(f.tenant, manager.id, ['test.tree.manage'])
    expect(
      (await admin.listRoles(f.tenant)).find((role: RoleRow) => role.id === manager.id)?.permissions,
    ).toEqual(['test.tree.manage'])

    // a role that is still assigned cannot be deleted
    expect(await domainCode(admin.deleteRole(f.tenant, manager.id))).toBe('ROLE_IN_USE')

    // narrowing the allowed sets must not strand the manager's assignment
    const otherType = (
      await pool.query(
        `insert into org_types (tenant_id, code, name) values ($1, 'other', 'Other') returning id`,
        [f.tenant],
      )
    ).rows[0].id as string
    expect(
      await domainCode(admin.syncRoleEligibility(f.tenant, manager.id, { orgTypeIds: [otherType] })),
    ).toBe('ASSIGNMENT_STRANDED')
    // an empty set is refused outright
    expect(
      await domainCode(admin.syncRoleEligibility(f.tenant, manager.id, { orgTypeIds: [] })),
    ).toBe('ROLE_NEEDS_ELIGIBILITY')
    // widening is fine
    await admin.syncRoleEligibility(f.tenant, manager.id, {
      orgTypeIds: [f.collegeType, otherType],
    })
  })

  it('reserves the canonical administrator role for its own holders', async () => {
    const admin = administration()
    const roles = await admin.listRoles(f.tenant)
    const canonical = roles.find((role: RoleRow) => role.code === 'tenant-admin')!

    // The scenario the reservation exists for: an org manager who legitimately
    // administers grants across the whole tree, and still must not be able to
    // promote themselves. Giving them that authority first is what isolates
    // the role rule from the node rule.
    const broad = (
      await pool.query(
        `insert into roles (tenant_id, code, name, kind) values ($1, 'grant-admin', 'GA', 'org')
         returning id`,
        [f.tenant],
      )
    ).rows[0].id as string
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, id from permissions where code = 'rbac.assignment.manage'`,
      [f.tenant, broad],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.manager, broad, f.root],
    )
    const keep = (await admin.listAssignments(f.tenant, { userId: f.manager })).map((row) => ({
      roleId: row.role_id,
      orgNodeId: row.org_node_id,
      scope: row.scope,
    }))
    const grant = { roleId: canonical.id, orgNodeId: f.root, scope: 'subtree' as const }

    // they may administer every node they touch, and are still refused
    expect(
      await domainCode(
        admin.syncUserAssignments(f.tenant, f.manager, [...keep, grant], principal(f.manager)),
      ),
    ).toBe('TENANT_ADMIN_REQUIRED')
    // an administrator may, which proves the refusal was about the role
    await admin.syncUserAssignments(f.tenant, f.manager, [...keep, grant], principal(f.admin))
    expect(
      (await admin.listAssignments(f.tenant, { userId: f.manager })).some(
        (row) => row.role_id === canonical.id,
      ),
    ).toBe(true)
    // now that they hold it they may also give it up: holding the role IS
    // what authorizes administering it, and the tenant is still protected by
    // the survivor invariant rather than by this rule
    await admin.syncUserAssignments(f.tenant, f.manager, keep, principal(f.manager))
    // and having given it up they cannot take it back
    expect(
      await domainCode(
        admin.syncUserAssignments(f.tenant, f.manager, [...keep, grant], principal(f.manager)),
      ),
    ).toBe('TENANT_ADMIN_REQUIRED')
    await pool.query(`delete from user_role_assignments where role_id = $1`, [broad])
    await pool.query(`delete from roles where id = $1`, [broad])
  })

  it('replaces a user assignment set without dropping the last administrator', async () => {
    const admin = administration()
    // the admin is the only holder: clearing their set must fail as a whole,
    // and it fails with a declared code rather than a plain error that would
    // reach a browser as an unexplained 500
    expect(await domainCode(admin.syncUserAssignments(f.tenant, f.admin, []))).toBe(
      'LAST_ADMINISTRATOR',
    )
    const kept = await admin.listAssignments(f.tenant, { userId: f.admin })
    expect(kept.length).toBeGreaterThan(0)

    // a set that adds an eligible org assignment applies
    await admin.syncUserAssignments(f.tenant, f.manager, [
      { roleId: f.managerRole, orgNodeId: f.college, scope: 'subtree' },
    ])
    const managerAssignments = await admin.listAssignments(f.tenant, { userId: f.manager })
    expect(managerAssignments.map((row) => row.scope)).toEqual(['subtree'])

    // an ineligible node type is refused
    expect(
      await domainCode(
        admin.syncUserAssignments(f.tenant, f.manager, [
          { roleId: f.managerRole, orgNodeId: f.class1, scope: 'self' },
        ]),
      ),
    ).toBe('ASSIGNMENT_NOT_ELIGIBLE')
  })
})
