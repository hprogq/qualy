import { z } from 'zod'
import { defineDomainErrors } from '@qualy/api-contract'

// the single source for every org error: code, http status, english
// protocol message and, where the frontend needs to format a sentence, a
// zod data schema. Contract .errors(), the http status map, the typed error
// the service throws and the client translation types are all derived from
// this — never write them by hand. Data stays safe and structured: never
// role codes, constraint names or raw sql detail.
export const orgErrors = defineDomainErrors({
  ORG_TYPE_NOT_FOUND: { status: 404, message: 'organization type not found' },
  ORG_RULE_NOT_FOUND: { status: 404, message: 'hierarchy rule not found' },
  ORG_NODE_NOT_FOUND: { status: 404, message: 'organization node not found' },
  ORG_TYPE_CONFLICT: { status: 409, message: 'organization type code or name already exists' },
  ORG_RULE_CONFLICT: { status: 409, message: 'hierarchy rule already exists' },
  ORG_NODE_CONFLICT: { status: 409, message: 'sibling node name or code already exists' },
  ORG_TYPE_IN_USE: { status: 409, message: 'organization type is still referenced' },
  ORG_RULE_IN_USE: { status: 409, message: 'existing nodes depend on this rule' },
  ORG_NODE_IN_USE: { status: 409, message: 'users or assignments still reference this node' },
  ORG_NODE_IS_ROOT: { status: 409, message: 'the root node cannot be moved or deleted' },
  ORG_NODE_HAS_CHILDREN: { status: 409, message: 'only leaf nodes can be deleted' },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    status: 409,
    message: 'role assignments reject the requested organization type',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
  // The people standing here do not move when the node is retyped, so the
  // node changing under them strands them exactly as a transfer would. Only
  // grants were checked before, which let a school retype a class into a
  // college and leave its students standing somewhere their type forbids.
  ORG_NODE_PLACEMENT_INCOMPATIBLE: {
    status: 409,
    message: 'users standing here may not be placed on the requested organization type',
    data: z.object({ userCount: z.number().int().nonnegative() }),
  },
  ORG_RULE_INVALID: { status: 422, message: 'invalid hierarchy rule' },
  ORG_RULE_CYCLE: { status: 422, message: 'the rule would create a cycle in the type graph' },
  ORG_NODE_RULE_VIOLATION: {
    status: 422,
    message: 'the hierarchy rules forbid this parent and child type combination',
  },
  ORG_NODE_INVALID_MOVE: {
    status: 422,
    message: 'a node cannot move into itself or its own subtree',
  },
})
