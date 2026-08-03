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
import { encodeCursor, isAccessDeniedError, isDomainError } from '@qualy/api-contract'
import { permissions as authPermissions } from '../src/permissions.ts'
import { IamService } from '../src/iam/service.ts'
import { createIdentityRouter } from '../src/iam/router.ts'

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
    classNode: '',
    classType: '',
    viewerRole: '',
    admin: '',
    manager: '',
    tenantAdminRole: '',
    managerRole: '',
  }

  // the two viewpoints the authorization tests need
  const asAdmin = () => ({ tenantId: f.tenant, userId: f.admin, sessionId: 'admin' })
  const asManager = () => ({ tenantId: f.tenant, userId: f.manager, sessionId: 'manager' })
  const list = (
    principal: { tenantId: string; userId: string; sessionId: string },
    input: { orgNodeId: string; scope: 'self' | 'subtree'; search?: string; cursor?: string },
  ) => iam.listUsers(principal, { ...input, limit: 50 })

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
    f.classType = await row(
      `insert into org_types (tenant_id, code, name) values ($1, 'class', 'K') returning id`,
      [f.tenant],
    )
    f.classNode = await row(
      `insert into org_nodes (id, tenant_id, org_type_id, parent_id, name, path, depth)
       select v.id, $1, $2, $3, 'Class',
         ((select path::text from org_nodes where id = $3) || '.' ||
          replace(v.id::text, '-', ''))::ltree, 2
       from (select uuidv7() as id) v returning id`,
      [f.tenant, f.classType, f.college],
    )
    // both types open a sign-in channel: a type that opens none holds nobody
    // who can actually sign in, and the lockout invariant counts exactly that
    f.adminType = await row(
      `insert into user_types (tenant_id, code, name, is_system, allow_local_login, placement_mode)
       values ($1, 'administrator', 'Admin', true, true, 'unrestricted') returning id`,
      [f.tenant],
    )
    f.facultyType = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'faculty', 'Faculty', true, 'unrestricted') returning id`,
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
    // a role that reads users and nothing else, held by the manager at the
    // college with SELF scope: the case a subtree request must not widen
    f.viewerRole = await row(
      `insert into roles (tenant_id, code, name, kind) values ($1, 'user-viewer', 'UV', 'org')
       returning id`,
      [f.tenant],
    )
    await pool.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.facultyType],
    )
    await pool.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.collegeType],
    )
    await pool.query(
      `insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.viewerRole, f.college],
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
    await pool.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, id from permissions where code = 'auth.user.read'`,
      [f.tenant, f.viewerRole],
    )
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
    // a disabled type cannot receive new people. The type has to be an empty
    // one: disabling a populated type is refused outright now, which is the
    // point of the rule rather than an obstacle to it
    const retired = await iam.createUserType(f.tenant, { code: 'retired', name: 'Retired' })
    await iam.setUserTypeEnabled(f.tenant, retired, false)
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Too late',
          userTypeId: retired,
          primaryOrgNodeId: f.college,
        }),
      ),
    ).toBe('USER_TYPE_DISABLED')
    // and a populated one cannot be disabled at all
    expect(await code(iam.setUserTypeEnabled(f.tenant, f.facultyType, false))).toBe(
      'USER_TYPE_IN_USE',
    )
    await iam.deleteUserType(f.tenant, retired)

    const users = await list(asAdmin(), { orgNodeId: f.root, scope: 'subtree' })
    expect(users.map((user) => user.display_name)).toContain('New Person')
    // the anchor scopes the listing
    const collegeOnly = await list(asAdmin(), { orgNodeId: f.college, scope: 'self' })
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
    const users = await list(asAdmin(), { orgNodeId: f.college, scope: 'self' })
    expect(users.find((user) => user.id === f.manager)?.display_name).toBe('Manager Renamed')
    await pool.query(`delete from user_role_assignments where user_id = $1 and role_id = $2`, [
      f.manager,
      f.managerRole,
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


  it('intersects a subtree request with the reader’s own anchors', async () => {
    // someone stands below the college, inside the requested subtree but
    // outside a self anchor's reach
    const below = await iam.createUser(f.tenant, {
      displayName: 'Class Member',
      userTypeId: f.facultyType,
      primaryOrgNodeId: f.classNode,
    })
    // the admin holds a subtree anchor at the root and sees both
    const wide = await list(asAdmin(), { orgNodeId: f.college, scope: 'subtree' })
    expect(wide.map((user) => user.id)).toContain(below)

    // the manager holds a SELF anchor at the college. Asking for the subtree
    // used to return everything below it, because only the requested scope
    // decided the answer; now the two are intersected.
    const narrow = await list(asManager(), { orgNodeId: f.college, scope: 'subtree' })
    expect(narrow.map((user) => user.id)).not.toContain(below)
    expect(narrow.map((user) => user.id)).toContain(f.manager)
    // and the node itself is still readable
    expect(
      (await list(asManager(), { orgNodeId: f.college, scope: 'self' })).map((user) => user.id),
    ).toContain(f.manager)
    // asking about a node no anchor reaches yields nothing rather than a leak
    expect(await list(asManager(), { orgNodeId: f.classNode, scope: 'subtree' })).toEqual([])
    // a single record is guarded the same way, and cannot be told apart from
    // one that does not exist
    expect(await code(iam.getUser(asManager(), below))).toBe('USER_NOT_FOUND')
    expect((await iam.getUser(asAdmin(), below)).id).toBe(below)

    await pool.query(`delete from users where id = $1`, [below])
  })

  it('re-decides authority inside the write transaction', async () => {
    // the manager may read at the college but administers nobody, so every
    // write is refused where it is finally applied rather than where it was
    // first checked
    const denied = (error: unknown) =>
      isAccessDeniedError(error) ? 'ACCESS_DENIED' : ((error as Error).message ?? 'error')
    await expect(
      iam
        .updateUser(f.tenant, f.manager, { displayName: 'Self Rename' }, asManager())
        .catch(denied),
    ).resolves.toBe('ACCESS_DENIED')
    await expect(
      iam
        .createUser(
          f.tenant,
          { displayName: 'Smuggled', userTypeId: f.facultyType, primaryOrgNodeId: f.college },
          asManager(),
        )
        .catch(denied),
    ).resolves.toBe('ACCESS_DENIED')
    // the admin, who does administer that node, succeeds through the same path
    const created = await iam.createUser(
      f.tenant,
      { displayName: 'Legitimate', userTypeId: f.facultyType, primaryOrgNodeId: f.college },
      asAdmin(),
    )
    expect(created).toBeTruthy()
    await pool.query(`delete from users where id = $1`, [created])
  })

  it('refuses to delete a user type a role has no alternative to', async () => {
    // the viewer role allows faculty and nothing else
    expect(await code(iam.deleteUserType(f.tenant, f.facultyType))).toBe('USER_TYPE_IN_USE')
    const lonely = await iam.createUserType(f.tenant, { code: 'lonely', name: 'Lonely' })
    await pool.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, lonely],
    )
    await pool.query(`delete from role_allowed_user_types where role_id = $1 and user_type_id = $2`,
      [f.tenant === '' ? '' : f.viewerRole, f.facultyType])
    expect(await code(iam.deleteUserType(f.tenant, lonely))).toBe('USER_TYPE_LAST_FOR_ROLE')
    // restoring the alternative makes the deletion legal again
    await pool.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.facultyType],
    )
    await iam.deleteUserType(f.tenant, lonely)
  })

  it('pages instead of truncating in silence', async () => {
    const made: string[] = []
    for (const index of [1, 2, 3]) {
      made.push(
        await iam.createUser(f.tenant, {
          displayName: `Paged ${index}`,
          userTypeId: f.facultyType,
          primaryOrgNodeId: f.college,
        }),
      )
    }
    const first = await iam.listUsers(asAdmin(), {
      orgNodeId: f.college,
      scope: 'self',
      search: 'Paged',
      limit: 2,
    })
    expect(first).toHaveLength(2)
    const next = await iam.listUsers(asAdmin(), {
      orgNodeId: f.college,
      scope: 'self',
      search: 'Paged',
      cursor: encodeCursor([first[1]!.display_name, first[1]!.id]),
      limit: 2,
    })
    // the cursor resumes after the last row rather than repeating it
    expect(next.map((user) => user.display_name)).toEqual(['Paged 3'])
    await pool.query(`delete from users where id = any($1::uuid[])`, [made])
  })

  it('gates and scopes the identity api over http', async () => {
    // the service tests above prove the rules; this one proves the wire
    // carries them: real urls, real status codes, real query strings
    const viewer: { current?: AuthPrincipal } = {}
    const host = ctx.plugin({
      name: 'identity-http',
      inject: ['server', 'rbac'],
      apply: (child: Context) => {
        child.server.enrich('test-principal', (context) => {
          context.principal = viewer.current
        })
        child.server.contribute('identity', createIdentityRouter(child, iam))
      },
    })
    await host
    const base = `http://127.0.0.1:${ctx.server.port}/api`
    const call = async (path: string, as?: AuthPrincipal) => {
      viewer.current = as
      try {
        const response = await fetch(`${base}${path}`)
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        }
      } finally {
        viewer.current = undefined
      }
    }

    // anonymous requests never reach a handler
    expect((await call('/iam/user-types')).status).toBe(401)
    // a tenant-scope screen is refused to someone without its permission
    expect((await call('/iam/user-types', asManager())).status).toBe(403)
    const types = await call('/iam/user-types', asAdmin())
    expect(types.status).toBe(200)
    expect((types.body as { capabilities: { canManage: boolean } }).capabilities.canManage).toBe(
      true,
    )

    // scope is an enum in the url and survives the trip as one
    const wide = await call(`/iam/users?orgNodeId=${f.root}&scope=subtree`, asAdmin())
    expect(wide.status).toBe(200)
    expect((wide.body as { items: unknown[] }).items.length).toBeGreaterThan(1)
    const narrow = await call(`/iam/users?orgNodeId=${f.root}&scope=self`, asAdmin())
    expect((narrow.body as { items: { id: string }[] }).items.map((user) => user.id)).toEqual([
      f.admin,
    ])
    // a value the enum cannot hold is a validation failure, not a default
    expect((await call(`/iam/users?orgNodeId=${f.root}&scope=sideways`, asAdmin())).status).toBe(
      400,
    )

    // and the manager's self anchor still bounds what the url can ask for
    const managerView = await call(`/iam/users?orgNodeId=${f.college}&scope=subtree`, asManager())
    expect(managerView.status).toBe(200)
    expect(
      (managerView.body as { items: { primaryOrgNode: { id: string } }[] }).items.every(
        (user) => user.primaryOrgNode.id === f.college,
      ),
    ).toBe(true)

    // a declared domain error arrives as its declared status and code
    const missing = await call(`/iam/users/${randomUUID()}`, asAdmin())
    expect(missing.status).toBe(404)
    expect(missing.body.code).toBe('USER_NOT_FOUND')

    // the options endpoint carries the caller's own anchors and nothing else
    const options = await call('/iam/user-options', asManager())
    expect(options.status).toBe(200)
    expect(
      (options.body as { anchors: { orgNodeId: string }[] }).anchors.map((a) => a.orgNodeId),
    ).toEqual([f.college])

    await host.dispose()
  })

  it('never lets the tenant lose its last administrator', async () => {
    // the admin is the only holder of the canonical role
    expect(await code(iam.setUserEnabled(f.tenant, f.admin, false))).toBe('LAST_ADMINISTRATOR')
    // and the type they sign in through cannot be disabled while anyone
    // holds it, which is what used to revoke access without ending sessions
    expect(await code(iam.setUserTypeEnabled(f.tenant, f.adminType, false))).toBe(
      'USER_TYPE_IN_USE',
    )
    // closing its last sign-in channel is the same lockout by another route
    expect(
      await code(
        iam.updateUserType(f.tenant, f.adminType, { allowLocalLogin: false, allowSsoLogin: false }),
      ),
    ).toBe('LAST_ADMINISTRATOR')

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
