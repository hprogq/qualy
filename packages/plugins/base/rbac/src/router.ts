import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { DEFAULT_PAGE_SIZE, decodeQueryCursor, encodeQueryCursor } from '@qualy/api-contract'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { AuthorizationScope, Principal } from '@qualy/rbac-contract'
import { accessContract, type RoleDto, type RoleGrantDto } from './contract.ts'
import type { Administration, GrantRow, RoleRow } from './administration.ts'
import type { Authorization } from './authorization.ts'
import { accessErrors } from './errors.ts'
import { ESCALATE } from './escalation.ts'
import type { PermissionRegistry } from './permission-registry.ts'

// Roles and the capability catalog are tenant-scope administration. Grants
// are decided per anchor and filtered inside the query, so a manager sees
// exactly the grants they administer. Authorization for grant writes happens
// inside the service transaction, on the locked connection.

const toRoleDto = (
  row: RoleRow,
  permissions: { active: string[]; unavailable: string[] },
): RoleDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  kind: row.kind,
  status: row.status,
  holdsEveryPermission: row.permission_mode === 'all-active',
  systemKey: row.system_key,
  assignable: row.assignable,
  version: row.version,
  grantCount: row.grant_count,
  permissions: permissions.active,
  unavailablePermissions: permissions.unavailable,
  eligibleUserTypeIds: row.allowed_user_types,
  anchorOrgTypeIds: row.allowed_org_types,
})

const toGrantDto = (row: GrantRow): RoleGrantDto => ({
  id: row.id,
  userId: row.user_id,
  userDisplayName: row.user_display_name,
  roleId: row.role_id,
  roleCode: row.role_code,
  roleName: row.role_name,
  roleKind: row.role_kind,
  target:
    row.org_node_id === null
      ? { kind: 'tenant' }
      : {
          kind: 'org-node',
          orgNodeId: row.org_node_id,
          orgNodeName: row.org_node_name ?? '',
          coverage: row.coverage ?? 'self',
        },
  manageable: row.manageable,
})

export function createAccessRouter(
  ctx: Context,
  admin: Administration,
  authorization: Authorization,
  registry: PermissionRegistry,
) {
  const impl = implement(accessContract)
    .$context<ApiContext>()
    .use(apiErrorBoundary)
    .use(requireAuth)
  const requireTenant = (principal: Principal, code: string) => ctx.rbac.require(principal, code)
  const holds = async (principal: Principal, code: string) =>
    (await authorization.effectiveCodes(principal, undefined)).has(code)

  // which grants a caller may see and change. A tenant-wide grant has no
  // node, so node coverage cannot decide it: those answer to their own
  // tenant permissions.
  const grantScope = async (
    principal: Principal,
  ): Promise<{
    read: AuthorizationScope
    manage: AuthorizationScope
    tenantGrants: { read: boolean; manage: boolean }
  }> => {
    const held = await authorization.effectiveCodes(principal, undefined)
    return {
      read: await ctx.rbac.listAuthorizedScope(principal, 'iam.grant.read'),
      manage: await ctx.rbac.listAuthorizedScope(principal, 'iam.grant.manage'),
      tenantGrants: {
        read: held.has('iam.tenant-grant.read') || held.has('iam.tenant-grant.manage'),
        manage: held.has('iam.tenant-grant.manage'),
      },
    }
  }

  const roleDto = (row: RoleRow) => toRoleDto(row, admin.permissionsOfRole(row))

  return impl.router({
    // the ACTIVE catalog, not the table: a row left behind by a plugin that
    // is no longer loaded must never be offered as something to grant
    listPermissions: impl.listPermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.read')
      const search = input.search?.trim().toLowerCase()
      const permissions = registry
        .list({ target: input.target, plugin: input.plugin })
        .filter(
          (definition) =>
            !search ||
            definition.code.toLowerCase().includes(search) ||
            definition.name.toLowerCase().includes(search),
        )
        .map((definition) => ({
          code: definition.code,
          plugin: definition.plugin,
          name: definition.name,
          description: definition.description ?? null,
          groupKey: definition.groupKey ?? null,
          target: definition.target,
        }))
      return { permissions }
    }),

    getRoleOptions: impl.getRoleOptions.handler(async ({ context }) => {
      await requireTenant(context.principal, 'iam.role.read')
      return admin.listEligibilityOptions(context.principal.tenantId)
    }),

    listRoles: impl.listRoles.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.read')
      const rows = (await admin.listRoles(context.principal.tenantId))
        .filter((row) => !input.kind || row.kind === input.kind)
        .filter((row) => !input.status || row.status === input.status)
      return {
        roles: rows.map(roleDto),
        // read and manage are separate grants, so a read-only administrator
        // gets a screen without buttons instead of buttons that answer 403
        capabilities: {
          canManage: await ctx.rbac.hasPermission(context.principal, 'iam.role.manage'),
          canEscalate: await holds(context.principal, ESCALATE),
        },
      }
    }),
    createRole: impl.createRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      const id = await admin.createRole(context.principal.tenantId, input)
      return { id, status: 'draft' as const, version: 1 }
    }),
    getRole: impl.getRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.read')
      return { role: roleDto(await admin.getRole(context.principal.tenantId, input.roleId)) }
    }),
    updateRole: impl.updateRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      return {
        version: await admin.updateRole(
          context.principal.tenantId,
          input.roleId,
          input,
          input.expectedVersion,
        ),
      }
    }),
    setRoleStatus: impl.setRoleStatus.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      return {
        version: await admin.setRoleStatus(
          context.principal.tenantId,
          input.roleId,
          input.status,
          input.expectedVersion,
          context.principal,
        ),
      }
    }),
    getRolePermissions: impl.getRolePermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.read')
      const role = await admin.getRole(context.principal.tenantId, input.roleId)
      return { codes: admin.permissionsOfRole(role).active, version: role.version }
    }),
    syncRolePermissions: impl.syncRolePermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      return {
        version: await admin.syncRolePermissions(
          context.principal.tenantId,
          input.roleId,
          input.codes,
          input.expectedVersion,
          context.principal,
        ),
      }
    }),
    getRoleEligibility: impl.getRoleEligibility.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.read')
      const role = await admin.getRole(context.principal.tenantId, input.roleId)
      return {
        userTypeIds: role.allowed_user_types,
        orgTypeIds: role.allowed_org_types,
        version: role.version,
      }
    }),
    syncRoleEligibility: impl.syncRoleEligibility.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      return {
        version: await admin.syncRoleEligibility(
          context.principal.tenantId,
          input.roleId,
          input,
          input.expectedVersion,
        ),
      }
    }),
    deleteRole: impl.deleteRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.role.manage')
      await admin.deleteRole(context.principal.tenantId, input.roleId, input.expectedVersion)
      return { ok: true as const }
    }),


    getRoleGrantOptions: impl.getRoleGrantOptions.handler(async ({ context, input }) => {
      const target =
        input.orgNodeId === undefined
          ? ({ kind: 'tenant' } as const)
          : ({
              kind: 'org-node',
              orgNodeId: input.orgNodeId,
              coverage: input.coverage ?? 'self',
            } as const)
      const roles = await admin.grantOptions(
        context.principal.tenantId,
        { userId: input.userId, target },
        context.principal,
      )
      return { roles }
    }),
    listRoleGrants: impl.listRoleGrants.handler(async ({ context, input }) => {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE
      // the cursor belongs to this filter and no other
      const fingerprint = `grants:${input.orgNodeId ?? ''}`
      const rows = await admin.listGrants(
        context.principal.tenantId,
        { orgNodeId: input.orgNodeId },
        await grantScope(context.principal),
        { after: decodeQueryCursor(input.cursor, fingerprint, 1)?.[0], limit: limit + 1 },
      )
      const items = rows.slice(0, limit)
      const last = items.at(-1)
      return {
        items: items.map(toGrantDto),
        nextCursor:
          rows.length > limit && last ? encodeQueryCursor(fingerprint, [last.id]) : null,
      }
    }),
    getUserRoleGrants: impl.getUserRoleGrants.handler(async ({ context, input }) => {
      const rows = await admin.listGrants(
        context.principal.tenantId,
        { userId: input.userId },
        await grantScope(context.principal),
      )
      return { grants: rows.map(toGrantDto) }
    }),
    createRoleGrant: impl.createRoleGrant.handler(async ({ context, input }) => {
      const id = await admin.grant(
        context.principal.tenantId,
        { userId: input.userId, roleId: input.roleId, target: input.target },
        context.principal,
      )
      return { id }
    }),
    deleteRoleGrant: impl.deleteRoleGrant.handler(async ({ context, input }) => {
      await admin.revoke(context.principal.tenantId, input.grantId, context.principal)
      return { ok: true as const }
    }),

    getUserEffectivePermissions: impl.getUserEffectivePermissions.handler(
      async ({ context, input }) => {
        await requireTenant(context.principal, 'iam.authorization.inspect')
        const permissions = await admin.explainEffectivePermissions(
          context.principal.tenantId,
          input.userId,
          input.orgNodeId,
        )
        return { permissions }
      },
    ),
    evaluateAccess: impl.evaluateAccess.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'iam.authorization.inspect')
      const definition = registry.get(input.permissionCode)
      if (!definition) {
        throw accessErrors.create('PERMISSION_NOT_FOUND', { permissions: [input.permissionCode] })
      }
      if (definition.target === 'org-node' && !input.orgNodeId) {
        throw accessErrors.create('ACCESS_TARGET_REQUIRED')
      }
      const explained = await admin.explainEffectivePermissions(
        context.principal.tenantId,
        input.userId,
        input.orgNodeId,
      )
      const entry = explained.find((row) => row.code === input.permissionCode)
      return {
        allowed: entry !== undefined,
        target: definition.target,
        sources: entry?.sources ?? [],
      }
    }),
  })
}
