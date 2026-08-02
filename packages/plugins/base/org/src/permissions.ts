// the org plugin's permission catalog; definePermissions wiring lands with
// the org domain session, the seed already provisions the rows
export const orgPermissions = [
  {
    code: 'org.tree.read',
    name: '查看组织架构',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
  {
    code: 'org.tree.manage',
    name: '管理组织架构',
    scope: 'org',
    grantToUserType: false,
    grantToRole: true,
    defaultTenantAdmin: true,
  },
] as const
