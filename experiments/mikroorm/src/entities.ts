import { defineEntity } from '@mikro-orm/core'

// The entities the vertical slice needs, and no more.
//
// org owns the tree, auth owns the people standing in it, rbac owns what they
// may do - and `changeNodeType` is the one path where all three meet inside a
// single transaction. That is the case worth proving, so the closure stops at
// the tables it reaches.
//
// Column names are not written out. The underlying schema is snake_case and
// every property here is camelCase, so a naming strategy that failed to map
// them would surface as an undefined column rather than as a silent mismatch.

const p = defineEntity.properties

export const Tenant = defineEntity({
  name: 'Tenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary(),
    slug: p.string().length(63),
    name: p.string().length(255),
    enabled: p.boolean(),
  },
})

export const OrgType = defineEntity({
  name: 'OrgType',
  tableName: 'org_types',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    code: p.string().length(63),
    name: p.string().length(255),
    sortOrder: p.smallint(),
  },
})

export const OrgTypeRule = defineEntity({
  name: 'OrgTypeRule',
  tableName: 'org_type_rules',
  properties: {
    tenantId: p.uuid().primary(),
    parentTypeId: p.uuid().primary(),
    childTypeId: p.uuid().primary(),
  },
})

export const OrgNode = defineEntity({
  name: 'OrgNode',
  tableName: 'org_nodes',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    parentId: p.uuid().nullable(),
    orgTypeId: p.uuid(),
    code: p.string().length(63).nullable(),
    name: p.string().length(255),
    // ltree has no MikroORM primitive; the column type is declared so the
    // schema generator emits it, and the value is read as text
    path: p.string().type('ltree'),
    depth: p.smallint(),
    sortOrder: p.smallint(),
  },
})

export const UserType = defineEntity({
  name: 'UserType',
  tableName: 'user_types',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    code: p.string().length(63),
    name: p.string().length(255),
    placementMode: p.string().length(16),
    enabled: p.boolean(),
  },
})

export const UserTypeAllowedOrgType = defineEntity({
  name: 'UserTypeAllowedOrgType',
  tableName: 'user_type_allowed_org_types',
  properties: {
    tenantId: p.uuid().primary(),
    userTypeId: p.uuid().primary(),
    orgTypeId: p.uuid().primary(),
  },
})

export const User = defineEntity({
  name: 'User',
  tableName: 'users',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    displayName: p.string().length(255).nullable(),
    userTypeId: p.uuid(),
    primaryOrgNodeId: p.uuid().nullable(),
    enabled: p.boolean(),
  },
})

export const Role = defineEntity({
  name: 'Role',
  tableName: 'roles',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    code: p.string().length(63),
    name: p.string().length(100),
    kind: p.string().length(16),
    status: p.string().length(16),
    permissionMode: p.string().length(16),
    systemKey: p.string().length(63).nullable(),
  },
})

export const RoleGrant = defineEntity({
  name: 'RoleGrant',
  tableName: 'role_grants',
  properties: {
    id: p.uuid().primary(),
    tenantId: p.uuid(),
    userId: p.uuid(),
    roleId: p.uuid(),
    orgNodeId: p.uuid().nullable(),
    coverage: p.string().length(16).nullable(),
  },
})

export const RoleAllowedOrgType = defineEntity({
  name: 'RoleAllowedOrgType',
  tableName: 'role_allowed_org_types',
  properties: {
    tenantId: p.uuid().primary(),
    roleId: p.uuid().primary(),
    orgTypeId: p.uuid().primary(),
  },
})

/**
 * What the host would compose from the plugins the manifest selected.
 *
 * A tuple rather than an array, because `EntityManager` and `getKysely()` read
 * their types from it: widening it to `EntitySchema[]` erases every table name
 * and column, and the Kysely queries below would typecheck against nothing.
 */
export const entities = [
  Tenant,
  OrgType,
  OrgTypeRule,
  OrgNode,
  UserType,
  UserTypeAllowedOrgType,
  User,
  Role,
  RoleGrant,
  RoleAllowedOrgType,
] as const
