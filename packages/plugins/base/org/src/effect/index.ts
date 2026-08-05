import { Context, Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentUser } from './session-port.ts'
import { orgApiGroup } from '../api.ts'
import { Placement } from '@qualy/auth-contract'
import { Database } from '@qualy/plugin-database/effect'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import {
  AssignmentIncompatible,
  NodeNotFound,
  PlacementBlocked,
  RuleViolation,
  TypeNotFound,
  InvalidMove,
  NodeHasChildren,
  NodeIsRoot,
  nodeConstraints,
  typeConstraints,
  RuleCycle,
  RuleInUse,
  RuleInvalid,
  RuleNotFound,
  TypeInUse,
  type ChangeNodeTypeError,
  type CreateNodeError,
  type MoveNodeError,
  type CreateTypeError,
  type DeleteRuleError,
  type DeleteTypeError,
  type PutRuleError,
  type UpdateTypeError,
  type DeleteNodeError,
  type UpdateNodeError,
} from './errors.ts'
import type { Principal } from '@qualy/rbac-contract'
import { translateConstraints } from '@qualy/plugin-database/effect/constraints'
import {
  byPath,
  coveredBy,
  forestRoots,
  forestShape,
  subtreeCoveredBy,
  type ResolvedScope,
} from '../coverage.ts'
import {
  countTypesQuery,
  deleteNodeQuery,
  deleteRuleQuery,
  deleteTypeQuery,
  hasChildrenQuery,
  insertRuleQuery,
  insertTypeQuery,
  listRulesQuery,
  listTypesQuery,
  insertNodeQuery,
  moveSubtreeQuery,
  nodesByIdQuery,
  readSnapshotQuery,
  rootQuery,
  ruleInUseQuery,
  subtreeQuery,
  ruleWouldCycleQuery,
  typeHasNodesQuery,
  typeHasRulesQuery,
  updateTypeQuery,
  incompatibleChildTypesQuery,
  lockTenantQuery,
  nodeQuery,
  ruleExistsQuery,
  setNodeTypeQuery,
  typeQuery,
  updateNodeFieldsQuery,
} from '../queries.ts'

// org as an Effect layer, starting with the retype path.
//
// This method was ported first on purpose: it is the only one that touches all
// three plugins inside one locked transaction, so if the ambient transaction
// did not carry across a cross-plugin call the failure would be a pool
// deadlock rather than a wrong answer. A loud failure is worth more than a
// quiet one when the mechanism is new.
//
// The shape it preserves: take the tenant lock first, re-decide authorization
// on the locked connection, then ask each peer about the state this
// transaction is about to commit. The router's pre-check ran before the lock
// and a concurrent move can re-anchor the target in between, so the in-lock
// check is a second decision rather than a repeat of the first.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

/** the columns NODE_COLUMNS selects, as they come out of the database */
interface NodeRow extends Record<string, unknown> {
  id: string
  parent_id: string | null
  org_type_id: string
  code: string | null
  name: string
  path: string
  depth: number
  sort_order: number
}

/** a node as a caller sees it, with what they may do to it */
export type NodeRowPublic = {
  id: string
  parent_id: string | null
  org_type_id: string
  code: string | null
  name: string
  path: string
  depth: number
  sort_order: number
}

export interface NodeView {
  id: string
  parent_id: string | null
  org_type_id: string
  code: string | null
  name: string
  path: string
  depth: number
  sort_order: number
  manageable: boolean
  subtreeManageable: boolean
}

export interface TypeRow extends Record<string, unknown> {
  id: string
  code: string
  name: string
  sort_order: number
}

export interface RuleRow extends Record<string, unknown> {
  parent_type_id: string
  child_type_id: string
}

export class Org extends Context.Service<
  Org,
  {
    readonly changeNodeType: (
      tenantId: string,
      nodeId: string,
      newTypeId: string,
      as: Principal,
    ) => Effect.Effect<void, ChangeNodeTypeError>
    readonly updateNode: (
      tenantId: string,
      nodeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<void, UpdateNodeError>
    readonly deleteNode: (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) => Effect.Effect<void, DeleteNodeError>

    readonly createNode: (
      tenantId: string,
      input: {
        parentId: string
        orgTypeId: string
        name: string
        code?: string
        sortOrder?: number
      },
      as: Principal,
    ) => Effect.Effect<NodeRowPublic, CreateNodeError>
    readonly moveNode: (
      tenantId: string,
      nodeId: string,
      newParentId: string,
      as: Principal,
      newSortOrder?: number,
    ) => Effect.Effect<void, MoveNodeError>

    readonly readNode: (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) => Effect.Effect<NodeView, NodeNotFound | AccessDenied>
    readonly readForest: (
      tenantId: string,
      nodeId: string | undefined,
      as: Principal,
    ) => Effect.Effect<
      { roots: readonly string[]; nodes: readonly NodeView[] },
      NodeNotFound | AccessDenied
    >

    readonly listTypes: (
      tenantId: string,
      as: Principal,
    ) => Effect.Effect<readonly TypeRow[], AccessDenied>
    readonly createType: (
      tenantId: string,
      input: { code: string; name: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<TypeRow, CreateTypeError>
    readonly updateType: (
      tenantId: string,
      typeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<void, UpdateTypeError>
    readonly deleteType: (
      tenantId: string,
      typeId: string,
      as: Principal,
    ) => Effect.Effect<void, DeleteTypeError>

    readonly listRules: (
      tenantId: string,
      as: Principal,
    ) => Effect.Effect<readonly RuleRow[], AccessDenied>
    readonly putRule: (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) => Effect.Effect<void, PutRuleError>
    readonly deleteRule: (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) => Effect.Effect<void, DeleteRuleError>
  }
>()('@qualy/plugin-org/Org') {}

export const make = Effect.fn('Org.make')(function* () {
  const database = yield* Database
  const rbac = yield* Rbac
  const placement = yield* Placement

  const changeNodeType = Effect.fn('Org.changeNodeType')(function* (
    tenantId: string,
    nodeId: string,
    newTypeId: string,
    as: Principal,
  ) {
    // the transaction itself can fail on BEGIN or COMMIT. That is the pool
    // being unreachable rather than a decision this caller makes, so it dies
    // as a 500 instead of joining the failures a handler chooses between
    return yield* database.transaction((tx) =>
      Effect.gen(function* () {
        // first statement, always: it serializes this tenant's structural
        // writes against rbac's and auth's
        yield* tx.execute(lockTenantQuery(tenantId))

        const node = rows<NodeRow>(
          yield* tx.execute(nodeQuery(tenantId, nodeId)),
        )[0]
        if (!node) return yield* new NodeNotFound()

        // re-decided under the lock rather than trusted from the router: a
        // concurrent move can have re-anchored the target since that check
        yield* rbac.requireAt(as, 'org.tree.manage', nodeId)

        if (node.org_type_id === newTypeId) return
        const type = rows<{ id: string }>(
          yield* tx.execute(typeQuery(tenantId, newTypeId)),
        )[0]
        if (!type) return yield* new TypeNotFound()

        if (node.parent_id) {
          const parent = rows<NodeRow>(
            yield* tx.execute(nodeQuery(tenantId, node.parent_id)),
          )[0]!
          const allowed = rows(
            yield* tx
              .execute(ruleExistsQuery(tenantId, parent.org_type_id, newTypeId))
              ,
          )
          if (allowed.length === 0) {
            return yield* new RuleViolation({
              reason: 'the new type is not allowed under the parent type',
            })
          }
        }

        const incompatible = rows(
          yield* tx
            .execute(incompatibleChildTypesQuery(tenantId, nodeId, newTypeId))
            ,
        )
        if (incompatible.length > 0) {
          return yield* new RuleViolation({
            reason: 'existing children are incompatible with the new type',
          })
        }

        // both peers run on this transaction's connection because the
        // connection is in the fiber. Under cordis each took the caller's
        // handle as an argument, and forgetting it meant reading committed
        // state instead of what this transaction is about to commit.
        const blocking = yield* rbac.grantsBlockingOrgType(tenantId, nodeId, newTypeId)
        if (blocking.length > 0) {
          return yield* new AssignmentIncompatible({ assignmentCount: blocking.length })
        }

        // and the people standing here, who do not move when the node does
        const stranded = yield* placement.usersBlockingOrgType(tenantId, nodeId, newTypeId)
        if (stranded > 0) return yield* new PlacementBlocked({ userCount: stranded })

        yield* tx.execute(setNodeTypeQuery(tenantId, nodeId, newTypeId))
      }),
    ).pipe(
      translateConstraints(nodeConstraints),
      Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
    )
  })

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]

  // the shape every structural write shares: lock the tenant, find the node,
  // re-decide authorization on the locked connection, then write
  const write = <A, E>(
    tenantId: string,
    nodeId: string,
    as: Principal,
    body: (tx: Tx, node: NodeRow) => Effect.Effect<A, E>,
  ) =>
    // Refuse before taking the lock. The check inside the transaction is the
    // authoritative one, because a concurrent move can re-anchor the target
    // between the two; this one only stops an unauthorized caller from
    // serializing every structural write of the tenant behind them first.
    rbac.requireAt(as, 'org.tree.manage', nodeId).pipe(
      Effect.andThen(
        database.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(lockTenantQuery(tenantId))
            const node = rows<NodeRow>(yield* tx.execute(nodeQuery(tenantId, nodeId)))[0]
            if (!node) return yield* new NodeNotFound()
            // re-decided under the lock: the pre-check ran before it, and the
            // target may have been re-anchored since
            yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
            return yield* body(tx, node)
          }),
        ),
      ),
      translateConstraints(nodeConstraints),
      // both tags: the transaction itself raises SqlError on begin and commit,
      // while a statement inside it arrives wrapped as
      // EffectDrizzleQueryError. Catching only the first leaves the second in
      // the error channel, where nothing declares it.
      Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
    )

  const updateNode = Effect.fn('Org.updateNode')(function* (
    tenantId: string,
    nodeId: string,
    fields: { name?: string; sortOrder?: number },
    as: Principal,
  ) {
    yield* write(tenantId, nodeId, as, (tx) =>
      tx.execute(updateNodeFieldsQuery(tenantId, nodeId, fields)),
    )
  })

  const deleteNode = Effect.fn('Org.deleteNode')(function* (
    tenantId: string,
    nodeId: string,
    as: Principal,
  ) {
    yield* write(tenantId, nodeId, as, (tx, node) =>
      Effect.gen(function* () {
        if (!node.parent_id) return yield* new NodeIsRoot()
        const children = rows(
          yield* tx.execute(hasChildrenQuery(tenantId, nodeId)),
        )
        if (children.length > 0) return yield* new NodeHasChildren()
        // users and assignments still block through their restrict foreign
        // keys. That is not a comment about intent: the write runs under
        // translateConstraints, which turns those constraint names into
        // ORG_NODE_IN_USE rather than letting them become a 500.
        yield* tx.execute(deleteNodeQuery(tenantId, nodeId))
      }),
    )
  })

  // types and rules are tenant-wide, so authority is proved at the root rather
  // than at a node: there is no node for a type to be managed at
  const atRoot = Effect.fn('Org.atRoot')(function* (tenantId: string, as: Principal) {
    const root = rows<NodeRow>(
      yield* database.execute(rootQuery(tenantId)).pipe(Effect.orDie),
    )[0]
    if (!root) return yield* Effect.die(new Error(`tenant ${tenantId} has no root node`))
    yield* rbac.requireAt(as, 'org.tree.manage', root.id)
  })

  const writeAtRoot = <A, E>(
    tenantId: string,
    as: Principal,
    body: (tx: Tx) => Effect.Effect<A, E>,
  ) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          yield* atRoot(tenantId, as)
          return yield* body(tx)
        }),
      )
      .pipe(
        translateConstraints(typeConstraints),
        // both tags: the transaction itself raises SqlError on begin/commit,
        // while a statement inside it arrives wrapped as
        // EffectDrizzleQueryError. Catching only the first leaves the second
        // in the error channel, where nothing declares it.
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )

  // a read: no constraint can fire, so dying here keeps the caller's error
  // type narrow without hiding anything translatable
  const typeOf = (tx: Tx, tenantId: string, typeId: string) =>
    tx.execute(typeQuery(tenantId, typeId)).pipe(
      Effect.orDie,
      Effect.map((result) => rows<TypeRow>(result)[0]),
    )

  // Anchors resolved against node paths, on the caller's connection.
  //
  // An anchor whose node has vanished drops out rather than raising: a grant
  // pointing at a deleted node grants nothing, and failing the whole read
  // because of one stale grant would be worse than fail-closed.
  const resolveScope = Effect.fn('Org.resolveScope')(function* (
    tx: Tx,
    tenantId: string,
    as: Principal,
    code: string,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, code)
    if (scope.tenantWide) return { tenantWide: true, anchors: [] } satisfies ResolvedScope
    if (scope.anchors.length === 0) {
      return { tenantWide: false, anchors: [] } satisfies ResolvedScope
    }
    const found = rows<NodeRow>(
      yield* tx
        .execute(nodesByIdQuery(tenantId, scope.anchors.map((anchor) => anchor.orgNodeId)))
        .pipe(Effect.orDie),
    )
    const byId = new Map(found.map((node) => [node.id, node]))
    return {
      tenantWide: false,
      anchors: scope.anchors.flatMap((anchor) => {
        const node = byId.get(anchor.orgNodeId)
        return node ? [{ id: node.id, path: node.path, coverage: anchor.coverage }] : []
      }),
    } satisfies ResolvedScope
  })

  /** every read projection runs in one snapshot; see readSnapshotQuery */
  const readInSnapshot = <A, E>(body: (tx: Tx) => Effect.Effect<A, E>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(readSnapshotQuery)
          return yield* body(tx)
        }),
      )
      .pipe(
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )

  const withFlags = (node: NodeRow, manageScope: ResolvedScope) => ({
    ...node,
    // manageable covers single-node mutations; a move relocates the whole
    // subtree and needs subtree coverage, so they are separate answers
    manageable: coveredBy(manageScope, node),
    subtreeManageable: subtreeCoveredBy(manageScope, node),
  })

  const createNode = Effect.fn('Org.createNode')(function* (
    tenantId: string,
    input: {
      parentId: string
      orgTypeId: string
      name: string
      code?: string
      sortOrder?: number
    },
    as: Principal,
  ) {
    // authority over the parent, because creating a child mutates the parent
    return yield* write(tenantId, input.parentId, as, (tx, parent) =>
      Effect.gen(function* () {
        const type = rows<TypeRow>(
          yield* tx.execute(typeQuery(tenantId, input.orgTypeId)).pipe(Effect.orDie),
        )[0]
        if (!type) return yield* new TypeNotFound()
        const allowed = rows(
          yield* tx
            .execute(ruleExistsQuery(tenantId, parent.org_type_id, input.orgTypeId))
            .pipe(Effect.orDie),
        )
        if (allowed.length === 0) {
          return yield* new RuleViolation({
            reason: 'parent-child type combination is not allowed by the rules',
          })
        }
        return rows<NodeRow>(
          yield* tx.execute(
            insertNodeQuery({
              tenantId,
              parentId: parent.id,
              parentPath: parent.path,
              parentDepth: parent.depth,
              orgTypeId: input.orgTypeId,
              code: input.code ?? null,
              name: input.name,
              sortOrder: input.sortOrder ?? 0,
            }),
          ),
        )[0]!
      }),
    )
  })

  /**
   * Relocating a node relocates everything beneath it.
   *
   * So this does not use the shared single-node check. The caller's authority
   * has to cover the WHOLE moved subtree, or a bare self anchor would let them
   * drag unmanaged descendants into a region they do manage and silently gain
   * authority over them. Both ends are checked: the subtree being moved, and
   * the parent receiving it.
   */
  const moveNode = Effect.fn('Org.moveNode')(function* (
    tenantId: string,
    nodeId: string,
    newParentId: string,
    as: Principal,
    newSortOrder?: number,
  ) {
    return yield* database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          if (nodeId === newParentId) {
            return yield* new InvalidMove({ reason: 'a node cannot become its own parent' })
          }
          const node = rows<NodeRow>(yield* tx.execute(nodeQuery(tenantId, nodeId)))[0]
          if (!node) return yield* new NodeNotFound()
          if (!node.parent_id) return yield* new NodeIsRoot()
          const newParent = rows<NodeRow>(
            yield* tx.execute(nodeQuery(tenantId, newParentId)),
          )[0]
          if (!newParent) return yield* new NodeNotFound()

          const manageScope = yield* resolveScope(tx, tenantId, as, 'org.tree.manage')
          if (!subtreeCoveredBy(manageScope, node) || !coveredBy(manageScope, newParent)) {
            return yield* new AccessDenied({ reason: 'not allowed to move this subtree' })
          }

          if (newParent.id === node.parent_id) {
            // same parent: a reorder, with no structural change to validate
            if (newSortOrder !== undefined) {
              yield* tx.execute(
                updateNodeFieldsQuery(tenantId, nodeId, { sortOrder: newSortOrder }),
              )
            }
            return
          }
          if (
            newParent.path === node.path ||
            newParent.path.startsWith(`${node.path}.`)
          ) {
            return yield* new InvalidMove({ reason: 'a node cannot move into its own subtree' })
          }
          const allowed = rows(
            yield* tx.execute(
              ruleExistsQuery(tenantId, newParent.org_type_id, node.org_type_id),
            ),
          )
          if (allowed.length === 0) {
            return yield* new RuleViolation({
              reason: 'parent-child type combination is not allowed by the rules',
            })
          }
          const newPath = `${newParent.path}.${node.path.split('.').at(-1)}`
          yield* tx.execute(
            moveSubtreeQuery({
              tenantId,
              nodeId,
              newParentId,
              oldPath: node.path,
              newPath,
              depthDelta: newParent.depth + 1 - node.depth,
            }),
          )
          if (newSortOrder !== undefined) {
            yield* tx.execute(updateNodeFieldsQuery(tenantId, nodeId, { sortOrder: newSortOrder }))
          }
        }),
      )
      .pipe(
        translateConstraints(nodeConstraints),
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )
  })

  return {
    changeNodeType,
    updateNode,
    deleteNode,
    createNode,
    moveNode,

    readNode: Effect.fn('Org.readNode')(function* (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) {
      return yield* readInSnapshot((tx) =>
        Effect.gen(function* () {
          const readScope = yield* resolveScope(tx, tenantId, as, 'org.tree.read')
          const node = rows<NodeRow>(
            yield* tx.execute(nodeQuery(tenantId, nodeId)).pipe(Effect.orDie),
          )[0]
          // not-found and not-covered answer the same on purpose: a caller
          // must not learn that a node they cannot see exists
          if (!node || !coveredBy(readScope, node)) return yield* new NodeNotFound()
          const manageScope = yield* resolveScope(tx, tenantId, as, 'org.tree.manage')
          return withFlags(node, manageScope)
        }),
      )
    }),

    readForest: Effect.fn('Org.readForest')(function* (
      tenantId: string,
      nodeId: string | undefined,
      as: Principal,
    ) {
      return yield* readInSnapshot((tx) =>
        Effect.gen(function* () {
          const readScope = yield* resolveScope(tx, tenantId, as, 'org.tree.read')
          const manageScope = yield* resolveScope(tx, tenantId, as, 'org.tree.manage')
          const subtree = (path: string) =>
            tx
              .execute(subtreeQuery(tenantId, path))
              .pipe(Effect.orDie, Effect.map((r) => rows<NodeRow>(r)))

          let roots: string[] = []
          const nodes = new Map<string, NodeRow>()

          if (nodeId !== undefined) {
            const node = rows<NodeRow>(
              yield* tx.execute(nodeQuery(tenantId, nodeId)).pipe(Effect.orDie),
            )[0]
            if (!node || !coveredBy(readScope, node)) return yield* new NodeNotFound()
            roots = [node.id]
            // the incident this guards: only a subtree anchor yields the
            // subtree. A self anchor yields the one node it names.
            const slice = subtreeCoveredBy(readScope, node) ? yield* subtree(node.path) : [node]
            for (const each of slice) nodes.set(each.id, each)
          } else if (readScope.tenantWide) {
            const root = rows<NodeRow>(
              yield* tx.execute(rootQuery(tenantId)).pipe(Effect.orDie),
            )[0]
            if (root) {
              roots = [root.id]
              for (const each of yield* subtree(root.path)) nodes.set(each.id, each)
            }
          } else {
            const shape = forestShape(readScope)
            for (const anchor of shape.subtrees) {
              for (const each of yield* subtree(anchor.path)) nodes.set(each.id, each)
            }
            for (const anchor of shape.selves) {
              const node = rows<NodeRow>(
                yield* tx.execute(nodeQuery(tenantId, anchor.id)).pipe(Effect.orDie),
              )[0]
              if (node) nodes.set(node.id, node)
            }
            roots = forestRoots(shape, (id) => nodes.has(id))
          }

          return {
            roots,
            nodes: [...nodes.values()]
              .sort(byPath)
              .map((node) => withFlags(node, manageScope)),
          }
        }),
      )
    }),

    // type and rule metadata is tenant-global, so reading it needs the
    // permission held anywhere in the tenant rather than at a specific node
    listTypes: Effect.fn('Org.listTypes')(function* (tenantId: string, as: Principal) {
      if (!(yield* rbac.hasPermission(as, 'org.tree.read'))) {
        return yield* new AccessDenied({ reason: 'cannot read the organization' })
      }
      return rows<TypeRow>(
        yield* database.execute(listTypesQuery(tenantId)).pipe(Effect.orDie),
      )
    }),
    createType: Effect.fn('Org.createType')(function* (
      tenantId: string,
      input: { code: string; name: string; sortOrder?: number },
      as: Principal,
    ) {
      return yield* writeAtRoot(tenantId, as, (tx) =>
        tx
          .execute(
            insertTypeQuery({
              tenantId,
              code: input.code,
              name: input.name,
              sortOrder: input.sortOrder ?? 0,
            }),
          )
          .pipe(Effect.map((result) => rows<TypeRow>(result)[0]!)),
      )
    }),
    updateType: Effect.fn('Org.updateType')(function* (
      tenantId: string,
      typeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, (tx) =>
        Effect.gen(function* () {
          if (!(yield* typeOf(tx, tenantId, typeId))) return yield* new TypeNotFound()
          yield* tx.execute(updateTypeQuery(tenantId, typeId, fields))
        }),
      )
    }),
    deleteType: Effect.fn('Org.deleteType')(function* (
      tenantId: string,
      typeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, (tx) =>
        Effect.gen(function* () {
          if (!(yield* typeOf(tx, tenantId, typeId))) return yield* new TypeNotFound()
          const used = rows(yield* tx.execute(typeHasNodesQuery(tenantId, typeId)))
          if (used.length > 0) return yield* new TypeInUse({ reason: 'nodes still use this org type' })
          const ruled = rows(yield* tx.execute(typeHasRulesQuery(tenantId, typeId)))
          if (ruled.length > 0) {
            return yield* new TypeInUse({ reason: 'rules still reference this org type' })
          }
          yield* tx.execute(deleteTypeQuery(tenantId, typeId))
        }),
      )
    }),

    listRules: Effect.fn('Org.listRules')(function* (tenantId: string, as: Principal) {
      if (!(yield* rbac.hasPermission(as, 'org.tree.read'))) {
        return yield* new AccessDenied({ reason: 'cannot read the organization' })
      }
      return rows<RuleRow>(
        yield* database.execute(listRulesQuery(tenantId)).pipe(Effect.orDie),
      )
    }),
    // idempotent by design: the pair identifies the rule, so repeating the
    // request converges on the same state instead of reporting a conflict
    putRule: Effect.fn('Org.putRule')(function* (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, (tx) =>
        Effect.gen(function* () {
          if (parentTypeId === childTypeId) return yield* new RuleInvalid()
          const existing = rows(
            yield* tx.execute(ruleExistsQuery(tenantId, parentTypeId, childTypeId)),
          )
          if (existing.length > 0) return
          const counted = rows<{ count: string }>(
            yield* tx.execute(countTypesQuery(tenantId, [parentTypeId, childTypeId])),
          )
          if (Number(counted[0]?.count ?? 0) !== 2) return yield* new TypeNotFound()
          const cycles = rows(
            yield* tx.execute(ruleWouldCycleQuery(tenantId, parentTypeId, childTypeId)),
          )
          if (cycles.length > 0) return yield* new RuleCycle()
          yield* tx.execute(insertRuleQuery({ tenantId, parentTypeId, childTypeId }))
        }),
      )
    }),
    deleteRule: Effect.fn('Org.deleteRule')(function* (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, (tx) =>
        Effect.gen(function* () {
          const existing = rows(
            yield* tx.execute(ruleExistsQuery(tenantId, parentTypeId, childTypeId)),
          )
          if (existing.length === 0) return yield* new RuleNotFound()
          const used = rows(
            yield* tx.execute(ruleInUseQuery(tenantId, parentTypeId, childTypeId)),
          )
          if (used.length > 0) return yield* new RuleInUse()
          yield* tx.execute(deleteRuleQuery(tenantId, parentTypeId, childTypeId))
        }),
      )
    }),
  }
})

/**
 * What this plugin contributes.
 *
 * It requires both peers and provides nothing to them, which is the direction
 * that keeps the graph acyclic.
 */
export const layer: Layer.Layer<Org, never, Database | Rbac | Placement> = Layer.effect(
  Org,
  make(),
)

// --- api ---

// Rows leave the database in snake_case; the contract describes camelCase.
// Mapping at the boundary rather than renaming the columns keeps the SQL
// readable and keeps both runtimes describing a record the same way.
const toTypeDto = (row: TypeRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  sortOrder: row.sort_order,
})

const toNodeDto = (node: NodeView) => ({
  id: node.id,
  parentId: node.parent_id,
  orgTypeId: node.org_type_id,
  code: node.code,
  name: node.name,
  path: node.path,
  depth: node.depth,
  sortOrder: node.sort_order,
  manageable: node.manageable,
  subtreeManageable: node.subtreeManageable,
})

const toRuleDto = (row: RuleRow) => ({
  parentTypeId: row.parent_type_id,
  childTypeId: row.child_type_id,
})

// The local API exists so this plugin implements its group without importing
// the aggregate that contains it; see QUALY_API_ID. It carries the same prefix
// as the aggregate, because routes are built from this one and the document
// from that one.
const local = HttpApi.make(QUALY_API_ID).add(orgApiGroup).prefix(QUALY_API_PREFIX)

export const orgApiHandlers = HttpApiBuilder.group(local, 'org', (handlers) =>
  handlers.handle(
    'changeNodeType',
    Effect.fn('org.changeNodeType.handler')(function* ({ params, payload }) {
      const org = yield* Org
      // the tenant comes from the session, never from the request: a caller
      // must not be able to name the tenant they are acting on
      const principal = yield* CurrentUser
      yield* org.changeNodeType(principal.tenantId, params.nodeId, payload.orgTypeId, principal)
      return { ok: true as const }
    }),
  )
    .handle(
      'updateNode',
      Effect.fn('org.updateNode.handler')(function* ({ params, payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.updateNode(principal.tenantId, params.nodeId, payload, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'deleteNode',
      Effect.fn('org.deleteNode.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.deleteNode(principal.tenantId, params.nodeId, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'createNode',
      Effect.fn('org.createNode.handler')(function* ({ payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        const node = yield* org.createNode(principal.tenantId, payload, principal)
        // a freshly created node is manageable by whoever could create it
        return { node: toNodeDto({ ...node, manageable: true, subtreeManageable: true }) }
      }),
    )
    .handle(
      'setNodePlacement',
      Effect.fn('org.setNodePlacement.handler')(function* ({ params, payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.moveNode(
          principal.tenantId,
          params.nodeId,
          payload.parentId,
          principal,
          payload.sortOrder,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'getTree',
      Effect.fn('org.getTree.handler')(function* ({ query }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        const forest = yield* org.readForest(principal.tenantId, query.nodeId, principal)
        return { roots: forest.roots, nodes: forest.nodes.map(toNodeDto) }
      }),
    )
    .handle(
      'getNode',
      Effect.fn('org.getNode.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        return { node: toNodeDto(yield* org.readNode(principal.tenantId, params.nodeId, principal)) }
      }),
    )
    .handle(
      'listTypes',
      Effect.fn('org.listTypes.handler')(function* () {
        const org = yield* Org
        const principal = yield* CurrentUser
        const types = yield* org.listTypes(principal.tenantId, principal)
        return { types: types.map(toTypeDto) }
      }),
    )
    .handle(
      'createType',
      Effect.fn('org.createType.handler')(function* ({ payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        return { type: toTypeDto(yield* org.createType(principal.tenantId, payload, principal)) }
      }),
    )
    .handle(
      'updateType',
      Effect.fn('org.updateType.handler')(function* ({ params, payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.updateType(principal.tenantId, params.typeId, payload, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'deleteType',
      Effect.fn('org.deleteType.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.deleteType(principal.tenantId, params.typeId, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'listRules',
      Effect.fn('org.listRules.handler')(function* () {
        const org = yield* Org
        const principal = yield* CurrentUser
        const rules = yield* org.listRules(principal.tenantId, principal)
        return { rules: rules.map(toRuleDto) }
      }),
    )
    .handle(
      'putRule',
      Effect.fn('org.putRule.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.putRule(
          principal.tenantId,
          params.parentTypeId,
          params.childTypeId,
          principal,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'deleteRule',
      Effect.fn('org.deleteRule.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.deleteRule(
          principal.tenantId,
          params.parentTypeId,
          params.childTypeId,
          principal,
        )
        return { ok: true as const }
      }),
    ),
)
