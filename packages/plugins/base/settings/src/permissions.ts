import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

// The settings domain's own catalog: pure constants shared by the runtime
// registry declaration and the seed. Tenant-wide, because a word the tenant
// uses is not a per-node resource - and there is no read permission at all,
// since every signed-in reader sees the effective words.

export const permissions = [
  {
    code: 'settings.terminology.manage',
    name: message('settings/permission/terminology-manage', 'Manage terminology'),
    groupKey: 'settings',
    group: message('settings/permission-group/settings', 'System settings'),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
