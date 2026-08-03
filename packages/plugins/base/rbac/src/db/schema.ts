// stable pure-table entry: kit aggregation and cross-plugin imports both key
// off these named exports; helpers and relations stay in their own modules
export { permissions } from './tables/permissions.ts'
export { roles } from './tables/roles.ts'
export { rolePermissions } from './tables/role-permissions.ts'
export { roleAllowedUserTypes } from './tables/role-allowed-user-types.ts'
export { roleAllowedOrgTypes } from './tables/role-allowed-org-types.ts'
export { roleGrants } from './tables/role-grants.ts'
