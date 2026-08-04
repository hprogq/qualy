import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { Authenticated } from '@qualy/plugin-auth/effect/session'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AssignmentIncompatible,
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
)
