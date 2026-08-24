import { Schema } from 'effect'
import type { AccessDenied } from '@qualy/rbac-contract/effect'

// The ways a retype can be refused, in their own module.
//
// They sit below both the group that declares them and the layer that raises
// them: the group has to name them to declare its failures, and the layer has
// to construct them, so putting them in either one makes the other import it
// back. That is a real ESM cycle rather than a stylistic one, and it shows up
// as a temporal dead zone at load time rather than as a type error.

export class NodeNotFound extends Schema.TaggedError<NodeNotFound>()(
  'ORG_NODE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'OrgNodeNotFound' },
) {}

export class TypeNotFound extends Schema.TaggedError<TypeNotFound>()(
  'ORG_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'OrgTypeNotFound' },
) {}

export class RuleViolation extends Schema.TaggedError<RuleViolation>()(
  'ORG_NODE_RULE_VIOLATION',
  { reason: Schema.String },
  { httpApiStatus: 422, identifier: 'OrgNodeRuleViolation' },
) {}

/** role codes stay private: the count is all the caller needs, and it localizes */
export class AssignmentIncompatible extends Schema.TaggedError<AssignmentIncompatible>()(
  'ORG_NODE_ASSIGNMENT_INCOMPATIBLE',
  { assignmentCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'OrgNodeAssignmentIncompatible' },
) {}

export class PlacementBlocked extends Schema.TaggedError<PlacementBlocked>()(
  // the code the oRPC side already raises, and the only one the client can
  // translate. Inventing a clearer name here would have meant the same failure
  // is localized on one path and shown in English on the other.
  'ORG_NODE_PLACEMENT_INCOMPATIBLE',
  { userCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'OrgNodePlacementIncompatible' },
) {}

export type ChangeNodeTypeError =
  | NodeNotFound
  | NodeIsRoot
  | TypeNotFound
  | RuleViolation
  | AssignmentIncompatible
  | PlacementBlocked
  | AccessDenied
  | NodeConstraintError

export class NodeIsRoot extends Schema.TaggedError<NodeIsRoot>()(
  'ORG_NODE_IS_ROOT',
  {},
  { httpApiStatus: 409, identifier: 'OrgNodeIsRoot' },
) {}

/** users and assignments hold a node through restrict foreign keys */
export class NodeHasChildren extends Schema.TaggedError<NodeHasChildren>()(
  'ORG_NODE_HAS_CHILDREN',
  {},
  { httpApiStatus: 409, identifier: 'OrgNodeHasChildren' },
) {}

export type UpdateNodeError = NodeNotFound | AccessDenied | NodeConstraintError
export type DeleteNodeError =
  NodeNotFound | NodeIsRoot | NodeHasChildren | AccessDenied | NodeConstraintError

export class TypeInUse extends Schema.TaggedError<TypeInUse>()(
  'ORG_TYPE_IN_USE',
  { reason: Schema.String },
  { httpApiStatus: 409, identifier: 'OrgTypeInUse' },
) {}

export class RuleInvalid extends Schema.TaggedError<RuleInvalid>()(
  'ORG_RULE_INVALID',
  {},
  { httpApiStatus: 422, identifier: 'OrgRuleInvalid' },
) {}

export class RuleCycle extends Schema.TaggedError<RuleCycle>()(
  'ORG_RULE_CYCLE',
  {},
  { httpApiStatus: 422, identifier: 'OrgRuleCycle' },
) {}

export class RuleNotFound extends Schema.TaggedError<RuleNotFound>()(
  'ORG_RULE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'OrgRuleNotFound' },
) {}

export class RuleInUse extends Schema.TaggedError<RuleInUse>()(
  'ORG_RULE_IN_USE',
  {},
  { httpApiStatus: 409, identifier: 'OrgRuleInUse' },
) {}

export type CreateTypeError = AccessDenied | TypeConstraintError
export type UpdateTypeError = TypeNotFound | AccessDenied | TypeConstraintError
export type DeleteTypeError = TypeNotFound | TypeInUse | AccessDenied | TypeConstraintError
export type PutRuleError =
  RuleInvalid | TypeNotFound | RuleCycle | AccessDenied | TypeConstraintError
export type DeleteRuleError = RuleNotFound | RuleInUse | AccessDenied | TypeConstraintError

export class NodeConflict extends Schema.TaggedError<NodeConflict>()(
  'ORG_NODE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'OrgNodeConflict' },
) {}

export class NodeInUse extends Schema.TaggedError<NodeInUse>()(
  'ORG_NODE_IN_USE',
  {},
  { httpApiStatus: 409, identifier: 'OrgNodeInUse' },
) {}

export class TypeConflict extends Schema.TaggedError<TypeConflict>()(
  'ORG_TYPE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'OrgTypeConflict' },
) {}

/**
 * The database as a backstop, by constraint name.
 *
 * These are the violations a service check cannot prevent without a race: a
 * concurrent insert takes the same sibling name, or a user is placed on a node
 * between the has-children check and the delete. The constraint is what
 * actually decides, so its violation has to arrive as the same domain error a
 * pre-check would have raised, not as a 500.
 */
export type NodeConstraintError = NodeConflict | NodeInUse
export type TypeConstraintError = TypeConflict | TypeInUse

/** what a node write can be refused by, once the statement reaches the database */
export const nodeConstraints: Record<string, () => NodeConstraintError> = {
  uq_org_nodes_tenant_parent_name: () => new NodeConflict(),
  uq_org_nodes_tenant_root_name: () => new NodeConflict(),
  uq_org_nodes_tenant_code: () => new NodeConflict(),
  uq_org_nodes_tenant_single_root: () => new NodeConflict(),
  // restrict foreign keys owned by auth and rbac; the constraint-name gate
  // checks these still exist in the deployed lineage
  fk_users_primary_org_node: () => new NodeInUse(),
  fk_role_grants_node: () => new NodeInUse(),
  // the fk detaches DELETED users (set null); a LIVE user standing here now
  // surfaces as this check refusing the null instead of the fk refusing the
  // delete - the same refusal, one constraint later
  chk_users_live_user_is_placed: () => new NodeInUse(),
}

/**
 * And what a type or rule write can be refused by.
 *
 * Every restrict foreign key that points at org_types belongs here, whether or
 * not deleteType pre-checks it: a placement allow-list has no pre-check at all
 * (auth owns it, and org must not learn to read auth's tables), and the node
 * key is the race the doc comment above describes. An unnamed one is a 500.
 */
export const typeConstraints: Record<string, () => TypeConstraintError> = {
  uq_org_types_tenant_code: () => new TypeConflict(),
  uq_org_types_tenant_name: () => new TypeConflict(),
  fk_role_allowed_org_types_type: () =>
    new TypeInUse({ reason: 'roles still allow this org type' }),
  fk_user_type_allowed_org_types_org_type: () =>
    new TypeInUse({ reason: 'user types still allow this org type' }),
  fk_org_nodes_org_type: () => new TypeInUse({ reason: 'nodes still use this org type' }),
}

export class InvalidMove extends Schema.TaggedError<InvalidMove>()(
  'ORG_NODE_INVALID_MOVE',
  { reason: Schema.String },
  { httpApiStatus: 422, identifier: 'OrgNodeInvalidMove' },
) {}

export type CreateNodeError =
  NodeNotFound | TypeNotFound | RuleViolation | AccessDenied | NodeConstraintError
export type MoveNodeError =
  NodeNotFound | NodeIsRoot | InvalidMove | RuleViolation | AccessDenied | NodeConstraintError
