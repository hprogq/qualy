import { Schema } from 'effect'
import { boundedInt, changed, kebabCode, trimmedName } from '@qualy/api-kit/schema'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { Authenticated } from '@qualy/plugin-auth/effect/session'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  InvalidMove,
  NodeConflict,
  NodeInUse,
  TypeConflict,
  RuleCycle,
  RuleInUse,
  RuleInvalid,
  RuleNotFound,
  TypeInUse,
  AssignmentIncompatible,
  NodeHasChildren,
  NodeIsRoot,
  NodeNotFound,
  PlacementBlocked,
  RuleViolation,
  TypeNotFound,
} from './effect/errors.ts'

// The endpoints this plugin serves, as definitions only.
//
// One so far: the retype path, ported first because it is where three plugins
// meet in one transaction. The rest follow the same shape.
//
// The path is frozen (scripts/tests/api-surface.test.ts). A state change is an
// idempotent subresource replacement rather than an action segment, which is
// why this is a PUT on /type and not a POST to /retype.


// An id a caller supplies is validated before any work happens, so a
// malformed one is a 400 rather than a query that finds nothing and answers
// 404. The oRPC contract has always done this; the port had let it through as
// a plain string.
const id = Schema.String.check(Schema.isUUID())
// Payload primitives only, mirroring the zod constants in contract.ts. A
// response DTO keeps a bare String: it describes what is stored, and putting an
// input constraint there would refuse to encode a legitimate row written before
// the rule tightened.
//
// A node name is allowed to be longer than a type name because it names a real
// place rather than a category.
const nodeName = trimmedName(255)
const typeName = trimmedName(100)
const sortOrder = boundedInt(0, 32767)

// The wire shape stays camelCase, as the contract declares it. Rows come out
// of the database in snake_case, and letting that reach the client would make
// the two runtimes describe the same record differently.
const orgType = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  sortOrder: Schema.Number,
})

const orgNode = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  orgTypeId: Schema.String,
  code: Schema.NullOr(Schema.String),
  name: Schema.String,
  depth: Schema.Number,
  sortOrder: Schema.Number,
  // what this caller may do, so the client hides controls it cannot use. This
  // does not replace the api's own authorization; it only stops the interface
  // offering actions that would be refused.
  manageable: Schema.Boolean,
  subtreeManageable: Schema.Boolean,
})

const orgRule = Schema.Struct({
  parentTypeId: Schema.String,
  childTypeId: Schema.String,
})

export const orgApiGroup = HttpApiGroup.make('org').add(
  HttpApiEndpoint.put('changeNodeType', '/org/nodes/:nodeId/type', {
    params: Schema.Struct({ nodeId: id }),
    payload: Schema.Struct({ orgTypeId: id }),
    success: Schema.Struct({ node: orgNode }),
    // every way this can be refused, each carrying its own status. The caller
    // has to deal with them, which is the point of declaring them here.
    error: [
      NodeNotFound,
      TypeNotFound,
      RuleViolation,
      AssignmentIncompatible,
      PlacementBlocked,
      AccessDenied,
      NodeConflict,
      NodeInUse,
    ],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.patch('updateNode', '/org/nodes/:nodeId', {
    params: Schema.Struct({ nodeId: id }),
    payload: changed(
      { name: Schema.optional(nodeName), sortOrder: Schema.optional(sortOrder) },
      ['name', 'sortOrder'],
    ),
    // the updated row, as the contract declares: answering ok makes a client
    // re-read to learn what it just wrote
    success: Schema.Struct({ node: orgNode }),
    error: [NodeNotFound, AccessDenied, NodeConflict, NodeInUse],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteNode', '/org/nodes/:nodeId', {
    params: Schema.Struct({ nodeId: id }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [NodeNotFound, NodeIsRoot, NodeHasChildren, AccessDenied, NodeConflict, NodeInUse],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.get('listTypes', '/org/types', {
    success: Schema.Struct({ types: Schema.Array(orgType) }),
    error: [AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.post('createType', '/org/types', {
    payload: Schema.Struct({
      code: kebabCode,
      name: typeName,
      sortOrder: Schema.optional(sortOrder),
    }),
    success: Schema.Struct({ type: orgType }),
    error: [AccessDenied, TypeConflict, TypeInUse],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.patch('updateType', '/org/types/:typeId', {
    params: Schema.Struct({ typeId: id }),
    payload: changed(
      { name: Schema.optional(typeName), sortOrder: Schema.optional(sortOrder) },
      ['name', 'sortOrder'],
    ),
    // the updated row, as the contract declares: answering ok makes a client
    // re-read to learn what it just wrote
    success: Schema.Struct({ type: orgType }),
    error: [TypeNotFound, AccessDenied, TypeConflict, TypeInUse],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteType', '/org/types/:typeId', {
    params: Schema.Struct({ typeId: id }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [TypeNotFound, TypeInUse, AccessDenied, TypeConflict],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.get('listRules', '/org/type-rules', {
    success: Schema.Struct({ rules: Schema.Array(orgRule) }),
    error: [AccessDenied],
  }).middleware(Authenticated),
).add(
  // idempotent: the pair identifies the rule, so repeating converges rather
  // than conflicting, which is why this is a PUT on the pair
  HttpApiEndpoint.put('putRule', '/org/type-rules/:parentTypeId/:childTypeId', {
    params: Schema.Struct({ parentTypeId: id, childTypeId: id }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [RuleInvalid, TypeNotFound, RuleCycle, AccessDenied, TypeConflict, TypeInUse],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteRule', '/org/type-rules/:parentTypeId/:childTypeId', {
    params: Schema.Struct({ parentTypeId: id, childTypeId: id }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [RuleNotFound, RuleInUse, AccessDenied, TypeConflict, TypeInUse],
  }).middleware(Authenticated),
).add(
  // the whole authorized projection, or one node's subtree when asked. A self
  // anchor yields the node alone; only a subtree anchor yields what is below.
  HttpApiEndpoint.get('getTree', '/org/tree', {
    query: Schema.Struct({ nodeId: Schema.optional(id) }),
    success: Schema.Struct({
      roots: Schema.Array(Schema.String),
      nodes: Schema.Array(orgNode),
    }),
    error: [NodeNotFound, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.get('getNode', '/org/nodes/:nodeId', {
    params: Schema.Struct({ nodeId: id }),
    success: Schema.Struct({ node: orgNode }),
    // a node the caller cannot see answers exactly as a missing one
    error: [NodeNotFound, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.post('createNode', '/org/nodes', {
    payload: Schema.Struct({
      parentId: id,
      orgTypeId: id,
      name: nodeName,
      code: Schema.optional(kebabCode),
      sortOrder: Schema.optional(sortOrder),
    }),
    success: Schema.Struct({ node: orgNode }),
    error: [NodeNotFound, TypeNotFound, RuleViolation, AccessDenied, NodeConflict, NodeInUse],
  }).middleware(Authenticated),
).add(
  // a relocation is an idempotent replacement of where the node sits, not an
  // action, which is why it is a PUT on /placement
  HttpApiEndpoint.put('setNodePlacement', '/org/nodes/:nodeId/placement', {
    params: Schema.Struct({ nodeId: id }),
    payload: Schema.Struct({
      parentId: id,
      sortOrder: Schema.optional(sortOrder),
    }),
    success: Schema.Struct({ node: orgNode }),
    error: [
      NodeNotFound,
      NodeIsRoot,
      InvalidMove,
      RuleViolation,
      AccessDenied,
      NodeConflict,
      NodeInUse,
    ],
  }).middleware(Authenticated),
)
