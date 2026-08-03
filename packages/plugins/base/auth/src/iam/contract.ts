import { z } from 'zod'
import { del, get, okOutput, patch, post, put } from '@qualy/api-contract'
import { iamErrors as e } from './errors.ts'

const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case').max(63)
const name = z.string().trim().min(1).max(100)

export const userTypeDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  allowLocalLogin: z.boolean(),
  allowSsoLogin: z.boolean(),
  enabled: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  userCount: z.number().int(),
  permissions: z.array(z.string()),
})

export const userDto = z.object({
  id: z.string(),
  businessNo: z.string().nullable(),
  displayName: z.string(),
  enabled: z.boolean(),
  userType: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  primaryOrgNode: z.object({ id: z.string(), name: z.string() }),
  identifier: z.string().nullable(),
})

export type UserTypeDto = z.infer<typeof userTypeDto>
export type IamUserDto = z.infer<typeof userDto>

export const iamContract = {
  listUserTypes: get('/iam/user-types').output(z.object({ userTypes: z.array(userTypeDto) })),
  createUserType: post('/iam/user-types')
    .input(
      z.object({
        code,
        name,
        description: z.string().max(500).optional(),
        allowLocalLogin: z.boolean().optional(),
        allowSsoLogin: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(32767).optional(),
      }),
    )
    .errors(e.pick('USER_TYPE_CONFLICT'))
    .output(z.object({ id: z.string() })),
  updateUserType: patch('/iam/user-types/{userTypeId}')
    .input(
      z.object({
        userTypeId: z.uuid(),
        name: name.optional(),
        description: z.string().max(500).nullable().optional(),
        allowLocalLogin: z.boolean().optional(),
        allowSsoLogin: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(32767).optional(),
      }),
    )
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_CONFLICT'))
    .output(okOutput),
  setUserTypeEnabled: put('/iam/user-types/{userTypeId}/enabled')
    .input(z.object({ userTypeId: z.uuid(), enabled: z.boolean() }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'LAST_ADMINISTRATOR'))
    .output(okOutput),
  syncUserTypePermissions: put('/iam/user-types/{userTypeId}/permissions')
    .input(z.object({ userTypeId: z.uuid(), codes: z.array(z.string()).max(200) }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'PERMISSION_NOT_GRANTABLE'))
    .output(okOutput),
  deleteUserType: del('/iam/user-types/{userTypeId}')
    .input(z.object({ userTypeId: z.uuid() }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_IS_SYSTEM', 'USER_TYPE_IN_USE'))
    .output(okOutput),

  listUsers: get('/iam/users')
    .input(
      z.object({
        orgNodeId: z.uuid(),
        subtree: z.boolean().optional(),
        search: z.string().max(100).optional(),
      }),
    )
    .output(z.object({ users: z.array(userDto) })),
  createUser: post('/iam/users')
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(100),
        userTypeId: z.uuid(),
        primaryOrgNodeId: z.uuid(),
        businessNo: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .errors(
      e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_DISABLED', 'USER_PLACEMENT_NOT_FOUND', 'USER_CONFLICT'),
    )
    .output(z.object({ id: z.string() })),
  updateUser: patch('/iam/users/{userId}')
    .input(
      z.object({
        userId: z.uuid(),
        displayName: z.string().trim().min(1).max(100).optional(),
        userTypeId: z.uuid().optional(),
        // a business number is never cleared through an ordinary update
        businessNo: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .errors(
      e.pick(
        'USER_NOT_FOUND',
        'USER_TYPE_NOT_FOUND',
        'USER_TYPE_DISABLED',
        'USER_CONFLICT',
        'ASSIGNMENT_INCOMPATIBLE',
      ),
    )
    .output(okOutput),
  setUserEnabled: put('/iam/users/{userId}/enabled')
    .input(z.object({ userId: z.uuid(), enabled: z.boolean() }))
    .errors(e.pick('USER_NOT_FOUND', 'LAST_ADMINISTRATOR'))
    .output(okOutput),
}
