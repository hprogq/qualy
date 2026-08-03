import { z } from 'zod'
import { del, get, okOutput, patch, post, put } from '@qualy/api-contract'
import { adminErrors as e } from './administration.ts'

const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case').max(63)

export const roleDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  isSystem: z.boolean(),
  assignable: z.boolean(),
  enabled: z.boolean(),
  assignmentCount: z.number().int(),
  permissions: z.array(z.string()),
  allowedUserTypeIds: z.array(z.string()),
  allowedOrgTypeIds: z.array(z.string()),
})

export const assignmentDto = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  roleId: z.string(),
  roleCode: z.string(),
  roleName: z.string(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  scope: z.enum(['self', 'subtree']),
})

export type RoleDto = z.infer<typeof roleDto>
export type AssignmentDto = z.infer<typeof assignmentDto>

const assignmentInput = z.object({
  roleId: z.uuid(),
  orgNodeId: z.uuid(),
  scope: z.enum(['self', 'subtree']),
})

export const rbacAdminContract = {
  listRoles: get('/rbac/roles').output(z.object({ roles: z.array(roleDto) })),
  createOrgRole: post('/rbac/roles')
    .input(
      z.object({
        code,
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).optional(),
      }),
    )
    .errors(e.pick('ROLE_CONFLICT'))
    .output(z.object({ id: z.string() })),
  updateRole: patch('/rbac/roles/{roleId}')
    .input(
      z.object({
        roleId: z.uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).nullable().optional(),
        assignable: z.boolean().optional(),
      }),
    )
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_CONFLICT', 'ROLE_IS_SYSTEM'))
    .output(okOutput),
  setRoleEnabled: put('/rbac/roles/{roleId}/enabled')
    .input(z.object({ roleId: z.uuid(), enabled: z.boolean() }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM'))
    .output(okOutput),
  syncRolePermissions: put('/rbac/roles/{roleId}/permissions')
    .input(z.object({ roleId: z.uuid(), codes: z.array(z.string()).max(200) }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM', 'ROLE_PERMISSION_NOT_GRANTABLE'))
    .output(okOutput),
  syncRoleAllowedSets: put('/rbac/roles/{roleId}/allowed')
    .input(
      z.object({
        roleId: z.uuid(),
        userTypeIds: z.array(z.uuid()).optional(),
        orgTypeIds: z.array(z.uuid()).optional(),
      }),
    )
    .errors(
      e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_NEEDS_ALLOWED_SETS',
        'ROLE_USER_TYPE_NOT_FOUND',
        'ROLE_ORG_TYPE_NOT_FOUND',
        'ASSIGNMENT_NOT_ELIGIBLE',
      ),
    )
    .output(okOutput),
  deleteRole: del('/rbac/roles/{roleId}')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_IS_SYSTEM', 'ROLE_IN_USE'))
    .output(okOutput),

  listAssignments: get('/rbac/assignments')
    .input(z.object({ userId: z.uuid().optional(), orgNodeId: z.uuid().optional() }))
    .output(z.object({ assignments: z.array(assignmentDto) })),
  syncUserAssignments: put('/rbac/assignments/{userId}')
    .input(z.object({ userId: z.uuid(), assignments: z.array(assignmentInput).max(50) }))
    .errors(
      e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ASSIGNMENT_NOT_FOUND',
        'ASSIGNMENT_NOT_ELIGIBLE',
        'TENANT_ADMIN_REQUIRED',
      ),
    )
    .output(okOutput),
}
