import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { Authenticated } from '@qualy/plugin-auth/effect/session'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
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


const orgType = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  sort_order: Schema.Number,
})

const orgRule = Schema.Struct({
  parent_type_id: Schema.String,
  child_type_id: Schema.String,
})

export const orgApiGroup = HttpApiGroup.make('org').add(
  HttpApiEndpoint.put('changeNodeType', '/org/nodes/:nodeId/type', {
    params: Schema.Struct({ nodeId: Schema.String }),
    payload: Schema.Struct({ orgTypeId: Schema.String }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    // every way this can be refused, each carrying its own status. The caller
    // has to deal with them, which is the point of declaring them here.
    error: [
      NodeNotFound,
      TypeNotFound,
      RuleViolation,
      AssignmentIncompatible,
      PlacementBlocked,
      AccessDenied,
    ],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.patch('updateNode', '/org/nodes/:nodeId', {
    params: Schema.Struct({ nodeId: Schema.String }),
    payload: Schema.Struct({
      name: Schema.optional(Schema.String),
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [NodeNotFound, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteNode', '/org/nodes/:nodeId', {
    params: Schema.Struct({ nodeId: Schema.String }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [NodeNotFound, NodeIsRoot, NodeHasChildren, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.get('listTypes', '/org/types', {
    success: Schema.Struct({ types: Schema.Array(orgType) }),
    error: [AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.post('createType', '/org/types', {
    payload: Schema.Struct({
      code: Schema.String,
      name: Schema.String,
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({ type: orgType }),
    error: [AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.patch('updateType', '/org/types/:typeId', {
    params: Schema.Struct({ typeId: Schema.String }),
    payload: Schema.Struct({
      name: Schema.optional(Schema.String),
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [TypeNotFound, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteType', '/org/types/:typeId', {
    params: Schema.Struct({ typeId: Schema.String }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [TypeNotFound, TypeInUse, AccessDenied],
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
    params: Schema.Struct({ parentTypeId: Schema.String, childTypeId: Schema.String }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [RuleInvalid, TypeNotFound, RuleCycle, AccessDenied],
  }).middleware(Authenticated),
).add(
  HttpApiEndpoint.delete('deleteRule', '/org/type-rules/:parentTypeId/:childTypeId', {
    params: Schema.Struct({ parentTypeId: Schema.String, childTypeId: Schema.String }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    error: [RuleNotFound, RuleInUse, AccessDenied],
  }).middleware(Authenticated),
)
