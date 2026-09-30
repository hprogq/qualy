// The audit domain's own catalog: pure constants shared by the runtime
// registry declaration and the seed. Reading the log is tenant-wide - the
// trail is the tenant's memory, not a per-node resource - and there is no
// write permission at all, because events are written by operations, never
// by people.
import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

export const permissions = [
  {
    code: 'audit.event.read',
    name: text(m.permission_eventRead),
    groupKey: 'audit',
    group: text(m.permissionGroup_audit),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
