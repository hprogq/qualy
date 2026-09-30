// The auth plugin's permission catalog; shape is validated where it meets
// rbac.definePermissions, and the seed upserts the same rows by code.
//
// There is deliberately no "may enter the portal" capability. Whether a
// signed-in person reaches the shell is authentication state — an enabled
// user with an enabled type and a live session — and pages say so with
// AUTHENTICATED visibility. Modelling it as a permission meant every user
// type needed a role just to carry it, which is most of why user types
// started carrying roles at all.
import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

export const permissions = [
  {
    code: 'auth.user-type.read',
    name: text(m.permission_userTypeRead),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'tenant',
  },
  {
    code: 'auth.user-type.manage',
    name: text(m.permission_userTypeManage),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'tenant',
  },
  {
    code: 'auth.provider.read',
    name: text(m.permission_providerRead),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'tenant',
  },
  {
    code: 'auth.provider.manage',
    name: text(m.permission_providerManage),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'tenant',
  },
  // Apart from manage, which arranges the doors: adding one, and what one
  // believes - its server, client and secrets, and how it reads a person
  // from an answer - decide who can sign in as whom. The administrator
  // holds it; anybody else only when given it on purpose.
  {
    code: 'auth.provider.trust.manage',
    name: text(m.permission_providerTrustManage),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'tenant',
  },
  {
    code: 'auth.user.read',
    name: text(m.permission_userRead),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'org-node',
  },
  {
    code: 'auth.user.manage',
    name: text(m.permission_userManage),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'org-node',
  },
  // Deliberately apart from manage: erasing a person from the living set is
  // final and a higher-stakes act than editing them, and handing both to
  // everyone who administers a unit would make deletion routine.
  {
    code: 'auth.user.delete',
    name: text(m.permission_userDelete),
    groupKey: 'identity',
    group: text(m.permissionGroup_identity),
    target: 'org-node',
  },
] as const satisfies readonly PermissionDefinition[]
