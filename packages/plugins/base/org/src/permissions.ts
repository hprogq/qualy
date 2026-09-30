// the org plugin's permission catalog; definePermissions wiring lands with
// the org domain session, the seed already provisions the rows
import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

export const permissions = [
  {
    code: 'org.tree.read',
    name: text(m.permission_treeRead),
    groupKey: 'org',
    group: text(m.permissionGroup_structure),
    target: 'org-node',
  },
  {
    code: 'org.tree.manage',
    name: text(m.permission_treeManage),
    groupKey: 'org',
    group: text(m.permissionGroup_structure),
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]
