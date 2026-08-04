import { Context, Effect, Layer, Schema } from 'effect'
import { Placement } from '@qualy/auth-contract'
import { Database } from '@qualy/plugin-database/effect'
import { Rbac, type AccessDenied } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import {
  incompatibleChildTypesQuery,
  lockTenantQuery,
  nodeQuery,
  ruleExistsQuery,
  setNodeTypeQuery,
  typeQuery,
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

export class NodeNotFound extends Schema.TaggedErrorClass<NodeNotFound>()(
  'ORG_NODE_NOT_FOUND',
  {},
  { httpApiStatus: 404 },
) {}

export class TypeNotFound extends Schema.TaggedErrorClass<TypeNotFound>()(
  'ORG_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404 },
) {}

export class RuleViolation extends Schema.TaggedErrorClass<RuleViolation>()(
  'ORG_NODE_RULE_VIOLATION',
  { reason: Schema.String },
  { httpApiStatus: 409 },
) {}

/** role codes stay private: the count is all the caller needs, and it localizes */
export class AssignmentIncompatible extends Schema.TaggedErrorClass<AssignmentIncompatible>()(
  'ORG_NODE_ASSIGNMENT_INCOMPATIBLE',
  { assignmentCount: Schema.Number },
  { httpApiStatus: 409 },
) {}

export class PlacementBlocked extends Schema.TaggedErrorClass<PlacementBlocked>()(
  'ORG_NODE_PLACEMENT_BLOCKED',
  { userCount: Schema.Number },
  { httpApiStatus: 409 },
) {}

export type ChangeNodeTypeError =
  | NodeNotFound
  | TypeNotFound
  | RuleViolation
  | AssignmentIncompatible
  | PlacementBlocked
  | AccessDenied

interface NodeRow extends Record<string, unknown> {
  id: string
  parent_id: string | null
  org_type_id: string
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

  return { changeNodeType }
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
