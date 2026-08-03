import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { DEFAULT_PAGE_SIZE, decodeCursor, encodeCursor } from '@qualy/api-contract'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import {
  accessContract,
  type PermissionDto,
  type RoleAssignmentDto,
  type RoleDto,
} from './contract.ts'
import type { Administration, AssignmentRow, RoleRow } from './administration.ts'
import type { PermissionRegistry } from './permission-registry.ts'

// roles and the permission catalog are tenant-scope administration; grants
// are org-scope and are filtered by the caller's own anchors inside the
// query, so a manager sees exactly the grants they administer

const toRoleDto = (row: RoleRow): RoleDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  kind: row.kind,
  isSystem: row.is_system,
  assignable: row.assignable,
  status: row.enabled ? 'active' : 'disabled',
  assignmentCount: row.assignment_count,
  permissions: row.permissions,
  allowedUserTypeIds: row.allowed_user_types,
  allowedOrgTypeIds: row.allowed_org_types,
})

const toAssignmentDto = (row: AssignmentRow): RoleAssignmentDto => ({
  id: row.id,
  userId: row.user_id,
  userDisplayName: row.user_display_name,
  roleId: row.role_id,
  roleCode: row.role_code,
  roleName: row.role_name,
  orgNodeId: row.org_node_id,
  orgNodeName: row.org_node_name,
  scope: row.scope,
  manageable: row.manageable,
})

export function createAccessRouter(
  ctx: Context,
  admin: Administration,
  registry: PermissionRegistry,
) {
  const impl = implement(accessContract)
    .$context<ApiContext>()
    .use(apiErrorBoundary)
    .use(requireAuth)
  const requireTenant = (principal: Principal, code: string) => ctx.rbac.require(principal, code)

  // the anchors that decide which grants a caller may see and change; read
  // once per request and pushed into the statement
  const grantScope = async (principal: Principal) => ({
    read: await ctx.rbac.listAuthorizedAnchors(principal, 'rbac.assignment.read'),
    manage: await ctx.rbac.listAuthorizedAnchors(principal, 'rbac.assignment.manage'),
  })

  return impl.router({
    // the ACTIVE catalog, not the table: a row left behind by a plugin that
    // is no longer loaded must never be offered as something to grant
    listPermissions: impl.listPermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.read')
      const permissions: PermissionDto[] = registry
        .list()
        .filter((definition) => !input.scope || definition.scope === input.scope)
        .filter((definition) =>
          !input.grantChannel ||
          (input.grantChannel === 'user-type' ? definition.grantToUserType : definition.grantToRole),
        )
        .map((definition) => ({
          code: definition.code,
          name: definition.name,
          description: definition.description ?? null,
          groupKey: definition.groupKey ?? null,
          plugin: definition.plugin,
          scope: definition.scope,
          grantToUserType: definition.grantToUserType,
          grantToRole: definition.grantToRole,
        }))
      return { permissions }
    }),

    getRoleOptions: impl.getRoleOptions.handler(async ({ context }) => {
      await requireTenant(context.principal, 'rbac.role.read')
      return admin.listEligibilityOptions(context.principal.tenantId)
    }),

    listRoles: impl.listRoles.handler(async ({ context }) => {
      await requireTenant(context.principal, 'rbac.role.read')
      return {
        roles: (await admin.listRoles(context.principal.tenantId)).map(toRoleDto),
        // read and manage are separate grants, so a read-only administrator
        // gets a screen without buttons instead of buttons that answer 403
        capabilities: {
          canManage: await ctx.rbac.hasPermission(context.principal, 'rbac.role.manage'),
        },
      }
    }),
    createOrgRole: impl.createOrgRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      return { id: await admin.createOrgRole(context.principal.tenantId, input) }
    }),
    getRole: impl.getRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.read')
      return { role: toRoleDto(await admin.getRole(context.principal.tenantId, input.roleId)) }
    }),
    updateRole: impl.updateRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.updateRole(context.principal.tenantId, input.roleId, input)
      return { ok: true as const }
    }),
    setRoleStatus: impl.setRoleStatus.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.setRoleEnabled(context.principal.tenantId, input.roleId, input.status === 'active')
      return { ok: true as const }
    }),
    syncRolePermissions: impl.syncRolePermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.syncRolePermissions(context.principal.tenantId, input.roleId, input.codes)
      return { ok: true as const }
    }),
    syncRoleEligibility: impl.syncRoleEligibility.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.syncRoleEligibility(context.principal.tenantId, input.roleId, input)
      return { ok: true as const }
    }),
    deleteRole: impl.deleteRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.deleteRole(context.principal.tenantId, input.roleId)
      return { ok: true as const }
    }),

    listRoleAssignments: impl.listRoleAssignments.handler(async ({ context, input }) => {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE
      const rows = await admin.listAssignments(
        context.principal.tenantId,
        { orgNodeId: input.orgNodeId },
        await grantScope(context.principal),
        { after: decodeCursor(input.cursor, 1)?.[0], limit: limit + 1 },
      )
      const items = rows.slice(0, limit)
      return {
        items: items.map(toAssignmentDto),
        nextCursor:
          rows.length > limit && items.at(-1) ? encodeCursor([items.at(-1)!.id]) : null,
      }
    }),
    getUserRoleAssignments: impl.getUserRoleAssignments.handler(async ({ context, input }) => {
      const rows = await admin.listAssignments(
        context.principal.tenantId,
        { userId: input.userId },
        await grantScope(context.principal),
      )
      return { assignments: rows.map(toAssignmentDto) }
    }),
    syncUserRoleAssignments: impl.syncUserRoleAssignments.handler(async ({ context, input }) => {
      // authorization is decided inside the service transaction, on the
      // locked connection: a check made out here would be against a tree
      // that can still move before the write lands
      await admin.syncUserAssignments(
        context.principal.tenantId,
        input.userId,
        input.assignments,
        context.principal,
      )
      return { ok: true as const }
    }),
  })
}
