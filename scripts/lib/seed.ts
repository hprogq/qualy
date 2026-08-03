import type { PoolClient } from 'pg'
import { resolvePermissionCatalogs } from './permission-entries.ts'
import { resolvePluginModuleUrl } from './schema-entries.ts'
import { SYSTEM_ACCOUNT_USER_TYPE } from '@qualy/plugin-auth/constants'

// tenant bootstrap in layers with different convergence semantics:
//
// - provision (default tenant, org type/rule template, single root, system
//   user type, local provider, admin): created when absent. Stable platform
//   semantics (provider type, system flags, login channels) are verified and
//   drift fails loudly; business-editable fields (names, sort, logo, rules
//   added by admins) are never written back.
// - demo data (sample descendants, student/faculty types, demo accounts):
//   only under an explicit demo flag, pure create-if-absent.
// - admin credential: operational input, never silently reset — an explicit
//   reset flag is required once the identity exists.

const passwordModule = () =>
  import(resolvePluginModuleUrl('@qualy/plugin-auth-local/password')) as Promise<
    typeof import('../../packages/plugins/base/auth-local/src/password.ts')
  >

type PermissionRow = import('../../packages/rbac-contract/src/index.ts').PermissionDefinition

// permission catalogs are discovered through package metadata
// (qualy.permissions.entry) so the seed never enumerates plugin names; the
// same modules feed the runtime registry
async function permissionCatalog(): Promise<{ plugin: string; rows: readonly PermissionRow[] }[]> {
  return Promise.all(
    resolvePermissionCatalogs().map(async (ref) => {
      const module = (await import(ref.moduleUrl)) as { permissions?: readonly PermissionRow[] }
      if (!module.permissions) {
        throw new Error(`${ref.plugin}: the permissions module must export "permissions"`)
      }
      return { plugin: ref.plugin, rows: module.permissions }
    }),
  )
}

const TENANT_ADMIN_ROLE = { code: 'tenant-admin', name: '租户管理员' }

const TENANT = { slug: 'default', name: 'Qualy' }

const ORG_TYPES = [
  { code: 'university', name: '学校', sortOrder: 10 },
  { code: 'campus', name: '校区', sortOrder: 20 },
  { code: 'college', name: '学院', sortOrder: 30 },
  { code: 'grade', name: '年级', sortOrder: 40 },
  { code: 'department', name: '系', sortOrder: 50 },
  { code: 'major', name: '专业', sortOrder: 60 },
  { code: 'specialization', name: '专业方向', sortOrder: 70 },
  { code: 'class', name: '班级', sortOrder: 80 },
]

const ORG_TYPE_RULES: [string, string][] = [
  ['university', 'campus'],
  ['campus', 'college'],
  ['university', 'college'],
  ['college', 'grade'],
  ['college', 'department'],
  ['grade', 'major'],
  ['major', 'specialization'],
  ['major', 'class'],
  ['specialization', 'class'],
]

const ADMIN_USER_TYPE = { code: SYSTEM_ACCOUNT_USER_TYPE, name: '系统账户' }
const LOCAL_PROVIDER = { code: 'local', name: '本地账号' }

// Where each kind of person may stand. This is the whole of what a user type
// decides: a student belongs to a class, a teacher to a grade, a
// teaching-research office or a class. What either of them may DO is a role
// they are granted, not something their type carries.
const DEMO_USER_TYPES = [
  { code: 'student', name: '学生', sortOrder: 10, orgTypes: ['class'] },
  { code: 'faculty', name: '教职工', sortOrder: 20, orgTypes: ['grade', 'department', 'class'] },
]

const DEMO_ORG_NODES = [
  { code: 'software-college', name: '软件学院', type: 'college', parent: 'root' },
  { code: 'grade-2023', name: '2023级', type: 'grade', parent: 'software-college' },
  { code: 'computer-science', name: '计算机科学与技术', type: 'major', parent: 'grade-2023' },
  { code: 'class-2023-1', name: '软件2023级1班', type: 'class', parent: 'computer-science' },
]

const DEMO_ORG_MANAGER = {
  code: 'org-manager',
  name: '组织管理员',
  // who may hold the duty, and where the duty applies — both independent of
  // where the person themselves is placed. A teacher belonging to a grade
  // can be the counsellor for a whole college.
  allowedUserTypes: ['faculty'],
  allowedOrgTypes: ['college', 'major'],
  permissions: [
    'org.tree.read',
    'org.tree.manage',
    'auth.user.read',
    'auth.user.manage',
    'iam.grant.read',
    'iam.grant.manage',
  ],
}

const DEMO_USERS = [
  {
    identifier: 'manager',
    displayName: '示例辅导员',
    userType: 'faculty',
    org: 'grade-2023',
  },
  { identifier: 'student', displayName: '示例学生', userType: 'student', org: 'class-2023-1' },
]

const label = (id: string) => id.replaceAll('-', '')

function drift(subject: string, field: string, expected: unknown, actual: unknown): never {
  throw new Error(
    `seed drift: ${subject} has unexpected ${field} (${actual} instead of ${expected})`,
  )
}

async function provisionRbac(
  ctx: Ctx,
  adminUserId: string,
  adminTypeId: string,
  report: SeedReport,
): Promise<void> {
  for (const { plugin, rows } of await permissionCatalog()) {
    for (const row of rows) {
      const inserted = await ctx.client.query(
        `insert into permissions (code, plugin, name, description, group_key, target_kind)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (code) do nothing`,
        [row.code, plugin, row.name, row.description ?? null, row.groupKey ?? null, row.target],
      )
      report.created.permissions += inserted.rowCount ?? 0
      if ((inserted.rowCount ?? 0) === 0) {
        // stable platform semantics on existing rows, same rule as the
        // runtime registry: changed ownership or calling convention needs a
        // new code, because live grants already assume the old one
        const existing = (
          await ctx.client.query(
            `select plugin, target_kind from permissions where code = $1`,
            [row.code],
          )
        ).rows[0]
        if (existing.plugin !== plugin) {
          drift(`permission ${row.code}`, 'plugin', plugin, existing.plugin)
        }
        if (existing.target_kind !== row.target) {
          drift(`permission ${row.code}`, 'target_kind', row.target, existing.target_kind)
        }
      }
    }
  }

  // The administrator role holds every capability that currently exists,
  // expressed once here instead of as a flag every plugin author has to
  // remember on every permission they declare. A plugin added tomorrow is
  // covered without touching this row.
  const roleInsert = await ctx.client.query(
    `insert into roles (tenant_id, code, name, kind, system_key, permission_mode,
       status, assignable)
     values ($1, $2, $3, 'tenant', 'tenant-admin', 'all-active', 'active', true)
     on conflict (tenant_id, code) do nothing`,
    [ctx.tenantId, TENANT_ADMIN_ROLE.code, TENANT_ADMIN_ROLE.name],
  )
  report.created.roles += roleInsert.rowCount ?? 0
  const role = (
    await ctx.client.query(
      `select id, kind, system_key, permission_mode, status from roles
       where tenant_id = $1 and code = $2`,
      [ctx.tenantId, TENANT_ADMIN_ROLE.code],
    )
  ).rows[0]
  if (roleInsert.rowCount === 0) {
    if (role.kind !== 'tenant') drift('role tenant-admin', 'kind', 'tenant', role.kind)
    if (role.system_key !== 'tenant-admin') {
      drift('role tenant-admin', 'system_key', 'tenant-admin', role.system_key)
    }
    if (role.permission_mode !== 'all-active') {
      drift('role tenant-admin', 'permission_mode', 'all-active', role.permission_mode)
    }
    if (role.status !== 'active') drift('role tenant-admin', 'status', 'active', role.status)
  }


  // a tenant role reaches the whole tenant, so the grant carries no node:
  // pinning it to the root with subtree coverage was a fiction every
  // downstream query had to keep up
  // The system account stands at the tenant root and nowhere else, which is
  // a platform rule rather than a configured allow-list: writing one here
  // would only invite the reading that some other university-typed node
  // would do just as well.

  const grant = await ctx.client.query(
    `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
     values ($1, $2, $3, null, null)
     on conflict do nothing`,
    [ctx.tenantId, adminUserId, role.id],
  )
  report.created.assignments += grant.rowCount ?? 0
}

export interface SeedOptions {
  demo?: boolean
  adminUsername?: string
  adminPassword?: string
  resetAdminPassword?: boolean
  demoPassword?: string
}

export interface SeedReport {
  created: {
    tenant: number
    orgTypes: number
    rules: number
    root: number
    userTypes: number
    provider: number
    permissions: number
    roles: number
    rolePermissions: number
    userTypeGrants: number
    assignments: number
    demoNodes: number
    demoUsers: number
  }
  admin: 'created' | 'unchanged' | 'reset'
  demo: 'created' | 'skipped'
}

interface Ctx {
  client: PoolClient
  tenantId: string
  typeIds: Map<string, string>
}

async function provisionTenant(client: PoolClient, report: SeedReport): Promise<Ctx> {
  const upsert = await client.query(
    `insert into tenants (slug, name) values ($1, $2) on conflict (slug) do nothing`,
    [TENANT.slug, TENANT.name],
  )
  report.created.tenant += upsert.rowCount ?? 0
  // existing tenants keep their business-edited name/logo/state untouched
  const tenantId: string = (
    await client.query(`select id from tenants where slug = $1`, [TENANT.slug])
  ).rows[0].id

  const typeIds = new Map<string, string>()
  for (const type of ORG_TYPES) {
    const inserted = await client.query(
      `insert into org_types (tenant_id, code, name, sort_order) values ($1, $2, $3, $4)
       on conflict (tenant_id, code) do nothing`,
      [tenantId, type.code, type.name, type.sortOrder],
    )
    report.created.orgTypes += inserted.rowCount ?? 0
    const row = await client.query(`select id from org_types where tenant_id = $1 and code = $2`, [
      tenantId,
      type.code,
    ])
    typeIds.set(type.code, row.rows[0].id)
  }

  for (const [parent, child] of ORG_TYPE_RULES) {
    const inserted = await client.query(
      `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1, $2, $3)
       on conflict (tenant_id, parent_type_id, child_type_id) do nothing`,
      [tenantId, typeIds.get(parent)!, typeIds.get(child)!],
    )
    report.created.rules += inserted.rowCount ?? 0
  }

  const root = await client.query(
    `select id from org_nodes where tenant_id = $1 and parent_id is null`,
    [tenantId],
  )
  if (!root.rows[0]) {
    const tenantName = (await client.query(`select name from tenants where id = $1`, [tenantId]))
      .rows[0].name
    const inserted = await client.query(
      `insert into org_nodes (tenant_id, org_type_id, code, name, path, depth)
       values ($1, $2, 'root', $3, '', 0) returning id`,
      [tenantId, typeIds.get('university'), tenantName],
    )
    await client.query(`update org_nodes set path = $1 where id = $2`, [
      label(inserted.rows[0].id),
      inserted.rows[0].id,
    ])
    report.created.root += 1
  }

  return { client, tenantId, typeIds }
}

// The placement policy is written at insert time, never after: the column
// carries no database default, so every writer states it, and a type that
// already exists keeps whatever the tenant configured. Re-adding the demo
// org types on every run would silently undo an administrator's narrowing.
async function ensureUserType(
  ctx: Ctx,
  type: { code: string; name: string; sortOrder?: number; orgTypes?: readonly string[] },
  flags: { allowLocalLogin: boolean; isSystem: boolean },
  report: SeedReport,
): Promise<{ id: string; created: boolean }> {
  const placementMode = type.orgTypes && type.orgTypes.length > 0 ? 'allow-list' : 'unrestricted'
  const inserted = await ctx.client.query(
    `insert into user_types (tenant_id, code, name, sort_order, allow_local_login, is_system,
       enabled, placement_mode)
     values ($1, $2, $3, $4, $5, $6, true, $7)
     on conflict (tenant_id, code) do nothing`,
    [
      ctx.tenantId,
      type.code,
      type.name,
      type.sortOrder ?? 0,
      flags.allowLocalLogin,
      flags.isSystem,
      placementMode,
    ],
  )
  report.created.userTypes += inserted.rowCount ?? 0
  const row = (
    await ctx.client.query(
      `select id, allow_local_login, is_system from user_types where tenant_id = $1 and code = $2`,
      [ctx.tenantId, type.code],
    )
  ).rows[0]
  if (inserted.rowCount === 0) {
    // stable platform semantics; display fields stay business-owned
    if (row.is_system !== flags.isSystem) {
      drift(`user type ${type.code}`, 'is_system', flags.isSystem, row.is_system)
    }
    if (flags.isSystem && row.allow_local_login !== flags.allowLocalLogin) {
      drift(
        `user type ${type.code}`,
        'allow_local_login',
        flags.allowLocalLogin,
        row.allow_local_login,
      )
    }
  }
  return { id: row.id, created: (inserted.rowCount ?? 0) > 0 }
}

async function ensureLocalProvider(ctx: Ctx, report: SeedReport): Promise<string> {
  const inserted = await ctx.client.query(
    `insert into auth_providers (tenant_id, code, type, name, is_system, enabled)
     values ($1, $2, 'local', $3, true, true)
     on conflict (tenant_id, code) do nothing`,
    [ctx.tenantId, LOCAL_PROVIDER.code, LOCAL_PROVIDER.name],
  )
  report.created.provider += inserted.rowCount ?? 0
  const row = (
    await ctx.client.query(
      `select id, type, is_system from auth_providers where tenant_id = $1 and code = $2`,
      [ctx.tenantId, LOCAL_PROVIDER.code],
    )
  ).rows[0]
  if (inserted.rowCount === 0) {
    if (row.type !== 'local') drift('auth provider local', 'type', 'local', row.type)
    if (row.is_system !== true) drift('auth provider local', 'is_system', true, row.is_system)
  }
  return row.id
}

async function createUserWithIdentity(
  ctx: Ctx,
  input: {
    providerId: string
    identifier: string
    displayName: string
    userTypeId: string
    orgNodeId: string
    credentialHash: string
  },
): Promise<void> {
  const user = await ctx.client.query(
    `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
     values ($1, $2, $3, $4) returning id`,
    [ctx.tenantId, input.displayName, input.userTypeId, input.orgNodeId],
  )
  await ctx.client.query(
    `insert into user_identities (tenant_id, user_id, auth_provider_id, identifier, credential_hash)
     values ($1, $2, $3, $4, $5)`,
    [ctx.tenantId, user.rows[0].id, input.providerId, input.identifier, input.credentialHash],
  )
}

async function provisionAdmin(
  ctx: Ctx,
  providerId: string,
  adminTypeId: string,
  options: SeedOptions,
  report: SeedReport,
): Promise<string> {
  const { hashPassword, normalizeLocalIdentifier } = await passwordModule()
  const username = normalizeLocalIdentifier(options.adminUsername ?? 'admin')
  if (!username) throw new Error('seed: QUALY_ADMIN_USERNAME is not a valid login name')

  const identity = (
    await ctx.client.query(
      `select id, user_id from user_identities where tenant_id = $1 and auth_provider_id = $2 and identifier = $3`,
      [ctx.tenantId, providerId, username],
    )
  ).rows[0]

  if (!identity) {
    if (!options.adminPassword) {
      throw new Error(
        'seed: the administrator does not exist yet, set QUALY_ADMIN_PASSWORD to create it',
      )
    }
    const root = (
      await ctx.client.query(
        `select id from org_nodes where tenant_id = $1 and parent_id is null`,
        [ctx.tenantId],
      )
    ).rows[0]
    await createUserWithIdentity(ctx, {
      providerId,
      identifier: username,
      displayName: '系统管理员',
      userTypeId: adminTypeId,
      orgNodeId: root.id,
      credentialHash: await hashPassword(options.adminPassword),
    })
    report.admin = 'created'
    const created = (
      await ctx.client.query(
        `select user_id from user_identities where tenant_id = $1 and auth_provider_id = $2 and identifier = $3`,
        [ctx.tenantId, providerId, username],
      )
    ).rows[0]
    return created.user_id
  }

  if (options.resetAdminPassword) {
    if (!options.adminPassword) {
      throw new Error('seed: QUALY_RESET_ADMIN_PASSWORD requires QUALY_ADMIN_PASSWORD')
    }
    await ctx.client.query(`update user_identities set credential_hash = $1 where id = $2`, [
      await hashPassword(options.adminPassword),
      identity.id,
    ])
    report.admin = 'reset'
    return identity.user_id
  }
  report.admin = 'unchanged'
  return identity.user_id
}

async function seedDemoData(ctx: Ctx, options: SeedOptions, report: SeedReport): Promise<void> {
  const { hashPassword } = await passwordModule()

  const nodeIds = new Map<string, string>()
  const root = (
    await ctx.client.query(
      `select id, path, depth from org_nodes where tenant_id = $1 and parent_id is null`,
      [ctx.tenantId],
    )
  ).rows[0]
  const nodes = new Map<string, { id: string; path: string; depth: number }>()
  nodes.set('root', root)
  nodeIds.set('root', root.id)

  for (const node of DEMO_ORG_NODES) {
    const existing = (
      await ctx.client.query(
        `select id, path, depth from org_nodes where tenant_id = $1 and code = $2`,
        [ctx.tenantId, node.code],
      )
    ).rows[0]
    if (existing) {
      nodes.set(node.code, existing)
      continue
    }
    const parent = nodes.get(node.parent)
    if (!parent) throw new Error(`seed demo order broken: missing parent ${node.parent}`)
    const inserted = await ctx.client.query(
      `insert into org_nodes (tenant_id, parent_id, org_type_id, code, name, path, depth)
       values ($1, $2, $3, $4, $5, '', $6) returning id`,
      [ctx.tenantId, parent.id, ctx.typeIds.get(node.type), node.code, node.name, parent.depth + 1],
    )
    const id = inserted.rows[0].id
    const path = `${parent.path}.${label(id)}`
    await ctx.client.query(`update org_nodes set path = $1 where id = $2`, [path, id])
    nodes.set(node.code, { id, path, depth: parent.depth + 1 })
    report.created.demoNodes += 1
  }

  const demoTypeIds = new Map<string, string>()
  for (const type of DEMO_USER_TYPES) {
    const { id, created } = await ensureUserType(
      ctx,
      type,
      { allowLocalLogin: true, isSystem: false },
      report,
    )
    demoTypeIds.set(type.code, id)
    // only on creation: where a kind of person may stand is the tenant's to
    // narrow, and a seed that re-adds its own list would undo that silently
    if (created) {
      for (const orgTypeCode of type.orgTypes) {
        await ctx.client.query(
          `insert into user_type_allowed_org_types (tenant_id, user_type_id, org_type_id)
           select $1, $2, ot.id from org_types ot where ot.tenant_id = $1 and ot.code = $3`,
          [ctx.tenantId, id, orgTypeCode],
        )
      }
    }
  }

  const provider = (
    await ctx.client.query(`select id from auth_providers where tenant_id = $1 and code = $2`, [
      ctx.tenantId,
      LOCAL_PROVIDER.code,
    ])
  ).rows[0]
  for (const user of DEMO_USERS) {
    const existing = (
      await ctx.client.query(
        `select id from user_identities where tenant_id = $1 and auth_provider_id = $2 and identifier = $3`,
        [ctx.tenantId, provider.id, user.identifier],
      )
    ).rows[0]
    if (existing) continue
    if (!options.demoPassword) {
      throw new Error('seed: QUALY_SEED_DEMO requires QUALY_DEMO_PASSWORD for the demo accounts')
    }
    await createUserWithIdentity(ctx, {
      providerId: provider.id,
      identifier: user.identifier,
      displayName: user.displayName,
      userTypeId: demoTypeIds.get(user.userType)!,
      orgNodeId: nodes.get(user.org)!.id,
      credentialHash: await hashPassword(options.demoPassword),
    })
    report.created.demoUsers += 1
  }


  // sample org role: applicability-constrained, permission-mapped, and the
  // demo manager holds it over the college subtree
  const roleInsert = await ctx.client.query(
    `insert into roles (tenant_id, code, name, kind, status) values ($1, $2, $3, 'org', 'active')
     on conflict (tenant_id, code) do nothing`,
    [ctx.tenantId, DEMO_ORG_MANAGER.code, DEMO_ORG_MANAGER.name],
  )
  report.created.roles += roleInsert.rowCount ?? 0
  const role = (
    await ctx.client.query(`select id from roles where tenant_id = $1 and code = $2`, [
      ctx.tenantId,
      DEMO_ORG_MANAGER.code,
    ])
  ).rows[0]
  for (const typeCode of DEMO_ORG_MANAGER.allowedUserTypes) {
    await ctx.client.query(
      `insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
       select $1, $2, ut.id from user_types ut
       where ut.tenant_id = $1 and ut.code = $3
       on conflict do nothing`,
      [ctx.tenantId, role.id, typeCode],
    )
  }
  for (const orgTypeCode of DEMO_ORG_MANAGER.allowedOrgTypes) {
    await ctx.client.query(
      `insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
       select $1, $2, ot.id from org_types ot
       where ot.tenant_id = $1 and ot.code = $3
       on conflict do nothing`,
      [ctx.tenantId, role.id, orgTypeCode],
    )
  }
  const mapped = await ctx.client.query(
    `insert into role_permissions (tenant_id, role_id, permission_id)
     select $1, $2, p.id from permissions p where p.code = any($3)
     on conflict do nothing`,
    [ctx.tenantId, role.id, DEMO_ORG_MANAGER.permissions],
  )
  report.created.rolePermissions += mapped.rowCount ?? 0

  const manager = (
    await ctx.client.query(
      `select u.id from users u
       join user_identities i on i.tenant_id = u.tenant_id and i.user_id = u.id
       where u.tenant_id = $1 and i.identifier = 'manager'`,
      [ctx.tenantId],
    )
  ).rows[0]
  const college = nodes.get('software-college')!
  const assignment = await ctx.client.query(
    `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
     values ($1, $2, $3, $4, 'subtree')
     on conflict do nothing`,
    [ctx.tenantId, manager.id, role.id, college.id],
  )
  report.created.assignments += assignment.rowCount ?? 0
}

export async function seed(client: PoolClient, options: SeedOptions = {}): Promise<SeedReport> {
  const report: SeedReport = {
    created: {
      tenant: 0,
      orgTypes: 0,
      rules: 0,
      root: 0,
      userTypes: 0,
      provider: 0,
      permissions: 0,
      roles: 0,
      rolePermissions: 0,
      userTypeGrants: 0,
      assignments: 0,
      demoNodes: 0,
      demoUsers: 0,
    },
    admin: 'unchanged',
    demo: 'skipped',
  }
  const ctx = await provisionTenant(client, report)
  const { id: adminTypeId } = await ensureUserType(
    ctx,
    ADMIN_USER_TYPE,
    { allowLocalLogin: true, isSystem: true },
    report,
  )
  const providerId = await ensureLocalProvider(ctx, report)
  const adminUserId = await provisionAdmin(ctx, providerId, adminTypeId, options, report)
  await provisionRbac(ctx, adminUserId, adminTypeId, report)
  if (options.demo) {
    await seedDemoData(ctx, options, report)
    report.demo = 'created'
  }
  return report
}
