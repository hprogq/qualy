import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import { iamContract, type IamUserDto, type UserTypeDto } from './contract.ts'
import type { IamService, UserRow, UserTypeRow } from './service.ts'

// user types are tenant-scope administration; users are org-scope, so every
// user operation authorizes at the node the user is placed on. The shared
// middlewares own the error mapping and the principal narrowing.

const toUserTypeDto = (row: UserTypeRow): UserTypeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  allowLocalLogin: row.allow_local_login,
  allowSsoLogin: row.allow_sso_login,
  enabled: row.enabled,
  isSystem: row.is_system,
  sortOrder: row.sort_order,
  userCount: row.user_count,
  permissions: row.permissions,
})

const toUserDto = (row: UserRow): IamUserDto => ({
  id: row.id,
  businessNo: row.business_no,
  displayName: row.display_name,
  enabled: row.enabled,
  userType: { id: row.user_type_id, code: row.user_type_code, name: row.user_type_name },
  primaryOrgNode: { id: row.primary_org_node_id, name: row.primary_org_node_name },
  identifier: row.identifier,
})

export function createIamRouter(ctx: Context, service: IamService) {
  const impl = implement(iamContract).$context<ApiContext>().use(apiErrorBoundary).use(requireAuth)

  const requireTenant = (principal: Principal, code: string) => ctx.rbac.require(principal, code)
  // a user is administered where they stand: the caller must hold the org
  // permission at that user's primary node
  const requireAtUser = async (principal: Principal, userId: string, code: string) => {
    const node = await service.userOrgNode(principal.tenantId, userId)
    await ctx.rbac.requireAt(principal, code, node)
  }

  return impl.router({
    listUserTypes: impl.listUserTypes.handler(async ({ context }) => {
      await requireTenant(context.principal, 'auth.user-type.read')
      const rows = await service.listUserTypes(context.principal.tenantId)
      return { userTypes: rows.map(toUserTypeDto) }
    }),
    createUserType: impl.createUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      return { id: await service.createUserType(context.principal.tenantId, input) }
    }),
    updateUserType: impl.updateUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.updateUserType(context.principal.tenantId, input.userTypeId, input)
      return { ok: true as const }
    }),
    setUserTypeEnabled: impl.setUserTypeEnabled.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.setUserTypeEnabled(
        context.principal.tenantId,
        input.userTypeId,
        input.enabled,
      )
      return { ok: true as const }
    }),
    syncUserTypePermissions: impl.syncUserTypePermissions.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.syncUserTypePermissions(
        context.principal.tenantId,
        input.userTypeId,
        input.codes,
      )
      return { ok: true as const }
    }),
    deleteUserType: impl.deleteUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.deleteUserType(context.principal.tenantId, input.userTypeId)
      return { ok: true as const }
    }),

    listUsers: impl.listUsers.handler(async ({ context, input }) => {
      await ctx.rbac.requireAt(context.principal, 'auth.user.read', input.orgNodeId)
      const rows = await service.listUsers(context.principal.tenantId, {
        orgNodeId: input.orgNodeId,
        subtree: input.subtree ?? true,
        search: input.search,
      })
      return { users: rows.map(toUserDto) }
    }),
    createUser: impl.createUser.handler(async ({ context, input }) => {
      // authority is decided by where the user will stand
      await ctx.rbac.requireAt(context.principal, 'auth.user.manage', input.primaryOrgNodeId)
      return { id: await service.createUser(context.principal.tenantId, input) }
    }),
    updateUser: impl.updateUser.handler(async ({ context, input }) => {
      await requireAtUser(context.principal, input.userId, 'auth.user.manage')
      await service.updateUser(context.principal.tenantId, input.userId, input)
      return { ok: true as const }
    }),
    setUserEnabled: impl.setUserEnabled.handler(async ({ context, input }) => {
      await requireAtUser(context.principal, input.userId, 'auth.user.manage')
      await service.setUserEnabled(context.principal.tenantId, input.userId, input.enabled)
      return { ok: true as const }
    }),
  })
}
