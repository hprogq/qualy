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

// Where a kind of person may stand, stated rather than inferred. The list
// used to carry the whole meaning, with "empty" reading as "anywhere", so
// unchecking the last entry widened the rule instead of narrowing it and
// skipped the check for people already standing somewhere it no longer
// allowed. An allow-list must name at least one type; meaning "anywhere" is
// a different answer and says so.
export const placementPolicy = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('unrestricted') }),
  z.object({ mode: z.literal('allow-list'), orgTypeIds: z.array(z.uuid()).min(1).max(50) }),
])
export type PlacementPolicyInput = z.infer<typeof placementPolicy>

export const userTypeDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  allowLocalLogin: z.boolean(),
  allowSsoLogin: z.boolean(),
  status: resourceStatus,
  // a system type is provisioned by the platform and never handed out
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  userCount: z.number().int(),
  // Where this kind of person may stand. A user type confers no authority
  // (that is what roles are for), so this is the whole of what it decides.
  placementPolicy,
})

export const userDto = z.object({
  id: z.string(),
  businessNo: z.string().nullable(),
  displayName: z.string(),
  status: resourceStatus,
  userType: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  primaryOrgNode: z.object({ id: z.string(), name: z.string() }),
  // how many sign-in identities exist, not which. One identity out of
  // possibly several, with no provider context, told a reader nothing and
  // exposed a login name to anyone holding org-scope read.
  identityCount: z.number().int(),
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
        // required: a type created without one constrains nothing, and
        // "not configured yet" is indistinguishable from "deliberately open"
        placementPolicy,
      }),
    )
    .errors(e.pick('USER_TYPE_CONFLICT', 'USER_TYPE_ORG_TYPE_NOT_FOUND'))
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
      ...e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_CONFLICT', 'RECOVERY_CHANNEL_REQUIRED'),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
  // where this kind of person may stand, replaced whole
  getPlacementPolicy: get('/iam/user-types/{userTypeId}/placement-policy')
    .input(z.object({ userTypeId: z.uuid() }))
    .errors(e.pick('USER_TYPE_NOT_FOUND'))
    .output(z.object({ policy: placementPolicy, version: z.number().int() })),
  setPlacementPolicy: put('/iam/user-types/{userTypeId}/placement-policy')
    .input(
      z.object({
        userTypeId: z.uuid(),
        policy: placementPolicy,
        expectedVersion: z.number().int().min(1),
      }),
    )
    .errors(
      e.pick(
        'USER_TYPE_NOT_FOUND',
        'USER_TYPE_IS_SYSTEM',
        'USER_TYPE_ORG_TYPE_NOT_FOUND',
        'USER_TYPE_PLACEMENT_IN_USE',
        'USER_TYPE_VERSION_CONFLICT',
      ),
    )
    .output(z.object({ version: z.number().int() })),
  // The org types a user type screen needs to state its placement policy,
  // behind that screen's own permission. Borrowing the role screen's options
  // endpoint meant a user type administrator had to also hold role read, and
  // a legitimate one would have seen an empty picker instead.
  getUserTypeOptions: get('/iam/user-type-options').output(
    z.object({
      orgTypes: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
    }),
  ),
  setUserTypeStatus: put('/iam/user-types/{userTypeId}/status')
    .input(z.object({ userTypeId: z.uuid(), status: resourceStatus }))
    .errors(e.pick('USER_TYPE_NOT_FOUND', 'USER_TYPE_IN_USE'))
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

  // The nodes this caller may administer users at, and the types they may
  // hand out; one call, so the screen needs no permission but its own. The
  // nodes are the ones inside the caller's coverage rather than the anchors
  // their grants sit on — a subtree grant at a college means every
  // department under it is a place a user may stand.
  getUserOptions: get('/iam/user-options')
    .input(
      z.object({
        search: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .output(
      z.object({
        // says when the tree was cut short instead of presenting a partial
        // list as the whole of it
        truncated: z.boolean(),
        nodes: z.array(
          z.object({
            orgNodeId: z.string(),
            name: z.string(),
            depth: z.number().int(),
            orgTypeId: z.string(),
            manageable: z.boolean(),
          }),
        ),
        // each type carries the org types it admits, so the screen can pair a
        // person with a place without a second round trip
        userTypes: z.array(
          z.object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            placementPolicy,
          }),
        ),
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
        'USER_TYPE_PLACEMENT_NOT_ALLOWED',
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
        'USER_TYPE_PLACEMENT_NOT_ALLOWED',
        'USER_CONFLICT',
        'ASSIGNMENT_INCOMPATIBLE',
      ),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
  // a transfer, not a field edit: it changes who administers this person
  setUserPlacement: put('/iam/users/{userId}/placement')
    .input(z.object({ userId: z.uuid(), primaryOrgNodeId: z.uuid() }))
    .errors(
      e.pick('USER_NOT_FOUND', 'USER_PLACEMENT_NOT_FOUND', 'USER_TYPE_PLACEMENT_NOT_ALLOWED'),
    )
    .output(okOutput),
  setUserStatus: put('/iam/users/{userId}/status')
    .input(z.object({ userId: z.uuid(), status: resourceStatus }))
    .errors({
      ...e.pick('USER_NOT_FOUND'),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),
}
