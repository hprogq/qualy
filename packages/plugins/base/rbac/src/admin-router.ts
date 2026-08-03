import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import {
  rbacAdminContract,
  type AssignmentDto,
  type RoleDto,
} from './admin-contract.ts'
import type { Administration, AssignmentRow, RoleRow } from './administration.ts'

// roles are tenant-scope administration; assignments are org-scope and are
// authorized at the node the assignment anchors to, so a manager can only
// grant inside the subtree they administer

const toRoleDto = (row: RoleRow): RoleDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  kind: row.kind,
  isSystem: row.is_system,
  assignable: row.assignable,
  enabled: row.enabled,
  assignmentCount: row.assignment_count,
  permissions: row.permissions,
  allowedUserTypeIds: row.allowed_user_types,
  allowedOrgTypeIds: row.allowed_org_types,
})

const toAssignmentDto = (row: AssignmentRow): AssignmentDto => ({
  id: row.id,
  userId: row.user_id,
  userDisplayName: row.user_display_name,
  roleId: row.role_id,
  roleCode: row.role_code,
  roleName: row.role_name,
  orgNodeId: row.org_node_id,
  orgNodeName: row.org_node_name,
  scope: row.scope,
})

export function createRbacAdminRouter(ctx: Context, admin: Administration) {
  const impl = implement(rbacAdminContract)
    .$context<ApiContext>()
    .use(apiErrorBoundary)
    .use(requireAuth)
  const requireTenant = (principal: Principal, code: string) => ctx.rbac.require(principal, code)

  return impl.router({
    listRoles: impl.listRoles.handler(async ({ context }) => {
      await requireTenant(context.principal, 'rbac.role.read')
      return { roles: (await admin.listRoles(context.principal.tenantId)).map(toRoleDto) }
    }),
    createOrgRole: impl.createOrgRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      return { id: await admin.createOrgRole(context.principal.tenantId, input) }
    }),
    updateRole: impl.updateRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.updateRole(context.principal.tenantId, input.roleId, input)
      return { ok: true as const }
    }),
    setRoleEnabled: impl.setRoleEnabled.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.setRoleEnabled(context.principal.tenantId, input.roleId, input.enabled)
      return { ok: true as const }
    }),
    syncRolePermissions: impl.syncRolePermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.syncRolePermissions(context.principal.tenantId, input.roleId, input.codes)
      return { ok: true as const }
    }),
    syncRoleAllowedSets: impl.syncRoleAllowedSets.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.syncRoleAllowedSets(context.principal.tenantId, input.roleId, input)
      return { ok: true as const }
    }),
    deleteRole: impl.deleteRole.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'rbac.role.manage')
      await admin.deleteRole(context.principal.tenantId, input.roleId)
      return { ok: true as const }
    }),

    listAssignments: impl.listAssignments.handler(async ({ context, input }) => {
      const rows = await admin.listAssignments(context.principal.tenantId, input)
      // an assignment is only visible where the caller may read assignments
      const visible: AssignmentDto[] = []
      for (const row of rows) {
        if (await ctx.rbac.canAt(context.principal, 'rbac.assignment.read', row.org_node_id)) {
          visible.push(toAssignmentDto(row))
        }
      }
      return { assignments: visible }
    }),
    syncUserAssignments: impl.syncUserAssignments.handler(async ({ context, input }) => {
      // authority is per anchor: every node touched, before and after, must
      // be one the caller may administer
      const existing = await admin.listAssignments(context.principal.tenantId, {
        userId: input.userId,
      })
      const nodes = new Set([
        ...existing.map((row) => row.org_node_id),
        ...input.assignments.map((entry) => entry.orgNodeId),
      ])
      for (const node of nodes) {
        await ctx.rbac.requireAt(context.principal, 'rbac.assignment.manage', node)
      }
      // and the canonical administrator role is reserved for its holders
      for (const entry of input.assignments) {
        await admin.assertMayAdministerRole(
          context.principal.tenantId,
          entry.roleId,
          context.principal.userId,
        )
      }
      for (const row of existing) {
        const kept = input.assignments.some(
          (entry) =>
            entry.roleId === row.role_id &&
            entry.orgNodeId === row.org_node_id &&
            entry.scope === row.scope,
        )
        if (!kept) {
          await admin.assertMayAdministerRole(
            context.principal.tenantId,
            row.role_id,
            context.principal.userId,
          )
        }
      }
      await admin.syncUserAssignments(
        context.principal.tenantId,
        input.userId,
        input.assignments,
      )
      return { ok: true as const }
    }),
  })
}
