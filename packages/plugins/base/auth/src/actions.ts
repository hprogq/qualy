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
  subject: message('auth/audit-subject/user-update', 'Your account details were changed'),
  details: Schema.Struct({
    fields: Schema.Array(Schema.Literals(['displayName', 'userTypeId', 'businessNo', 'email'])),
  }),
})

export const UserMoved = AuditAction.define({
  code: 'auth.user.move',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-move', 'Move user'),
  subject: message('auth/audit-subject/user-move', 'Your unit was changed'),
  details: Schema.Struct({ fromOrgNodeId: id, toOrgNodeId: id }),
})

export const UserEnabled = AuditAction.define({
  code: 'auth.user.enable',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-enable', 'Enable user'),
  subject: message('auth/audit-subject/user-enable', 'Your account was enabled'),
  details: Schema.Struct({}),
})

export const UserDisabled = AuditAction.define({
  code: 'auth.user.disable',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/user-disable', 'Disable user'),
  subject: message('auth/audit-subject/user-disable', 'Your account was disabled'),
  details: Schema.Struct({}),
})

export const UserDeleted = AuditAction.define({
  code: 'auth.user.delete',
  target: 'auth.user',
  // version 1 rows count `revokedIdentities`; the same fact, before the
  // table was named for bindings
  version: 2,
  name: message('auth/audit/user-delete', 'Delete user'),
  // the counts say what fell with the person; the ids say where they stood,
  // which the row itself stops saying if the unit or type is later removed
  details: Schema.Struct({
    userTypeId: Schema.NullOr(id),
    orgNodeId: Schema.NullOr(id),
    revokedGrants: Schema.Number,
    revokedBindings: Schema.Number,
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
  // which settings moved (`name`, or a field key of the entrance's kind, a
  // cleared secret included), never what they moved to
  details: Schema.Struct({ fields: Schema.Array(Schema.String) }),
})

// The entrance leaves for good: what it ended goes with it, because the
// bindings and sessions it took down leave no trace of their own.
export const ProviderDeleted = AuditAction.define({
  code: 'auth.provider.delete',
  target: 'auth.provider',
  version: 1,
  name: message('auth/audit/provider-delete', 'Delete an entrance'),
  details: Schema.Struct({
    type: Schema.String,
    code: Schema.String,
    revokedBindings: Schema.Number,
    endedSessions: Schema.Number,
  }),
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

// A way in, written for a person or withdrawn from them. The door and the
// binding are in the details and nothing the person proves themselves with
// is: who could come in as whom is what an investigation asks. The codes are
// the ones the trail has always used; version 1 rows name the binding
// `identityId`.
export const BindingWritten = AuditAction.define({
  code: 'auth.identity.bind',
  target: 'auth.user',
  version: 2,
  name: message('auth/audit/identity-bind', 'Set a sign-in credential for a user'),
  subject: message('auth/audit-subject/identity-bind', 'A way to sign in was set or changed'),
  details: Schema.Struct({
    providerId: id,
    bindingId: id,
    /** a first binding, or the replacement of the one that stood */
    replaced: Schema.Boolean,
    endedSessions: Schema.Number,
  }),
})

export const BindingRevoked = AuditAction.define({
  code: 'auth.identity.revoke',
  target: 'auth.user',
  version: 2,
  name: message('auth/audit/identity-revoke', 'Withdraw a sign-in binding from a user'),
  subject: message('auth/audit-subject/identity-revoke', 'A way to sign in was removed'),
  details: Schema.Struct({ providerId: id, bindingId: id, endedSessions: Schema.Number }),
})

// Sessions the person ended themselves, on devices other than the one they
// were using: one, or all of them at once. Signing out of the session in
// hand is not recorded - it is the everyday way out, not a security act.
export const SessionsEnded = AuditAction.define({
  code: 'auth.session.revoke',
  target: 'auth.user',
  version: 1,
  name: message('auth/audit/session-revoke', 'End sign-in sessions'),
  subject: message('auth/audit-subject/session-revoke', 'Signed out on other devices'),
  details: Schema.Struct({ scope: Schema.Literals(['one', 'others']), ended: Schema.Number }),
})

export const userActions = [
  SessionsEnded,
  BindingWritten,
  BindingRevoked,
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
  ProviderDeleted,
  ProviderStatusChanged,
  ProvidersReordered,
] as const
