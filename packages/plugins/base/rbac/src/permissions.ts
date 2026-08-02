// the rbac plugin's own permission catalog. Permission modules are pure
// constants shared by the runtime registry (definePermissions) and the seed
// (row upsert before any plugin has booted) — one source, two consumers.
export const rbacPermissions = [
  {
    code: 'rbac.role.read',
    name: '查看角色',
    scope: 'tenant',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'rbac.role.manage',
    name: '管理角色',
    scope: 'tenant',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'rbac.assignment.read',
    name: '查看角色授予',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'rbac.assignment.manage',
    name: '管理角色授予',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
] as const
