// The access domain's own catalog. Permission modules are pure constants
// shared by the runtime registry (definePermissions) and the seed (row
// upsert before any plugin has booted) — one source, two consumers.
//
// The codes live under iam for the same reason the urls do: rbac is how
// authorization is implemented, and an administrator picking permissions in
// a list should read the product domain, not the mechanism.
import type { PermissionDefinition } from '@qualy/rbac-contract'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

export const permissions = [
  {
    code: 'iam.role.read',
    name: text(m.permission_roleRead),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  {
    code: 'iam.role.manage',
    name: text(m.permission_roleManage),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  // Holding role.manage must not be a way to mint authority you lack: put a
  // permission in a role, grant yourself the role, and you have it. So a
  // role may only be given permissions its editor already holds — unless
  // they hold this, which is the deliberate, auditable exception.
  {
    code: 'iam.role.escalate',
    name: text(m.permission_roleEscalate),
    description: text(m.permissionHint_roleEscalate),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  {
    code: 'iam.grant.read',
    name: text(m.permission_grantRead),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'org-node',
  },
  {
    code: 'iam.grant.manage',
    name: text(m.permission_grantManage),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'org-node',
  },
  // No bind escape hatches beside these any more (re-ruled 2026-08-20):
  // granting to somebody else stopped comparing permission sets - the
  // appointment graph is the whole of that authority - and a self-grant
  // must never escalate, with no permission able to say otherwise.
  {
    code: 'iam.tenant-grant.read',
    name: text(m.permission_tenantGrantRead),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  {
    code: 'iam.tenant-grant.manage',
    name: text(m.permission_tenantGrantManage),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  // The appointment graph is security policy, not role cosmetics: whoever
  // can redraw who-appoints-whom can route authority. Editing it is its own
  // capability, apart from editing role definitions.
  {
    code: 'iam.role.appointment.manage',
    name: text(m.permission_roleAppointmentManage),
    description: text(m.permissionHint_roleAppointmentManage),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
  // reading why someone holds what they hold names roles and grants, which
  // is more than an ordinary administrator needs
  {
    code: 'iam.authorization.inspect',
    name: text(m.permission_authorizationInspect),
    groupKey: 'access',
    group: text(m.permissionGroup_access),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
