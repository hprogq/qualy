// the auth plugin's permission catalog; shape is validated where it meets
// rbac.definePermissions, and the seed upserts the same rows by code
export const authPermissions = [
  {
    code: 'auth.portal.access',
    name: '访问门户',
    scope: 'tenant',
    grantToUserType: true,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'auth.user-type.read',
    name: '查看用户类型',
    scope: 'tenant',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'auth.user-type.manage',
    name: '管理用户类型',
    scope: 'tenant',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'auth.user.read',
    name: '查看用户',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'auth.user.manage',
    name: '管理用户',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
] as const
