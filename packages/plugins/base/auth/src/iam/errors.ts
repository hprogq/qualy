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
  // deleting it would empty a role's eligibility and leave that role
  // assignable to nobody
  USER_TYPE_LAST_FOR_ROLE: {
    status: 409,
    message: 'roles allow this user type and no other',
    data: z.object({ roleCount: z.number().int().nonnegative() }),
  },
  USER_TYPE_DISABLED: { status: 409, message: 'the user type is disabled' },
  USER_NOT_FOUND: { status: 404, message: 'user not found' },
  USER_CONFLICT: { status: 409, message: 'a user with that business number already exists' },
  IDENTITY_CONFLICT: { status: 409, message: 'that sign-in name is already taken' },
  USER_PLACEMENT_NOT_FOUND: {
    status: 404,
    message: 'the organization node a user would be placed on does not exist',
  },
  PERMISSION_NOT_GRANTABLE: {
    status: 422,
    message: 'a permission cannot be granted through this channel',
    data: z.object({ rejected: z.array(z.string()) }),
  },
  ASSIGNMENT_INCOMPATIBLE: {
    status: 409,
    message: 'existing role grants do not allow this change',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
})
