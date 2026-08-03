import { z } from 'zod'
import { defineDomainErrors } from '@qualy/api-contract'

// identity administration errors, declared once (see the plugin api
// discipline in CLAUDE): the contract entries, the http status map and the
// typed create() all derive from here. The lockout invariant is deliberately
// absent — rbac raises it too, so it is declared in @qualy/rbac-contract
// where one code can mean one thing on both sides
export const iamErrors = defineDomainErrors({
  USER_TYPE_NOT_FOUND: { status: 404, message: 'user type not found' },
  USER_TYPE_CONFLICT: { status: 409, message: 'a user type with that code already exists' },
  USER_TYPE_IS_SYSTEM: { status: 409, message: 'system user types cannot be changed this way' },
  USER_TYPE_IN_USE: {
    status: 409,
    message: 'users still have this type',
    data: z.object({ userCount: z.number().int().nonnegative() }),
  },
  // roles still declare which user types may hold them, so deleting the only
  // type a role admits leaves that role grantable to nobody
  USER_TYPE_LAST_FOR_ROLE: {
    status: 409,
    message: 'roles admit this user type and no other',
    data: z.object({ roleCount: z.number().int().nonnegative() }),
  },
  USER_TYPE_DISABLED: { status: 409, message: 'the user type is disabled' },
  // where a kind of person may stand is a fact about the type, checked
  // wherever someone is created, retyped or transferred
  USER_TYPE_PLACEMENT_NOT_ALLOWED: {
    status: 409,
    message: 'that user type may not be placed on this kind of organization node',
  },
  // narrowing the allowed placements would leave people standing where their
  // type no longer permits
  USER_TYPE_PLACEMENT_IN_USE: {
    status: 409,
    message: 'users already stand where this change would no longer allow',
    data: z.object({ userCount: z.number().int().nonnegative() }),
  },
  USER_TYPE_VERSION_CONFLICT: {
    status: 409,
    message: 'the user type changed since it was read',
    data: z.object({ currentVersion: z.number().int() }),
  },
  USER_TYPE_ORG_TYPE_NOT_FOUND: { status: 404, message: 'organization type not found' },
  // The administrator type keeps password sign-in: it is how a tenant
  // recovers itself, and the generic survivor invariant cannot stand in for
  // this one — that check passes on any open channel, including an sso
  // channel with no provider behind it.
  RECOVERY_CHANNEL_REQUIRED: {
    status: 409,
    message: 'the administrator user type must keep password sign-in',
  },
  USER_NOT_FOUND: { status: 404, message: 'user not found' },
  // the tenant's way back in, frozen against the ordinary identity api:
  // its type, its status and where it stands are platform facts, not
  // administration decisions
  SYSTEM_ACCOUNT_PROTECTED: {
    status: 409,
    message: 'the system account cannot be changed this way',
  },
  USER_CONFLICT: { status: 409, message: 'a user with that business number already exists' },
  IDENTITY_CONFLICT: { status: 409, message: 'that sign-in name is already taken' },
  USER_PLACEMENT_NOT_FOUND: {
    status: 404,
    message: 'the organization node a user would be placed on does not exist',
  },
  GRANT_INCOMPATIBLE: {
    status: 409,
    message: 'existing role grants do not allow this change',
    data: z.object({ grantCount: z.number().int().nonnegative() }),
  },
})
