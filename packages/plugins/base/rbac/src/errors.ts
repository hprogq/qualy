import { z } from 'zod'
import { defineDomainErrors } from '@qualy/api-contract'

// Access administration errors, declared once: the contract entries, the http
// status map and the typed create() all derive from here. The cross-domain
// lockout invariant lives in @qualy/rbac-contract instead, because auth
// raises it too and one code must mean one thing across the api.
export const accessErrors = defineDomainErrors({
  ROLE_NOT_FOUND: { status: 404, message: 'role not found' },
  ROLE_CONFLICT: { status: 409, message: 'a role with that code or name already exists' },
  ROLE_IS_SYSTEM: { status: 409, message: 'system roles cannot be changed this way' },
  ROLE_IN_USE: {
    status: 409,
    message: 'the role is still assigned',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
  ROLE_NEEDS_ELIGIBILITY: {
    status: 422,
    message: 'an org role needs at least one allowed user type and org type',
  },
  ROLE_PERMISSION_NOT_GRANTABLE: {
    status: 422,
    message: 'a permission cannot be granted to this role',
    data: z.object({ rejected: z.array(z.string()) }),
  },
  ROLE_USER_TYPE_NOT_FOUND: { status: 404, message: 'user type not found' },
  ROLE_ORG_TYPE_NOT_FOUND: { status: 404, message: 'org type not found' },
  ASSIGNMENT_NOT_FOUND: { status: 404, message: 'assignment not found' },
  ASSIGNMENT_USER_NOT_FOUND: { status: 404, message: 'user not found in this tenant' },
  ASSIGNMENT_NODE_NOT_FOUND: { status: 404, message: 'organization node not found in this tenant' },
  // why one specific grant is refused. The reason is a stable semantic
  // token, never a role code or a constraint name, so it is safe to hand a
  // browser and precise enough to localize into a real sentence.
  ASSIGNMENT_NOT_ELIGIBLE: {
    status: 409,
    message: 'that role cannot be granted to this user at this node',
    data: z.object({
      reason: z.enum([
        'role-unassignable',
        'user-disabled',
        'user-type',
        'org-type',
        'tenant-role-anchor',
      ]),
    }),
  },
  // narrowing a role's eligibility would leave grants that no longer qualify
  ASSIGNMENT_STRANDED: {
    status: 409,
    message: 'existing grants would no longer qualify',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
  TENANT_ADMIN_REQUIRED: {
    status: 403,
    message: 'only a tenant administrator may grant or revoke that role',
  },
})

export type AssignmentIneligibility = z.infer<
  NonNullable<(typeof accessErrors.definitions)['ASSIGNMENT_NOT_ELIGIBLE']['data']>
>['reason']
