import { Schema } from 'effect'
import type { AccessDenied } from '@qualy/rbac-contract/effect'

// The ways a retype can be refused, in their own module.
//
// They sit below both the group that declares them and the layer that raises
// them: the group has to name them to declare its failures, and the layer has
// to construct them, so putting them in either one makes the other import it
// back. That is a real ESM cycle rather than a stylistic one, and it shows up
// as a temporal dead zone at load time rather than as a type error.

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
