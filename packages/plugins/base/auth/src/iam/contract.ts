import { z } from 'zod'
import { del, get, okOutput, pageInput, pageOutput, patch, post, put } from '@qualy/api-contract'
import { accessInvariantErrors } from '@qualy/rbac-contract'
import { iamErrors as e } from './errors.ts'

// Users and the types they belong to. `status` rather than `enabled` because
// a url that names the concept can grow a third state; a boolean endpoint
// would need a second one.

const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case').max(63)
const displayName = z.string().trim().min(1).max(100)
const description = z.string().max(500)

export const resourceStatus = z.enum(['active', 'disabled'])

export const userTypeDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  allowLocalLogin: z.boolean(),
  allowSsoLogin: z.boolean(),
  status: resourceStatus,
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  userCount: z.number().int(),
  permissions: z.array(z.string()),
})

export const userDto = z.object({
  id: z.string(),
  businessNo: z.string().nullable(),
  displayName: z.string(),
  status: resourceStatus,
  userType: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  primaryOrgNode: z.object({ id: z.string(), name: z.string() }),
  identifier: z.string().nullable(),
  // whether this caller may change this particular user; a read-only
  // administrator gets a screen without buttons rather than buttons that
  // answer 403
  manageable: z.boolean(),
})

export type UserTypeDto = z.infer<typeof userTypeDto>
export type IamUserDto = z.infer<typeof userDto>

// a patch that changes nothing is a mistake, not a no-op that bumps a
// timestamp; the shape says so instead of the handler discovering it
const changed = <Shape extends z.ZodRawShape>(shape: Shape, keys: readonly (keyof Shape)[]) =>
  z.object(shape).refine(
    (value) => keys.some((key) => (value as Record<string, unknown>)[key as string] !== undefined),
    { message: 'at least one field must be present' },
  )

export const identityContract = {
  listUserTypes: get('/iam/user-types').output(
    z.object({
      userTypes: z.array(userTypeDto),
      capabilities: z.object({ canManage: z.boolean() }),
    }),
  ),
  createUserType: post('/iam/user-types')
    .input(
      z.object({
        code,
        name: displayName,
        description: description.optional(),
        allowLocalLogin: z.boolean().optional(),
        allowSsoLogin: z.boolean().optional(),
        sortOrder: z.number().int().min(0).max(32767).optional(),
        // created complete: a type that opens no channel and holds no
        // permission is enabled and useless
        permissionCodes: z.array(z.string()).max(200).optional(),
      }),
    )
    .errors(e.pick('USER_TYPE_CONFLICT', 'PERMISSION_NOT_GRANTABLE'))
    .output(z.object({ id: z.string() })),
  getUserType: get('/iam/user-types/{userTypeId}')
    .input(z.object({ userTypeId: z.uuid() }))
    .errors(e.pick('USER_TYPE_NOT_FOUND'))
    .output(z.object({ userType: userTypeDto })),
  updateUserType: patch('/iam/user-types/{userTypeId}')
    .input(
      changed(
        {
          userTypeId: z.uuid(),
          name: displayName.optional(),
          description: description.nullable().optional(),
          allowLocalLogin: z.boolean().optional(),
          allowSsoLogin: z.boolean().optional(),
          sortOrder: z.number().int().min(0).max(32767).optional(),
        },
        ['name', 'description', 'allowLocalLogin', 'allowSsoLogin', 'sortOrder'],
      ),
    )
    .errors({
      ...e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_CONFLICT'),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
  setUserTypeStatus: put('/iam/user-types/{userTypeId}/status')
    .input(z.object({ userTypeId: z.uuid(), status: resourceStatus }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_IN_USE'))
    .output(okOutput),
  syncUserTypePermissions: put('/iam/user-types/{userTypeId}/permissions')
    .input(z.object({ userTypeId: z.uuid(), codes: z.array(z.string()).max(200) }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'PERMISSION_NOT_GRANTABLE'))
    .output(okOutput),
  deleteUserType: del('/iam/user-types/{userTypeId}')
    .input(z.object({ userTypeId: z.uuid() }))
    .errors(
      e.pick(
        'USER_TYPE_NOT_FOUND',
        'USER_TYPE_IS_SYSTEM',
        'USER_TYPE_IN_USE',
        'USER_TYPE_LAST_FOR_ROLE',
      ),
    )
    .output(okOutput),

  // the anchors this caller may administer users at, and the types they may
  // hand out; one call, so the screen needs no permission but its own
  getUserOptions: get('/iam/user-options').output(
    z.object({
      anchors: z.array(
        z.object({
          orgNodeId: z.string(),
          name: z.string(),
          scope: z.enum(['self', 'subtree']),
          manageable: z.boolean(),
        }),
      ),
      userTypes: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
    }),
  ),

  listUsers: get('/iam/users')
    .input(
      z.object({
        orgNodeId: z.uuid(),
        // an enum says what it means; `subtree=false` never did
        scope: z.enum(['self', 'subtree']).optional(),
        search: z.string().max(100).optional(),
        ...pageInput,
      }),
    )
    .output(pageOutput(userDto)),
  createUser: post('/iam/users')
    .input(
      z.object({
        displayName,
        userTypeId: z.uuid(),
        primaryOrgNodeId: z.uuid(),
        businessNo: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .errors(
      e.pick(
        'USER_TYPE_NOT_FOUND',
        'USER_TYPE_DISABLED',
        'USER_PLACEMENT_NOT_FOUND',
        'USER_CONFLICT',
      ),
    )
    .output(z.object({ id: z.string() })),
  getUser: get('/iam/users/{userId}')
    .input(z.object({ userId: z.uuid() }))
    .errors(e.pick('USER_NOT_FOUND'))
    .output(z.object({ user: userDto })),
  updateUser: patch('/iam/users/{userId}')
    .input(
      changed(
        {
          userId: z.uuid(),
          displayName: displayName.optional(),
          userTypeId: z.uuid().optional(),
          // a business number is never cleared through an ordinary update
          businessNo: z.string().trim().min(1).max(64).optional(),
        },
        ['displayName', 'userTypeId', 'businessNo'],
      ),
    )
    .errors({
      ...e.pick(
        'USER_NOT_FOUND',
        'USER_TYPE_NOT_FOUND',
        'USER_TYPE_DISABLED',
        'USER_CONFLICT',
        'ASSIGNMENT_INCOMPATIBLE',
      ),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
  // a transfer, not a field edit: it changes who administers this person
  setUserPlacement: put('/iam/users/{userId}/placement')
    .input(z.object({ userId: z.uuid(), primaryOrgNodeId: z.uuid() }))
    .errors(e.pick('USER_NOT_FOUND', 'USER_PLACEMENT_NOT_FOUND'))
    .output(okOutput),
  setUserStatus: put('/iam/users/{userId}/status')
    .input(z.object({ userId: z.uuid(), status: resourceStatus }))
    .errors({
      ...e.pick('USER_NOT_FOUND'),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
}
