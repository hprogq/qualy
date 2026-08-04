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
  NodeHasChildren,
  NodeIsRoot,
  RuleCycle,
  RuleInUse,
  RuleInvalid,
  RuleNotFound,
  TypeInUse,
  type ChangeNodeTypeError,
  type CreateTypeError,
  type DeleteRuleError,
  type DeleteTypeError,
  type PutRuleError,
  type UpdateTypeError,
  type DeleteNodeError,
  type UpdateNodeError,
} from './errors.ts'
import type { Principal } from '@qualy/rbac-contract'
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
  rootQuery,
  ruleInUseQuery,
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

interface NodeRow extends Record<string, unknown> {
  id: string
  parent_id: string | null
  org_type_id: string
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
        yield* tx.execute(lockTenantQuery(tenantId)).pipe(Effect.orDie)

        const node = rows<NodeRow>(
          yield* tx.execute(nodeQuery(tenantId, nodeId)).pipe(Effect.orDie),
        )[0]
        if (!node) return yield* new NodeNotFound()

        // re-decided under the lock rather than trusted from the router: a
        // concurrent move can have re-anchored the target since that check
        yield* rbac.requireAt(as, 'org.tree.manage', nodeId)

        if (node.org_type_id === newTypeId) return
        const type = rows<{ id: string }>(
          yield* tx.execute(typeQuery(tenantId, newTypeId)).pipe(Effect.orDie),
        )[0]
        if (!type) return yield* new TypeNotFound()

        if (node.parent_id) {
          const parent = rows<NodeRow>(
            yield* tx.execute(nodeQuery(tenantId, node.parent_id)).pipe(Effect.orDie),
          )[0]!
          const allowed = rows(
            yield* tx
              .execute(ruleExistsQuery(tenantId, parent.org_type_id, newTypeId))
              .pipe(Effect.orDie),
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
            .pipe(Effect.orDie),
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

        yield* tx.execute(setNodeTypeQuery(tenantId, nodeId, newTypeId)).pipe(Effect.orDie)
      }),
    ).pipe(Effect.catchTag('SqlError', (error) => Effect.die(error)))
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
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId)).pipe(Effect.orDie)
          const node = rows<NodeRow>(
            yield* tx.execute(nodeQuery(tenantId, nodeId)).pipe(Effect.orDie),
          )[0]
          if (!node) return yield* new NodeNotFound()
          yield* rbac.requireAt(as, 'org.tree.manage', nodeId)
          return yield* body(tx, node)
        }),
      )
      .pipe(Effect.catchTag('SqlError', (error) => Effect.die(error)))

  const updateNode = Effect.fn('Org.updateNode')(function* (
    tenantId: string,
    nodeId: string,
    fields: { name?: string; sortOrder?: number },
    as: Principal,
  ) {
    yield* write(tenantId, nodeId, as, (tx) =>
      tx.execute(updateNodeFieldsQuery(tenantId, nodeId, fields)).pipe(Effect.orDie),
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
          yield* tx.execute(hasChildrenQuery(tenantId, nodeId)).pipe(Effect.orDie),
        )
        if (children.length > 0) return yield* new NodeHasChildren()
        // users and assignments still block through their restrict foreign
        // keys, which surface as ORG_NODE_IN_USE by constraint name
        yield* tx.execute(deleteNodeQuery(tenantId, nodeId)).pipe(Effect.orDie)
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
          yield* tx.execute(lockTenantQuery(tenantId)).pipe(Effect.orDie)
          yield* atRoot(tenantId, as)
          return yield* body(tx)
        }),
      )
      .pipe(Effect.catchTag('SqlError', (error) => Effect.die(error)))

  const typeOf = (tx: Tx, tenantId: string, typeId: string) =>
    tx.execute(typeQuery(tenantId, typeId)).pipe(
      Effect.orDie,
      Effect.map((result) => rows<TypeRow>(result)[0]),
    )

  return {
    changeNodeType,
    updateNode,
    deleteNode,

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
          .pipe(Effect.orDie, Effect.map((result) => rows<TypeRow>(result)[0]!)),
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
          yield* tx.execute(updateTypeQuery(tenantId, typeId, fields)).pipe(Effect.orDie)
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
          const used = rows(yield* tx.execute(typeHasNodesQuery(tenantId, typeId)).pipe(Effect.orDie))
          if (used.length > 0) return yield* new TypeInUse({ reason: 'nodes still use this org type' })
          const ruled = rows(yield* tx.execute(typeHasRulesQuery(tenantId, typeId)).pipe(Effect.orDie))
          if (ruled.length > 0) {
            return yield* new TypeInUse({ reason: 'rules still reference this org type' })
          }
          yield* tx.execute(deleteTypeQuery(tenantId, typeId)).pipe(Effect.orDie)
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
            yield* tx.execute(ruleExistsQuery(tenantId, parentTypeId, childTypeId)).pipe(Effect.orDie),
          )
          if (existing.length > 0) return
          const counted = rows<{ count: string }>(
            yield* tx.execute(countTypesQuery(tenantId, [parentTypeId, childTypeId])).pipe(Effect.orDie),
          )
          if (Number(counted[0]?.count ?? 0) !== 2) return yield* new TypeNotFound()
          const cycles = rows(
            yield* tx.execute(ruleWouldCycleQuery(tenantId, parentTypeId, childTypeId)).pipe(Effect.orDie),
          )
          if (cycles.length > 0) return yield* new RuleCycle()
          yield* tx.execute(insertRuleQuery({ tenantId, parentTypeId, childTypeId })).pipe(Effect.orDie)
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
            yield* tx.execute(ruleExistsQuery(tenantId, parentTypeId, childTypeId)).pipe(Effect.orDie),
          )
          if (existing.length === 0) return yield* new RuleNotFound()
          const used = rows(
            yield* tx.execute(ruleInUseQuery(tenantId, parentTypeId, childTypeId)).pipe(Effect.orDie),
          )
          if (used.length > 0) return yield* new RuleInUse()
          yield* tx.execute(deleteRuleQuery(tenantId, parentTypeId, childTypeId)).pipe(Effect.orDie)
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
      'listTypes',
      Effect.fn('org.listTypes.handler')(function* () {
        const org = yield* Org
        const principal = yield* CurrentUser
        return { types: yield* org.listTypes(principal.tenantId, principal) }
      }),
    )
    .handle(
      'createType',
      Effect.fn('org.createType.handler')(function* ({ payload }) {
        const org = yield* Org
        const principal = yield* CurrentUser
        return { type: yield* org.createType(principal.tenantId, payload, principal) }
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
        return { rules: yield* org.listRules(principal.tenantId, principal) }
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
