import type { Context } from 'cordis'
import { AccessDeniedError } from '@qualy/api-contract'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import type { AuthorizationAnchor, Principal } from '@qualy/rbac-contract'
import { orgErrors } from './errors.ts'
import {
  deleteNode,
  deleteRule,
  deleteType,
  getNode,
  getNodes,
  getRoot,
  getType,
  hasChildren,
  incompatibleChildTypes,
  insertNode,
  insertRule,
  insertType,
  listRules,
  listSubtree,
  listTypes,
  lockTenant,
  moveSubtree,
  pathLabel,
  ruleExists,
  ruleInUse,
  ruleWouldCycle,
  setNodeType,
  typeHasNodes,
  typeHasRules,
  updateNodeFields,
  updateType,
  countTypes,
  type NodeRow,
  type OrgDb,
  type OrgTx,
} from './repo.ts'

// a resolved authorization anchor: the anchor node's id/path plus scope
export type AnchorPath = { id: string; path: string; scope: 'self' | 'subtree' }

const coveredBy = (anchors: readonly AnchorPath[], node: { id: string; path: string }) =>
  anchors.some((anchor) =>
    anchor.scope === 'self'
      ? anchor.id === node.id
      : node.path === anchor.path || node.path.startsWith(`${anchor.path}.`),
  )

// the whole subtree of the node is inside the caller's authority: only a
// subtree-scoped anchor above it can guarantee that (a self anchor covers
// one node, never its descendants)
const subtreeCoveredBy = (anchors: readonly AnchorPath[], node: { path: string }) =>
  anchors.some(
    (anchor) =>
      anchor.scope === 'subtree' &&
      (node.path === anchor.path || node.path.startsWith(`${anchor.path}.`)),
  )

// database constraints stay loud backstops: a violation that slips past
// the in-transaction checks surfaces as the matching domain error
const translateDbError: (error: unknown) => never = createConstraintTranslator({
  uq_org_nodes_tenant_parent_name: () =>
    orgErrors.create('ORG_NODE_CONFLICT', 'sibling name already exists'),
  uq_org_nodes_tenant_root_name: () =>
    orgErrors.create('ORG_NODE_CONFLICT', 'root name already exists'),
  uq_org_nodes_tenant_code: () => orgErrors.create('ORG_NODE_CONFLICT', 'node code already exists'),
  uq_org_nodes_tenant_single_root: () =>
    orgErrors.create('ORG_NODE_CONFLICT', 'tenant already has a root'),
  uq_org_types_tenant_code: () =>
    orgErrors.create('ORG_TYPE_CONFLICT', 'org type code already exists'),
  uq_org_types_tenant_name: () =>
    orgErrors.create('ORG_TYPE_CONFLICT', 'org type name already exists'),
  pk_org_type_rules: () => orgErrors.create('ORG_RULE_CONFLICT'),
  fk_org_nodes_parent: () => orgErrors.create('ORG_NODE_HAS_CHILDREN'),
  fk_users_primary_org_node: () =>
    orgErrors.create('ORG_NODE_IN_USE', 'users are attached to this node'),
  fk_user_role_assignments_node: () =>
    orgErrors.create('ORG_NODE_IN_USE', 'role assignments are anchored at this node'),
  fk_org_nodes_org_type: () => orgErrors.create('ORG_TYPE_IN_USE', 'nodes still use this org type'),
  fk_role_allowed_org_types_type: () =>
    orgErrors.create('ORG_TYPE_IN_USE', 'roles still allow this org type'),
})

export interface OrgForest {
  // ids of the top-level nodes the caller may see; self-scope anchors appear
  // without their children
  roots: string[]
  nodes: NodeRow[]
}

// the org tree domain: every mutation runs in one transaction that first
// locks the tenant row, serializing all structural writes of a tenant (and,
// because rbac assignment writes take the same lock, topology-dependent
// authorization writes too). Validation therefore never races the update it
// guards. Domain rules throw through orgErrors; database constraints stay
// backstops translated by constraint name.
export class OrgTreeService {
  constructor(private ctx: Context) {}

  private get db() {
    return this.ctx.db.drizzle
  }

  private async write<T>(work: (tx: OrgTx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work)
    } catch (error) {
      translateDbError(error)
    }
  }

  async getRootNode(tenantId: string): Promise<NodeRow> {
    const root = await getRoot(this.db, tenantId)
    if (!root) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'tenant has no root node')
    return root
  }

  async getSubtree(tenantId: string, nodeId: string): Promise<OrgForest> {
    const node = await getNode(this.db, tenantId, nodeId)
    if (!node) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'node not found')
    return { roots: [node.id], nodes: await listSubtree(this.db, tenantId, node.path) }
  }

  // the forest a set of resolved anchors makes visible: top-most subtree
  // anchors expand to whole subtrees, self anchors surface as bare nodes
  // unless another kept subtree already covers them
  private async projectForest(
    db: OrgDb,
    tenantId: string,
    anchors: readonly AnchorPath[],
  ): Promise<OrgForest> {
    if (anchors.length === 0) return { roots: [], nodes: [] }
    const covered = (path: string, keep: AnchorPath[]) =>
      keep.some((kept) => path === kept.path || path.startsWith(`${kept.path}.`))
    const keptSubtrees: AnchorPath[] = []
    for (const anchor of [...anchors]
      .filter((anchor) => anchor.scope === 'subtree')
      .sort((a, b) => a.path.length - b.path.length)) {
      if (!covered(anchor.path, keptSubtrees)) keptSubtrees.push(anchor)
    }
    const selfAnchors = anchors.filter(
      (anchor) => anchor.scope === 'self' && !covered(anchor.path, keptSubtrees),
    )
    const nodes = new Map<string, NodeRow>()
    for (const anchor of keptSubtrees) {
      for (const node of await listSubtree(db, tenantId, anchor.path)) {
        nodes.set(node.id, node)
      }
    }
    for (const anchor of selfAnchors) {
      const node = await getNode(db, tenantId, anchor.id)
      if (node) nodes.set(node.id, node)
    }
    const roots = [...new Set([...keptSubtrees, ...selfAnchors].map((anchor) => anchor.id))].filter(
      (id) => nodes.has(id),
    )
    return { roots, nodes: [...nodes.values()].sort((a, b) => (a.path < b.path ? -1 : 1)) }
  }

  // in-lock authorization re-validation: the router's requireAt runs before
  // the transaction, so a concurrent move could re-anchor the target between
  // check and lock. Re-deriving coverage from anchors read on the locked
  // connection closes that window; absent principal means a trusted
  // system-level call (seed, cross-plugin service use).
  private async assertManages(
    tx: OrgTx,
    principal: Principal | undefined,
    tenantId: string,
    nodes: readonly { node: NodeRow; wholeSubtree?: boolean }[],
  ): Promise<void> {
    if (!principal) return
    const anchors = await this.anchorPaths(
      tx,
      tenantId,
      await this.ctx.rbac.listAuthorizedAnchors(principal, 'org.tree.manage', tx),
    )
    for (const { node, wholeSubtree } of nodes) {
      const allowed = wholeSubtree ? subtreeCoveredBy(anchors, node) : coveredBy(anchors, node)
      if (!allowed) {
        throw new AccessDeniedError('not allowed to manage this node')
      }
    }
  }

  // resolves anchors to their node paths for coverage projection; anchors
  // pointing at vanished nodes drop out (fail closed)
  private async anchorPaths(
    db: OrgDb,
    tenantId: string,
    anchors: readonly AuthorizationAnchor[],
  ): Promise<AnchorPath[]> {
    const nodes = await getNodes(
      db,
      tenantId,
      anchors.map((anchor) => anchor.orgNodeId),
    )
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return anchors.flatMap((anchor) => {
      const node = byId.get(anchor.orgNodeId)
      return node ? [{ id: node.id, path: node.path, scope: anchor.scope }] : []
    })
  }

  // the authorized projection of the tree. Anchors (rbac assignments and
  // roles) AND the tree resolve inside the same repeatable-read read-only
  // transaction: a concurrent move can never tear the response, and a
  // revoked grant can never outlive the snapshot it was read in. With
  // nodeId the caller's read anchors decide the slice: subtree coverage
  // yields the whole subtree, bare self coverage only the node.
  async readForest(
    principal: Principal,
    nodeId?: string,
  ): Promise<{
    roots: string[]
    nodes: (NodeRow & { manageable: boolean; subtreeManageable: boolean })[]
  }> {
    const tenantId = principal.tenantId
    return this.db.transaction(
      async (tx) => {
        const readAnchors = await this.anchorPaths(
          tx,
          tenantId,
          await this.ctx.rbac.listAuthorizedAnchors(principal, 'org.tree.read', tx),
        )
        const manageAnchors = await this.anchorPaths(
          tx,
          tenantId,
          await this.ctx.rbac.listAuthorizedAnchors(principal, 'org.tree.manage', tx),
        )
        let forest: OrgForest
        if (nodeId) {
          const node = await getNode(tx, tenantId, nodeId)
          if (!node || !coveredBy(readAnchors, node)) {
            // not-found and not-covered are indistinguishable on purpose
            throw new AccessDeniedError('not allowed to read this node')
          }
          forest = subtreeCoveredBy(readAnchors, node)
            ? { roots: [node.id], nodes: await listSubtree(tx, tenantId, node.path) }
            : { roots: [node.id], nodes: [node] }
        } else {
          forest = await this.projectForest(tx, tenantId, readAnchors)
        }
        return {
          roots: forest.roots,
          nodes: forest.nodes.map((node) => ({
            ...node,
            // manageable covers single-node mutations; a move relocates the
            // whole subtree and needs subtree-scoped coverage
            manageable: coveredBy(manageAnchors, node),
            subtreeManageable: subtreeCoveredBy(manageAnchors, node),
          })),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }

  // type/rule management targets the root; the root never moves, but the
  // caller's grants can be revoked between the router pre-check and the
  // lock, so re-validate on the locked connection like every node write
  private async assertManagesRoot(
    tx: OrgTx,
    principal: Principal | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!principal) return
    const root = await getRoot(tx, tenantId)
    if (!root) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'tenant has no root node')
    await this.assertManages(tx, principal, tenantId, [{ node: root }])
  }

  createNode(
    tenantId: string,
    input: { parentId: string; orgTypeId: string; name: string; code?: string; sortOrder?: number },
    as?: Principal,
  ): Promise<NodeRow> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      const parent = await getNode(tx, tenantId, input.parentId)
      if (!parent) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'parent node not found')
      await this.assertManages(tx, as, tenantId, [{ node: parent }])
      const type = await getType(tx, tenantId, input.orgTypeId)
      if (!type) throw orgErrors.create('ORG_TYPE_NOT_FOUND', 'org type not found')
      if (!(await ruleExists(tx, tenantId, parent.org_type_id, input.orgTypeId))) {
        throw orgErrors.create('ORG_NODE_RULE_VIOLATION', 'parent-child type combination is not allowed by the rules')
      }
      return insertNode(tx, {
        tenantId,
        parentId: parent.id,
        parentPath: parent.path,
        parentDepth: parent.depth,
        orgTypeId: input.orgTypeId,
        code: input.code ?? null,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      })
    })
  }

  updateNode(
    tenantId: string,
    nodeId: string,
    fields: { name?: string; sortOrder?: number },
    as?: Principal,
  ): Promise<NodeRow> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      const node = await getNode(tx, tenantId, nodeId)
      if (!node) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'node not found')
      await this.assertManages(tx, as, tenantId, [{ node }])
      await updateNodeFields(tx, tenantId, nodeId, fields)
      return (await getNode(tx, tenantId, nodeId))!
    })
  }

  changeNodeType(
    tenantId: string,
    nodeId: string,
    newTypeId: string,
    as?: Principal,
  ): Promise<NodeRow> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      const node = await getNode(tx, tenantId, nodeId)
      if (!node) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'node not found')
      await this.assertManages(tx, as, tenantId, [{ node }])
      if (node.org_type_id === newTypeId) return node
      const type = await getType(tx, tenantId, newTypeId)
      if (!type) throw orgErrors.create('ORG_TYPE_NOT_FOUND', 'org type not found')
      if (node.parent_id) {
        const parent = (await getNode(tx, tenantId, node.parent_id))!
        if (!(await ruleExists(tx, tenantId, parent.org_type_id, newTypeId))) {
          throw orgErrors.create('ORG_NODE_RULE_VIOLATION', 'the new type is not allowed under the parent type')
        }
      }
      const incompatible = await incompatibleChildTypes(tx, tenantId, nodeId, newTypeId)
      if (incompatible.length > 0) {
        throw orgErrors.create('ORG_NODE_RULE_VIOLATION', 'existing children are incompatible with the new type')
      }
      // the check runs on this transaction's own connection: a second pool
      // connection while holding the tenant lock could deadlock the pool
      const blocking = await this.ctx.rbac.assignmentsBlockingOrgType(
        tenantId,
        nodeId,
        newTypeId,
        tx,
      )
      if (blocking.length > 0) {
        // role codes stay private to assignment readers; the count is the
        // only thing the caller needs, and it localizes with an icu plural
        throw orgErrors.create('ORG_NODE_ASSIGNMENT_INCOMPATIBLE', {
          assignmentCount: blocking.length,
        })
      }
      await setNodeType(tx, tenantId, nodeId, newTypeId)
      return (await getNode(tx, tenantId, nodeId))!
    })
  }

  moveNode(
    tenantId: string,
    nodeId: string,
    newParentId: string,
    newSortOrder?: number,
    as?: Principal,
  ): Promise<NodeRow> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      if (nodeId === newParentId) {
        throw orgErrors.create('ORG_NODE_INVALID_MOVE', 'a node cannot become its own parent')
      }
      const node = await getNode(tx, tenantId, nodeId)
      if (!node) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'node not found')
      if (!node.parent_id) throw orgErrors.create('ORG_NODE_IS_ROOT', 'the root cannot be moved')
      const newParent = await getNode(tx, tenantId, newParentId)
      if (!newParent) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'new parent not found')
      // a move relocates every descendant, so the caller's authority must
      // cover the WHOLE moved subtree (a bare self anchor on the node would
      // let it drag unmanaged descendants into its own managed region and
      // silently gain manage over them)
      await this.assertManages(tx, as, tenantId, [
        { node, wholeSubtree: true },
        { node: newParent },
      ])
      if (newParent.id === node.parent_id) {
        // same parent: a pure reorder, no structural change
        if (newSortOrder !== undefined) {
          await updateNodeFields(tx, tenantId, nodeId, { sortOrder: newSortOrder })
        }
        return (await getNode(tx, tenantId, nodeId))!
      }
      if (newParent.path === node.path || newParent.path.startsWith(`${node.path}.`)) {
        throw orgErrors.create('ORG_NODE_INVALID_MOVE', 'a node cannot move into its own subtree')
      }
      if (!(await ruleExists(tx, tenantId, newParent.org_type_id, node.org_type_id))) {
        throw orgErrors.create('ORG_NODE_RULE_VIOLATION', 'parent-child type combination is not allowed by the rules')
      }
      await moveSubtree(tx, {
        tenantId,
        nodeId,
        newParentId,
        oldPath: node.path,
        newPath: `${newParent.path}.${pathLabel(node.id)}`,
        depthDelta: newParent.depth + 1 - node.depth,
      })
      if (newSortOrder !== undefined) {
        await updateNodeFields(tx, tenantId, nodeId, { sortOrder: newSortOrder })
      }
      return (await getNode(tx, tenantId, nodeId))!
    })
  }

  deleteNode(tenantId: string, nodeId: string, as?: Principal): Promise<void> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      const node = await getNode(tx, tenantId, nodeId)
      if (!node) throw orgErrors.create('ORG_NODE_NOT_FOUND', 'node not found')
      if (!node.parent_id) throw orgErrors.create('ORG_NODE_IS_ROOT', 'the root cannot be deleted')
      await this.assertManages(tx, as, tenantId, [{ node }])
      if (await hasChildren(tx, tenantId, nodeId)) {
        throw orgErrors.create('ORG_NODE_HAS_CHILDREN', 'only leaf nodes can be deleted')
      }
      // users and assignments still block through their restrict fks,
      // translated to ORG_NODE_IN_USE by constraint name
      await deleteNode(tx, tenantId, nodeId)
    })
  }

  listTypes(tenantId: string) {
    return listTypes(this.db, tenantId)
  }

  createType(
    tenantId: string,
    input: { code: string; name: string; sortOrder?: number },
    as?: Principal,
  ) {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      await this.assertManagesRoot(tx, as, tenantId)
      return insertType(tx, {
        tenantId,
        code: input.code,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      })
    })
  }

  updateType(
    tenantId: string,
    typeId: string,
    fields: { name?: string; sortOrder?: number },
    as?: Principal,
  ) {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      await this.assertManagesRoot(tx, as, tenantId)
      const type = await getType(tx, tenantId, typeId)
      if (!type) throw orgErrors.create('ORG_TYPE_NOT_FOUND', 'org type not found')
      await updateType(tx, tenantId, typeId, fields)
      return (await getType(tx, tenantId, typeId))!
    })
  }

  deleteType(tenantId: string, typeId: string, as?: Principal): Promise<void> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      await this.assertManagesRoot(tx, as, tenantId)
      const type = await getType(tx, tenantId, typeId)
      if (!type) throw orgErrors.create('ORG_TYPE_NOT_FOUND', 'org type not found')
      if (await typeHasNodes(tx, tenantId, typeId)) {
        throw orgErrors.create('ORG_TYPE_IN_USE', 'nodes still use this org type')
      }
      if (await typeHasRules(tx, tenantId, typeId)) {
        throw orgErrors.create('ORG_TYPE_IN_USE', 'rules still reference this org type')
      }
      await deleteType(tx, tenantId, typeId)
    })
  }

  listRules(tenantId: string) {
    return listRules(this.db, tenantId)
  }

  createRule(
    tenantId: string,
    parentTypeId: string,
    childTypeId: string,
    as?: Principal,
  ): Promise<void> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      await this.assertManagesRoot(tx, as, tenantId)
      if (parentTypeId === childTypeId) {
        throw orgErrors.create('ORG_RULE_INVALID', 'a type cannot parent itself')
      }
      if ((await countTypes(tx, tenantId, [parentTypeId, childTypeId])) !== 2) {
        throw orgErrors.create('ORG_TYPE_NOT_FOUND', 'both rule types must exist in the tenant')
      }
      // the rule graph stays a dag: adding parent->child is rejected when
      // parent is already reachable from child
      if (await ruleWouldCycle(tx, tenantId, parentTypeId, childTypeId)) {
        throw orgErrors.create('ORG_RULE_CYCLE', 'the rule would create a cycle in the type graph')
      }
      await insertRule(tx, { tenantId, parentTypeId, childTypeId })
    })
  }

  deleteRule(
    tenantId: string,
    parentTypeId: string,
    childTypeId: string,
    as?: Principal,
  ): Promise<void> {
    return this.write(async (tx) => {
      await lockTenant(tx, tenantId)
      await this.assertManagesRoot(tx, as, tenantId)
      if (!(await ruleExists(tx, tenantId, parentTypeId, childTypeId))) {
        throw orgErrors.create('ORG_RULE_NOT_FOUND', 'rule not found')
      }
      if (await ruleInUse(tx, tenantId, parentTypeId, childTypeId)) {
        throw orgErrors.create('ORG_RULE_IN_USE', 'existing parent-child nodes depend on this rule')
      }
      await deleteRule(tx, tenantId, parentTypeId, childTypeId)
    })
  }
}
