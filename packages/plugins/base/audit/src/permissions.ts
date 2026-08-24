// The audit domain's own catalog: pure constants shared by the runtime
// registry declaration and the seed. Reading the log is tenant-wide - the
// trail is the tenant's memory, not a per-node resource - and there is no
// write permission at all, because events are written by operations, never
// by people.
import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'audit.event.read',
    name: message('audit/permission/event-read', 'View the audit log'),
    groupKey: 'audit',
    group: message('audit/permission-group/audit', 'Audit'),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
