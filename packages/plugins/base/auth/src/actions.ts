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
    fields: Schema.Array(Schema.Literals(['displayName', 'userTypeId', 'businessNo', 'email'])),
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

// Retired: deletion is final and nothing restores a person, so nothing
// records this. Declared so the events already in the trail keep a name.
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

export const ProviderCreated = AuditAction.define({
  code: 'auth.provider.create',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-create', 'Add an entrance'),
  details: Schema.Struct({ type: Schema.String, code: Schema.String }),
})

export const ProviderUpdated = AuditAction.define({
  code: 'auth.provider.update',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-update', 'Edit an entrance'),
  // which settings moved, never what they moved to: a config carries secrets
  details: Schema.Struct({ fields: Schema.Array(Schema.String) }),
})

export const ProviderStatusChanged = AuditAction.define({
  code: 'auth.provider.status',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-status', 'Enable or disable an entrance'),
  details: Schema.Struct({ status: Schema.Literals(['active', 'disabled']) }),
})

export const ProvidersReordered = AuditAction.define({
  code: 'auth.provider.reorder',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-reorder', 'Reorder the sign-in page'),
  details: Schema.Struct({ order: Schema.Array(id) }),
})

// A way in, written for a person or withdrawn from them. The entrance is in
// the details and the account name is not: who could come in as whom is what
// an investigation asks, and the name they typed at the door is theirs.
export const IdentityBound = AuditAction.define({
  code: 'auth.identity.bind',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/identity-bind', 'Set a sign-in account for a user'),
  details: Schema.Struct({
    providerId: id,
    identityId: id,
    /** a first binding, or the replacement of the one that stood */
    replaced: Schema.Boolean,
    endedSessions: Schema.Number,
  }),
})

export const IdentityRevoked = AuditAction.define({
  code: 'auth.identity.revoke',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/identity-revoke', 'Withdraw a sign-in account from a user'),
  details: Schema.Struct({ providerId: id, identityId: id, endedSessions: Schema.Number }),
})

export const userActions = [
  IdentityBound,
  IdentityRevoked,
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
  ProviderCreated,
  ProviderUpdated,
  ProviderStatusChanged,
  ProvidersReordered,
] as const
