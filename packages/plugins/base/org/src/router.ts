import { implement, ORPCError } from '@orpc/server'
import type { Context } from 'cordis'
import type { ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import { orgContract, type OrgNodeDto, type OrgTreeNodeDto } from './contract.ts'
import { OrgError } from './errors.ts'
import type { NodeRow } from './repo.ts'
import type { OrgTreeService } from './service.ts'

// transport layer: input validation lives in the contract, authorization is
// decided here through rbac (create targets the parent, move targets both
// ends, type/rule management targets the root), domain errors map onto the
// typed contract errors. No sql below this line.

const toNodeDto = (row: NodeRow): OrgNodeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  orgTypeId: row.org_type_id,
  parentId: row.parent_id,
  depth: row.depth,
  sortOrder: row.sort_order,
})

function requirePrincipal(context: ApiContext): Principal {
  if (!context.principal) throw new ORPCError('AUTH_REQUIRED')
  return context.principal
}

type ErrorFactories = Record<string, (options?: { message?: string }) => Error>

// domain errors become the procedure's typed errors; anything the contract
// does not declare stays an internal fault (500) on purpose. The service's
// in-lock authorization verdict maps onto the transport FORBIDDEN.
function mapDomain(errors: unknown, error: unknown): never {
  if (error instanceof OrgError) {
    if (error.code === 'ORG_FORBIDDEN') throw new ORPCError('FORBIDDEN')
    const factory = (errors as ErrorFactories)[error.code]
    if (factory) throw factory({ message: error.message })
  }
  throw error
}

export function createOrgRouter(ctx: Context, service: OrgTreeService) {
  const impl = implement(orgContract).$context<ApiContext>()

  // read access to type/rule metadata: held anywhere in the tenant tree
  const requireAnyRead = async (principal: Principal) => {
    if (!(await ctx.rbac.hasPermission(principal, 'org.tree.read'))) {
      throw new ORPCError('FORBIDDEN')
    }
  }
  const requireManageAtRoot = async (principal: Principal) => {
    const root = await service.getRootNode(principal.tenantId)
    await ctx.rbac.requireAt(principal, 'org.tree.manage', root.id)
  }

  return impl.router({
    getTree: impl.getTree.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        // authorization IS the anchor projection: subtree anchors expand,
        // self anchors stay bare (also for an explicit nodeId), everything
        // else is invisible. Anchors and tree resolve in one snapshot
        // inside the service.
        const forest = await service.readForest(principal, input.nodeId)
        const nodes: OrgTreeNodeDto[] = forest.nodes.map((row) => ({
          ...toNodeDto(row),
          manageable: row.manageable,
          subtreeManageable: row.subtreeManageable,
        }))
        return { roots: forest.roots, nodes }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    listTypes: impl.listTypes.handler(async ({ context }) => {
      const principal = requirePrincipal(context)
      await requireAnyRead(principal)
      const types = await service.listTypes(principal.tenantId)
      return {
        types: types.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          sortOrder: row.sort_order,
        })),
      }
    }),
    createType: impl.createType.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await requireManageAtRoot(principal)
        const type = await service.createType(principal.tenantId, input, principal)
        return {
          type: { id: type.id, code: type.code, name: type.name, sortOrder: type.sort_order },
        }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    updateType: impl.updateType.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await requireManageAtRoot(principal)
        const type = await service.updateType(principal.tenantId, input.typeId, input, principal)
        return {
          type: { id: type.id, code: type.code, name: type.name, sortOrder: type.sort_order },
        }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    deleteType: impl.deleteType.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await requireManageAtRoot(principal)
        await service.deleteType(principal.tenantId, input.typeId, principal)
        return { ok: true }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    listRules: impl.listRules.handler(async ({ context }) => {
      const principal = requirePrincipal(context)
      await requireAnyRead(principal)
      const rules = await service.listRules(principal.tenantId)
      return {
        rules: rules.map((row) => ({
          parentTypeId: row.parent_type_id,
          childTypeId: row.child_type_id,
        })),
      }
    }),
    createRule: impl.createRule.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await requireManageAtRoot(principal)
        await service.createRule(
          principal.tenantId,
          input.parentTypeId,
          input.childTypeId,
          principal,
        )
        return { ok: true }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    deleteRule: impl.deleteRule.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await requireManageAtRoot(principal)
        await service.deleteRule(
          principal.tenantId,
          input.parentTypeId,
          input.childTypeId,
          principal,
        )
        return { ok: true }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    createNode: impl.createNode.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.parentId)
        const node = await service.createNode(principal.tenantId, input, principal)
        return { node: toNodeDto(node) }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    updateNode: impl.updateNode.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.nodeId)
        const node = await service.updateNode(principal.tenantId, input.nodeId, input, principal)
        return { node: toNodeDto(node) }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    changeNodeType: impl.changeNodeType.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.nodeId)
        const node = await service.changeNodeType(
          principal.tenantId,
          input.nodeId,
          input.orgTypeId,
          principal,
        )
        return { node: toNodeDto(node) }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    moveNode: impl.moveNode.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        // both ends: moving a managed node into an unmanaged region and
        // pulling an unmanaged node into a managed one are both forbidden
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.nodeId)
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.newParentId)
        const node = await service.moveNode(
          principal.tenantId,
          input.nodeId,
          input.newParentId,
          input.newSortOrder,
          principal,
        )
        return { node: toNodeDto(node) }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
    deleteNode: impl.deleteNode.handler(async ({ context, input, errors }) => {
      try {
        const principal = requirePrincipal(context)
        await ctx.rbac.requireAt(principal, 'org.tree.manage', input.nodeId)
        await service.deleteNode(principal.tenantId, input.nodeId, principal)
        return { ok: true }
      } catch (error) {
        mapDomain(errors, error)
      }
    }),
  })
}
