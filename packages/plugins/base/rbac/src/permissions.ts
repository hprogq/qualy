// The access domain's own catalog. Permission modules are pure constants
// shared by the runtime registry (definePermissions) and the seed (row
// upsert before any plugin has booted) — one source, two consumers.
//
// The codes live under iam for the same reason the urls do: rbac is how
// authorization is implemented, and an administrator picking permissions in
// a list should read the product domain, not the mechanism.
import { message } from '@qualy/i18n-contract'
import type { PermissionDefinition } from '@qualy/rbac-contract'

export const permissions = [
  {
    code: 'iam.role.read',
    name: message('rbac/permission/role-read', 'View roles'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  {
    code: 'iam.role.manage',
    name: message('rbac/permission/role-manage', 'Manage roles'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  // Holding role.manage must not be a way to mint authority you lack: put a
  // permission in a role, grant yourself the role, and you have it. So a
  // role may only be given permissions its editor already holds — unless
  // they hold this, which is the deliberate, auditable exception.
  {
    code: 'iam.role.escalate',
    name: message('rbac/permission/role-escalate', 'Define roles beyond your own authority'),
    description: message(
      'rbac/permission-hint/role-escalate',
      'Put a permission into a role without holding it yourself.',
    ),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  {
    code: 'iam.grant.read',
    name: message('rbac/permission/grant-read', 'View role assignments in the organization'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'org-node',
  },
  {
    code: 'iam.grant.manage',
    name: message('rbac/permission/grant-manage', 'Manage role assignments in the organization'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'org-node',
  },
  // No bind escape hatches beside these any more (re-ruled 2026-08-20):
  // granting to somebody else stopped comparing permission sets - the
  // appointment graph is the whole of that authority - and a self-grant
  // must never escalate, with no permission able to say otherwise.
  {
    code: 'iam.tenant-grant.read',
    name: message('rbac/permission/tenant-grant-read', 'View tenant-wide role assignments'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  {
    code: 'iam.tenant-grant.manage',
    name: message('rbac/permission/tenant-grant-manage', 'Manage tenant-wide role assignments'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  // The appointment graph is security policy, not role cosmetics: whoever
  // can redraw who-appoints-whom can route authority. Editing it is its own
  // capability, apart from editing role definitions.
  {
    code: 'iam.role.appointment.manage',
    name: message('rbac/permission/role-appointment-manage', 'Manage which roles appoint which'),
    description: message(
      'rbac/permission-hint/role-appointment-manage',
      'Configure the roles that each role is allowed to appoint.',
    ),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
  // reading why someone holds what they hold names roles and grants, which
  // is more than an ordinary administrator needs
  {
    code: 'iam.authorization.inspect',
    name: message('rbac/permission/authorization-inspect', 'Inspect where authority comes from'),
    groupKey: 'access',
    group: message('rbac/permission-group/access', 'Roles and access'),
    target: 'tenant',
  },
] as const satisfies readonly PermissionDefinition[]
