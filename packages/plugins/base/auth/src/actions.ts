import { Schema } from 'effect'
import { message } from '@qualy/i18n-contract'
import { AuditAction } from '@qualy/audit-contract/action'

// The identity domain's audit actions: pure constants, like ./permissions.
// Details name ids and field names, never values - what changed is the
// event's business, what it changed TO is the row's.

const id = Schema.String

export const UserCreated = AuditAction.define({
  code: 'auth.user.create',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-create', 'Create user'),
  details: Schema.Struct({ userTypeId: id, orgNodeId: id }),
})

export const UserUpdated = AuditAction.define({
  code: 'auth.user.update',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-update', 'Edit user'),
  details: Schema.Struct({
    fields: Schema.Array(Schema.Literals(['displayName', 'userTypeId', 'businessNo'])),
  }),
})

export const UserMoved = AuditAction.define({
  code: 'auth.user.move',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-move', 'Move user'),
  details: Schema.Struct({ fromOrgNodeId: id, toOrgNodeId: id }),
})

export const UserEnabled = AuditAction.define({
  code: 'auth.user.enable',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-enable', 'Enable user'),
  details: Schema.Struct({}),
})

export const UserDisabled = AuditAction.define({
  code: 'auth.user.disable',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-disable', 'Disable user'),
  details: Schema.Struct({}),
})

export const UserDeleted = AuditAction.define({
  code: 'auth.user.delete',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-delete', 'Delete user'),
  // the counts say what fell with the person; the ids say where they stood,
  // which the row itself stops saying if the unit or type is later removed
  details: Schema.Struct({
    userTypeId: Schema.NullOr(id),
    orgNodeId: Schema.NullOr(id),
    revokedGrants: Schema.Number,
    revokedIdentities: Schema.Number,
    endedSessions: Schema.Number,
  }),
})

export const UserRestored = AuditAction.define({
  code: 'auth.user.restore',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-restore', 'Restore user'),
  details: Schema.Struct({ userTypeId: id, orgNodeId: id }),
})

const placementMode = Schema.Literals(['unrestricted', 'allow-list'])

export const UserTypeCreated = AuditAction.define({
  code: 'auth.user-type.create',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-create', 'Create user type'),
  details: Schema.Struct({ placementMode }),
})

export const UserTypeUpdated = AuditAction.define({
  code: 'auth.user-type.update',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-update', 'Edit user type'),
  details: Schema.Struct({
    fields: Schema.Array(Schema.Literals(['name', 'description', 'sortOrder'])),
  }),
})

export const UserTypeEnabled = AuditAction.define({
  code: 'auth.user-type.enable',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-enable', 'Enable user type'),
  details: Schema.Struct({}),
})

export const UserTypeDisabled = AuditAction.define({
  code: 'auth.user-type.disable',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-disable', 'Disable user type'),
  details: Schema.Struct({}),
})

export const UserTypePlacementUpdated = AuditAction.define({
  code: 'auth.user-type.placement.update',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-placement', 'Change where a user type may stand'),
  details: Schema.Struct({ mode: placementMode, orgTypeCount: Schema.Number }),
})

export const UserTypeDeleted = AuditAction.define({
  code: 'auth.user-type.delete',
  target: 'auth.user-type',
  version: 1,
  name: message('auth/audit/user-type-delete', 'Delete user type'),
  details: Schema.Struct({}),
})

export const ProviderAudienceUpdated = AuditAction.define({
  code: 'auth.provider.audience.update',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-audience', 'Change who may sign in through an entrance'),
  details: Schema.Struct({ mode: placementMode, userTypeCount: Schema.Number }),
})

export const userActions = [
  UserCreated,
  UserUpdated,
  UserMoved,
  UserEnabled,
  UserDisabled,
  UserDeleted,
  UserRestored,
  UserTypeCreated,
  UserTypeUpdated,
  UserTypeEnabled,
  UserTypeDisabled,
  UserTypePlacementUpdated,
  UserTypeDeleted,
  ProviderAudienceUpdated,
] as const
