import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/plugin-auth/effect/session'
import {
  GrantNodeNotFound,
  GrantNotEligible,
  GrantNotFound,
  GrantUserNotFound,
  RoleNotFound,
} from './effect/grants.ts'
import { GrantEscalationRefused } from './effect/escalation.ts'

// The access api, as definitions only. Paths are frozen.
//
// A grant is created and removed rather than edited: it names a role, a
// person and where it applies, and changing any of those is a different grant.

const id = Schema.String.check(Schema.isUUID())

/** tenant-wide authority has nowhere to anchor; org authority needs one */
const grantTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('tenant') }),
  Schema.Struct({
    kind: Schema.Literal('org-node'),
    orgNodeId: id,
    coverage: Schema.Literals(['self', 'subtree']),
  }),
])

export const accessApiGroup = HttpApiGroup.make('access')
  .add(
    HttpApiEndpoint.post('createRoleGrant', '/iam/role-grants', {
      payload: Schema.Struct({ userId: id, roleId: id, target: grantTarget }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        RoleNotFound,
        GrantUserNotFound,
        GrantNodeNotFound,
        GrantNotEligible,
        GrantEscalationRefused,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteRoleGrant', '/iam/role-grants/:grantId', {
      params: Schema.Struct({ grantId: id }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [GrantNotFound, RoleNotFound, LastAdministrator, AccessDenied],
    }).middleware(Authenticated),
  )
