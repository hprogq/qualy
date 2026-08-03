import { z } from 'zod'
import { del, get, okOutput, pageInput, pageOutput, patch, post, put } from '@qualy/api-contract'
import { accessInvariantErrors } from '@qualy/rbac-contract'
import { accessErrors as e } from './errors.ts'

// Roles, the capability catalog, and the grants that connect them to people.
// The paths live under /iam because that is the product domain a tenant
// administers; rbac is how it happens to be implemented, and an
// implementation choice does not belong in a url.

const code = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case').max(63)
const roleName = z.string().trim().min(1).max(100)
const description = z.string().max(500)
// required on every set replacement: an optional concurrency token is one a
// client simply omits, which is last-write-wins with extra steps
const expectedVersion = z.number().int().min(1)
const versionOutput = z.object({ version: z.number().int() })

export const permissionTarget = z.enum(['tenant', 'org-node'])
export const roleKind = z.enum(['tenant', 'org'])
export const roleStatus = z.enum(['draft', 'active', 'disabled'])
export const coverage = z.enum(['self', 'subtree'])

// what the capability protects, and therefore how it is checked. Read-only:
// it is the calling convention of the code that declares it, and an
// administrator changing it would only break the check, never redirect it.
export const permissionDto = z.object({
  code: z.string(),
  plugin: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  groupKey: z.string().nullable(),
  target: permissionTarget,
})

export const roleDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: roleKind,
  status: roleStatus,
  // 'all-active' is the canonical administrator: it holds every capability
  // that currently exists, which is why no plugin declares a default-admin
  // flag and why nothing may edit its permissions
  holdsEveryPermission: z.boolean(),
  systemKey: z.string().nullable(),
  assignable: z.boolean(),
  version: z.number().int(),
  grantCount: z.number().int(),
  // configured is what the role names; active is what the registry currently
  // serves. A code left behind by an unloaded plugin is still configured and
  // authorizes nothing, and presenting it as effective would say the role
  // grants something it does not.
  permissions: z.array(z.string()),
  unavailablePermissions: z.array(z.string()),
  // Two different questions, and calling both of them "allowed" is what
  // made them look like duplicates of the user type's own placement rule.
  // Who may hold this duty:
  eligibleUserTypeIds: z.array(z.string()),
  // and where the duty applies, which is about the grant's anchor and has
  // nothing to do with where the holder personally belongs. A tenant role
  // anchors to nothing, so it leaves this empty.
  anchorOrgTypeIds: z.array(z.string()),
})

// a tenant role reaches the whole tenant and carries no node; an org role is
// anchored and carries both
export const grantTargetDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tenant') }),
  z.object({
    kind: z.literal('org-node'),
    orgNodeId: z.string(),
    orgNodeName: z.string(),
    coverage,
  }),
])

export const grantInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tenant') }),
  z.object({ kind: z.literal('org-node'), orgNodeId: z.uuid(), coverage }),
])

export const roleGrantDto = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  roleId: z.string(),
  roleCode: z.string(),
  roleName: z.string(),
  roleKind,
  target: grantTargetDto,
  // whether this caller may revoke this particular grant
  manageable: z.boolean(),
})

// why someone holds a capability. Naming roles and grants is more than an
// ordinary administrator needs, so the endpoint that returns it has its own
// permission.
export const permissionSourceDto = z.object({
  roleId: z.string(),
  roleCode: z.string(),
  grantId: z.string(),
  target: grantTargetDto,
})

export type PermissionDto = z.infer<typeof permissionDto>
export type RoleDto = z.infer<typeof roleDto>
export type RoleGrantDto = z.infer<typeof roleGrantDto>
export type PermissionSourceDto = z.infer<typeof permissionSourceDto>

const changed = <Shape extends z.ZodRawShape>(shape: Shape, keys: readonly (keyof Shape)[]) =>
  z.object(shape).refine(
    (value) => keys.some((key) => (value as Record<string, unknown>)[key as string] !== undefined),
    { message: 'at least one field must be present' },
  )

export const accessContract = {
  // --- capability catalog (read only: plugins own it) ---
  listPermissions: get('/iam/permissions')
    .input(
      z.object({
        target: permissionTarget.optional(),
        plugin: z.string().max(127).optional(),
        search: z.string().max(100).optional(),
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

  // --- roles ---
  listRoles: get('/iam/roles')
    .input(z.object({ kind: roleKind.optional(), status: roleStatus.optional() }))
    .output(
      z.object({
        roles: z.array(roleDto),
        capabilities: z.object({ canManage: z.boolean(), canEscalate: z.boolean() }),
      }),
    ),
  // creates a draft. A role becomes usable through activation, which is
  // where completeness is checked — demanding every decision here instead
  // would make a partly-decided role impossible to save.
  createRole: post('/iam/roles')
    .input(
      z.object({ code, name: roleName, description: description.optional(), kind: roleKind }),
    )
    .errors(e.pick('ROLE_CONFLICT'))
    .output(z.object({ id: z.string(), status: roleStatus, version: z.number().int() })),
  getRole: get('/iam/roles/{roleId}')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND'))
    .output(z.object({ role: roleDto })),
  updateRole: patch('/iam/roles/{roleId}')
    .input(
      changed(
        {
          roleId: z.uuid(),
          expectedVersion,
          name: roleName.optional(),
          description: description.nullable().optional(),
          assignable: z.boolean().optional(),
        },
        ['name', 'description', 'assignable'],
      ),
    )
    .errors(e.pick('ROLE_NOT_FOUND', 'ROLE_CONFLICT', 'ROLE_IS_SYSTEM', 'ROLE_VERSION_CONFLICT'))
    .output(versionOutput),
  setRoleStatus: put('/iam/roles/{roleId}/status')
    .input(
      z.object({
        roleId: z.uuid(),
        status: z.enum(['active', 'disabled']),
        expectedVersion,
      }),
    )
    .errors({
      ...e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_NOT_DRAFT',
        'ROLE_INCOMPLETE',
        'ROLE_ESCALATION_REFUSED',
        'ROLE_VERSION_CONFLICT',
      ),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(versionOutput),
  getRolePermissions: get('/iam/roles/{roleId}/permissions')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND'))
    .output(z.object({ codes: z.array(z.string()), version: z.number().int() })),
  syncRolePermissions: put('/iam/roles/{roleId}/permissions')
    .input(
      z.object({
        roleId: z.uuid(),
        codes: z.array(z.string()).max(500),
        expectedVersion,
      }),
    )
    .errors({
      ...e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_INCOMPLETE',
        'ROLE_TARGET_MISMATCH',
        'ROLE_ESCALATION_REFUSED',
        'ROLE_VERSION_CONFLICT',
        'PERMISSION_NOT_FOUND',
      ),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(versionOutput),
  getRoleEligibility: get('/iam/roles/{roleId}/eligibility')
    .input(z.object({ roleId: z.uuid() }))
    .errors(e.pick('ROLE_NOT_FOUND'))
    .output(
      z.object({
        userTypeIds: z.array(z.string()),
        orgTypeIds: z.array(z.string()),
        version: z.number().int(),
      }),
    ),
  // which user types may hold the role, and at which org node types it may
  // be anchored — "allowed" said neither
  syncRoleEligibility: put('/iam/roles/{roleId}/eligibility')
    .input(
      z.object({
        roleId: z.uuid(),
        // a full replacement names both sets: omitting one and having it
        // silently survive is how a "replace" quietly becomes a "merge"
        userTypeIds: z.array(z.uuid()).max(50),
        orgTypeIds: z.array(z.uuid()).max(50),
        expectedVersion,
      }),
    )
    .errors(
      e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_NEEDS_ELIGIBILITY',
        'ROLE_USER_TYPE_NOT_FOUND',
        'ROLE_ORG_TYPE_NOT_FOUND',
        'ROLE_VERSION_CONFLICT',
        'GRANT_STRANDED',
      ),
    )
    .output(versionOutput),
  deleteRole: del('/iam/roles/{roleId}')
    .input(z.object({ roleId: z.uuid(), expectedVersion }))
    .errors(
      e.pick(
        'ROLE_NOT_FOUND',
        'ROLE_IS_SYSTEM',
        'ROLE_IN_USE',
        'ROLE_VERSION_CONFLICT',
      ),
    )
    .output(okOutput),

  // --- grants ---
  // Which roles this caller may actually grant to this person at this place.
  // Every rule is re-checked on write; this exists so a screen does not have
  // to reimplement eligibility and then disagree with the server about it.
  getRoleGrantOptions: get('/iam/role-grant-options')
    .input(
      z.object({
        userId: z.uuid(),
        orgNodeId: z.uuid().optional(),
        coverage: coverage.optional(),
      }),
    )
    .errors(e.pick('GRANT_USER_NOT_FOUND', 'GRANT_NODE_NOT_FOUND'))
    .output(
      z.object({
        roles: z.array(
          z.object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            kind: roleKind,
          }),
        ),
      }),
    ),
  listRoleGrants: get('/iam/role-grants')
    .input(z.object({ orgNodeId: z.uuid().optional(), ...pageInput }))
    .output(pageOutput(roleGrantDto)),
  getUserRoleGrants: get('/iam/users/{userId}/role-grants')
    .input(z.object({ userId: z.uuid() }))
    .output(z.object({ grants: z.array(roleGrantDto) })),
  // One grant at a time. Replacing a whole set looked tidier until the set a
  // caller could see was smaller than the set that existed: "replace with
  // what I see" then silently proposed deleting what they could not.
  createRoleGrant: post('/iam/role-grants')
    .input(z.object({ userId: z.uuid(), roleId: z.uuid(), target: grantInput }))
    .errors({
      ...e.pick(
        'ROLE_NOT_FOUND',
        'GRANT_EXISTS',
        'GRANT_USER_NOT_FOUND',
        'GRANT_NODE_NOT_FOUND',
        'GRANT_NOT_ELIGIBLE',
        'GRANT_ESCALATION_REFUSED',
        'TENANT_ADMIN_REQUIRED',
      ),
    })
    .output(z.object({ id: z.string() })),
  deleteRoleGrant: del('/iam/role-grants/{grantId}')
    .input(z.object({ grantId: z.uuid() }))
    .errors({
      ...e.pick('GRANT_NOT_FOUND', 'TENANT_ADMIN_REQUIRED'),
      ...accessInvariantErrors.pick('LAST_ADMINISTRATOR'),
    })
    .output(okOutput),

  // --- diagnostics ---
  // why someone holds what they hold. Answering "allowed?" is easy; the
  // reason is what makes a wrong answer fixable, and what an audit needs.
  getUserEffectivePermissions: get('/iam/users/{userId}/effective-permissions')
    .input(z.object({ userId: z.uuid(), orgNodeId: z.uuid().optional() }))
    .errors(e.pick('GRANT_USER_NOT_FOUND'))
    .output(
      z.object({
        permissions: z.array(
          z.object({
            code: z.string(),
            name: z.string(),
            target: permissionTarget,
            sources: z.array(permissionSourceDto),
          }),
        ),
      }),
    ),
  evaluateAccess: post('/iam/access-evaluations')
    .input(
      z.object({ userId: z.uuid(), permissionCode: z.string().max(127), orgNodeId: z.uuid().optional() }),
    )
    .errors(e.pick('GRANT_USER_NOT_FOUND', 'PERMISSION_NOT_FOUND', 'ACCESS_TARGET_REQUIRED'))
    .output(
      z.object({
        allowed: z.boolean(),
        target: permissionTarget,
        sources: z.array(permissionSourceDto),
      }),
    ),
}
