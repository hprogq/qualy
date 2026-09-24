import { NodeUsageCatalog } from '@qualy/org-contract/plugin'
import { Context, Effect, Layer } from 'effect'
import { OrgNodeRefused, OrgProvisioning } from '@qualy/org-contract/effect'
import type { OrgNodeRef } from '@qualy/org-contract'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { CurrentUser } from './session-port.ts'
import { orgApiGroup } from '../api.ts'
import { Placement } from '@qualy/auth-contract'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import {
  countTypes,
  deleteRule,
  deleteType,
  insertRule,
  insertType,
  deleteNode as deleteNodeRow,
  deletedNodes,
  purgeNode,
  oneDeletedNode,
  restoreNode as restoreNodeRow,
  countChildren,
  hasChildren,
  incompatibleChildTypes,
  insertNode,
  listRules,
  listTypes,
  lockTenant,
  moveSubtree,
  nodesById,
  childNamed,
  oneNode,
  oneType,
  readSnapshot,
  rootNode,
  setNodeType,
  subtree,
  updateNodeFields,
  ruleExists,
  ruleInUse,
  ruleWouldCycle,
  typeHasLiveNodes,
  typeHasNodes,
  typeHasRules,
  updateType,
} from './db.ts'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import {
  AssignmentIncompatible,
  NodeNotFound,
  NodeParentDeleted,
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
  NodeInUse,
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
  type RestoreNodeError,
  type UpdateNodeError,
} from './errors.ts'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import type { AuditActor } from '@qualy/audit-contract'
import {
  NodeCreated,
  NodeDeleted,
  NodeRestored,
  NodeMoved,
  NodeRetyped,
  NodeUpdated,
  RuleDeleted,
  RulePut,
  TypeCreated,
  TypeDeleted,
  TypeUpdated,
} from '../actions.ts'
import { failedWith, translateConstraints } from '@qualy/plugin-database/server/constraints'
import {
  byPath,
  coveredBy,
  forestRoots,
  forestShape,
  subtreeCoveredBy,
  type ResolvedScope,
} from '../coverage.ts'

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

/** the columns NODE_COLUMNS selects, as they come out of the database */
interface NodeRow {
  id: string
  parentId: string | null
  orgTypeId: string
  name: string
  path: string
  depth: number
  sortOrder: number
}

/** a node as a caller sees it, with what they may do to it */
export type NodeRowPublic = {
  id: string
  parentId: string | null
  orgTypeId: string
  name: string
  path: string
  depth: number
  sortOrder: number
}

export interface NodeView {
  id: string
  parentId: string | null
  orgTypeId: string
  name: string
  path: string
  depth: number
  sortOrder: number
  manageable: boolean
  subtreeManageable: boolean
  /** whether the answer carries what is under this node, or only the node */
  subtreeVisible: boolean
}

export interface TypeRow {
  id: string
  name: string
  sortOrder: number
}

export interface RuleRow {
  parentTypeId: string
  childTypeId: string
}

export class Org extends Context.Service<
  Org,
  {
    /** the bulk door; also provided on its own tag for the plugins that only need it */
    readonly provisioning: OrgProvisioning['Service']
    readonly changeNodeType: (
      tenantId: string,
      nodeId: string,
      newTypeId: string,
      as: Principal,
    ) => Effect.Effect<NodeView, ChangeNodeTypeError>
    readonly updateNode: (
      tenantId: string,
      nodeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<NodeView, UpdateNodeError>
    readonly deleteNode: (
      tenantId: string,
      nodeId: string,
      as: Principal,
      /**
       * Whether anything still stands on the unit - people, grants in force,
       * a round under way. The row is kept, so no foreign key answers this
       * any more; the plugins that own those things do, and org cannot see
       * them, so whoever calls says how to ask. Required on purpose: a
       * caller that forgot would take a unit away from under the people at it.
       */
      held: Effect.Effect<boolean>,
    ) => Effect.Effect<void, DeleteNodeError>
    /** the units taken out of the structure; the tenant's to read, at the root */
    readonly listDeletedNodes: (
      tenantId: string,
      as: Principal,
    ) => Effect.Effect<
      readonly {
        id: string
        name: string
        orgTypeId: string
        parentName: string | null
        restorable: boolean
        deletedAt: Date
      }[],
      AccessDenied
    >
    readonly restoreNode: (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) => Effect.Effect<void, RestoreNodeError>

    readonly createNode: (
      tenantId: string,
      input: {
        parentId: string
        orgTypeId: string
        name: string
        sortOrder?: number
      },
      as: Principal,
    ) => Effect.Effect<NodeView, CreateNodeError>
    readonly moveNode: (
      tenantId: string,
      nodeId: string,
      newParentId: string,
      as: Principal,
      newSortOrder?: number,
    ) => Effect.Effect<NodeView, MoveNodeError>

    readonly childCount: (tenantId: string, nodeId: string) => Effect.Effect<number>
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
      input: { name: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<TypeRow, CreateTypeError>
    readonly updateType: (
      tenantId: string,
      typeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) => Effect.Effect<TypeRow, UpdateTypeError>
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

/** who acted; org's closure cannot see users, so the trail's read side names them */
const actorOf = (as: Principal): AuditActor => ({ kind: 'user', userId: as.userId })

export const make = Effect.fn('Org.make')(function* () {
  // a read opens no transaction, so it has nothing to take a database from;
  // supplying it here keeps the requirement off everybody who calls
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const placement = yield* Placement
  const audit = yield* Audit

  const changeNodeType = Effect.fn('Org.changeNodeType')(function* (
    tenantId: string,
    nodeId: string,
    newTypeId: string,
    as: Principal,
  ) {
    // the transaction itself can fail on BEGIN or COMMIT. That is the pool
    // being unreachable rather than a decision this caller makes, so it dies
    // as a 500 instead of joining the failures a handler chooses between
    // Refuse before taking the lock, the way the field writes already do:
    // the check inside is the authoritative one, and this one only stops an
    // unauthorized caller from serializing every structural write of the
    // tenant behind them - and from learning whether a node exists by which
    // refusal comes back.
    yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          // first statement, always: it serializes this tenant's structural
          // writes against rbac's and auth's
          yield* lockTenant(tenantId)

          const node = yield* oneNode(tenantId, nodeId)
          if (!node) return yield* new NodeNotFound()
          // The root keeps its type for life. Its specialness lives in the
          // structure - parent is null - not in a name or a marker, and the
          // type it stands on is how "the tenant's root type" is found at
          // all: re-typing it would cut the one thread that identifies it.
          if (node.parentId === null) return yield* new NodeIsRoot()

          // re-decided under the lock rather than trusted from the router: a
          // concurrent move can have re-anchored the target since that check
          yield* rbac.requireAt(as, 'org.tree.manage', nodeId)

          if (node.orgTypeId === newTypeId) return yield* writtenNode(tenantId, nodeId, as)
          const type = yield* oneType(tenantId, newTypeId)
          if (!type) return yield* new TypeNotFound()

          if (node.parentId) {
            const parent = (yield* oneNode(tenantId, node.parentId))!
            if (!(yield* ruleExists(tenantId, parent.orgTypeId, newTypeId))) {
              return yield* new RuleViolation({
                reason: 'the new type is not allowed under the parent type',
              })
            }
          }

          const incompatible = yield* incompatibleChildTypes(tenantId, nodeId, newTypeId)
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

          yield* setNodeType(tenantId, nodeId, newTypeId)
          yield* audit.record(NodeRetyped, {
            tenantId,
            actor: actorOf(as),
            target: { id: node.id, label: node.name },
            organizationId: node.id,
            details: { fromOrgTypeId: node.orgTypeId, toOrgTypeId: newTypeId },
          })
          return yield* writtenNode(tenantId, nodeId, as)
        }),
      ),
    ).pipe(
      translateConstraints(nodeConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )
  })

  /**
   * What postgres says when a row is still pointed at.
   *
   * Two codes, not one: a RESTRICT foreign key raises 23001 and a NO ACTION
   * one raises 23503, and which of them a plugin above this chose is not
   * something this plugin should have to know.
   */
  const STILL_REFERENCED = ['23001', '23503']

  // the shape every structural write shares: lock the tenant, find the node,
  // re-decide authorization on the locked connection, then write
  const write = <A, E, R>(
    tenantId: string,
    nodeId: string,
    as: Principal,
    body: (node: NodeRow) => Effect.Effect<A, E, R>,
  ) =>
    // Refuse before taking the lock. The check inside the transaction is the
    // authoritative one, because a concurrent move can re-anchor the target
    // between the two; this one only stops an unauthorized caller from
    // serializing every structural write of the tenant behind them first.
    rbac.requireAt(as, 'org.tree.manage', nodeId).pipe(
      Effect.andThen(
        withDb(
          transaction(
            Effect.gen(function* () {
              yield* lockTenant(tenantId)
              const node = yield* oneNode(tenantId, nodeId)
              if (!node) return yield* new NodeNotFound()
              // re-decided under the lock: the pre-check ran before it, and the
              // target may have been re-anchored since
              yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
              return yield* body(node)
            }),
          ),
        ),
      ),
      translateConstraints(nodeConstraints),
      // a statement that fails for a reason no constraint names is nobody's
      // decision, so it leaves the error channel here rather than widening
      // every caller's error type
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )

  const updateNode = Effect.fn('Org.updateNode')(function* (
    tenantId: string,
    nodeId: string,
    fields: { name?: string; sortOrder?: number },
    as: Principal,
  ) {
    return yield* write(tenantId, nodeId, as, (node) =>
      Effect.gen(function* () {
        yield* updateNodeFields(tenantId, nodeId, fields)
        yield* audit.record(NodeUpdated, {
          tenantId,
          actor: actorOf(as),
          target: { id: node.id, label: fields.name ?? node.name },
          organizationId: node.id,
          details: {
            fields: (['name', 'sortOrder'] as const).filter((field) => fields[field] !== undefined),
          },
        })
        return yield* writtenNode(tenantId, nodeId, as)
      }),
    )
  })

  const deleteNode = Effect.fn('Org.deleteNode')(function* (
    tenantId: string,
    nodeId: string,
    as: Principal,
    held: Effect.Effect<boolean>,
  ) {
    // asked before the lock is taken: the answer comes from other plugins'
    // own connections, and the tenant lock is not held across those
    yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
    if (yield* held) return yield* new NodeInUse()
    yield* write(tenantId, nodeId, as, (node) =>
      Effect.gen(function* () {
        if (!node.parentId) return yield* new NodeIsRoot()
        const children = yield* hasChildren(tenantId, nodeId)
        if (children) return yield* new NodeHasChildren()
        // Taken out of the structure, not dropped: whoever still stands here
        // or holds a grant here is asked about before this is called, and
        // what merely remembers the unit keeps a row to remember.
        yield* deleteNodeRow(tenantId, nodeId)
        yield* audit.record(NodeDeleted, {
          tenantId,
          actor: actorOf(as),
          target: { id: node.id, label: node.name },
          details: {},
        })
      }),
    )
  })

  /**
   * Undoes the creation of a unit nothing has used: the row is dropped, not
   * binned - there is nothing to remember and nothing to put back.
   */
  const purgeUnused = Effect.fn('Org.purgeUnused')(function* (
    tenantId: string,
    nodeId: string,
    as: Principal,
  ) {
    yield* write(tenantId, nodeId, as, (node) =>
      Effect.gen(function* () {
        if (!node.parentId) return yield* new NodeIsRoot()
        if (yield* hasChildren(tenantId, nodeId)) return yield* new NodeHasChildren()
        yield* purgeNode(tenantId, nodeId)
        yield* audit.record(NodeDeleted, {
          tenantId,
          actor: actorOf(as),
          target: { id: node.id, label: node.name },
          details: {},
        })
      }),
    ).pipe(
      // Any foreign key, not only the ones this plugin can name.
      //
      // A named map cannot keep up: a plugin above this one may point at a
      // node (a round's management boundary does), and org must not learn
      // that plugin's constraint names to answer for it - the dependency
      // runs the other way. Deleting a node is the one place where every
      // reference means the same thing to a reader, so the sqlstate itself
      // is the answer: something is still using it.
      //
      // The whole cause, not the failure: an unnamed constraint has already
      // become a defect by the time it gets here, which is exactly the 500
      // this is here to prevent.
      Effect.catchCause((cause) =>
        STILL_REFERENCED.some((sqlstate) => failedWith(cause, sqlstate))
          ? new NodeInUse()
          : Effect.failCause(cause),
      ),
    )
  })

  // types and rules are tenant-wide, so authority is proved at the root rather
  // than at a node: there is no node for a type to be managed at
  const atRoot = Effect.fn('Org.atRoot')(function* (tenantId: string, as: Principal) {
    const root = yield* rootNode(tenantId).pipe(Effect.orDie)
    if (!root) return yield* Effect.die(new Error(`tenant ${tenantId} has no root node`))
    yield* rbac.requireAt(as, 'org.tree.manage', root.id)
  })

  const writeAtRoot = <A, E, R>(
    tenantId: string,
    as: Principal,
    body: () => Effect.Effect<A, E, R>,
  ) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          yield* atRoot(tenantId, as)
          return yield* body()
        }),
      ),
    ).pipe(
      translateConstraints(typeConstraints),
      // a statement that fails for a reason no constraint names is nobody's
      // decision, so it leaves the error channel here rather than widening
      // every caller's error type
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )

  const listDeletedNodes = Effect.fn('Org.listDeletedNodes')(function* (
    tenantId: string,
    as: Principal,
  ) {
    const rows = yield* withDb(
      Effect.gen(function* () {
        yield* atRoot(tenantId, as)
        return yield* deletedNodes(tenantId).pipe(Effect.orDie)
      }),
    )
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      orgTypeId: row.orgTypeId,
      parentName: row.parentName,
      restorable: row.parentDeletedAt === null,
      deletedAt: new Date(row.deletedAt!),
    }))
  })

  /**
   * Puts a unit back where it stood.
   *
   * The structure may have moved on while it was away, so what a new unit is
   * asked is asked again: the unit it stood under is still standing, and the
   * kinds still fit. Whether somebody has taken its name is the index's to
   * decide - the partial unique index counts it again the moment it is back.
   */
  const restoreNode = Effect.fn('Org.restoreNode')(function* (
    tenantId: string,
    nodeId: string,
    as: Principal,
  ) {
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          const gone = yield* oneDeletedNode(tenantId, nodeId)
          if (!gone || gone.parentId === null) return yield* new NodeNotFound()
          const parent = yield* oneNode(tenantId, gone.parentId)
          if (!parent) return yield* new NodeParentDeleted()
          yield* rbac.requireAt(as, 'org.tree.manage', parent.id)
          if (!(yield* ruleExists(tenantId, parent.orgTypeId, gone.orgTypeId))) {
            return yield* new RuleViolation({
              reason: 'parent-child type combination is no longer allowed by the rules',
            })
          }
          yield* restoreNodeRow(tenantId, nodeId)
          yield* audit.record(NodeRestored, {
            tenantId,
            actor: actorOf(as),
            target: { id: gone.id, label: gone.name },
            organizationId: gone.id,
            details: {},
          })
        }),
      ),
    ).pipe(
      translateConstraints(nodeConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )
  })

  // a read: no constraint can fire, so dying here keeps the caller's error
  // type narrow without hiding anything translatable
  const typeOf = (tenantId: string, typeId: string) => oneType(tenantId, typeId).pipe(Effect.orDie)

  // Anchors resolved against node paths, on the caller's connection.
  //
  // An anchor whose node has vanished drops out rather than raising: a grant
  // pointing at a deleted node grants nothing, and failing the whole read
  // because of one stale grant would be worse than fail-closed.
  const resolveScope = Effect.fn('Org.resolveScope')(function* (
    tenantId: string,
    as: Principal,
    code: string,
  ) {
    // Every method here takes a tenant and a principal, and the rows come from
    // the argument while the authority comes from the principal. Those must be
    // the same tenant or the two halves of one decision are about different
    // places: a tenant-wide administrator of A passed B's id read B's tree.
    //
    // The api never gets this wrong - the handlers pass principal.tenantId -
    // so this is a defect rather than a refusal: nothing a caller can send
    // produces it, and answering "not found" would hide a wiring mistake.
    if (tenantId !== as.tenantId) {
      return yield* Effect.die(
        new Error(
          `org was asked about tenant ${tenantId} by a principal of ${as.tenantId}; ` +
            'the tenant must come from the principal',
        ),
      )
    }
    const scope = yield* rbac.listAuthorizedScope(as, code)
    if (scope.tenantWide) return { tenantWide: true, anchors: [] } satisfies ResolvedScope
    if (scope.anchors.length === 0) {
      return { tenantWide: false, anchors: [] } satisfies ResolvedScope
    }
    const found = yield* nodesById(
      tenantId,
      scope.anchors.map((anchor) => anchor.orgNodeId),
    ).pipe(Effect.orDie)
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
  const readInSnapshot = <A, E, R>(body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* readSnapshot
          return yield* body()
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

  const withFlags = (node: NodeRow, manageScope: ResolvedScope, readScope: ResolvedScope) => ({
    ...node,
    // manageable covers single-node mutations; a move relocates the whole
    // subtree and needs subtree coverage, so they are separate answers
    manageable: coveredBy(manageScope, node),
    subtreeManageable: subtreeCoveredBy(manageScope, node),
    // Whether the answer carries what is UNDER this node, or only the node
    // itself: a self anchor yields the one node it names, and a reader
    // cannot tell that from a unit that genuinely holds nothing. Saying so
    // is what lets a screen keep an emptiness it cannot see from reading as
    // one it can.
    subtreeVisible: subtreeCoveredBy(readScope, node),
  })

  /**
   * The row a write leaves behind, read on the writing connection.
   *
   * Not through readNode: that resolves org.tree.read, which is a separate
   * catalog entry from the org.tree.manage the write proved. A caller holding
   * manage alone used to receive ORG_NODE_NOT_FOUND for a rename that had
   * already committed - a response contradicting durable state. Reading it
   * here also keeps the answer inside the tenant lock, so it describes what
   * this transaction wrote rather than what the next one did.
   */
  const writtenNode = Effect.fn('Org.writtenNode')(function* (
    tenantId: string,
    nodeId: string,
    as: Principal,
  ) {
    // the row exists: this runs under the lock the write took, after the write
    const node = (yield* oneNode(tenantId, nodeId).pipe(Effect.orDie))!
    return withFlags(
      node,
      yield* resolveScope(tenantId, as, 'org.tree.manage'),
      yield* resolveScope(tenantId, as, 'org.tree.read'),
    )
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
    return yield* write(tenantId, input.parentId, as, (parent) =>
      Effect.gen(function* () {
        const type = yield* oneType(tenantId, input.orgTypeId).pipe(Effect.orDie)
        if (!type) return yield* new TypeNotFound()
        const allowed = yield* ruleExists(tenantId, parent.orgTypeId, input.orgTypeId).pipe(
          Effect.orDie,
        )
        if (!allowed) {
          return yield* new RuleViolation({
            reason: 'parent-child type combination is not allowed by the rules',
          })
        }
        const created = yield* insertNode({
          tenantId,
          parentId: parent.id,
          parentPath: parent.path,
          parentDepth: parent.depth,
          orgTypeId: input.orgTypeId,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
        })
        yield* audit.record(NodeCreated, {
          tenantId,
          actor: actorOf(as),
          target: { id: created.id, label: input.name },
          organizationId: created.id,
          details: { parentId: parent.id, orgTypeId: input.orgTypeId },
        })
        // What the creator may do with what they just made, asked rather
        // than assumed. Authority over the PARENT is what let them create
        // it, and a self anchor covers exactly the parent - so the answer
        // is often no, and the screen used to offer a rename and a move
        // that the next request refuses.
        return yield* writtenNode(tenantId, created.id, as)
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
    // as above: refused before the lock, re-decided under it. A move is
    // judged against both ends, and the one the caller is moving is the one
    // they must already be able to reach to be asking at all.
    yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          if (nodeId === newParentId) {
            return yield* new InvalidMove({ reason: 'a node cannot become its own parent' })
          }
          const node = yield* oneNode(tenantId, nodeId)
          if (!node) return yield* new NodeNotFound()
          if (!node.parentId) return yield* new NodeIsRoot()
          const newParent = yield* oneNode(tenantId, newParentId)
          if (!newParent) return yield* new NodeNotFound()

          const manageScope = yield* resolveScope(tenantId, as, 'org.tree.manage')
          if (!subtreeCoveredBy(manageScope, node) || !coveredBy(manageScope, newParent)) {
            return yield* new AccessDenied({ reason: 'not allowed to move this subtree' })
          }

          if (newParent.id === node.parentId) {
            // same parent: a reorder, with no structural change to validate
            if (newSortOrder !== undefined) {
              yield* updateNodeFields(tenantId, nodeId, { sortOrder: newSortOrder })
              yield* audit.record(NodeUpdated, {
                tenantId,
                actor: actorOf(as),
                target: { id: node.id, label: node.name },
                organizationId: node.id,
                details: { fields: ['sortOrder'] },
              })
            }
            return yield* writtenNode(tenantId, nodeId, as)
          }
          if (newParent.path === node.path || newParent.path.startsWith(`${node.path}.`)) {
            return yield* new InvalidMove({ reason: 'a node cannot move into its own subtree' })
          }
          if (!(yield* ruleExists(tenantId, newParent.orgTypeId, node.orgTypeId))) {
            return yield* new RuleViolation({
              reason: 'parent-child type combination is not allowed by the rules',
            })
          }
          const newPath = `${newParent.path}.${node.path.split('.').at(-1)}`
          yield* moveSubtree({
            tenantId,
            nodeId,
            newParentId,
            oldPath: node.path,
            newPath,
            depthDelta: newParent.depth + 1 - node.depth,
          })
          if (newSortOrder !== undefined) {
            yield* updateNodeFields(tenantId, nodeId, { sortOrder: newSortOrder })
          }
          yield* audit.record(NodeMoved, {
            tenantId,
            actor: actorOf(as),
            target: { id: node.id, label: node.name },
            organizationId: node.id,
            details: { fromParentId: node.parentId, toParentId: newParent.id },
          })
          return yield* writtenNode(tenantId, nodeId, as)
        }),
      ),
    ).pipe(
      translateConstraints(nodeConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )
  })

  /**
   * The bulk door a directory import materialises units through: reads of
   * the grammar and the tree, one child created on the caller's own
   * transaction under the authority the single creation asks for, and one
   * leaf taken away when nothing uses it.
   */
  const asRef = (node: {
    id: string
    parentId: string | null
    orgTypeId: string
    name: string
    path: string
    depth: number
  }): OrgNodeRef => ({
    id: node.id,
    parentId: node.parentId,
    orgTypeId: node.orgTypeId,
    name: node.name,
    path: node.path,
    depth: node.depth,
  })
  const provisioning: OrgProvisioning['Service'] = {
    rootNode: (tenantId) =>
      withDb(rootNode(tenantId)).pipe(
        Effect.orDie,
        Effect.map((node) => (node ? asRef(node) : null)),
      ),
    nodesById: (tenantId, ids) =>
      withDb(nodesById(tenantId, ids)).pipe(
        Effect.orDie,
        Effect.map((nodes) => nodes.map(asRef)),
      ),
    childNamed: (tenantId, parentId, name) =>
      withDb(childNamed(tenantId, parentId, name)).pipe(
        Effect.orDie,
        Effect.map((node) => (node ? asRef(node) : null)),
      ),
    types: (tenantId) =>
      withDb(listTypes(tenantId)).pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sortOrder })),
        ),
      ),
    rules: (tenantId) =>
      withDb(listRules(tenantId)).pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows.map((row) => ({ parentTypeId: row.parentTypeId, childTypeId: row.childTypeId })),
        ),
      ),
    createChild: (tenantId, input, as) =>
      createNode(tenantId, input, as).pipe(
        Effect.map((node) =>
          asRef({
            id: node.id,
            parentId: node.parentId,
            orgTypeId: node.orgTypeId,
            name: node.name,
            path: node.path,
            depth: node.depth,
          }),
        ),
        Effect.catchTags({
          ORG_NODE_NOT_FOUND: () => new OrgNodeRefused({ reason: 'parent-missing' }),
          ORG_TYPE_NOT_FOUND: () => new OrgNodeRefused({ reason: 'type-missing' }),
          ORG_NODE_RULE_VIOLATION: () => new OrgNodeRefused({ reason: 'rule' }),
          ORG_NODE_CONFLICT: () => new OrgNodeRefused({ reason: 'duplicate' }),
          ORG_NODE_IN_USE: () => new OrgNodeRefused({ reason: 'other' }),
        }),
      ),
    deleteUnused: (tenantId, nodeId, as) =>
      purgeUnused(tenantId, nodeId, as).pipe(
        Effect.map(() => 'deleted' as const),
        Effect.catchTags({
          ORG_NODE_NOT_FOUND: () => Effect.succeed('missing' as const),
          ORG_NODE_HAS_CHILDREN: () => Effect.succeed('has-children' as const),
          ORG_NODE_IN_USE: () => Effect.succeed('in-use' as const),
          ORG_NODE_IS_ROOT: () => Effect.succeed('in-use' as const),
          ORG_NODE_CONFLICT: () => Effect.succeed('in-use' as const),
        }),
      ),
  }

  return {
    provisioning,
    changeNodeType,
    updateNode,
    deleteNode,
    listDeletedNodes,
    restoreNode,
    createNode,
    moveNode,

    /** the true number of units directly under one, for whoever may read it */
    childCount: Effect.fn('Org.childCount')(function* (tenantId: string, nodeId: string) {
      return yield* readInSnapshot(() => countChildren(tenantId, nodeId).pipe(Effect.orDie))
    }),

    readNode: Effect.fn('Org.readNode')(function* (
      tenantId: string,
      nodeId: string,
      as: Principal,
    ) {
      return yield* readInSnapshot(() =>
        Effect.gen(function* () {
          const readScope = yield* resolveScope(tenantId, as, 'org.tree.read')
          const node = yield* oneNode(tenantId, nodeId).pipe(Effect.orDie)
          // not-found and not-covered answer the same on purpose: a caller
          // must not learn that a node they cannot see exists
          if (!node || !coveredBy(readScope, node)) return yield* new NodeNotFound()
          const manageScope = yield* resolveScope(tenantId, as, 'org.tree.manage')
          return withFlags(node, manageScope, readScope)
        }),
      )
    }),

    readForest: Effect.fn('Org.readForest')(function* (
      tenantId: string,
      nodeId: string | undefined,
      as: Principal,
    ) {
      return yield* readInSnapshot(() =>
        Effect.gen(function* () {
          const readScope = yield* resolveScope(tenantId, as, 'org.tree.read')
          const manageScope = yield* resolveScope(tenantId, as, 'org.tree.manage')
          const branch = (path: string) => subtree(tenantId, path).pipe(Effect.orDie)

          let roots: string[] = []
          const nodes = new Map<string, NodeRow>()

          if (nodeId !== undefined) {
            const node = yield* oneNode(tenantId, nodeId).pipe(Effect.orDie)
            // not-found and not-covered are indistinguishable on purpose, and
            // the shared answer is a refusal: a client branching on 403 to
            // re-prompt for authorization must keep doing so
            if (!node || !coveredBy(readScope, node)) {
              return yield* new AccessDenied({ reason: 'not allowed to read this node' })
            }
            roots = [node.id]
            // the incident this guards: only a subtree anchor yields the
            // subtree. A self anchor yields the one node it names.
            const slice = subtreeCoveredBy(readScope, node) ? yield* branch(node.path) : [node]
            for (const each of slice) nodes.set(each.id, each)
          } else if (readScope.tenantWide) {
            const root = yield* rootNode(tenantId).pipe(Effect.orDie)
            if (root) {
              roots = [root.id]
              for (const each of yield* branch(root.path)) nodes.set(each.id, each)
            }
          } else {
            const shape = forestShape(readScope)
            for (const anchor of shape.subtrees) {
              for (const each of yield* branch(anchor.path)) nodes.set(each.id, each)
            }
            for (const anchor of shape.selves) {
              const node = yield* oneNode(tenantId, anchor.id).pipe(Effect.orDie)
              if (node) nodes.set(node.id, node)
            }
            roots = forestRoots(shape, (id) => nodes.has(id))
          }

          return {
            roots,
            nodes: [...nodes.values()]
              .sort(byPath)
              .map((node) => withFlags(node, manageScope, readScope)),
          }
        }),
      )
    }),

    // type and rule metadata is tenant-global, so reading it needs the
    // permission held anywhere in the tenant rather than at a specific node
    listTypes: (tenantId: string, as: Principal) =>
      withDb(
        Effect.gen(function* () {
          if (!(yield* rbac.hasPermission(as, 'org.tree.read'))) {
            return yield* new AccessDenied({ reason: 'cannot read the organization' })
          }
          return yield* listTypes(tenantId).pipe(Effect.orDie)
        }).pipe(Effect.withSpan('Org.listTypes')),
      ),
    createType: Effect.fn('Org.createType')(function* (
      tenantId: string,
      input: { name: string; sortOrder?: number },
      as: Principal,
    ) {
      return yield* writeAtRoot(tenantId, as, () =>
        Effect.gen(function* () {
          const created = yield* insertType({
            tenantId,
            name: input.name,
            sortOrder: input.sortOrder ?? 0,
          })
          yield* audit.record(TypeCreated, {
            tenantId,
            actor: actorOf(as),
            target: { id: created.id, label: input.name },
            details: {},
          })
          return created
        }),
      )
    }),
    updateType: Effect.fn('Org.updateType')(function* (
      tenantId: string,
      typeId: string,
      fields: { name?: string; sortOrder?: number },
      as: Principal,
    ) {
      return yield* writeAtRoot(tenantId, as, () =>
        Effect.gen(function* () {
          if (!(yield* typeOf(tenantId, typeId))) return yield* new TypeNotFound()
          yield* updateType(tenantId, typeId, fields)
          // the row as it now stands, read here rather than by the handler:
          // listTypes asks for org.tree.read, and this write proved manage
          const written = (yield* typeOf(tenantId, typeId))!
          yield* audit.record(TypeUpdated, {
            tenantId,
            actor: actorOf(as),
            target: { id: written.id, label: written.name },
            details: {
              fields: (['name', 'sortOrder'] as const).filter(
                (field) => fields[field] !== undefined,
              ),
            },
          })
          return written
        }),
      )
    }),
    deleteType: Effect.fn('Org.deleteType')(function* (
      tenantId: string,
      typeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, () =>
        Effect.gen(function* () {
          const type = yield* typeOf(tenantId, typeId)
          if (!type) return yield* new TypeNotFound()
          // a unit in the bin holds the kind as surely as one in the tree,
          // and sends the reader somewhere else entirely
          if (yield* typeHasLiveNodes(tenantId, typeId)) {
            return yield* new TypeInUse({ reason: 'nodes' })
          }
          if (yield* typeHasNodes(tenantId, typeId)) {
            return yield* new TypeInUse({ reason: 'deleted-nodes' })
          }
          if (yield* typeHasRules(tenantId, typeId)) {
            return yield* new TypeInUse({ reason: 'rules still reference this org type' })
          }
          yield* deleteType(tenantId, typeId)
          yield* audit.record(TypeDeleted, {
            tenantId,
            actor: actorOf(as),
            target: { id: type.id, label: type.name },
            details: {},
          })
        }),
      )
    }),

    listRules: (tenantId: string, as: Principal) =>
      withDb(
        Effect.gen(function* () {
          if (!(yield* rbac.hasPermission(as, 'org.tree.read'))) {
            return yield* new AccessDenied({ reason: 'cannot read the organization' })
          }
          return yield* listRules(tenantId).pipe(Effect.orDie)
        }).pipe(Effect.withSpan('Org.listRules')),
      ),
    // idempotent by design: the pair identifies the rule, so repeating the
    // request converges on the same state instead of reporting a conflict
    putRule: Effect.fn('Org.putRule')(function* (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, () =>
        Effect.gen(function* () {
          if (parentTypeId === childTypeId) return yield* new RuleInvalid()
          if (yield* ruleExists(tenantId, parentTypeId, childTypeId)) return
          const counted = yield* countTypes(tenantId, [parentTypeId, childTypeId])
          if (counted !== 2) return yield* new TypeNotFound()
          if (yield* ruleWouldCycle(tenantId, parentTypeId, childTypeId)) {
            return yield* new RuleCycle()
          }
          yield* insertRule({ tenantId, parentTypeId, childTypeId })
          yield* audit.record(RulePut, {
            tenantId,
            actor: actorOf(as),
            target: { id: `${parentTypeId}/${childTypeId}` },
            details: { parentTypeId, childTypeId },
          })
        }),
      )
    }),
    deleteRule: Effect.fn('Org.deleteRule')(function* (
      tenantId: string,
      parentTypeId: string,
      childTypeId: string,
      as: Principal,
    ) {
      yield* writeAtRoot(tenantId, as, () =>
        Effect.gen(function* () {
          if (!(yield* ruleExists(tenantId, parentTypeId, childTypeId))) {
            return yield* new RuleNotFound()
          }
          if (yield* ruleInUse(tenantId, parentTypeId, childTypeId)) return yield* new RuleInUse()
          yield* deleteRule(tenantId, parentTypeId, childTypeId)
          yield* audit.record(RuleDeleted, {
            tenantId,
            actor: actorOf(as),
            target: { id: `${parentTypeId}/${childTypeId}` },
            details: { parentTypeId, childTypeId },
          })
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
/** the service alone; the entry composes it with what the plugin registers */
export const serviceLayer: Layer.Layer<
  Org | OrgProvisioning,
  never,
  Orm | Rbac | Placement | Audit
> = Layer.effectContext(
  Effect.gen(function* () {
    const org = yield* make()
    return Context.empty().pipe(
      Context.add(Org, org),
      // the port a directory import materialises units through
      Context.add(OrgProvisioning, org.provisioning),
    )
  }),
)

// --- api ---

// Rows leave the database in snake_case; the contract describes camelCase.
const toTypeDto = (row: TypeRow) => ({
  id: row.id,
  name: row.name,
  sortOrder: row.sortOrder,
})

const toNodeDto = (node: NodeView) => ({
  id: node.id,
  parentId: node.parentId,
  orgTypeId: node.orgTypeId,
  name: node.name,
  depth: node.depth,
  sortOrder: node.sortOrder,
  manageable: node.manageable,
  subtreeManageable: node.subtreeManageable,
  subtreeVisible: node.subtreeVisible,
})

const toRuleDto = (row: RuleRow) => ({
  parentTypeId: row.parentTypeId,
  childTypeId: row.childTypeId,
})

const local = Api.local(orgApiGroup)

export const orgApiHandlers = HttpApiBuilder.group(local, 'org', (handlers) =>
  handlers
    .handle(
      'changeNodeType',
      Effect.fn('org.changeNodeType.handler')(function* ({ params, payload }) {
        const org = yield* Org
        // the tenant comes from the session, never from the request: a caller
        // must not be able to name the tenant they are acting on
        const principal = yield* CurrentUser
        // the row it produced, as the contract declares: answering ok makes a
        // client re-read to learn what it just wrote
        const node = yield* org.changeNodeType(
          principal.tenantId,
          params.nodeId,
          payload.orgTypeId,
          principal,
        )
        return { node: toNodeDto(node) }
      }),
    )
    .handle(
      'updateNode',
      Effect.fn('org.updateNode.handler')(function* ({ params, payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        const node = yield* org.updateNode(principal.tenantId, params.nodeId, payload, principal)
        return { node: toNodeDto(node) }
      }),
    )
    .handle(
      'getNodeUsage',
      Effect.fn('org.getNodeUsage.handler')(function* ({ params }) {
        const org = yield* Org
        const catalog = yield* NodeUsageCatalog
        const principal = yield* CurrentUser
        // the same read authority as the unit itself, and the same answer
        // for a unit the caller cannot see as for one that is not there
        const node = yield* org.readNode(principal.tenantId, params.nodeId, principal)
        const children = yield* org.childCount(principal.tenantId, node.id)
        const usage = yield* catalog.usageOf(principal.tenantId, node.id)
        return {
          isRoot: node.parentId === null,
          children,
          usage: usage.map((one) => ({
            kind: one.kind,
            label: one.label,
            count: one.count,
            clearable: one.clearable,
            examples: [...one.examples],
            target:
              one.target === undefined
                ? null
                : {
                    pageId: one.target.pageId,
                    params: { ...one.target.params },
                    search: { ...one.target.search },
                  },
          })),
        }
      }),
    )
    .handle(
      'deleteNode',
      Effect.fn('org.deleteNode.handler')(function* ({ params }) {
        const org = yield* Org
        const catalog = yield* NodeUsageCatalog
        const principal = yield* CurrentUser
        // The row stays, so no foreign key speaks up any more: what still
        // stands on the unit - people, grants in force, a round under way -
        // is asked of the plugins that own it. What merely remembers the unit
        // (a closed round, a grant withdrawn) is why the row stays, and holds
        // nothing.
        yield* org.deleteNode(
          principal.tenantId,
          params.nodeId,
          principal,
          Effect.map(catalog.usageOf(principal.tenantId, params.nodeId), (usage) =>
            usage.some((one) => one.clearable && one.count > 0),
          ),
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'listDeletedNodes',
      Effect.fn('org.listDeletedNodes.handler')(function* () {
        const org = yield* Org
        const principal = yield* CurrentUser
        const nodes = yield* org.listDeletedNodes(principal.tenantId, principal)
        return {
          nodes: nodes.map((node) => ({ ...node, deletedAt: node.deletedAt.toISOString() })),
        }
      }),
    )
    .handle(
      'restoreNode',
      Effect.fn('org.restoreNode.handler')(function* ({ params }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        yield* org.restoreNode(principal.tenantId, params.nodeId, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'createNode',
      Effect.fn('org.createNode.handler')(function* ({ payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        const node = yield* org.createNode(principal.tenantId, payload, principal)
        return { node: toNodeDto(node) }
      }),
    )
    .handle(
      'setNodePlacement',
      Effect.fn('org.setNodePlacement.handler')(function* ({ params, payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        const node = yield* org.moveNode(
          principal.tenantId,
          params.nodeId,
          payload.parentId,
          principal,
          payload.sortOrder,
        )
        return { node: toNodeDto(node) }
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
        return {
          node: toNodeDto(yield* org.readNode(principal.tenantId, params.nodeId, principal)),
        }
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
        const type = yield* org.updateType(principal.tenantId, params.typeId, payload, principal)
        return { type: toTypeDto(type) }
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
        yield* org.putRule(principal.tenantId, params.parentTypeId, params.childTypeId, principal)
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
