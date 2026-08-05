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
import { GrantEscalationRefused, RoleEscalationRefused } from './effect/escalation.ts'
import {
  GrantStranded,
  PermissionNotFound,
  RoleNeedsEligibility,
  RoleOrgTypeNotFound,
  RoleUserTypeNotFound,
  RoleConflict,
  RoleTargetMismatch,
  RoleInUse,
  RoleIncomplete,
  RoleIsSystem,
  RoleNotDraft,
  RoleVersionConflict,
} from './effect/roles.ts'

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
    // the management api creates drafts only; a role becomes usable through
    // activation, which is where completeness is checked
    HttpApiEndpoint.post('createRole', '/iam/roles', {
      payload: Schema.Struct({
        code: Schema.String,
        name: Schema.String,
        description: Schema.optional(Schema.String),
        kind: Schema.Literals(['tenant', 'org']),
      }),
      success: Schema.Struct({ id: Schema.String }),
      error: [RoleConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateRole', '/iam/roles/:roleId', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: Schema.Number,
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.NullOr(Schema.String)),
        assignable: Schema.optional(Schema.Boolean),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [RoleNotFound, RoleVersionConflict, RoleIsSystem, RoleConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setRoleStatus', '/iam/roles/:roleId/status', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: Schema.Number,
        status: Schema.Literals(['active', 'disabled']),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        RoleNotFound,
        RoleVersionConflict,
        RoleIsSystem,
        RoleNotDraft,
        RoleIncomplete,
        RoleEscalationRefused,
        LastAdministrator,
        RoleConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getRolePermissions', '/iam/roles/:roleId/permissions', {
      params: Schema.Struct({ roleId: id }),
      success: Schema.Struct({
        // what the role carries and can still use, apart from what it carries
        // and cannot: a code whose plugin is unloaded grants nothing but has
        // not been taken away either
        active: Schema.Array(Schema.String),
        unavailable: Schema.Array(Schema.String),
        version: Schema.Number,
      }),
      error: [RoleNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setRolePermissions', '/iam/roles/:roleId/permissions', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: Schema.Number,
        codes: Schema.Array(Schema.String),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        RoleNotFound,
        RoleVersionConflict,
        RoleIsSystem,
        PermissionNotFound,
        RoleTargetMismatch,
        RoleEscalationRefused,
        RoleIncomplete,
        LastAdministrator,
        RoleConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getRoleEligibility', '/iam/roles/:roleId/eligibility', {
      params: Schema.Struct({ roleId: id }),
      success: Schema.Struct({
        userTypeIds: Schema.Array(Schema.String),
        orgTypeIds: Schema.Array(Schema.String),
        version: Schema.Number,
      }),
      error: [RoleNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // which user types may hold the role, and at which org node types it may
    // be anchored. "allowed" said neither
    HttpApiEndpoint.put('setRoleEligibility', '/iam/roles/:roleId/eligibility', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: Schema.Number,
        // a full replacement names both sets: omitting one and having it
        // silently survive is how a replace quietly becomes a merge
        userTypeIds: Schema.Array(id).check(Schema.isMaxLength(50)),
        orgTypeIds: Schema.Array(id).check(Schema.isMaxLength(50)),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        RoleNotFound,
        RoleVersionConflict,
        RoleIsSystem,
        RoleNeedsEligibility,
        RoleUserTypeNotFound,
        RoleOrgTypeNotFound,
        GrantStranded,
        RoleConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteRole', '/iam/roles/:roleId', {
      params: Schema.Struct({ roleId: id }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [RoleNotFound, RoleVersionConflict, RoleIsSystem, RoleInUse, RoleConflict, AccessDenied],
    }).middleware(Authenticated),
  )
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
