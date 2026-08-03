import { implement, ORPCError } from '@orpc/server'
import type { Context } from 'cordis'
import { DEFAULT_PAGE_SIZE, encodeCursor } from '@qualy/api-contract'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import { identityContract, type IamUserDto, type UserTypeDto } from './contract.ts'
import type { IamService, UserRow, UserTypeRow } from './service.ts'

// User types are tenant-scope administration. Users are org-scope, and their
// authorization is decided inside the service transaction rather than here:
// a check made at this layer is against a tree that can still move before
// the write it guards lands. Reads carry their own filter, so what comes
// back is already the caller's own slice.

const toUserTypeDto = (row: UserTypeRow): UserTypeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  allowLocalLogin: row.allow_local_login,
  allowSsoLogin: row.allow_sso_login,
  status: row.enabled ? 'active' : 'disabled',
  isSystem: row.is_system,
  sortOrder: row.sort_order,
  userCount: row.user_count,
  permissions: row.permissions,
})

const toUserDto = (row: UserRow): IamUserDto => ({
  id: row.id,
  businessNo: row.business_no,
  displayName: row.display_name,
  status: row.enabled ? 'active' : 'disabled',
  userType: { id: row.user_type_id, code: row.user_type_code, name: row.user_type_name },
  primaryOrgNode: { id: row.primary_org_node_id, name: row.primary_org_node_name },
  identifier: row.identifier,
  manageable: row.manageable,
})

export function createIdentityRouter(ctx: Context, service: IamService) {
  const impl = implement(identityContract)
    .$context<ApiContext>()
    .use(apiErrorBoundary)
    .use(requireAuth)

  const requireTenant = (principal: Principal, code: string) => ctx.rbac.require(principal, code)
  // reading users is org-scope and held per anchor, so the gate here is
  // "anywhere at all"; which users come back is the query's own decision
  const requireUserRead = async (principal: Principal) => {
    if (!(await ctx.rbac.hasPermission(principal, 'auth.user.read'))) {
      throw new ORPCError('FORBIDDEN')
    }
  }

  return impl.router({
    listUserTypes: impl.listUserTypes.handler(async ({ context }) => {
      await requireTenant(context.principal, 'auth.user-type.read')
      return {
        userTypes: (await service.listUserTypes(context.principal.tenantId)).map(toUserTypeDto),
        capabilities: {
          canManage: await ctx.rbac.hasPermission(context.principal, 'auth.user-type.manage'),
        },
      }
    }),
    createUserType: impl.createUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      return { id: await service.createUserType(context.principal.tenantId, input) }
    }),
    getUserType: impl.getUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.read')
      const row = await service.getUserType(context.principal.tenantId, input.userTypeId)
      return { userType: toUserTypeDto(row) }
    }),
    updateUserType: impl.updateUserType.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.updateUserType(context.principal.tenantId, input.userTypeId, input)
      return { ok: true as const }
    }),
    setUserTypeStatus: impl.setUserTypeStatus.handler(async ({ context, input }) => {
      await requireTenant(context.principal, 'auth.user-type.manage')
      await service.setUserTypeEnabled(
        context.principal.tenantId,
        input.userTypeId,
        input.status === 'active',
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

    getUserOptions: impl.getUserOptions.handler(async ({ context }) => {
      await requireUserRead(context.principal)
      return service.userOptions(context.principal)
    }),

    listUsers: impl.listUsers.handler(async ({ context, input }) => {
      await requireUserRead(context.principal)
      const limit = input.limit ?? DEFAULT_PAGE_SIZE
      const rows = await service.listUsers(context.principal, {
        orgNodeId: input.orgNodeId,
        scope: input.scope ?? 'subtree',
        search: input.search,
        cursor: input.cursor,
        limit: limit + 1,
      })
      const items = rows.slice(0, limit)
      const last = items.at(-1)
      return {
        items: items.map(toUserDto),
        nextCursor: rows.length > limit && last ? encodeCursor([last.display_name, last.id]) : null,
      }
    }),
    createUser: impl.createUser.handler(async ({ context, input }) => ({
      id: await service.createUser(context.principal.tenantId, input, context.principal),
    })),
    getUser: impl.getUser.handler(async ({ context, input }) => {
      await requireUserRead(context.principal)
      return { user: toUserDto(await service.getUser(context.principal, input.userId)) }
    }),
    updateUser: impl.updateUser.handler(async ({ context, input }) => {
      await service.updateUser(context.principal.tenantId, input.userId, input, context.principal)
      return { ok: true as const }
    }),
    setUserPlacement: impl.setUserPlacement.handler(async ({ context, input }) => {
      await service.setUserPlacement(
        context.principal.tenantId,
        input.userId,
        input.primaryOrgNodeId,
        context.principal,
      )
      return { ok: true as const }
    }),
    setUserStatus: impl.setUserStatus.handler(async ({ context, input }) => {
      await service.setUserEnabled(
        context.principal.tenantId,
        input.userId,
        input.status === 'active',
        context.principal,
      )
      return { ok: true as const }
    }),
  })
}
