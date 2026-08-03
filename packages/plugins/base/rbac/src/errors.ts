import { z } from 'zod'
import { defineDomainErrors } from '@qualy/api-contract'

// Access administration errors, declared once: the contract entries, the
// http status map and the typed create() all derive from here. The
// cross-domain lockout invariant lives in @qualy/rbac-contract instead,
// because auth raises it too and one code must mean one thing across the api.
export const accessErrors = defineDomainErrors({
  ROLE_NOT_FOUND: { status: 404, message: 'role not found' },
  ROLE_CONFLICT: { status: 409, message: 'a role with that code or name already exists' },
  ROLE_IS_SYSTEM: { status: 409, message: 'system roles cannot be changed this way' },
  ROLE_IN_USE: {
    status: 409,
    message: 'the role is still granted',
    data: z.object({ grantCount: z.number().int().nonnegative() }),
  },
  // a stale editor must not silently undo a change made after it read
  ROLE_VERSION_CONFLICT: {
    status: 409,
    message: 'the role changed since it was read',
    data: z.object({ currentVersion: z.number().int() }),
  },
  ROLE_NOT_DRAFT: { status: 409, message: 'only a draft role can be activated' },
  // a role that grants nothing, or an org role nobody qualifies for, is
  // indistinguishable from a misconfiguration, so it cannot become active
  ROLE_INCOMPLETE: {
    status: 422,
    message: 'the role is not complete enough to activate',
    data: z.object({
      missing: z.array(z.enum(['permissions', 'user-types', 'org-types'])),
    }),
  },
  ROLE_NEEDS_ELIGIBILITY: {
    status: 422,
    message: 'an org role needs at least one allowed user type and org type',
  },
  // a tenant role may hold anything; an org role is anchored, so a
  // tenant-wide capability inside it would have nowhere to apply
  ROLE_TARGET_MISMATCH: {
    status: 422,
    message: 'those permissions do not fit this kind of role',
    data: z.object({ permissions: z.array(z.string()) }),
  },
  PERMISSION_NOT_FOUND: {
    status: 404,
    message: 'no such active permission',
    data: z.object({ permissions: z.array(z.string()) }),
  },
  // defining a role with capabilities the author does not hold
  ROLE_ESCALATION_REFUSED: {
    status: 403,
    message: 'a role cannot be given permissions its author does not hold',
    data: z.object({ permissions: z.array(z.string()) }),
  },
  // handing out authority, or coverage, beyond the granter's own
  GRANT_ESCALATION_REFUSED: {
    status: 403,
    message: 'a role cannot be granted beyond the authority of the person granting it',
    data: z.object({ permissions: z.array(z.string()) }),
  },
  ROLE_USER_TYPE_NOT_FOUND: { status: 404, message: 'user type not found' },
  ROLE_ORG_TYPE_NOT_FOUND: { status: 404, message: 'org type not found' },
  GRANT_NOT_FOUND: { status: 404, message: 'grant not found' },
  // granting or revoking the administrator role is reserved for its holders:
  // the bind escape hatch must not be a route to becoming superuser
  TENANT_ADMIN_REQUIRED: {
    status: 403,
    message: 'only a tenant administrator may grant or revoke that role',
  },
  // an org-node capability cannot be evaluated without a node
  ACCESS_TARGET_REQUIRED: {
    status: 400,
    message: 'that permission is checked against an organization node',
  },
  GRANT_EXISTS: { status: 409, message: 'that grant already exists' },
  GRANT_USER_NOT_FOUND: { status: 404, message: 'user not found in this tenant' },
  GRANT_NODE_NOT_FOUND: { status: 404, message: 'organization node not found in this tenant' },
  // why one specific grant is refused. The reason is a stable semantic
  // token, never a role code or a constraint name, so it is safe to hand a
  // browser and precise enough to localize into a real sentence.
  GRANT_NOT_ELIGIBLE: {
    status: 409,
    message: 'that role cannot be granted to this user here',
    data: z.object({
      reason: z.enum([
        'role-unassignable',
        'user-disabled',
        'user-type',
        'org-type',
        'tenant-role-anchored',
        'org-role-unanchored',
      ]),
    }),
  },
  // narrowing a role's eligibility would leave grants that no longer qualify
  GRANT_STRANDED: {
    status: 409,
    message: 'existing grants would no longer qualify',
    data: z.object({ grantCount: z.number().int().nonnegative() }),
  },
})
