import { implement, ORPCError } from '@orpc/server'
import type { Context } from 'cordis'
import { apiErrorBoundary, requireAuth, type ApiContext } from '@qualy/plugin-server'
import type { Principal } from '@qualy/rbac-contract'
import { orgContract, type OrgNodeDto, type OrgTreeNodeDto } from './contract.ts'
import type { NodeRow } from './repo.ts'
import type { OrgTreeService } from './service.ts'

// transport layer: input validation lives in the contract, authorization is
// decided here through rbac (create targets the parent, move targets both
// ends, type/rule management targets the root). The shared middlewares own
// the cross-cutting concerns: apiErrorBoundary maps thrown domain errors
// onto the typed contract errors and requireAuth narrows the principal to
// non-optional for every handler. No sql below this line.

const toNodeDto = (row: NodeRow): OrgNodeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  orgTypeId: row.org_type_id,
  parentId: row.parent_id,
  depth: row.depth,
  sortOrder: row.sort_order,
})

const toTypeDto = (row: { id: string; code: string; name: string; sort_order: number }) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  sortOrder: row.sort_order,
})

export function createOrgRouter(ctx: Context, service: OrgTreeService) {
  const impl = implement(orgContract).$context<ApiContext>().use(apiErrorBoundary).use(requireAuth)

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
    getTree: impl.getTree.handler(async ({ context, input }) => {
      // authorization IS the anchor projection: subtree anchors expand,
      // self anchors stay bare (also for an explicit nodeId), everything
      // else is invisible. Anchors and tree resolve in one snapshot.
      const forest = await service.readForest(context.principal, input.nodeId)
      const nodes: OrgTreeNodeDto[] = forest.nodes.map((row) => ({
        ...toNodeDto(row),
        manageable: row.manageable,
        subtreeManageable: row.subtreeManageable,
      }))
      return { roots: forest.roots, nodes }
    }),
    listTypes: impl.listTypes.handler(async ({ context }) => {
      await requireAnyRead(context.principal)
      return { types: (await service.listTypes(context.principal.tenantId)).map(toTypeDto) }
    }),
    createType: impl.createType.handler(async ({ context, input }) => {
      await requireManageAtRoot(context.principal)
      const type = await service.createType(context.principal.tenantId, input, context.principal)
      return { type: toTypeDto(type) }
    }),
    updateType: impl.updateType.handler(async ({ context, input }) => {
      await requireManageAtRoot(context.principal)
      const type = await service.updateType(
        context.principal.tenantId,
        input.typeId,
        input,
        context.principal,
      )
      return { type: toTypeDto(type) }
    }),
    deleteType: impl.deleteType.handler(async ({ context, input }) => {
      await requireManageAtRoot(context.principal)
      await service.deleteType(context.principal.tenantId, input.typeId, context.principal)
      return { ok: true }
    }),
    listRules: impl.listRules.handler(async ({ context }) => {
      await requireAnyRead(context.principal)
      const rules = await service.listRules(context.principal.tenantId)
      return {
        rules: rules.map((row) => ({
          parentTypeId: row.parent_type_id,
          childTypeId: row.child_type_id,
        })),
      }
    }),
    putRule: impl.putRule.handler(async ({ context, input }) => {
      await requireManageAtRoot(context.principal)
      await service.putRule(
        context.principal.tenantId,
        input.parentTypeId,
        input.childTypeId,
        context.principal,
      )
      return { ok: true }
    }),
    deleteRule: impl.deleteRule.handler(async ({ context, input }) => {
      await requireManageAtRoot(context.principal)
      await service.deleteRule(
        context.principal.tenantId,
        input.parentTypeId,
        input.childTypeId,
        context.principal,
      )
      return { ok: true }
    }),
    getNode: impl.getNode.handler(async ({ context, input }) => {
      const node = await service.readNode(context.principal, input.nodeId)
      return {
        node: {
          ...toNodeDto(node),
          manageable: node.manageable,
          subtreeManageable: node.subtreeManageable,
        },
      }
    }),
    createNode: impl.createNode.handler(async ({ context, input }) => {
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.parentId)
      const node = await service.createNode(context.principal.tenantId, input, context.principal)
      return { node: toNodeDto(node) }
    }),
    updateNode: impl.updateNode.handler(async ({ context, input }) => {
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.nodeId)
      const node = await service.updateNode(
        context.principal.tenantId,
        input.nodeId,
        input,
        context.principal,
      )
      return { node: toNodeDto(node) }
    }),
    changeNodeType: impl.changeNodeType.handler(async ({ context, input }) => {
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.nodeId)
      const node = await service.changeNodeType(
        context.principal.tenantId,
        input.nodeId,
        input.orgTypeId,
        context.principal,
      )
      return { node: toNodeDto(node) }
    }),
    setNodePlacement: impl.setNodePlacement.handler(async ({ context, input }) => {
      // both ends: moving a managed node into an unmanaged region and
      // pulling an unmanaged node into a managed one are both forbidden
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.nodeId)
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.parentId)
      const node = await service.moveNode(
        context.principal.tenantId,
        input.nodeId,
        input.parentId,
        context.principal,
        input.sortOrder,
      )
      return { node: toNodeDto(node) }
    }),
    deleteNode: impl.deleteNode.handler(async ({ context, input }) => {
      await ctx.rbac.requireAt(context.principal, 'org.tree.manage', input.nodeId)
      await service.deleteNode(context.principal.tenantId, input.nodeId, context.principal)
      return { ok: true }
    }),
  })
}
