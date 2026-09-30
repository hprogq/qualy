import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The settings domain's own catalog: pure constants shared by the runtime
// registry declaration and the seed. Tenant-wide, because a word the tenant
// uses is not a per-node resource - and there is no read permission at all,
// since every signed-in reader sees the effective words.

export const permissions = [
  {
    code: 'settings.terminology.manage',
    name: text(m.permission_terminologyManage),
    groupKey: 'settings',
    group: text(m.permissionGroup_settings),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
