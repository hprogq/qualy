import { randomUUID } from 'node:crypto'
import { Context } from 'cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from '@qualy/plugin-database'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'
import { isAccessDeniedError, isDomainError } from '@qualy/api-contract'
import {
  isCanonicalTenantAdmin,
  type PermissionDefinition,
  type RbacDbHandle,
  type RbacService,
} from '@qualy/rbac-contract'
import Rbac from '../src/index.ts'

// A capability declares what it protects and therefore how it is checked,
// and nothing else. There is no channel flag and no default-administrator
// flag: a permission reaches a person through a role and through nothing
// else, and holding every capability is one fact about one role.
const CATALOG = [
  { code: 'test.report.read', name: 'read reports', target: 'tenant' },
  { code: 'test.role.manage', name: 'manage roles', target: 'tenant' },
  { code: 'test.tree.manage', name: 'manage the tree', target: 'org-node' },
  { code: 'test.user.manage', name: 'manage people', target: 'org-node' },
  { code: 'test.audit.read', name: 'read audits', target: 'org-node' },
] as const satisfies readonly PermissionDefinition[]

describe.runIf(postgresAvailable)('rbac', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let rbac: RbacService
  // fixture ids
  const f = {
    tenant: '',
    tenantB: '',
    root: '',
    college: '',
    otherCollege: '',
    class1: '',
    universityType: '',
    collegeType: '',
    classType: '',
    otherType: '',
    typeAdmin: '',
    typeFaculty: '',
    typeStudent: '',
    admin: '',
    manager: '',
    student: '',
    binder: '',
    adminB: '',
    tenantAdminRole: '',
    managerRole: '',
    adminGrant: '',
    managerGrant: '',
  }
  // roles built by the tests that need them and read by the ones after
  const built = { reviewer: '', auditor: '', delegate: '', authorKit: '' }

  const principal = (userId: string, tenantId = f.tenant) => ({
    tenantId,
    userId,
    sessionId: 'test-session',
  })
  // The service owns the wired instance: administration decides authorization
  // itself, so it needs the same authorization the api uses. The declared
  // service contract does not carry the field, so this narrows to the plugin
  // class the suite belongs to, and a rename there fails to compile here.
  const administration = () => (rbac as InstanceType<typeof Rbac>).administration

  const insertId = async (text: string, params: unknown[] = []) =>
    (await db.query(text, params)).rows[0]!.id as string

  beforeAll(async () => {
    db = await createTestContext('rbac')

    // two tenants with a small org tree, three user types, four users
    f.tenant = await insertId(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    f.tenantB = await insertId(`insert into tenants (slug, name) values ('b', 'B') returning id`)
    const orgType = (code: string, name: string, tenant = f.tenant) =>
      insertId(`insert into org_types (tenant_id, code, name) values ($1, $2, $3) returning id`, [
        tenant,
        code,
        name,
      ])
    f.universityType = await orgType('university', 'University')
    f.collegeType = await orgType('college', 'College')
    f.classType = await orgType('class', 'Class')
    f.otherType = await orgType('other', 'Other')
    f.root = await insertId(
      `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
       values ($1, $2, 'Root', 'r', 0) returning id`,
      [f.tenant, f.universityType],
    )
    f.college = await insertId(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'College', 'r.c1', 1) returning id`,
      [f.tenant, f.collegeType, f.root],
    )
    f.otherCollege = await insertId(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'Other College', 'r.c2', 1) returning id`,
      [f.tenant, f.collegeType, f.root],
    )
    f.class1 = await insertId(
      `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
       values ($1, $2, $3, 'Class 1', 'r.c1.k1', 2) returning id`,
      [f.tenant, f.classType, f.college],
    )
    // placement_mode has no database default on purpose: an omitted policy
    // used to mean "may stand anywhere", which is the widest rule of all
    const userType = (code: string, name: string, tenant = f.tenant) =>
      insertId(
        `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
         values ($1, $2, $3, true, 'unrestricted') returning id`,
        [tenant, code, name],
      )
    f.typeAdmin = await userType('administrator', 'Admin')
    f.typeFaculty = await userType('faculty', 'Faculty')
    f.typeStudent = await userType('student', 'Student')
    const user = (name: string, typeId: string, node: string, tenant = f.tenant) =>
      insertId(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, $2, $3, $4) returning id`,
        [tenant, name, typeId, node],
      )
    f.admin = await user('Admin', f.typeAdmin, f.root)
    f.manager = await user('Manager', f.typeFaculty, f.college)
    f.student = await user('Student', f.typeStudent, f.class1)
    f.binder = await user('Binder', f.typeFaculty, f.otherCollege)

    // tenant B mirrors the administrator setup: its admin genuinely holds
    // every capability of B, which is what makes the isolation claim mean
    // something
    const universityTypeB = await orgType('university', 'University', f.tenantB)
    const rootB = await insertId(
      `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
       values ($1, $2, 'Root B', 'rb', 0) returning id`,
      [f.tenantB, universityTypeB],
    )
    const typeAdminB = await userType('administrator', 'Admin', f.tenantB)
    f.adminB = await user('Admin B', typeAdminB, rootB, f.tenantB)

    // The canonical administrator, identified by its whole shape. The
    // database refuses any other row from claiming all-active, and refuses
    // this one from being re-kinded, disabled or made unassignable.
    const tenantAdminRole = (tenant: string) =>
      insertId(
        `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
         values ($1, 'tenant-admin', 'TA', 'tenant', 'active', 'all-active', 'tenant-admin')
         returning id`,
        [tenant],
      )
    f.tenantAdminRole = await tenantAdminRole(f.tenant)
    const tenantAdminRoleB = await tenantAdminRole(f.tenantB)
    f.managerRole = await insertId(
      `insert into roles (tenant_id, code, name, kind, status)
       values ($1, 'org-manager', 'OM', 'org', 'active') returning id`,
      [f.tenant],
    )
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.typeFaculty],
    )
    await db.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.collegeType],
    )

    await db.ctx.plugin(Rbac)
    rbac = db.ctx.rbac
    // register the test catalog through a scoped plugin and wait for the
    // database mirror
    await db.ctx.plugin({
      name: 'catalog',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('test', CATALOG)
      },
    })
    await rbac.whenSynced()

    await db.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p
       where p.code in ('test.tree.manage', 'test.user.manage')`,
      [f.tenant, f.managerRole],
    )
    // a tenant role carries no node; an org role is anchored by its grant
    f.adminGrant = await insertId(
      `insert into role_grants (tenant_id, user_id, role_id) values ($1, $2, $3) returning id`,
      [f.tenant, f.admin, f.tenantAdminRole],
    )
    await db.query(`insert into role_grants (tenant_id, user_id, role_id) values ($1, $2, $3)`, [
      f.tenantB,
      f.adminB,
      tenantAdminRoleB,
    ])
    f.managerGrant = await insertId(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, $4, 'subtree') returning id`,
      [f.tenant, f.manager, f.managerRole, f.college],
    )
  })

  afterAll(async () => {
    await db?.dispose()
  })

  // domain errors surface their code and their structured data; an
  // authorization verdict surfaces as ACCESS_DENIED; anything else is a
  // fault and surfaces its message so a broken test says why
  const outcome = (promise: Promise<unknown>): Promise<{ code: string; data?: unknown }> =>
    promise.then(
      () => ({ code: 'ok' }),
      (error) =>
        isDomainError(error)
          ? { code: error.code, data: error.data }
          : isAccessDeniedError(error)
            ? { code: 'ACCESS_DENIED' }
            : { code: (error as Error).message ?? 'error' },
    )
  const domainCode = async (promise: Promise<unknown>) => (await outcome(promise)).code

  const orpcCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error) => (error as { code?: string }).code ?? (error as Error).message,
    )

  const versionOf = async (roleId: string) =>
    (await administration().getRole(f.tenant, roleId)).version

  // a role only becomes usable through activation, which is where
  // completeness is checked; every fixture role takes the same route
  const activeRole = async (input: {
    code: string
    name: string
    kind: 'tenant' | 'org'
    codes: readonly string[]
    userTypeIds: readonly string[]
    orgTypeIds?: readonly string[]
  }) => {
    const admin = administration()
    const id = await admin.createRole(f.tenant, {
      code: input.code,
      name: input.name,
      kind: input.kind,
    })
    await admin.syncRolePermissions(f.tenant, id, input.codes, await versionOf(id))
    await admin.syncRoleEligibility(
      f.tenant,
      id,
      { userTypeIds: input.userTypeIds, orgTypeIds: input.orgTypeIds ?? [] },
      await versionOf(id),
    )
    await admin.setRoleStatus(f.tenant, id, 'active', await versionOf(id))
    return id
  }

  const addRolePermissions = async (roleId: string, codes: readonly string[]) => {
    const admin = administration()
    const role = await admin.getRole(f.tenant, roleId)
    await admin.syncRolePermissions(
      f.tenant,
      roleId,
      [...role.permissions, ...codes],
      role.version,
    )
  }

  it('answers every check from grants alone', async () => {
    // A user type classifies a person and says where they may stand. It
    // carries no authority, so a student with an enabled type and no grants
    // holds nothing at all.
    const student = await rbac.getProfile(principal(f.student))
    expect(student).toEqual({ tenantPermissions: [], orgPermissions: [] })
    expect(await rbac.hasPermission(principal(f.student), 'test.report.read')).toBe(false)

    // a tenant capability comes only from a tenant role
    expect(await orpcCode(rbac.require(principal(f.admin), 'test.role.manage'))).toBe('ok')
    expect(await orpcCode(rbac.require(principal(f.manager), 'test.role.manage'))).toBe('FORBIDDEN')
    expect(await orpcCode(rbac.require(principal(f.student), 'test.role.manage'))).toBe('FORBIDDEN')

    // all-active reaches every node of its tenant, with no anchor anywhere
    for (const node of [f.root, f.college, f.otherCollege, f.class1]) {
      expect(await rbac.canAt(principal(f.admin), 'test.tree.manage', node)).toBe(true)
    }
    expect(await rbac.listAuthorizedScope(principal(f.admin), 'test.tree.manage')).toEqual({
      tenantWide: true,
      anchors: [],
    })

    // an org role reaches exactly what its grant covers
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(true)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.class1)).toBe(true)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.otherCollege)).toBe(false)
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.root)).toBe(false)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(false)
    expect(await rbac.listAuthorizedScope(principal(f.manager), 'test.tree.manage')).toEqual({
      tenantWide: false,
      anchors: [{ orgNodeId: f.college, coverage: 'subtree' }],
    })

    // a node that does not exist is never authorized, not even for the
    // administrator whose reach is otherwise unconditional
    expect(await rbac.canAt(principal(f.admin), 'test.tree.manage', randomUUID())).toBe(false)
  })

  it('distinguishes 401 from 403 and refuses the wrong calling convention', async () => {
    expect(await orpcCode(rbac.require(undefined, 'test.role.manage'))).toBe('AUTH_REQUIRED')
    expect(await orpcCode(rbac.requireAt(undefined, 'test.tree.manage', f.college))).toBe(
      'AUTH_REQUIRED',
    )
    expect(await orpcCode(rbac.requireAt(principal(f.student), 'test.tree.manage', f.college))).toBe(
      'FORBIDDEN',
    )
    // a code nobody declared authorizes nothing, and says so as a refusal
    expect(await orpcCode(rbac.require(principal(f.admin), 'never.declared.code'))).toBe('FORBIDDEN')
    expect(await rbac.canAt(principal(f.admin), 'never.declared.code', f.root)).toBe(false)
    // the target decides how a code is checked; asking the other way is a
    // programming error, not a 403
    await expect(rbac.require(principal(f.admin), 'test.tree.manage')).rejects.toThrow(
      /use requireAt/,
    )
    await expect(rbac.canAt(principal(f.admin), 'test.role.manage', f.root)).rejects.toThrow(
      /use require/,
    )
  })

  it('covers exactly the node for self coverage and the descendance for subtree', async () => {
    const grantAt = (node: string, coverage: 'self' | 'subtree') =>
      insertId(
        `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
         values ($1, $2, $3, $4, $5) returning id`,
        [f.tenant, f.student, f.managerRole, node, coverage],
      )
    // written directly on purpose: eligibility governs the write path, and
    // this is about what the read path makes of the coverage it finds
    const self = await grantAt(f.college, 'self')
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.college)).toBe(true)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(false)
    expect(await rbac.listAuthorizedScope(principal(f.student), 'test.tree.manage')).toEqual({
      tenantWide: false,
      anchors: [{ orgNodeId: f.college, coverage: 'self' }],
    })
    await db.query(`delete from role_grants where id = $1`, [self])

    // subtree includes its own anchor and never reaches upward
    const subtree = await grantAt(f.class1, 'subtree')
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(true)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.college)).toBe(false)
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.root)).toBe(false)
    await db.query(`delete from role_grants where id = $1`, [subtree])
    expect(await rbac.canAt(principal(f.student), 'test.tree.manage', f.class1)).toBe(false)
  })

  it('fails closed on a role that is not active', async () => {
    for (const status of ['draft', 'disabled']) {
      await db.query(`update roles set status = $2 where id = $1`, [f.managerRole, status])
      expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(false)
      expect(await rbac.getProfile(principal(f.manager))).toEqual({
        tenantPermissions: [],
        orgPermissions: [],
      })
    }
    await db.query(`update roles set status = 'active' where id = $1`, [f.managerRole])
    expect(await rbac.canAt(principal(f.manager), 'test.tree.manage', f.college)).toBe(true)
  })

  it('drops a capability when its plugin unloads and keeps the row', async () => {
    const scoped = db.ctx.plugin({
      name: 'transient',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('transient', [
          { code: 'transient.thing.use', name: 'transient', target: 'tenant' },
        ])
      },
    })
    await scoped
    await rbac.whenSynced()
    // the administrator holds every ACTIVE capability, which is how the role
    // stays complete when a plugin adds one
    expect(await orpcCode(rbac.require(principal(f.admin), 'transient.thing.use'))).toBe('ok')
    await scoped.dispose()
    // no enabled column decides this: the code is simply not served any more
    expect(await orpcCode(rbac.require(principal(f.admin), 'transient.thing.use'))).toBe('FORBIDDEN')
    expect(rbac.getPermission('transient.thing.use')).toBeUndefined()
    const rows = await db.query(`select count(*) from permissions where code like 'transient.%'`)
    expect(Number(rows.rows[0]!.count)).toBe(1)
  })

  // Disabling a plugin suspends what it contributes; it does not destroy
  // configuration that mentions it. An administrator editing an unrelated
  // part of a role sees only the codes the registry currently serves, so
  // omitting a suspended one is not a decision to remove it, and treating it
  // as one silently discarded authority that reinstating the plugin was
  // supposed to bring back.
  it('keeps a permission whose plugin is unloaded while the role is edited', async () => {
    const scoped = db.ctx.plugin({
      name: 'suspendable',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('suspendable', [
          { code: 'suspendable.thing.read', name: 'suspendable', target: 'tenant' },
        ])
      },
    })
    await scoped
    await rbac.whenSynced()

    const admin = administration()
    const role = await admin.createRole(f.tenant, {
      code: 'suspendable-holder',
      name: 'Suspendable holder',
      kind: 'tenant',
    })
    let version = await admin.syncRolePermissions(
      f.tenant,
      role,
      ['suspendable.thing.read', 'test.report.read'],
      1,
    )

    await scoped.dispose()
    // the code is no longer served, so the editor cannot offer it and the
    // role reports it as configured but unavailable
    expect(rbac.getPermission('suspendable.thing.read')).toBeUndefined()
    const suspended = await admin.getRole(f.tenant, role)
    expect(admin.permissionsOfRole(suspended)).toEqual({
      active: ['test.report.read'],
      unavailable: ['suspendable.thing.read'],
    })

    // an ordinary save of what the editor could see must not take the rest
    version = await admin.syncRolePermissions(f.tenant, role, ['test.role.manage'], version)
    const kept = await db.query(
      `select p.code from role_permissions rp
       join permissions p on p.id = rp.permission_id
       where rp.role_id = $1 order by p.code`,
      [role],
    )
    expect(kept.rows.map((row) => row.code)).toEqual([
      'suspendable.thing.read',
      'test.role.manage',
    ])

    // and reinstating the plugin brings the capability back to the holder
    const again = db.ctx.plugin({
      name: 'suspendable',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('suspendable', [
          { code: 'suspendable.thing.read', name: 'suspendable', target: 'tenant' },
        ])
      },
    })
    await again
    await rbac.whenSynced()
    expect(admin.permissionsOfRole(await admin.getRole(f.tenant, role)).active).toEqual([
      'suspendable.thing.read',
      'test.role.manage',
    ])
    await again.dispose()
    await db.query(`delete from role_permissions where role_id = $1`, [role])
    await db.query(`delete from roles where id = $1`, [role])
    void version
  })

  it('keeps tenants fully isolated', async () => {
    // B's administrator holds everything in B and nothing in A
    expect(await orpcCode(rbac.require(principal(f.adminB, f.tenantB), 'test.role.manage'))).toBe(
      'ok',
    )
    expect(await rbac.canAt(principal(f.adminB, f.tenantB), 'test.tree.manage', f.college)).toBe(
      false,
    )
    expect(await rbac.listAuthorizedScope(principal(f.adminB), 'test.tree.manage')).toEqual({
      tenantWide: false,
      anchors: [],
    })
    // a forged principal mixing tenant A's user with tenant B fails too
    expect(await orpcCode(rbac.require(principal(f.admin, f.tenantB), 'test.role.manage'))).toBe(
      'FORBIDDEN',
    )
  })

  it('projects the profile from the role kind, never from the user type', async () => {
    const admin = await rbac.getProfile(principal(f.admin))
    expect(admin.tenantPermissions).toContain('test.role.manage')
    expect(admin.tenantPermissions).toContain('test.report.read')
    expect(admin.orgPermissions).toContain('test.tree.manage')
    const manager = await rbac.getProfile(principal(f.manager))
    expect(manager.tenantPermissions).toEqual([])
    expect(manager.orgPermissions).toEqual(['test.tree.manage', 'test.user.manage'])

    // A tenant capability inside an org role would apply with no grant
    // having said where. The row is refused by the management api, so it is
    // written directly here to prove the read path refuses it as well.
    await db.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'test.report.read'`,
      [f.tenant, f.managerRole],
    )
    expect(await rbac.hasPermission(principal(f.manager), 'test.report.read')).toBe(false)
    expect((await rbac.getProfile(principal(f.manager))).tenantPermissions).toEqual([])
    await db.query(
      `delete from role_permissions where role_id = $1 and permission_id in
        (select id from permissions where code = 'test.report.read')`,
      [f.managerRole],
    )

    // and the mirror image: reaching every node is the all-active mode, not
    // the tenant kind, so an org capability in an ordinary tenant role
    // reaches nothing
    const leaky = await insertId(
      `insert into roles (tenant_id, code, name, kind, status)
       values ($1, 'leaky', 'Leaky', 'tenant', 'active') returning id`,
      [f.tenant],
    )
    await db.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'test.tree.manage'`,
      [f.tenant, leaky],
    )
    const leakyGrant = await insertId(
      `insert into role_grants (tenant_id, user_id, role_id) values ($1, $2, $3) returning id`,
      [f.tenant, f.student, leaky],
    )
    for (const node of [f.root, f.college, f.class1]) {
      expect(await rbac.canAt(principal(f.student), 'test.tree.manage', node)).toBe(false)
    }
    await db.query(`delete from role_grants where id = $1`, [leakyGrant])
    await db.query(`delete from roles where id = $1`, [leaky])
  })

  it('refuses a second catalog claiming a live code', async () => {
    const scoped = db.ctx.plugin({
      name: 'drift',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('drift', [
          { code: 'test.role.manage', name: 'drifted', target: 'org-node' },
        ])
      },
    })
    await expect(Promise.resolve(scoped)).rejects.toThrow('permission code conflict')
  })

  it('validates catalogs before activation', () => {
    expect(() => rbac.definePermissions('dup', [CATALOG[0], CATALOG[0]])).toThrow(/twice/)
    expect(() =>
      rbac.definePermissions('bad', [{ code: 'Bad.Thing', name: 'b', target: 'tenant' }]),
    ).toThrow(/dotted lower-case/)
    expect(() =>
      rbac.definePermissions('bad', [
        { code: 'bad.thing.use', name: 'b', target: 'org' } as unknown as PermissionDefinition,
      ]),
    ).toThrow(/target must be/)
  })

  it('re-checks the stored definition on every authorization', async () => {
    // an explicit-mode holder, because all-active answers before the stored
    // row is ever consulted and would hide the drift this pins
    const inspector = await activeRole({
      code: 'inspector',
      name: 'Inspector',
      kind: 'tenant',
      codes: ['test.role.manage'],
      userTypeIds: [f.typeFaculty],
    })
    const grant = await administration().grant(f.tenant, {
      userId: f.binder,
      roleId: inspector,
      target: { kind: 'tenant' },
    })
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('ok')

    // hijacking the row's owner kills the grant at read time
    await db.query(`update permissions set plugin = 'hijacker' where code = 'test.role.manage'`)
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('FORBIDDEN')
    expect((await rbac.getProfile(principal(f.binder))).tenantPermissions).not.toContain(
      'test.role.manage',
    )
    await db.query(`update permissions set plugin = 'test' where code = 'test.role.manage'`)
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('ok')

    // so does changing what the capability protects: live grants already
    // assume the calling convention, so it is stable semantics
    await db.query(
      `update permissions set target_kind = 'org-node' where code = 'test.role.manage'`,
    )
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('FORBIDDEN')
    await db.query(`update permissions set target_kind = 'tenant' where code = 'test.role.manage'`)
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('ok')

    await administration().revoke(f.tenant, grant)
    expect(await orpcCode(rbac.require(principal(f.binder), 'test.role.manage'))).toBe('FORBIDDEN')
  })

  it('fails closed when a declaration conflicts with the stored owner', async () => {
    await db.query(
      `insert into permissions (code, plugin, name, target_kind)
       values ('ghost.thing.use', 'ghost', 'G', 'tenant')`,
    )
    const scoped = db.ctx.plugin({
      name: 'intruder',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('intruder', [
          { code: 'ghost.thing.use', name: 'G', target: 'tenant' },
        ])
      },
    })
    await scoped
    // The administrator holds every active code, so activation is the only
    // gate: if a pending definition were served, the answer would flip to
    // allowed the instant it registered.
    expect(await orpcCode(rbac.require(principal(f.admin), 'ghost.thing.use'))).toBe('FORBIDDEN')
    await expect(rbac.whenSynced()).rejects.toThrow(/rejected: ghost\.thing\.use/)
    expect(await orpcCode(rbac.require(principal(f.admin), 'ghost.thing.use'))).toBe('FORBIDDEN')
    const row = await db.query(`select plugin from permissions where code = 'ghost.thing.use'`)
    expect(row.rows[0]!.plugin).toBe('ghost')

    // a later successful catalog must not mask the standing failure
    const clean = db.ctx.plugin({
      name: 'clean-after',
      inject: ['rbac'],
      apply: (child: Context) => {
        child.rbac.definePermissions('clean-after', [
          { code: 'clean.thing.use', name: 'C', target: 'tenant' },
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
  })

  it('lets concurrent instances converge on a single owner', async () => {
    // two application instances race to claim the same fresh code with
    // different owners: insert-then-reread converges both on the stored row
    // a genuinely separate application instance on the same database, which
    // is what the race is about; the lineage is already applied, so this one
    // only connects
    const other = new Context()
    await other.plugin(Database, { url: db.url, migrations: 'off' })
    await other.plugin(Rbac)
    const definition = {
      code: 'contested.thing.use',
      name: 'contested',
      target: 'tenant' as const,
    }
    const alpha = db.ctx.plugin({
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
    const row = await db.query(`select plugin from permissions where code = 'contested.thing.use'`)
    expect(row.rows[0]!.plugin).toBe(settled[0]!.status === 'fulfilled' ? 'alpha' : 'beta')
    await alpha.dispose()
    await other.fiber.dispose()
  })

  it('refuses rows that break the access model at the database', async () => {
    // holding every capability belongs to the administrator role the
    // platform provisions, so no other system role may claim the mode
    expect(
      await pgCode(
        db.query(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
           values ($1, 'usurper', 'Usurper', 'tenant', 'active', 'all-active', 'second-admin')`,
          [f.tenant],
        ),
      ),
    ).toBe('23514')
    // and with no key at all, which is the shape that slipped through: a
    // check evaluating to null is satisfied, so comparing a null system_key
    // with = accepted the row instead of rejecting it. That row is not the
    // canonical administrator by any test the code applies, yet the mode
    // alone reaches every node with every capability.
    expect(
      await pgCode(
        db.query(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode)
           values ($1, 'keyless', 'Keyless', 'tenant', 'active', 'all-active')`,
          [f.tenant],
        ),
      ),
    ).toBe('23514')
    // and the converse half, which is the one that protects a tenant: the
    // administrator row cannot be re-kinded, disabled or neutered
    expect(
      await pgCode(
        db.query(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
           values ($1, 'shadow', 'Shadow', 'org', 'active', 'all-active', 'tenant-admin')`,
          [f.tenant],
        ),
      ),
    ).toBe('23514')
    for (const update of [
      `update roles set assignable = false where id = $1`,
      `update roles set status = 'disabled' where id = $1`,
      `update roles set kind = 'org' where id = $1`,
      `update roles set permission_mode = 'explicit' where id = $1`,
    ]) {
      expect(await pgCode(db.query(update, [f.tenantAdminRole]))).toBe('23514')
    }

    // a grant is anchored or tenant-wide, never half of each
    expect(
      await pgCode(
        db.query(
          `insert into role_grants (tenant_id, user_id, role_id, org_node_id)
           values ($1, $2, $3, $4)`,
          [f.tenant, f.student, f.managerRole, f.college],
        ),
      ),
    ).toBe('23514')
    expect(
      await pgCode(
        db.query(
          `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
           values ($1, $2, $3, $4, 'everything')`,
          [f.tenant, f.student, f.managerRole, f.college],
        ),
      ),
    ).toBe('23514')
    // one grant per user, role and anchor; the tenant-wide case has its own
    // partial index because a null node defeats a plain unique index
    expect(
      await pgCode(
        db.query(`insert into role_grants (tenant_id, user_id, role_id) values ($1, $2, $3)`, [
          f.tenant,
          f.admin,
          f.tenantAdminRole,
        ]),
      ),
    ).toBe('23505')

    // a permission protects a tenant or a node, and nothing else
    expect(
      await pgCode(
        db.query(
          `insert into permissions (code, plugin, name, target_kind)
           values ('bad.thing.use', 'test', 'B', 'weird')`,
        ),
      ),
    ).toBe('23514')
  })

  it('enforces grant eligibility', async () => {
    const admin = administration()
    const grant = (userId: string, roleId: string, node?: string) =>
      admin.grant(f.tenant, {
        userId,
        roleId,
        target:
          node === undefined
            ? { kind: 'tenant' }
            : { kind: 'org-node', orgNodeId: node, coverage: 'self' },
      })

    // who may hold the duty is a fact about the role
    expect(await outcome(grant(f.student, f.managerRole, f.college))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'user-type' },
    })
    // where the duty applies is another
    expect(await outcome(grant(f.manager, f.managerRole, f.class1))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'org-type' },
    })
    // the kind of the role decides the shape of the grant
    expect(await outcome(grant(f.manager, f.managerRole))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'org-role-unanchored' },
    })
    expect(await outcome(grant(f.admin, f.tenantAdminRole, f.college))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'tenant-role-anchored' },
    })

    // a role nobody may be given, and a person who cannot act
    const draft = await admin.createRole(f.tenant, {
      code: 'not-yet',
      name: 'Not yet',
      kind: 'org',
    })
    expect(await outcome(grant(f.manager, draft, f.college))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'role-unassignable' },
    })
    await db.query(`update users set enabled = false where id = $1`, [f.manager])
    expect(await outcome(grant(f.manager, f.managerRole, f.college))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'user-disabled' },
    })
    await db.query(`update users set enabled = true where id = $1`, [f.manager])

    // a request naming something that does not exist gets told so, rather
    // than being flattened into a refusal
    expect(await domainCode(grant(randomUUID(), f.managerRole, f.college))).toBe(
      'GRANT_USER_NOT_FOUND',
    )
    expect(await domainCode(grant(f.manager, f.managerRole, randomUUID()))).toBe(
      'GRANT_NODE_NOT_FOUND',
    )
    expect(await domainCode(grant(f.manager, randomUUID(), f.college))).toBe('ROLE_NOT_FOUND')

    // an eligible grant applies, and the same one twice does not
    const id = await grant(f.manager, f.managerRole, f.college)
    expect(await domainCode(grant(f.manager, f.managerRole, f.college))).toBe('GRANT_EXISTS')
    expect((await admin.getGrant(f.tenant, id)).coverage).toBe('self')
    await admin.revoke(f.tenant, id)
    expect(await domainCode(admin.getGrant(f.tenant, id))).toBe('GRANT_NOT_FOUND')
    expect(await domainCode(admin.revoke(f.tenant, id))).toBe('GRANT_NOT_FOUND')
  })

  it('exempts only the canonical administrator from the eligibility check', async () => {
    const admin = administration()
    // The exemption is identified by the whole shape, not by "has a system
    // key". A second system role must inherit nothing.
    expect(
      isCanonicalTenantAdmin({
        system_key: 'recovery-desk',
        permission_mode: 'explicit',
        kind: 'tenant',
      }),
    ).toBe(false)
    expect(
      isCanonicalTenantAdmin({
        system_key: 'tenant-admin',
        permission_mode: 'all-active',
        kind: 'tenant',
      }),
    ).toBe(true)

    const pretender = await insertId(
      `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
       values ($1, 'recovery-desk', 'Recovery desk', 'tenant', 'active', 'explicit',
         'recovery-desk') returning id`,
      [f.tenant],
    )
    await db.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, p.id from permissions p where p.code = 'test.report.read'`,
      [f.tenant, pretender],
    )
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, pretender, f.typeAdmin],
    )
    const tenantWide = (userId: string, roleId: string) =>
      admin.grant(f.tenant, { userId, roleId, target: { kind: 'tenant' } })

    // a system key alone buys nothing: the role admits administrators only
    expect(await outcome(tenantWide(f.student, pretender))).toEqual({
      code: 'GRANT_NOT_ELIGIBLE',
      data: { reason: 'user-type' },
    })
    // and the same role to a user type it does admit goes through, which is
    // what proves the refusal was about eligibility
    const allowed = await tenantWide(f.admin, pretender)
    await admin.revoke(f.tenant, allowed)

    // the canonical administrator declares no eligible user types at all and
    // is still grantable: it is how a tenant is recovered
    expect((await admin.getRole(f.tenant, f.tenantAdminRole)).allowed_user_types).toEqual([])
    const recovery = await tenantWide(f.student, f.tenantAdminRole)
    expect(await orpcCode(rbac.require(principal(f.student), 'test.role.manage'))).toBe('ok')
    await admin.revoke(f.tenant, recovery)

    // the exemption is from eligibility and nothing else: a non-canonical
    // system role still has to declare who may hold it
    await admin.syncRoleEligibility(
      f.tenant,
      pretender,
      { userTypeIds: [f.typeAdmin, f.typeFaculty], orgTypeIds: [] },
      await versionOf(pretender),
    )
    expect(await domainCode(tenantWide(f.manager, pretender))).toBe('ok')
    await db.query(`delete from role_grants where role_id = $1`, [pretender])
  })

  it('requires a complete role before it can be activated', async () => {
    const admin = administration()
    const activate = (id: string) =>
      versionOf(id).then((version) => admin.setRoleStatus(f.tenant, id, 'active', version))

    // a role that grants nothing and a role nobody qualifies for are both
    // indistinguishable from a misconfiguration
    built.reviewer = await admin.createRole(f.tenant, {
      code: 'reviewer',
      name: 'Reviewer',
      kind: 'tenant',
    })
    expect(await outcome(activate(built.reviewer))).toEqual({
      code: 'ROLE_INCOMPLETE',
      data: { missing: ['permissions', 'user-types'] },
    })
    await admin.syncRolePermissions(
      f.tenant,
      built.reviewer,
      ['test.report.read'],
      await versionOf(built.reviewer),
    )
    // a tenant role needs eligible user types too: leaving that set empty is
    // what let the grant check skip it entirely
    expect(await outcome(activate(built.reviewer))).toEqual({
      code: 'ROLE_INCOMPLETE',
      data: { missing: ['user-types'] },
    })
    await admin.syncRoleEligibility(
      f.tenant,
      built.reviewer,
      { userTypeIds: [f.typeFaculty], orgTypeIds: [] },
      await versionOf(built.reviewer),
    )
    await activate(built.reviewer)
    expect((await admin.getRole(f.tenant, built.reviewer)).status).toBe('active')

    // an anchored role additionally says what it may anchor to
    built.auditor = await admin.createRole(f.tenant, {
      code: 'auditor',
      name: 'Auditor',
      kind: 'org',
    })
    await admin.syncRolePermissions(
      f.tenant,
      built.auditor,
      ['test.audit.read'],
      await versionOf(built.auditor),
    )
    expect(await outcome(activate(built.auditor))).toEqual({
      code: 'ROLE_INCOMPLETE',
      data: { missing: ['user-types', 'org-types'] },
    })
    await admin.syncRoleEligibility(
      f.tenant,
      built.auditor,
      { userTypeIds: [f.typeStudent], orgTypeIds: [] },
      await versionOf(built.auditor),
    )
    expect(await outcome(activate(built.auditor))).toEqual({
      code: 'ROLE_INCOMPLETE',
      data: { missing: ['org-types'] },
    })
    await admin.syncRoleEligibility(
      f.tenant,
      built.auditor,
      { userTypeIds: [f.typeStudent], orgTypeIds: [f.collegeType] },
      await versionOf(built.auditor),
    )
    await activate(built.auditor)
    expect((await admin.getRole(f.tenant, built.auditor)).status).toBe('active')

    // a stale editor must not silently undo a change made after it read, and
    // asking for the state a row is already in spends nothing
    const settled = await versionOf(built.auditor)
    expect(await outcome(admin.setRoleStatus(f.tenant, built.auditor, 'active', settled - 1))).toEqual(
      { code: 'ROLE_VERSION_CONFLICT', data: { currentVersion: settled } },
    )
    expect(await admin.setRoleStatus(f.tenant, built.auditor, 'active', settled)).toBe(settled)
  })

  it('refuses to strand the holders of a role whose eligibility narrows', async () => {
    const admin = administration()
    // A tenant grant carries no node. The stranded query joins the anchor
    // outward for exactly that reason: an inner join dropped every
    // tenant-wide grant, so narrowing a tenant role silently stranded its
    // holders. This role's only grant is tenant-wide, so the join shape is
    // the whole of what decides the answer.
    const held = await admin.grant(f.tenant, {
      userId: f.manager,
      roleId: built.reviewer,
      target: { kind: 'tenant' },
    })
    expect(
      await outcome(
        admin.syncRoleEligibility(
          f.tenant,
          built.reviewer,
          { userTypeIds: [f.typeStudent], orgTypeIds: [] },
          await versionOf(built.reviewer),
        ),
      ),
    ).toEqual({ code: 'GRANT_STRANDED', data: { grantCount: 1 } })
    // refused as a whole: the eligibility rows are unchanged
    expect((await admin.getRole(f.tenant, built.reviewer)).allowed_user_types).toEqual([
      f.typeFaculty,
    ])
    expect(await rbac.hasPermission(principal(f.manager), 'test.report.read')).toBe(true)

    // an anchored role is stranded by its node types just the same
    expect(
      await outcome(
        admin.syncRoleEligibility(
          f.tenant,
          f.managerRole,
          { userTypeIds: [f.typeFaculty], orgTypeIds: [f.otherType] },
          await versionOf(f.managerRole),
        ),
      ),
    ).toEqual({ code: 'GRANT_STRANDED', data: { grantCount: 1 } })

    // an active role may not be left with nobody eligible at all
    expect(
      await domainCode(
        admin.syncRoleEligibility(
          f.tenant,
          f.managerRole,
          { userTypeIds: [], orgTypeIds: [] },
          await versionOf(f.managerRole),
        ),
      ),
    ).toBe('ROLE_NEEDS_ELIGIBILITY')

    // widening strands nobody
    await admin.syncRoleEligibility(
      f.tenant,
      f.managerRole,
      { userTypeIds: [f.typeFaculty], orgTypeIds: [f.collegeType, f.otherType] },
      await versionOf(f.managerRole),
    )
    await admin.revoke(f.tenant, held)
  })

  it('offers only the roles the write would accept', async () => {
    const admin = administration()
    const codes = async (userId: string, node?: string) =>
      (
        await admin.grantOptions(f.tenant, {
          userId,
          target:
            node === undefined
              ? { kind: 'tenant' }
              : { kind: 'org-node', orgNodeId: node, coverage: 'self' },
        })
      ).map((role) => role.code)

    // the student qualifies for the auditor role at a college and for
    // nothing the manager role offers
    const atCollege = await codes(f.student, f.college)
    expect(atCollege).toContain('auditor')
    expect(atCollege).not.toContain('org-manager')
    // the manager is the other way around, and neither is offered a role
    // anchored where it may not apply
    const managerAtCollege = await codes(f.manager, f.college)
    expect(managerAtCollege).toContain('org-manager')
    expect(managerAtCollege).not.toContain('auditor')
    expect(await codes(f.manager, f.class1)).not.toContain('org-manager')
    // an org role is never offered tenant-wide, nor a tenant role at a node
    expect(await codes(f.manager)).not.toContain('org-manager')
    expect(await codes(f.manager)).toContain('reviewer')
    expect(await codes(f.manager, f.college)).not.toContain('reviewer')

    // a request naming somebody who is not there is an answer of its own,
    // not an empty list that reads as a permission verdict
    expect(await domainCode(admin.grantOptions(f.tenant, {
      userId: randomUUID(),
      target: { kind: 'tenant' },
    }))).toBe('GRANT_USER_NOT_FOUND')
    expect(await domainCode(admin.grantOptions(f.tenant, {
      userId: f.manager,
      target: { kind: 'org-node', orgNodeId: randomUUID(), coverage: 'self' },
    }))).toBe('GRANT_NODE_NOT_FOUND')
  })

  it('administers roles without letting the tenant lock itself out', async () => {
    const admin = administration()
    const canonical = await admin.getRole(f.tenant, f.tenantAdminRole)

    // the administrator role is immutable where it matters
    expect(
      await domainCode(
        admin.setRoleStatus(f.tenant, canonical.id, 'disabled', canonical.version),
      ),
    ).toBe('ROLE_IS_SYSTEM')
    expect(await domainCode(admin.deleteRole(f.tenant, canonical.id, canonical.version))).toBe(
      'ROLE_IS_SYSTEM',
    )
    expect(
      await domainCode(
        admin.updateRole(f.tenant, canonical.id, { assignable: false }, canonical.version),
      ),
    ).toBe('ROLE_IS_SYSTEM')
    expect(
      await domainCode(admin.syncRolePermissions(f.tenant, canonical.id, [], canonical.version)),
    ).toBe('ROLE_IS_SYSTEM')
    expect(
      await domainCode(
        admin.syncRoleEligibility(
          f.tenant,
          canonical.id,
          { userTypeIds: [f.typeAdmin], orgTypeIds: [] },
          canonical.version,
        ),
      ),
    ).toBe('ROLE_IS_SYSTEM')
    // its display fields stay editable
    await admin.updateRole(
      f.tenant,
      canonical.id,
      { name: 'Tenant administrator' },
      canonical.version,
    )
    expect((await admin.getRole(f.tenant, canonical.id)).name).toBe('Tenant administrator')
    // and it reports what it actually grants, which is every active code
    expect(admin.permissionsOfRole(await admin.getRole(f.tenant, canonical.id)).active).toContain(
      'test.audit.read',
    )

    // the kinds do not overlap: an anchored role holds anchored capabilities
    expect(
      await outcome(
        admin.syncRolePermissions(
          f.tenant,
          f.managerRole,
          ['test.role.manage'],
          await versionOf(f.managerRole),
        ),
      ),
    ).toEqual({ code: 'ROLE_TARGET_MISMATCH', data: { permissions: ['test.role.manage'] } })
    expect(
      await outcome(
        admin.syncRolePermissions(
          f.tenant,
          f.managerRole,
          ['nobody.declared.this'],
          await versionOf(f.managerRole),
        ),
      ),
    ).toEqual({ code: 'PERMISSION_NOT_FOUND', data: { permissions: ['nobody.declared.this'] } })

    // a set replacement applies as a whole and bumps the row
    const before = await versionOf(f.managerRole)
    const after = await admin.syncRolePermissions(
      f.tenant,
      f.managerRole,
      ['test.tree.manage'],
      before,
    )
    expect(after).toBeGreaterThan(before)
    expect((await admin.getRole(f.tenant, f.managerRole)).permissions).toEqual(['test.tree.manage'])
    expect(await rbac.canAt(principal(f.manager), 'test.user.manage', f.college)).toBe(false)
    await admin.syncRolePermissions(
      f.tenant,
      f.managerRole,
      ['test.tree.manage', 'test.user.manage'],
      await versionOf(f.managerRole),
    )
    expect(await rbac.canAt(principal(f.manager), 'test.user.manage', f.college)).toBe(true)

    // an active role may not be emptied: it would be live and grant nothing
    expect(
      await outcome(
        admin.syncRolePermissions(f.tenant, f.managerRole, [], await versionOf(f.managerRole)),
      ),
    ).toEqual({ code: 'ROLE_INCOMPLETE', data: { missing: ['permissions'] } })

    // a role that is still granted cannot be deleted
    expect(
      await outcome(admin.deleteRole(f.tenant, f.managerRole, await versionOf(f.managerRole))),
    ).toEqual({ code: 'ROLE_IN_USE', data: { grantCount: 1 } })
    const spare = await admin.createRole(f.tenant, { code: 'spare', name: 'Spare', kind: 'org' })
    await admin.deleteRole(f.tenant, spare, await versionOf(spare))
    expect(await domainCode(admin.getRole(f.tenant, spare))).toBe('ROLE_NOT_FOUND')

    // what org asks before it retypes a node: which anchored duties there
    // would no longer apply
    expect(await rbac.grantsBlockingOrgType(f.tenant, f.college, f.classType)).toEqual([
      'org-manager',
    ])
    expect(await rbac.grantsBlockingOrgType(f.tenant, f.college, f.collegeType)).toEqual([])
  })

  it('explains authority with the predicate it decides by', async () => {
    const admin = administration()
    const at = (userId: string, node?: string) =>
      admin.explainEffectivePermissions(f.tenant, userId, node)

    const adminAtClass = await at(f.admin, f.class1)
    const tree = adminAtClass.find((entry) => entry.code === 'test.tree.manage')!
    expect(tree.target).toBe('org-node')
    expect(tree.sources).toEqual([
      {
        roleId: f.tenantAdminRole,
        roleCode: 'tenant-admin',
        grantId: f.adminGrant,
        target: { kind: 'tenant' },
      },
    ])

    const managerAtClass = await at(f.manager, f.class1)
    expect(managerAtClass.find((entry) => entry.code === 'test.tree.manage')?.sources).toEqual([
      {
        roleId: f.managerRole,
        roleCode: 'org-manager',
        grantId: f.managerGrant,
        target: {
          kind: 'org-node',
          orgNodeId: f.college,
          orgNodeName: 'College',
          coverage: 'subtree',
        },
      },
    ])
    expect(managerAtClass.map((entry) => entry.code)).not.toContain('test.role.manage')
    // the explanation must never claim more than the decision does
    for (const entry of managerAtClass) {
      expect(await rbac.canAt(principal(f.manager), entry.code, f.class1)).toBe(true)
    }
    expect(await at(f.manager, f.otherCollege)).toEqual([])

    // an unknown node has no authority to explain, and answering as though
    // it did would disagree with canAt, which refuses it
    expect(await domainCode(at(randomUUID()))).toBe('GRANT_USER_NOT_FOUND')
    expect(await domainCode(at(f.manager, randomUUID()))).toBe('GRANT_NODE_NOT_FOUND')
  })

  it('pushes the authorized scope into the query', async () => {
    const admin = administration()
    // a second anchored grant outside the manager's reach, so the filter has
    // something real to exclude
    const elsewhere = await admin.grant(f.tenant, {
      userId: f.binder,
      roleId: f.managerRole,
      target: { kind: 'org-node', orgNodeId: f.otherCollege, coverage: 'self' },
    })
    // and one below the college, so a self anchor and a subtree anchor give
    // visibly different answers
    const classRole = await activeRole({
      code: 'class-duty',
      name: 'Class duty',
      kind: 'org',
      codes: ['test.tree.manage'],
      userTypeIds: [f.typeStudent],
      orgTypeIds: [f.classType],
    })
    const below = await admin.grant(f.tenant, {
      userId: f.student,
      roleId: classRole,
      target: { kind: 'org-node', orgNodeId: f.class1, coverage: 'self' },
    })
    const anchored = (coverage: 'self' | 'subtree') => ({
      read: { tenantWide: false, anchors: [{ orgNodeId: f.college, coverage }] },
      manage: { tenantWide: false, anchors: [] },
      tenantGrants: { read: false, manage: false },
    })
    // a self anchor covers exactly its node; only a subtree anchor descends
    const atCollege = await admin.listGrants(f.tenant, {}, anchored('self'))
    expect(atCollege.map((row) => row.id)).toContain(f.managerGrant)
    expect(atCollege.map((row) => row.id)).not.toContain(below)
    const underCollege = await admin.listGrants(f.tenant, {}, anchored('subtree'))
    expect(underCollege.map((row) => row.id)).toEqual(
      expect.arrayContaining([f.managerGrant, below]),
    )
    expect(underCollege.map((row) => row.id)).not.toContain(elsewhere)

    const scopeOf = async (userId: string) => ({
      read: await rbac.listAuthorizedScope(principal(userId), 'test.tree.manage'),
      manage: await rbac.listAuthorizedScope(principal(userId), 'test.user.manage'),
      tenantGrants: { read: false, manage: false },
    })

    // request range intersected with authorized range: a partial answer is
    // the correct answer, not an error
    const managerScope = await scopeOf(f.manager)
    const seen = await admin.listGrants(f.tenant, {}, managerScope)
    expect(seen.map((row) => row.id)).toContain(f.managerGrant)
    expect(seen.map((row) => row.id)).not.toContain(elsewhere)
    // a tenant-wide grant has no node, so node coverage cannot decide it
    expect(seen.every((row) => row.org_node_id !== null)).toBe(true)
    expect(seen.map((row) => row.id)).not.toContain(f.adminGrant)
    expect(seen.find((row) => row.id === f.managerGrant)?.manageable).toBe(true)

    // tenant-wide reach sees everything anchored, and tenant-wide grants
    // only when their own permission says so
    const adminScope = await scopeOf(f.admin)
    const all = await admin.listGrants(f.tenant, {}, {
      ...adminScope,
      tenantGrants: { read: true, manage: false },
    })
    expect(all.map((row) => row.id)).toEqual(
      expect.arrayContaining([f.managerGrant, elsewhere, f.adminGrant]),
    )
    expect(all.find((row) => row.id === f.adminGrant)?.manageable).toBe(false)

    // an empty scope reaches nothing at all, rather than everything
    const none = await admin.listGrants(f.tenant, {}, {
      read: { tenantWide: false, anchors: [] },
      manage: { tenantWide: false, anchors: [] },
      tenantGrants: { read: false, manage: false },
    })
    expect(none).toEqual([])

    // the filter narrows within the scope, it does not widen it
    expect(
      (await admin.listGrants(f.tenant, { orgNodeId: f.otherCollege }, managerScope)).map(
        (row) => row.id,
      ),
    ).toEqual([])
    await admin.revoke(f.tenant, elsewhere)
    await admin.revoke(f.tenant, below)
  })

  it("keeps a role definition inside the author's own permissions", async () => {
    const admin = administration()
    // the author holds one tenant capability and no escape hatch
    built.authorKit = await activeRole({
      code: 'author-kit',
      name: 'Author kit',
      kind: 'tenant',
      codes: ['test.report.read', 'iam.tenant-grant.manage'],
      userTypeIds: [f.typeFaculty],
    })
    await admin.grant(f.tenant, {
      userId: f.binder,
      roleId: built.authorKit,
      target: { kind: 'tenant' },
    })
    const author = principal(f.binder)

    built.delegate = await admin.createRole(f.tenant, {
      code: 'delegate',
      name: 'Delegate',
      kind: 'tenant',
    })
    await admin.syncRoleEligibility(
      f.tenant,
      built.delegate,
      { userTypeIds: [f.typeFaculty], orgTypeIds: [] },
      await versionOf(built.delegate),
    )
    // put a permission in a role, grant yourself the role, and you have it:
    // so a role may only name what its author already holds
    expect(
      await outcome(
        admin.syncRolePermissions(
          f.tenant,
          built.delegate,
          ['test.role.manage'],
          await versionOf(built.delegate),
          author,
        ),
      ),
    ).toEqual({ code: 'ROLE_ESCALATION_REFUSED', data: { permissions: ['test.role.manage'] } })
    await admin.syncRolePermissions(
      f.tenant,
      built.delegate,
      ['test.report.read'],
      await versionOf(built.delegate),
      author,
    )

    // activation runs the same check, so a stronger administrator cannot
    // stage the permissions and let a weaker author switch them on
    await admin.syncRolePermissions(
      f.tenant,
      built.delegate,
      ['test.report.read', 'test.role.manage'],
      await versionOf(built.delegate),
    )
    expect(
      await domainCode(
        admin.setRoleStatus(
          f.tenant,
          built.delegate,
          'active',
          await versionOf(built.delegate),
          author,
        ),
      ),
    ).toBe('ROLE_ESCALATION_REFUSED')

    // the exception is named and auditable, and only someone who holds it
    // can hand it out
    await addRolePermissions(built.authorKit, ['iam.role.escalate'])
    await admin.setRoleStatus(
      f.tenant,
      built.delegate,
      'active',
      await versionOf(built.delegate),
      author,
    )
    expect((await admin.getRole(f.tenant, built.delegate)).status).toBe('active')
  })

  it("keeps a grant inside the granter's own authority and coverage", async () => {
    const admin = administration()
    const granter = principal(f.binder)
    // authority over the grants themselves, at the whole college subtree
    const grantDesk = await activeRole({
      code: 'grant-desk',
      name: 'Grant desk',
      kind: 'org',
      codes: ['iam.grant.manage'],
      userTypeIds: [f.typeFaculty],
      orgTypeIds: [f.collegeType],
    })
    await admin.grant(f.tenant, {
      userId: f.binder,
      roleId: grantDesk,
      target: { kind: 'org-node', orgNodeId: f.college, coverage: 'subtree' },
    })
    // and one capability held at the college itself and nowhere below it
    const narrow = await activeRole({
      code: 'narrow-tree',
      name: 'Narrow tree',
      kind: 'org',
      codes: ['test.tree.manage'],
      userTypeIds: [f.typeFaculty],
      orgTypeIds: [f.collegeType],
    })
    const narrowGrant = await admin.grant(f.tenant, {
      userId: f.binder,
      roleId: narrow,
      target: { kind: 'org-node', orgNodeId: f.college, coverage: 'self' },
    })
    const tutor = await activeRole({
      code: 'tutor',
      name: 'Tutor',
      kind: 'org',
      codes: ['test.tree.manage'],
      userTypeIds: [f.typeStudent],
      orgTypeIds: [f.collegeType],
    })
    const handOut = (roleId: string, coverage: 'self' | 'subtree') =>
      admin.grant(
        f.tenant,
        {
          userId: f.student,
          roleId,
          target: { kind: 'org-node', orgNodeId: f.college, coverage },
        },
        granter,
      )

    // handing out what you hold, at coverage no wider than your own
    const same = await handOut(tutor, 'self')
    expect(await outcome(handOut(tutor, 'subtree'))).toEqual({
      code: 'GRANT_ESCALATION_REFUSED',
      data: { permissions: ['test.tree.manage'] },
    })
    // and never authority you do not hold at all
    expect(await outcome(handOut(built.auditor, 'self'))).toEqual({
      code: 'GRANT_ESCALATION_REFUSED',
      data: { permissions: ['test.audit.read'] },
    })

    // the escape hatch answers to coverage too: holding it at one node is
    // not authority to hand out a grant reaching a whole subtree
    await addRolePermissions(narrow, ['iam.org-role.bind'])
    const audited = await handOut(built.auditor, 'self')
    expect(await domainCode(handOut(built.auditor, 'subtree'))).toBe('GRANT_ESCALATION_REFUSED')
    await addRolePermissions(grantDesk, ['iam.org-role.bind'])
    const wide = await handOut(built.auditor, 'subtree')

    // being allowed to edit someone's grants says nothing about how much
    // power you may put in them, and the reverse holds as well: the reach of
    // the grant itself is checked before the role it carries
    await admin.revoke(f.tenant, narrowGrant)
    expect(
      await domainCode(
        admin.grant(
          f.tenant,
          {
            userId: f.student,
            roleId: tutor,
            target: { kind: 'org-node', orgNodeId: f.otherCollege, coverage: 'self' },
          },
          granter,
        ),
      ),
    ).toBe('ACCESS_DENIED')

    // the tenant side is the same rule with its own escape hatch
    expect(
      await outcome(
        admin.grant(
          f.tenant,
          { userId: f.manager, roleId: built.delegate, target: { kind: 'tenant' } },
          granter,
        ),
      ),
    ).toEqual({ code: 'GRANT_ESCALATION_REFUSED', data: { permissions: ['test.role.manage'] } })
    await addRolePermissions(built.authorKit, ['iam.tenant-role.bind'])
    const delegated = await admin.grant(
      f.tenant,
      { userId: f.manager, roleId: built.delegate, target: { kind: 'tenant' } },
      granter,
    )

    for (const id of [same, audited, wide, delegated]) await admin.revoke(f.tenant, id)
  })

  it('reserves the canonical administrator role for its own holders', async () => {
    const admin = administration()
    // The scenario the reservation exists for: someone who legitimately
    // administers tenant-wide grants and holds the named escape hatch, and
    // still must not be able to promote themselves.
    const desk = await activeRole({
      code: 'tenant-grant-desk',
      name: 'Tenant grant desk',
      kind: 'tenant',
      codes: ['iam.tenant-grant.manage', 'iam.tenant-role.bind'],
      userTypeIds: [f.typeFaculty],
    })
    const deskGrant = await admin.grant(f.tenant, {
      userId: f.manager,
      roleId: desk,
      target: { kind: 'tenant' },
    })
    const promote = (actor: string) =>
      admin.grant(
        f.tenant,
        { userId: f.manager, roleId: f.tenantAdminRole, target: { kind: 'tenant' } },
        principal(actor),
      )

    expect(await domainCode(promote(f.manager))).toBe('TENANT_ADMIN_REQUIRED')
    // an administrator may, which proves the refusal was about the role
    const promoted = await promote(f.admin)
    // holding the role IS what authorizes administering it, so having been
    // given it they may also give it up; the tenant stays protected by the
    // survivor invariant rather than by this rule
    await admin.revoke(f.tenant, promoted, principal(f.manager))
    // and having given it up they cannot take it back
    expect(await domainCode(promote(f.manager))).toBe('TENANT_ADMIN_REQUIRED')
    await admin.revoke(f.tenant, deskGrant)
  })

  it('protects the last tenant administrator', async () => {
    const admin = administration()
    const promote = (userId: string) =>
      admin.grant(f.tenant, { userId, roleId: f.tenantAdminRole, target: { kind: 'tenant' } })

    expect(await domainCode(admin.revoke(f.tenant, f.adminGrant))).toBe('LAST_ADMINISTRATOR')
    // a second administrator makes removal legal again
    const second = await promote(f.manager)
    await admin.revoke(f.tenant, f.adminGrant)
    // and the survivor is protected in turn
    expect(await domainCode(admin.revoke(f.tenant, second))).toBe('LAST_ADMINISTRATOR')
    f.adminGrant = await promote(f.admin)
    await admin.revoke(f.tenant, second)
    expect(await orpcCode(rbac.require(principal(f.manager), 'test.role.manage'))).toBe('FORBIDDEN')
  })

  it('counts an administrator who could still sign in, not merely a holder', async () => {
    const handle = db.ctx.db.drizzle as unknown as RbacDbHandle
    const survives = () => domainCode(rbac.assertTenantKeepsAdministrator(f.tenant, handle))
    expect(await survives()).toBe('ok')

    // Bound identities are deliberately absent from this: whether a user
    // needs one before their first sign-in is driver knowledge. Everything
    // that every driver refuses is here.
    const cases: [string, unknown[]][] = [
      [`update users set enabled = false where id = $1`, [f.admin]],
      [`update user_types set enabled = false where id = $1`, [f.typeAdmin]],
      [
        `update user_types set allow_local_login = false, allow_sso_login = false where id = $1`,
        [f.typeAdmin],
      ],
    ]
    for (const [statement, params] of cases) {
      await db.query(statement, params)
      expect(await survives()).toBe('LAST_ADMINISTRATOR')
      await db.query(`update users set enabled = true where id = $1`, [f.admin])
      await db.query(
        `update user_types set enabled = true, allow_local_login = true where id = $1`,
        [f.typeAdmin],
      )
      expect(await survives()).toBe('ok')
    }

    // and the invariant is checked by the writes themselves, against the
    // state they actually leave behind
    const spare = await administration().grant(f.tenant, {
      userId: f.manager,
      roleId: built.reviewer,
      target: { kind: 'tenant' },
    })
    await db.query(`update user_types set allow_local_login = false where id = $1`, [f.typeAdmin])
    expect(await domainCode(administration().revoke(f.tenant, spare))).toBe('LAST_ADMINISTRATOR')
    await db.query(`update user_types set allow_local_login = true where id = $1`, [f.typeAdmin])
    await administration().revoke(f.tenant, spare)
  })

  it('serializes concurrent administrator revocations', async () => {
    const admin = administration()
    // two administrators, both grants revoked concurrently: the tenant lock
    // and the role row lock force the second transaction to see the first
    // delete, so exactly one revocation wins
    const second = await admin.grant(f.tenant, {
      userId: f.manager,
      roleId: f.tenantAdminRole,
      target: { kind: 'tenant' },
    })
    const results = await Promise.allSettled(
      [f.adminGrant, second].map((id) => admin.revoke(f.tenant, id)),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const left = await db.query(
      `select count(distinct user_id) from role_grants where tenant_id = $1 and role_id = $2`,
      [f.tenant, f.tenantAdminRole],
    )
    expect(Number(left.rows[0]!.count)).toBe(1)
  })
})
