import { z } from 'zod'
import { del, get, okOutput, pageInput, pageOutput, patch, post, put } from '@qualy/api-contract'
import { accessInvariantErrors } from '@qualy/rbac-contract'
import { accessErrors as e } from './errors.ts'

// Roles, the permission catalog and the grants that connect them to people.
// The paths live under /iam because that is the product domain a tenant
// administers; rbac is how it happens to be implemented, and an
// implementation choice does not belong in a url.

const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case').max(63)
const roleName = z.string().trim().min(1).max(100)
const description = z.string().max(500)

// two states today, but a url that says `status` can grow a third without a
// second endpoint, which `enabled=false` never could
export const resourceStatus = z.enum(['active', 'disabled'])
export type ResourceStatus = z.infer<typeof resourceStatus>

export const permissionDto = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  groupKey: z.string().nullable(),
  plugin: z.string(),
  scope: z.enum(['tenant', 'org']),
  grantToUserType: z.boolean(),
  grantToRole: z.boolean(),
})

export const roleDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(['tenant', 'org']),
  isSystem: z.boolean(),
  assignable: z.boolean(),
  status: resourceStatus,
  assignmentCount: z.number().int(),
  permissions: z.array(z.string()),
  allowedUserTypeIds: z.array(z.string()),
  allowedOrgTypeIds: z.array(z.string()),
})

export const roleAssignmentDto = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  roleId: z.string(),
  roleCode: z.string(),
  roleName: z.string(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  scope: z.enum(['self', 'subtree']),
  // whether this caller may change this particular grant; the page hides
  // controls it could only ever be refused for
  manageable: z.boolean(),
})

export type PermissionDto = z.infer<typeof permissionDto>
export type RoleDto = z.infer<typeof roleDto>
export type RoleAssignmentDto = z.infer<typeof roleAssignmentDto>

const grantInput = z.object({
  roleId: z.uuid(),
  orgNodeId: z.uuid(),
  scope: z.enum(['self', 'subtree']),
})

// a patch that changes nothing is a mistake, not a no-op that bumps a
// timestamp; the shape says so instead of the handler discovering it
const changed = <Shape extends z.ZodRawShape>(shape: Shape, keys: readonly (keyof Shape)[]) =>
  z.object(shape).refine(
    (value) => keys.some((key) => (value as Record<string, unknown>)[key as string] !== undefined),
    { message: 'at least one field must be present' },
  )

export const accessContract = {
  listPermissions: get('/iam/permissions')
    .input(
      z.object({
        scope: z.enum(['tenant', 'org']).optional(),
        grantChannel: z.enum(['user-type', 'role']).optional(),
      }),
    )
    .output(z.object({ permissions: z.array(permissionDto) })),

  // the user types and node types a role's eligibility may name. Its own
  // endpoint because a role administrator does not necessarily hold
  // auth.user-type.read or org.tree.read, and an empty picker is a worse
  // answer than a scoped one
  getRoleOptions: get('/iam/role-options').output(
    z.object({
      userTypes: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
      orgTypes: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
    }),
  ),

  listRoles: get('/iam/roles').output(
    z.object({
      roles: z.array(roleDto),
      capabilities: z.object({ canManage: z.boolean() }),
    }),
  ),
  createOrgRole: post('/iam/roles')
    .input(
      z.object({
        code,
        name: roleName,
        description: description.optional(),
        // a role is created complete: an org role with no permissions and no
        // eligibility is enabled, assignable and unable to do anything
        permissionCodes: z.array(z.string()).max(200).optional(),
        allowedUserTypeIds: z.array(z.uuid()).max(50).optional(),
        allowedOrgTypeIds: z.array(z.uuid()).max(50).optional(),
      }),
    )
    .errors(e.pick('ROLE_CONFLICT', 'ROLE_PERMISSION_NOT_GRANTABLE', 'ROLE_USER_TYPE_NOT_FOUND', 'ROLE_ORG_TYPE_NOT_FOUND'))
    .output(z.object({ id: z.string() })),
  getRole: get('/iam/roles/{roleId}')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND'))
    .output(z.object({ role: roleDto })),
  updateRole: patch('/iam/roles/{roleId}')
    .input(
      changed(
        {
          roleId: z.uuid(),
          name: roleName.optional(),
          description: description.nullable().optional(),
          assignable: z.boolean().optional(),
        },
        ['name', 'description', 'assignable'],
      ),
    )
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_CONFLICT', 'ROLE_IS_SYSTEM'))
    .output(okOutput),
  setRoleStatus: put('/iam/roles/{roleId}/status')
    .input(z.object({ roleId: z.uuid(), status: resourceStatus }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM'))
    .output(okOutput),
  syncRolePermissions: put('/iam/roles/{roleId}/permissions')
    .input(z.object({ roleId: z.uuid(), codes: z.array(z.string()).max(200) }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM', 'ROLE_PERMISSION_NOT_GRANTABLE'))
    .output(okOutput),
  // which user types may hold the role, and at which org node types it may
  // be anchored — "allowed" said neither
  syncRoleEligibility: put('/iam/roles/{roleId}/eligibility')
    .input(
      z.object({
        roleId: z.uuid(),
        userTypeIds: z.array(z.uuid()).max(50).optional(),
        orgTypeIds: z.array(z.uuid()).max(50).optional(),
      }),
    )
    .errors(
      e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_NEEDS_ELIGIBILITY',
        'ROLE_USER_TYPE_NOT_FOUND',
        'ROLE_ORG_TYPE_NOT_FOUND',
        'ASSIGNMENT_STRANDED',
      ),
    )
    .output(okOutput),
  deleteRole: del('/iam/roles/{roleId}')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM', 'ROLE_IN_USE'))
    .output(okOutput),

  listRoleAssignments: get('/iam/role-assignments')
    .input(z.object({ orgNodeId: z.uuid().optional(), ...pageInput }))
    .output(pageOutput(roleAssignmentDto)),
  getUserRoleAssignments: get('/iam/users/{userId}/role-assignments')
    .input(z.object({ userId: z.uuid() }))
    .output(z.object({ assignments: z.array(roleAssignmentDto) })),
  // the whole set, replaced: partial grant apis need their own copy of every
  // eligibility and lockout rule, and copies drift
  syncUserRoleAssignments: put('/iam/users/{userId}/role-assignments')
    .input(z.object({ userId: z.uuid(), assignments: z.array(grantInput).max(50) }))
    .errors({
      ...e.pick(
        'ROLE_NOT_FOUND',
        'ASSIGNMENT_USER_NOT_FOUND',
        'ASSIGNMENT_NODE_NOT_FOUND',
        'ASSIGNMENT_NOT_ELIGIBLE',
        'TENANT_ADMIN_REQUIRED',
      ),
      // raised by the shared invariant, which auth can trip too
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
}
