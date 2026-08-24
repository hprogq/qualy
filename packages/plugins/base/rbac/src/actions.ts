import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The access domain's audit actions. Codes live under iam like its urls and
// permissions: rbac is how authorization is implemented, and a reader of the
// trail should meet the product domain, not the mechanism. Permission CODES
// appear in details - they are the catalog's public names - but never any
// secret or credential-shaped value.

const id = Schema.String

export const RoleCreated = AuditAction.define({
  code: 'iam.role.create',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-create', 'Create role'),
  details: Schema.Struct({ kind: Schema.Literals(['tenant', 'org']) }),
})

export const RoleUpdated = AuditAction.define({
  code: 'iam.role.update',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-update', 'Edit role'),
  details: Schema.Struct({
    fields: Schema.Array(Schema.Literals(['name', 'description', 'assignable'])),
  }),
})

export const RoleEnabled = AuditAction.define({
  code: 'iam.role.enable',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-enable', 'Activate role'),
  details: Schema.Struct({}),
})

export const RoleDisabled = AuditAction.define({
  code: 'iam.role.disable',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-disable', 'Disable role'),
  details: Schema.Struct({}),
})

// changing an active role's permissions is changing the office itself: it
// takes effect for every holder at once, which is exactly why the diff is
// worth keeping
export const RolePermissionsUpdated = AuditAction.define({
  code: 'iam.role.permissions.update',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-permissions', 'Change role permissions'),
  details: Schema.Struct({
    added: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
  }),
})

export const RoleEligibilityUpdated = AuditAction.define({
  code: 'iam.role.eligibility.update',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-eligibility', 'Change who may hold a role'),
  details: Schema.Struct({
    holderMode: Schema.Literals(['unrestricted', 'allow-list']),
    anchorMode: Schema.NullOr(Schema.Literals(['unrestricted', 'allow-list'])),
    userTypeCount: Schema.Number,
    orgTypeCount: Schema.Number,
  }),
})

export const RoleAppointmentUpdated = AuditAction.define({
  code: 'iam.role.appointment.update',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-appointment', 'Change which roles this one may appoint'),
  details: Schema.Struct({ targetRoleIds: Schema.Array(id) }),
})

export const RoleDeleted = AuditAction.define({
  code: 'iam.role.delete',
  target: 'iam.role',
  version: 1,
  name: message('rbac/audit/role-delete', 'Delete role'),
  details: Schema.Struct({}),
})

export const GrantCreated = AuditAction.define({
  code: 'iam.role-grant.create',
  target: 'iam.role-grant',
  version: 1,
  name: message('rbac/audit/grant-create', 'Grant role'),
  details: Schema.Struct({
    userId: id,
    roleId: id,
    scope: Schema.Literals(['tenant', 'org-node']),
    orgNodeId: Schema.NullOr(id),
    coverage: Schema.NullOr(Schema.Literals(['self', 'subtree'])),
    resource: Schema.NullOr(
      Schema.Struct({ namespace: Schema.String, type: Schema.String, id: Schema.String }),
    ),
  }),
})

export const GrantRevoked = AuditAction.define({
  code: 'iam.role-grant.revoke',
  target: 'iam.role-grant',
  version: 1,
  name: message('rbac/audit/grant-revoke', 'Revoke role grant'),
  details: Schema.Struct({ userId: id, roleId: id }),
})

export const accessActions = [
  RoleCreated,
  RoleUpdated,
  RoleEnabled,
  RoleDisabled,
  RolePermissionsUpdated,
  RoleEligibilityUpdated,
  RoleAppointmentUpdated,
  RoleDeleted,
  GrantCreated,
  GrantRevoked,
] as const
