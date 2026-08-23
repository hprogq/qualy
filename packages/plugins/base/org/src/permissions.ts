// the org plugin's permission catalog; definePermissions wiring lands with
// the org domain session, the seed already provisions the rows
import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'org.tree.read',
    name: message('org/permission/tree-read', 'View the organization'),
    groupKey: 'org',
    group: message('org/permission-group/structure', 'Organization'),
    target: 'org-node',
  },
  {
    code: 'org.tree.manage',
    name: message('org/permission/tree-manage', 'Manage the organization'),
    groupKey: 'org',
    group: message('org/permission-group/structure', 'Organization'),
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]
