import { randomUUID } from 'node:crypto'
import { Context } from 'cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import Server, { type AuthPrincipal } from '@qualy/plugin-server'
import UiRegistry from '@qualy/plugin-ui-registry'
import Rbac from '@qualy/plugin-rbac'
import { encodeQueryCursor, isAccessDeniedError, isDomainError } from '@qualy/api-contract'
import { permissions as authPermissions } from '../src/permissions.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../src/constants.ts'
import { placementPolicy } from '../src/iam/contract.ts'
import { IamService } from '../src/iam/service.ts'
import { createIdentityRouter } from '../src/iam/router.ts'

describe.runIf(postgresAvailable)('identity administration', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let ctx: Context
  let iam: IamService

  const f = {
    tenant: '',
    root: '',
    college: '',
    classNode: '',
    universityType: '',
    collegeType: '',
    classType: '',
    // the type the platform provisions and protects, held by the recovery
    // account; administrator power lives in the canonical role instead
    systemType: '',
    staffType: '',
    recovery: '',
    admin: '',
    manager: '',
    tenantAdminRole: '',
    managerRole: '',
    viewerRole: '',
  }

  // the two viewpoints the authorization tests need
  const asAdmin = () => ({ tenantId: f.tenant, userId: f.admin, sessionId: 'admin' })
  const asManager = () => ({ tenantId: f.tenant, userId: f.manager, sessionId: 'manager' })

  type ListInput = {
    orgNodeId: string
    scope: 'self' | 'subtree'
    search?: string
    cursor?: string
    limit?: number
  }
  // a cursor is only valid against the query that produced it, and the router
  // builds the fingerprint this way; tests resume pages through the same one
  const fingerprint = (input: ListInput) =>
    `users:${input.orgNodeId}:${input.scope}:${input.search ?? ''}`
  const list = (
    principal: { tenantId: string; userId: string; sessionId: string },
    input: ListInput,
  ) =>
    iam.listUsers(principal, {
      ...input,
      fingerprint: fingerprint(input),
      limit: input.limit ?? 50,
    })

  // the code and payload of a rejection, so a test can assert both without
  // narrowing at every call site
  const fault = (promise: Promise<unknown>): Promise<{ code: string; data: unknown }> =>
    promise.then(
      () => ({ code: 'ok', data: undefined }),
      (error: unknown) =>
        isDomainError(error)
          ? { code: error.code, data: error.data }
          : { code: (error as Error).message ?? 'error', data: undefined },
    )
  const code = (promise: Promise<unknown>) => fault(promise).then((failure) => failure.code)
  const deleteUsers = (userIds: string[]) =>
    db.query(`delete from users where id = any($1::uuid[])`, [userIds])
  const versionOf = async (userTypeId: string) =>
    (await iam.getUserType(f.tenant, userTypeId)).version
  const typeNamed = async (typeCode: string) =>
    (await iam.listUserTypes(f.tenant)).find((type) => type.code === typeCode)

  beforeAll(async () => {
    db = await createTestContext('iam')
    ctx = db.ctx

    const row = async (text: string, params: unknown[] = []) =>
      (await db.query(text, params)).rows[0]!.id as string

    f.tenant = await row(`insert into tenants (slug, name) values ('a', 'A') returning id`)
    f.universityType = await row(
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
    f.classNode = await row(
      `insert into org_nodes (id, tenant_id, org_type_id, parent_id, name, path, depth)
       select v.id, $1, $2, $3, 'Class',
         ((select path::text from org_nodes where id = $3) || '.' ||
          replace(v.id::text, '-', ''))::ltree, 2
       from (select uuidv7() as id) v returning id`,
      [f.tenant, f.classType, f.college],
    )
    // both types open a sign-in channel: a type that opens none holds nobody
    // who can actually sign in, and the lockout invariant counts exactly that.
    // Neither constrains placement, so every placement rule these tests pin
    // comes from a policy stated in the test itself.
    f.systemType = await row(
      `insert into user_types (tenant_id, code, name, is_system, allow_local_login, placement_mode)
       values ($1, $2, 'System Account', true, true, 'unrestricted') returning id`,
      [f.tenant, SYSTEM_ACCOUNT_USER_TYPE],
    )
    f.staffType = await row(
      `insert into user_types (tenant_id, code, name, allow_local_login, placement_mode)
       values ($1, 'staff', 'Staff', true, 'unrestricted') returning id`,
      [f.tenant],
    )
    // the account a tenant recovers itself with: an identity, not an
    // authority, so it holds no role of its own
    f.recovery = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Recovery', $2, $3) returning id`,
      [f.tenant, f.systemType, f.root],
    )
    f.admin = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Admin', $2, $3) returning id`,
      [f.tenant, f.staffType, f.root],
    )
    f.manager = await row(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Manager', $2, $3) returning id`,
      [f.tenant, f.staffType, f.college],
    )
    // the canonical administrator, identified by its whole shape: a system
    // key alone would let any later system role inherit its exemptions
    f.tenantAdminRole = await row(
      `insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
       values ($1, 'tenant-admin', 'TA', 'tenant', 'active', 'all-active', 'tenant-admin')
       returning id`,
      [f.tenant],
    )
    f.managerRole = await row(
      `insert into roles (tenant_id, code, name, kind, status)
       values ($1, 'org-manager', 'OM', 'org', 'active') returning id`,
      [f.tenant],
    )
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.staffType],
    )
    await db.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.managerRole, f.collegeType],
    )
    // a tenant role carries no anchor: it applies across the tenant, so
    // there is no node for the grant to name
    await db.query(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, null, null)`,
      [f.tenant, f.admin, f.tenantAdminRole],
    )
    // a role that reads users and nothing else, held by the manager at the
    // college with SELF coverage: the case a subtree request must not widen
    f.viewerRole = await row(
      `insert into roles (tenant_id, code, name, kind, status)
       values ($1, 'user-viewer', 'UV', 'org', 'active') returning id`,
      [f.tenant],
    )
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.staffType],
    )
    await db.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.collegeType],
    )
    await db.query(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.viewerRole, f.college],
    )

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
    await db.query(
      `insert into role_permissions (tenant_id, role_id, permission_id)
       select $1, $2, id from permissions where code = 'auth.user.read'`,
      [f.tenant, f.viewerRole],
    )
    iam = new IamService(ctx)
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('creates user types with the policy that says where their people may stand', async () => {
    const id = await iam.createUserType(f.tenant, {
      code: 'student',
      name: 'Student',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.classType] },
    })
    expect(id).toBeTruthy()
    expect(
      await code(
        iam.createUserType(f.tenant, {
          code: 'student',
          name: 'Other',
          placementPolicy: { mode: 'unrestricted' },
        }),
      ),
    ).toBe('USER_TYPE_CONFLICT')
    // the same name is refused too
    expect(
      await code(
        iam.createUserType(f.tenant, {
          code: 'other',
          name: 'Student',
          placementPolicy: { mode: 'unrestricted' },
        }),
      ),
    ).toBe('USER_TYPE_CONFLICT')
    // an allow-list naming an org type of another tenant creates nothing
    expect(
      await code(
        iam.createUserType(f.tenant, {
          code: 'ghost',
          name: 'Ghost',
          placementPolicy: { mode: 'allow-list', orgTypeIds: [randomUUID()] },
        }),
      ),
    ).toBe('USER_TYPE_ORG_TYPE_NOT_FOUND')
    expect(await typeNamed('ghost')).toBeUndefined()

    const types = await iam.listUserTypes(f.tenant)
    expect(types.map((type) => type.code)).toContain('student')
    expect(types.find((type) => type.code === SYSTEM_ACCOUNT_USER_TYPE)?.is_system).toBe(true)
    // the policy is stored as the type states it, not inferred from the list
    const student = types.find((type) => type.code === 'student')!
    expect(student.placement_mode).toBe('allow-list')
    expect(student.allowed_org_types).toEqual([f.classType])
    expect(student.version).toBe(1)
  })

  it('gives a user type no authority of its own', async () => {
    // A type says who someone is and where they may stand. It carries no
    // permission and no role, so a holder of a brand new type reaches
    // nothing until a grant says otherwise.
    const auditorType = await iam.createUserType(f.tenant, {
      code: 'auditor',
      name: 'Auditor',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.collegeType] },
    })
    const auditor = await iam.createUser(f.tenant, {
      displayName: 'Auditor One',
      userTypeId: auditorType,
      primaryOrgNodeId: f.college,
    })
    const asAuditor = { tenantId: f.tenant, userId: auditor, sessionId: 'auditor' }
    expect(await ctx.rbac.getProfile(asAuditor)).toEqual({
      tenantPermissions: [],
      orgPermissions: [],
    })
    expect(await list(asAuditor, { orgNodeId: f.college, scope: 'subtree' })).toEqual([])
    expect((await iam.userOptions(asAuditor, undefined, 50)).nodes).toEqual([])

    // the same person, after a role grant, holds exactly what the role
    // carries: authority arrives through grants and through nothing else
    await db.query(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, auditor, f.viewerRole, f.college],
    )
    expect(await ctx.rbac.getProfile(asAuditor)).toEqual({
      tenantPermissions: [],
      orgPermissions: ['auth.user.read'],
    })
    expect(
      (await list(asAuditor, { orgNodeId: f.college, scope: 'self' })).map((user) => user.id),
    ).toContain(f.manager)

    await db.query(`delete from users where id = $1`, [auditor])
    await iam.deleteUserType(f.tenant, auditorType, await versionOf(auditorType))
  })

  it('protects system and in-use user types from deletion', async () => {
    const system = (await typeNamed(SYSTEM_ACCOUNT_USER_TYPE))!
    const inUse = (await typeNamed('staff'))!
    const spare = (await typeNamed('student'))!
    expect(await code(iam.deleteUserType(f.tenant, system.id, system.version))).toBe(
      'USER_TYPE_IS_SYSTEM',
    )
    expect(await fault(iam.deleteUserType(f.tenant, inUse.id, inUse.version))).toEqual({
      code: 'USER_TYPE_IN_USE',
      data: { userCount: 2 },
    })
    // an unused, non-system type deletes cleanly
    await iam.deleteUserType(f.tenant, spare.id, spare.version)
    expect((await iam.listUserTypes(f.tenant)).map((type) => type.code)).not.toContain('student')
  })

  it('creates users and enforces the business number and placement', async () => {
    const id = await iam.createUser(f.tenant, {
      displayName: 'New Person',
      userTypeId: f.staffType,
      primaryOrgNodeId: f.college,
      businessNo: 'B-1001',
    })
    expect(id).toBeTruthy()
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Another',
          userTypeId: f.staffType,
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
          userTypeId: f.staffType,
          primaryOrgNodeId: randomUUID(),
        }),
      ),
    ).toBe('USER_PLACEMENT_NOT_FOUND')
    // a disabled type cannot receive new people. The type has to be an empty
    // one: disabling a populated type is refused outright, which is the point
    // of the rule rather than an obstacle to it
    const retired = await iam.createUserType(f.tenant, {
      code: 'retired',
      name: 'Retired',
      placementPolicy: { mode: 'unrestricted' },
    })
    expect(await iam.setUserTypeEnabled(f.tenant, retired, false, 1)).toBe(2)
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
    expect(
      await code(
        iam.setUserTypeEnabled(f.tenant, f.staffType, false, await versionOf(f.staffType)),
      ),
    ).toBe('USER_TYPE_IN_USE')
    await iam.deleteUserType(f.tenant, retired, 2)

    const users = await list(asAdmin(), { orgNodeId: f.root, scope: 'subtree' })
    expect(users.map((user) => user.display_name)).toContain('New Person')
    // the anchor scopes the listing
    const collegeOnly = await list(asAdmin(), { orgNodeId: f.college, scope: 'self' })
    expect(collegeOnly.map((user) => user.display_name)).not.toContain('Admin')

    await db.query(`delete from users where id = $1`, [id])
  })

  it('checks placement wherever it can be decided: creation, retype and transfer', async () => {
    const internType = await iam.createUserType(f.tenant, {
      code: 'intern',
      name: 'Intern',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.classType] },
    })
    // the node its type admits
    const intern = await iam.createUser(f.tenant, {
      displayName: 'Intern One',
      userTypeId: internType,
      primaryOrgNodeId: f.classNode,
    })
    expect(intern).toBeTruthy()
    // and one it does not
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Intern Two',
          userTypeId: internType,
          primaryOrgNodeId: f.college,
        }),
      ),
    ).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')

    // a transfer re-decides it: the person would land where their kind may
    // not stand
    expect(await code(iam.setUserPlacement(f.tenant, intern, f.college))).toBe(
      'USER_TYPE_PLACEMENT_NOT_ALLOWED',
    )
    expect((await iam.getUser(asAdmin(), intern)).primary_org_node_id).toBe(f.classNode)

    // and so does a retype: the new type must permit where this person
    // already stands, since they do not move
    const atCollege = await iam.createUser(f.tenant, {
      displayName: 'Staff At College',
      userTypeId: f.staffType,
      primaryOrgNodeId: f.college,
    })
    expect(await code(iam.updateUser(f.tenant, atCollege, { userTypeId: internType }))).toBe(
      'USER_TYPE_PLACEMENT_NOT_ALLOWED',
    )
    const atClass = await iam.createUser(f.tenant, {
      displayName: 'Staff At Class',
      userTypeId: f.staffType,
      primaryOrgNodeId: f.classNode,
    })
    await iam.updateUser(f.tenant, atClass, { userTypeId: internType })
    expect((await iam.getUser(asAdmin(), atClass)).user_type_code).toBe('intern')

    await deleteUsers([intern, atCollege, atClass])
    await iam.deleteUserType(f.tenant, internType, await versionOf(internType))
  })

  it('refuses to narrow a placement policy while people stand outside it', async () => {
    const contractorType = await iam.createUserType(f.tenant, {
      code: 'contractor',
      name: 'Contractor',
      placementPolicy: { mode: 'unrestricted' },
    })
    const atCollege = await iam.createUser(f.tenant, {
      displayName: 'Contractor College',
      userTypeId: contractorType,
      primaryOrgNodeId: f.college,
    })
    const atClass = await iam.createUser(f.tenant, {
      displayName: 'Contractor Class',
      userTypeId: contractorType,
      primaryOrgNodeId: f.classNode,
    })

    // one of the two stands outside the proposed list, and the count says so
    // without naming who
    expect(
      await fault(
        iam.syncPlacementPolicy(
          f.tenant,
          contractorType,
          { mode: 'allow-list', orgTypeIds: [f.collegeType] },
          1,
        ),
      ),
    ).toEqual({ code: 'USER_TYPE_PLACEMENT_IN_USE', data: { userCount: 1 } })
    // the refusal rolls back the policy as well as the version
    const untouched = await iam.getUserType(f.tenant, contractorType)
    expect(untouched.placement_mode).toBe('unrestricted')
    expect(untouched.version).toBe(1)

    // a list that covers everybody is accepted and spends a version
    expect(
      await iam.syncPlacementPolicy(
        f.tenant,
        contractorType,
        { mode: 'allow-list', orgTypeIds: [f.collegeType, f.classType] },
        1,
      ),
    ).toBe(2)
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Contractor Root',
          userTypeId: contractorType,
          primaryOrgNodeId: f.root,
        }),
      ),
    ).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')

    // widening back to "anywhere" is something the caller states, and it
    // permits any node
    expect(
      await iam.syncPlacementPolicy(f.tenant, contractorType, { mode: 'unrestricted' }, 2),
    ).toBe(3)
    const atRoot = await iam.createUser(f.tenant, {
      displayName: 'Contractor Root',
      userTypeId: contractorType,
      primaryOrgNodeId: f.root,
    })
    expect(atRoot).toBeTruthy()

    await deleteUsers([atCollege, atClass, atRoot])
    await iam.deleteUserType(f.tenant, contractorType, 3)
  })

  it('reads an allow-list with nothing on it as nowhere, and the contract refuses one', async () => {
    // Reading "no org types" as "anywhere" turns clearing the list into a
    // widening. The wire refuses to say it at all.
    expect(placementPolicy.safeParse({ mode: 'allow-list', orgTypeIds: [] }).success).toBe(false)
    expect(placementPolicy.safeParse({ mode: 'unrestricted' }).success).toBe(true)

    // called directly, the service stores it and reads it as the narrowing it
    // literally is: a type nobody may stand under anywhere
    const hermitType = await iam.createUserType(f.tenant, {
      code: 'hermit',
      name: 'Hermit',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.collegeType] },
    })
    expect(
      await iam.syncPlacementPolicy(
        f.tenant,
        hermitType,
        { mode: 'allow-list', orgTypeIds: [] },
        1,
      ),
    ).toBe(2)
    const stored = await iam.getUserType(f.tenant, hermitType)
    expect(stored.placement_mode).toBe('allow-list')
    expect(stored.allowed_org_types).toEqual([])
    for (const node of [f.root, f.college, f.classNode]) {
      expect(
        await code(
          iam.createUser(f.tenant, {
            displayName: 'Hermit One',
            userTypeId: hermitType,
            primaryOrgNodeId: node,
          }),
        ),
      ).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')
    }
    await iam.deleteUserType(f.tenant, hermitType, 2)
  })

  it('pins a system identity to the tenant root whatever its row stores', async () => {
    // the row says "anywhere"; the rule enforced is "the root and nowhere
    // else", because authority over a person is authority over the node they
    // stand at
    expect((await iam.getUserType(f.tenant, f.systemType)).placement_mode).toBe('unrestricted')
    expect(
      await code(
        iam.createUser(f.tenant, {
          displayName: 'Second Recovery',
          userTypeId: f.systemType,
          primaryOrgNodeId: f.college,
        }),
      ),
    ).toBe('USER_TYPE_PLACEMENT_NOT_ALLOWED')
    const atRoot = await iam.createUser(f.tenant, {
      displayName: 'Second Recovery',
      userTypeId: f.systemType,
      primaryOrgNodeId: f.root,
    })
    expect(atRoot).toBeTruthy()
    await db.query(`delete from users where id = $1`, [atRoot])

    // the whole of a system type is frozen, its placement policy included:
    // authority over where a person stands is authority over the person
    expect(
      await code(
        iam.syncPlacementPolicy(
          f.tenant,
          f.systemType,
          { mode: 'allow-list', orgTypeIds: [f.collegeType] },
          await versionOf(f.systemType),
        ),
      ),
    ).toBe('USER_TYPE_IS_SYSTEM')
    // and password sign-in stays open on it: the survivor invariant is
    // satisfied by any channel, including an sso channel with no provider
    expect(
      await code(
        iam.updateUserType(
          f.tenant,
          f.systemType,
          { allowLocalLogin: false },
          await versionOf(f.systemType),
        ),
      ),
    ).toBe('RECOVERY_CHANNEL_REQUIRED')
  })

  it('freezes the recovery account against ordinary administration', async () => {
    // retyping it to something ordinary would drop the root-only placement
    // and the guaranteed sign-in channel while keeping every grant it holds
    expect(await code(iam.updateUser(f.tenant, f.recovery, { userTypeId: f.staffType }))).toBe(
      'SYSTEM_ACCOUNT_PROTECTED',
    )
    // "another administrator survives" is not the same as "the tenant can
    // still recover itself"
    expect(await code(iam.setUserEnabled(f.tenant, f.recovery, false))).toBe(
      'SYSTEM_ACCOUNT_PROTECTED',
    )
    expect(await code(iam.setUserPlacement(f.tenant, f.recovery, f.college))).toBe(
      'SYSTEM_ACCOUNT_PROTECTED',
    )
    // its display fields are not frozen: only its type, status and placement
    await iam.updateUser(f.tenant, f.recovery, { displayName: 'Recovery Renamed' })
    const stored = await iam.getUser(asAdmin(), f.recovery)
    expect(stored.display_name).toBe('Recovery Renamed')
    expect(stored.user_type_id).toBe(f.systemType)
    expect(stored.enabled).toBe(true)
    expect(stored.primary_org_node_id).toBe(f.root)
    await iam.updateUser(f.tenant, f.recovery, { displayName: 'Recovery' })
  })

  it('versions the user type row as a whole', async () => {
    const tempType = await iam.createUserType(f.tenant, {
      code: 'temp',
      name: 'Temp',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.collegeType] },
    })
    expect(await versionOf(tempType)).toBe(1)

    // a caller that did not read this row cannot overwrite it, and is told
    // which version it would have to have read
    expect(await fault(iam.updateUserType(f.tenant, tempType, { name: 'Temp 2' }, 99))).toEqual({
      code: 'USER_TYPE_VERSION_CONFLICT',
      data: { currentVersion: 1 },
    })
    expect(await iam.updateUserType(f.tenant, tempType, { name: 'Temp 2' }, 1)).toBe(2)

    // asking for the state the row is already in is not an edit
    expect(await iam.setUserTypeEnabled(f.tenant, tempType, true, 2)).toBe(2)
    expect(
      await iam.syncPlacementPolicy(
        f.tenant,
        tempType,
        { mode: 'allow-list', orgTypeIds: [f.collegeType] },
        2,
      ),
    ).toBe(2)
    expect(await versionOf(tempType)).toBe(2)

    // but the rename did spend one, so a placement edit prepared against the
    // version it read is refused rather than silently applied
    expect(
      await fault(
        iam.syncPlacementPolicy(
          f.tenant,
          tempType,
          { mode: 'allow-list', orgTypeIds: [f.classType] },
          1,
        ),
      ),
    ).toEqual({ code: 'USER_TYPE_VERSION_CONFLICT', data: { currentVersion: 2 } })

    expect(await iam.syncPlacementPolicy(f.tenant, tempType, { mode: 'unrestricted' }, 2)).toBe(3)
    expect(await iam.setUserTypeEnabled(f.tenant, tempType, false, 3)).toBe(4)
    // deletion states a version too, so a stale editor cannot remove a row
    // that changed after it read
    expect(await fault(iam.deleteUserType(f.tenant, tempType, 3))).toEqual({
      code: 'USER_TYPE_VERSION_CONFLICT',
      data: { currentVersion: 4 },
    })
    await iam.deleteUserType(f.tenant, tempType, 4)
    expect(await typeNamed('temp')).toBeUndefined()
  })

  it('refuses a user type change that would strand role grants', async () => {
    await db.query(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, $4, 'self')`,
      [f.tenant, f.manager, f.managerRole, f.college],
    )
    const guestType = await iam.createUserType(f.tenant, {
      code: 'guest',
      name: 'Guest',
      placementPolicy: { mode: 'unrestricted' },
    })
    // org-manager and user-viewer both allow staff only, so moving the
    // manager to another type would leave those grants held by somebody the
    // roles do not admit
    expect(await fault(iam.updateUser(f.tenant, f.manager, { userTypeId: guestType }))).toEqual({
      code: 'GRANT_INCOMPATIBLE',
      data: { grantCount: 2 },
    })
    // an unrelated field still updates
    await iam.updateUser(f.tenant, f.manager, { displayName: 'Manager Renamed' })
    const users = await list(asAdmin(), { orgNodeId: f.college, scope: 'self' })
    expect(users.find((user) => user.id === f.manager)?.display_name).toBe('Manager Renamed')

    await db.query(`delete from role_grants where user_id = $1 and role_id = $2`, [
      f.manager,
      f.managerRole,
    ])
    await iam.deleteUserType(f.tenant, guestType, await versionOf(guestType))
  })

  it('ends the sessions of a user it disables', async () => {
    await db.query(
      `insert into sessions (tenant_id, user_id, token_hash, expires_at)
       values ($1, $2, repeat('a', 64), now() + interval '1 day')`,
      [f.tenant, f.manager],
    )
    expect(
      Number(
        (await db.query(`select count(*) from sessions where user_id = $1`, [f.manager])).rows[0]!
          .count,
      ),
    ).toBe(1)
    await iam.setUserEnabled(f.tenant, f.manager, false)
    // access ends now, not when the session happens to expire
    expect(
      Number(
        (await db.query(`select count(*) from sessions where user_id = $1`, [f.manager])).rows[0]!
          .count,
      ),
    ).toBe(0)
    await iam.setUserEnabled(f.tenant, f.manager, true)
  })

  it('intersects a subtree request with the reader’s own coverage', async () => {
    // someone stands below the college, inside the requested subtree but
    // outside a self anchor's reach
    const below = await iam.createUser(f.tenant, {
      displayName: 'Class Member',
      userTypeId: f.staffType,
      primaryOrgNodeId: f.classNode,
    })
    // the admin holds the canonical role, which reaches every node
    const wide = await list(asAdmin(), { orgNodeId: f.college, scope: 'subtree' })
    expect(wide.map((user) => user.id)).toContain(below)

    // the manager holds a SELF anchor at the college. The requested scope
    // alone would hand back everything below it, so the request and the
    // reader's coverage are intersected.
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

    await db.query(`delete from users where id = $1`, [below])
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
          { displayName: 'Smuggled', userTypeId: f.staffType, primaryOrgNodeId: f.college },
          asManager(),
        )
        .catch(denied),
    ).resolves.toBe('ACCESS_DENIED')
    // a system type is provisioned rather than handed out, whoever asks
    await expect(
      iam
        .createUser(
          f.tenant,
          { displayName: 'Self Made', userTypeId: f.systemType, primaryOrgNodeId: f.root },
          asAdmin(),
        )
        .catch(denied),
    ).resolves.toBe('ACCESS_DENIED')
    // the admin, who does administer that node, succeeds through the same path
    const created = await iam.createUser(
      f.tenant,
      { displayName: 'Legitimate', userTypeId: f.staffType, primaryOrgNodeId: f.college },
      asAdmin(),
    )
    expect(created).toBeTruthy()
    await db.query(`delete from users where id = $1`, [created])
  })

  it('refuses to delete a user type a role has no alternative to', async () => {
    // the viewer role allows staff and nothing else, and staff is in use
    expect(
      await code(iam.deleteUserType(f.tenant, f.staffType, await versionOf(f.staffType))),
    ).toBe('USER_TYPE_IN_USE')
    const lonely = await iam.createUserType(f.tenant, {
      code: 'lonely',
      name: 'Lonely',
      placementPolicy: { mode: 'unrestricted' },
    })
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, lonely],
    )
    await db.query(`delete from role_allowed_user_types where role_id = $1 and user_type_id = $2`, [
      f.viewerRole,
      f.staffType,
    ])
    expect(await fault(iam.deleteUserType(f.tenant, lonely, 1))).toEqual({
      code: 'USER_TYPE_LAST_FOR_ROLE',
      data: { roleCount: 1 },
    })
    // restoring the alternative makes the deletion legal again
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, f.viewerRole, f.staffType],
    )
    await iam.deleteUserType(f.tenant, lonely, 1)

    // The same guard for a tenant role, which declares who may hold it just
    // as an org role does. Looking only at org roles left an active tenant
    // role behind with nobody eligible for it, which is the inert state the
    // lifecycle exists to prevent.
    const orphan = (
      await db.query(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'orphan', 'Orphan', 'unrestricted') returning id`,
        [f.tenant],
      )
    ).rows[0]!.id as string
    const wide = (
      await db.query(
        `insert into roles (tenant_id, code, name, kind, status)
         values ($1, 'tenant-reviewer', 'Tenant reviewer', 'tenant', 'active') returning id`,
        [f.tenant],
      )
    ).rows[0]!.id as string
    await db.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id) values ($1, $2, $3)`,
      [f.tenant, wide, orphan],
    )
    expect(await fault(iam.deleteUserType(f.tenant, orphan, 1))).toEqual({
      code: 'USER_TYPE_LAST_FOR_ROLE',
      data: { roleCount: 1 },
    })
    await db.query(`delete from roles where id = $1`, [wide])
    await iam.deleteUserType(f.tenant, orphan, 1)
  })

  it('pages instead of truncating in silence', async () => {
    const made: string[] = []
    for (const index of [1, 2, 3]) {
      made.push(
        await iam.createUser(f.tenant, {
          displayName: `Paged ${index}`,
          userTypeId: f.staffType,
          primaryOrgNodeId: f.college,
        }),
      )
    }
    const query = { orgNodeId: f.college, scope: 'self' as const, search: 'Paged' }
    const first = await list(asAdmin(), { ...query, limit: 2 })
    expect(first).toHaveLength(2)
    const next = await list(asAdmin(), {
      ...query,
      cursor: encodeQueryCursor(fingerprint(query), [first[1]!.display_name, first[1]!.id]),
      limit: 2,
    })
    // the cursor resumes after the last row rather than repeating it
    expect(next.map((user) => user.display_name)).toEqual(['Paged 3'])
    // and it belongs to the query that produced it: resuming a different
    // search with it would skip or repeat rows and look like data loss
    await expect(
      list(asAdmin(), {
        ...query,
        search: 'Other',
        cursor: encodeQueryCursor(fingerprint(query), [first[1]!.display_name, first[1]!.id]),
        limit: 2,
      }),
    ).rejects.toThrow(/cursor is not usable here/)
    await deleteUsers(made)
  })

  it('answers the placement questions org and a tenant scan ask', async () => {
    const labType = await iam.createUserType(f.tenant, {
      code: 'lab-member',
      name: 'Lab Member',
      placementPolicy: { mode: 'allow-list', orgTypeIds: [f.classType] },
    })
    const member = await iam.createUser(f.tenant, {
      displayName: 'Lab One',
      userTypeId: labType,
      primaryOrgNodeId: f.classNode,
    })
    // org asks before it retypes a node: the people standing there do not
    // move, so the ground changing under them strands them
    expect(await iam.usersBlockingOrgType(f.tenant, f.classNode, f.classType)).toBe(0)
    expect(await iam.usersBlockingOrgType(f.tenant, f.classNode, f.collegeType)).toBe(1)
    // the root may be retyped freely: a system identity is legal there by the
    // rule that pins it, and staff state no constraint at all
    expect(await iam.usersBlockingOrgType(f.tenant, f.root, f.collegeType)).toBe(0)

    // the whole-tenant scan agrees with the writes, and answers zero only
    // because every placement was decided by the same predicate
    expect(await iam.placementViolations(f.tenant)).toBe(0)
    // a row written around the service (an import, a hand-run statement) is
    // exactly what the scan exists to find
    await db.query(`update users set primary_org_node_id = $1 where id = $2`, [f.college, member])
    expect(await iam.placementViolations(f.tenant)).toBe(1)
    expect(await iam.usersBlockingOrgType(f.tenant, f.college, f.collegeType)).toBe(1)

    await db.query(`delete from users where id = $1`, [member])
    expect(await iam.placementViolations(f.tenant)).toBe(0)
    await iam.deleteUserType(f.tenant, labType, await versionOf(labType))
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
    // a system type reports the rule that is enforced, not the row it stores:
    // presenting root-only as an allow-list of university nodes would be a
    // weaker claim
    const systemDto = (
      types.body as { userTypes: { code: string; placementPolicy: { mode: string } }[] }
    ).userTypes.find((type) => type.code === SYSTEM_ACCOUNT_USER_TYPE)
    expect(systemDto?.placementPolicy).toEqual({ mode: 'tenant-root' })

    // scope is an enum in the url and survives the trip as one
    const wide = await call(`/iam/users?orgNodeId=${f.root}&scope=subtree`, asAdmin())
    expect(wide.status).toBe(200)
    expect((wide.body as { items: unknown[] }).items.length).toBeGreaterThan(1)
    const narrow = await call(`/iam/users?orgNodeId=${f.root}&scope=self`, asAdmin())
    expect(
      (narrow.body as { items: { id: string }[] }).items.map((user) => user.id).sort(),
    ).toEqual([f.admin, f.recovery].sort())
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

    // the options endpoint carries the caller's own coverage and nothing
    // else, and never offers a type the platform provisions
    const options = await call('/iam/user-options', asManager())
    expect(options.status).toBe(200)
    const optionsBody = options.body as {
      nodes: { orgNodeId: string }[]
      truncated: boolean
      userTypes: { code: string }[]
    }
    expect(optionsBody.nodes.map((node) => node.orgNodeId)).toEqual([f.college])
    expect(optionsBody.truncated).toBe(false)
    expect(optionsBody.userTypes.map((type) => type.code)).not.toContain(SYSTEM_ACCOUNT_USER_TYPE)

    await host.dispose()
  })

  it('never lets the tenant lose its last administrator', async () => {
    // the admin is the only holder of the canonical role; the recovery
    // account is an identity, not an authority, and holds nothing
    expect(await code(iam.setUserEnabled(f.tenant, f.admin, false))).toBe('LAST_ADMINISTRATOR')
    // and the type they sign in through cannot be disabled while anyone
    // holds it: that revokes sign-in for every holder without ending a
    // single session
    expect(
      await code(
        iam.setUserTypeEnabled(f.tenant, f.staffType, false, await versionOf(f.staffType)),
      ),
    ).toBe('USER_TYPE_IN_USE')
    // closing its last sign-in channel is the same lockout by another route
    expect(
      await code(
        iam.updateUserType(
          f.tenant,
          f.staffType,
          { allowLocalLogin: false, allowSsoLogin: false },
          await versionOf(f.staffType),
        ),
      ),
    ).toBe('LAST_ADMINISTRATOR')
    // and the refused write left no trace, channels included
    const staff = await iam.getUserType(f.tenant, f.staffType)
    expect(staff.allow_local_login).toBe(true)

    // with a second administrator both become legal again
    const second = await iam.createUser(f.tenant, {
      displayName: 'Second Admin',
      userTypeId: f.staffType,
      primaryOrgNodeId: f.root,
    })
    await db.query(
      `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
       values ($1, $2, $3, null, null)`,
      [f.tenant, second, f.tenantAdminRole],
    )
    await iam.setUserEnabled(f.tenant, f.admin, false)
    // and the survivor becomes the one protected
    expect(await code(iam.setUserEnabled(f.tenant, second, false))).toBe('LAST_ADMINISTRATOR')
    await iam.setUserEnabled(f.tenant, f.admin, true)
  })

  it('serializes concurrent attempts to disable the last administrators', async () => {
    const holders = (
      await db.query(
        `select distinct g.user_id from role_grants g
         join users u on u.id = g.user_id and u.enabled
         where g.tenant_id = $1 and g.role_id = $2`,
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
      await db.query(
        `select count(distinct g.user_id) from role_grants g
         join users u on u.id = g.user_id and u.enabled
         where g.tenant_id = $1 and g.role_id = $2`,
        [f.tenant, f.tenantAdminRole],
      )
    ).rows[0]!.count
    expect(Number(left)).toBe(1)
  })
})
