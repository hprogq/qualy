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
import { isDomainError } from '@qualy/api-contract'
import { permissions as authPermissions } from '../src/permissions.ts'
import { IamService } from '../src/iam/service.ts'

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
if (!available) console.warn('postgres unreachable, iam tests skipped')

const quietPool = (config: ConstructorParameters<typeof Pool>[0]) => {
  const pool = new Pool(config)
  pool.on('error', () => {})
  return pool
}

describe.runIf(available)('identity administration', () => {
  const adminPool = quietPool({ connectionString: baseUrl })
  const dbName = `qualy_iam_${randomUUID().slice(0, 8)}`
  let pool: Pool
  let ctx: Context
  let iam: IamService

  const f = {
    tenant: '',
    root: '',
    college: '',
    universityType: '',
    collegeType: '',
    adminType: '',
    facultyType: '',
    admin: '',
    manager: '',
    tenantAdminRole: '',
    managerRole: '',
  }

  const code = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error) => (isDomainError(error) ? error.code : ((error as Error).message ?? 'error')),
    )

  beforeAll(async () => {
    await adminPool.query(`create database "${dbName}"`)
    const url = new URL(baseUrl)
    url.pathname = `/${dbName}`
    pool = quietPool({ connectionString: url.href })
    await runMigrations(pool, { folder: migrationsFolder })

    const row = async (text: string, params: unknown[] = []) =>
      (await pool.query(text, params)).rows[0].id as string

    f.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    f.universityType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'university', 'U') returning id`,
      [f.tenant],
    )
    f.collegeType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'college', 'C') returning id`,
      [f.tenant],
    )
    f.root = await row(
      `insert into org_nodes (id, tenant_id, org_type_id, name, path, depth)
       select v.id, $1, $2, 'Root', replace(v.id::text, '-', '')::ltree, 0
       from (select uuidv7() as id) v returning id`,
      [f.tenant, f.universityType],
    )
    f.college = await row(
      `insert into org_nodes (id, tenant_id, org_type_id, parent_id, name, path, depth)
       select v.id, $1, $2, $3, 'College',
         ((select path::text from org_nodes where id = $3) || '.' ||
          replace(v.id::text, '-', ''))::ltree, 1
       from (select uuidv7() as id) v returning id`,
      [f.tenant, f.collegeType, f.root],
    )
    f.adminType = await row(
      `insert into user_types (tenant_id, code, name, is_system) values ($1, 'administrator', 'Admin', true) returning id`,
      [f.tenant],
    )
    f.facultyType = await row(
      `insert into user_types (tenant_id, code, name) values ($1, 'faculty', 'Faculty') returning id`,
      [f.tenant],
    )
    f.admin = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Admin', $2, $3) returning id`,
      [f.tenant, f.adminType, f.root],
    )
    f.manager = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Manager', $2, $3) returning id`,
      [f.tenant, f.facultyType, f.college],
    )
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
      [f.tenant, f.managerRole, f.facultyType],
    )
    await pool.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.collegeType],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, f.admin, f.tenantAdminRole, f.root],
    )

    ctx = new Context()
    await ctx.plugin(Database, { url: url.href, migrations: 'off' })
    await ctx.plugin(Server, { port: 0 })
    await ctx.plugin(UiRegistry)
    await ctx.plugin(Rbac)
    // the permission rows come from the declaring plugins; the auth catalog
    // is registered directly so the whole session service is not needed here
    await ctx.plugin({
      name: 'auth-catalog',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('auth', authPermissions)
      },
    })
    await ctx.rbac.whenSynced()
    iam = new IamService(ctx)
  })

  afterAll(async () => {
    await ctx?.fiber.dispose()
    await pool?.end()
    await adminPool.query(`drop database if exists "${dbName}" with (force)`)
    await adminPool.end()
  })

  it('creates user types and refuses duplicate codes', async () => {
    const id = await iam.createUserType(f.tenant, { code: 'student', name: 'Student' })
    expect(id).toBeTruthy()
    expect(await code(iam.createUserType(f.tenant, { code: 'student', name: 'Other' }))).toBe(
      'USER_TYPE_CONFLICT',
    )
    // the same name is refused too
    expect(await code(iam.createUserType(f.tenant, { code: 'other', name: 'Student' }))).toBe(
      'USER_TYPE_CONFLICT',
    )
    const types = await iam.listUserTypes(f.tenant)
    expect(types.map((type) => type.code)).toContain('student')
    expect(types.find((type) => type.code === 'administrator')?.is_system).toBe(true)
  })

  it('grants only permissions that declare the user-type channel', async () => {
    const student = (await iam.listUserTypes(f.tenant)).find((type) => type.code === 'student')!
    // auth.portal.access is the one catalog entry with grantToUserType
    await iam.syncUserTypePermissions(f.tenant, student.id, ['auth.portal.access'])
    expect(
      (await iam.listUserTypes(f.tenant)).find((type) => type.id === student.id)?.permissions,
    ).toEqual(['auth.portal.access'])

    // a role-only permission cannot travel through this channel
    expect(
      await code(iam.syncUserTypePermissions(f.tenant, student.id, ['rbac.role.manage'])),
    ).toBe('PERMISSION_NOT_GRANTABLE')
    // the earlier grant is untouched by the rejected call
    expect(
      (await iam.listUserTypes(f.tenant)).find((type) => type.id === student.id)?.permissions,
    ).toEqual(['auth.portal.access'])

    // syncing is idempotent and removes what is no longer wanted
    await iam.syncUserTypePermissions(f.tenant, student.id, ['auth.portal.access'])
    await iam.syncUserTypePermissions(f.tenant, student.id, [])
    expect(
      (await iam.listUserTypes(f.tenant)).find((type) => type.id === student.id)?.permissions,
    ).toEqual([])
  })

  it('protects system and in-use user types from deletion', async () => {
    const types = await iam.listUserTypes(f.tenant)
    const system = types.find((type) => type.is_system)!
    const inUse = types.find((type) => type.code === 'faculty')!
    const spare = types.find((type) => type.code === 'student')!
    expect(await code(iam.deleteUserType(f.tenant, system.id))).toBe('USER_TYPE_IS_SYSTEM')
    expect(await code(iam.deleteUserType(f.tenant, inUse.id))).toBe('USER_TYPE_IN_USE')
    // an unused, non-system type deletes cleanly
    await iam.deleteUserType(f.tenant, spare.id)
    expect((await iam.listUserTypes(f.tenant)).map((type) => type.code)).not.toContain('student')
  })

  it('creates users and enforces the business number and placement', async () => {
    const id = await iam.createUser(f.tenant, {
      displayName: 'New Person',
      userTypeId: f.facultyType,
      primaryOrgNodeId: f.college,
      businessNo: 'B-1001',
    })
    expect(id).toBeTruthy()
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Another',
          userTypeId: f.facultyType,
          primaryOrgNodeId: f.college,
          businessNo: 'B-1001',
        }),
      ),
    ).toBe('USER_CONFLICT')
    // a node of another tenant simply does not exist here
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Nowhere',
          userTypeId: f.facultyType,
          primaryOrgNodeId: randomUUID(),
        }),
      ),
    ).toBe('USER_PLACEMENT_NOT_FOUND')
    // a disabled type cannot receive new people
    await iam.setUserTypeEnabled(f.tenant, f.facultyType, false)
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Too late',
          userTypeId: f.facultyType,
          primaryOrgNodeId: f.college,
        }),
      ),
    ).toBe('USER_TYPE_DISABLED')
    await iam.setUserTypeEnabled(f.tenant, f.facultyType, true)

    const users = await iam.listUsers(f.tenant, { orgNodeId: f.root, subtree: true })
    expect(users.map((user) => user.display_name)).toContain('New Person')
    // the anchor scopes the listing
    const collegeOnly = await iam.listUsers(f.tenant, { orgNodeId: f.college, subtree: false })
    expect(collegeOnly.map((user) => user.display_name)).not.toContain('Admin')
  })

  it('refuses a user type change that would strand role assignments', async () => {
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.managerRole, f.college],
    )
    // org-manager allows faculty only, so moving the manager to another type
    // would leave that assignment invalid
    expect(
      await code(iam.updateUser(f.tenant, f.manager, { userTypeId: f.adminType })),
    ).toBe('ASSIGNMENT_INCOMPATIBLE')
    // an unrelated field still updates
    await iam.updateUser(f.tenant, f.manager, { displayName: 'Manager Renamed' })
    const users = await iam.listUsers(f.tenant, { orgNodeId: f.college, subtree: false })
    expect(users.find((user) => user.id === f.manager)?.display_name).toBe('Manager Renamed')
    await pool.query(`delete from user_role_assignments where user_id = $1 and scope = 'self'`, [
      f.manager,
    ])
  })

  it('ends the sessions of a user it disables', async () => {
    await pool.query(
      `insert into sessions (tenant_id, user_id, token_hash, expires_at)
       values ($1, $2, repeat('a', 64), now() + interval '1 day')`,
      [f.tenant, f.manager],
    )
    expect(
      Number(
        (await pool.query(`select count(*) from sessions where user_id = $1`, [f.manager])).rows[0]
          .count,
      ),
    ).toBe(1)
    await iam.setUserEnabled(f.tenant, f.manager, false)
    // access ends now, not when the session happens to expire
    expect(
      Number(
        (await pool.query(`select count(*) from sessions where user_id = $1`, [f.manager])).rows[0]
          .count,
      ),
    ).toBe(0)
    await iam.setUserEnabled(f.tenant, f.manager, true)
  })

  it('never lets the tenant lose its last administrator', async () => {
    // the admin is the only holder of the canonical role
    expect(await code(iam.setUserEnabled(f.tenant, f.admin, false))).toBe('LAST_ADMINISTRATOR')
    // and their type is the one that lets them sign in
    expect(await code(iam.setUserTypeEnabled(f.tenant, f.adminType, false))).toBe(
      'LAST_ADMINISTRATOR',
    )

    // with a second administrator both become legal again
    const second = await iam.createUser(f.tenant, {
      displayName: 'Second Admin',
      userTypeId: f.facultyType,
      primaryOrgNodeId: f.root,
    })
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'subtree')`,
      [f.tenant, second, f.tenantAdminRole, f.root],
    )
    await iam.setUserEnabled(f.tenant, f.admin, false)
    // and the survivor is now the one protected
    expect(await code(iam.setUserEnabled(f.tenant, second, false))).toBe('LAST_ADMINISTRATOR')
    await iam.setUserEnabled(f.tenant, f.admin, true)
  })

  it('serializes concurrent attempts to disable the last administrators', async () => {
    const holders = (
      await pool.query(
        `select distinct a.user_id from user_role_assignments a
         join users u on u.id = a.user_id and u.enabled
         where a.tenant_id = $1 and a.role_id = $2`,
        [f.tenant, f.tenantAdminRole],
      )
    ).rows.map((row) => row.user_id as string)
    expect(holders.length).toBe(2)
    // both disabled at once: the tenant row lock serializes them, so exactly
    // one succeeds and an administrator always survives
    const results = await Promise.allSettled(
      holders.map((userId) => iam.setUserEnabled(f.tenant, userId, false)),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const left = (
      await pool.query(
        `select count(distinct a.user_id) from user_role_assignments a
         join users u on u.id = a.user_id and u.enabled
         where a.tenant_id = $1 and a.role_id = $2`,
        [f.tenant, f.tenantAdminRole],
      )
    ).rows[0].count
    expect(Number(left)).toBe(1)
  })
})
