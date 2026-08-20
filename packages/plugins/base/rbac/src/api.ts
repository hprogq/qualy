import {
  RoleAppointmentInvalid,
  AccessTargetRequired,
  GrantEscalationRefused,
  GrantExists,
  GrantNodeNotFound,
  GrantNotEligible,
  GrantNotFound,
  GrantRuleRefused,
  GrantStranded,
  GrantUserNotFound,
  PermissionNotFound,
  RoleConflict,
  RoleEscalationRefused,
  RoleInUse,
  RoleIncomplete,
  RoleIsSystem,
  RoleNeedsEligibility,
  RoleNotDraft,
  RoleNotFound,
  RoleOrgTypeNotFound,
  RoleTargetMismatch,
  RoleUserTypeNotFound,
  RoleVersionConflict,
  TenantAdminRequired,
} from './server/errors.ts'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  changed,
  expectedVersion,
  kebabCode,
  pageOf,
  pageQuery,
  trimmedName,
} from '@qualy/api-kit/schema'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'

// The access api, as definitions only. Paths are frozen.
//
// A grant is created and removed rather than edited: it names a role, a
// person and where it applies, and changing any of those is a different grant.

const id = Schema.String.check(Schema.isUUID())

const roleKind = Schema.Literals(['tenant', 'org'])
const permissionTarget = Schema.Literals(['tenant', 'org-node'])
const coverage = Schema.Literals(['self', 'subtree'])

/** what a role is and what it currently carries, as a role screen needs it */
/**
 * Who may hold a role, and where an org role's duty applies.
 *
 * The mode is stated rather than inferred from an empty list, exactly as user
 * type placement states it: reading "no rows" as "anyone, anywhere" makes
 * unchecking the last box widen the rule instead of narrowing it, and skips
 * the check that would have refused to strand the grants already made.
 */
const eligibilityView = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    userTypeIds: Schema.Array(Schema.String),
  }),
])

const anchorView = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({ mode: Schema.Literal('allow-list'), orgTypeIds: Schema.Array(Schema.String) }),
])

/** the same two, as a writer must state them: an allow-list has to list something */
const eligibilityPolicy = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    userTypeIds: Schema.Array(id).check(Schema.isMaxLength(50)),
  }),
])

const anchorPolicy = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    orgTypeIds: Schema.Array(id).check(Schema.isMaxLength(50)),
  }),
])

const roleShape = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  kind: roleKind,
  status: Schema.Literals(['draft', 'active', 'disabled']),
  // an all-active role carries whatever the assembly serves, so listing its
  // codes would describe this deployment rather than the role
  holdsEveryPermission: Schema.Boolean,
  systemKey: Schema.NullOr(Schema.String),
  assignable: Schema.Boolean,
  version: Schema.Number,
  grantCount: Schema.Number,
  permissions: Schema.Array(Schema.String),
  unavailablePermissions: Schema.Array(Schema.String),
  eligibility: eligibilityView,
  anchor: anchorView,
})

/** where authority applies, resolved for display */
const grantTargetShape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('tenant') }),
  Schema.Struct({
    kind: Schema.Literal('org-node'),
    orgNodeId: Schema.String,
    orgNodeName: Schema.String,
    coverage,
  }),
])

const grantShape = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  userDisplayName: Schema.String,
  roleId: Schema.String,
  roleCode: Schema.String,
  roleName: Schema.String,
  roleKind,
  target: grantTargetShape,
  // whether this caller may revoke this particular grant
  manageable: Schema.Boolean,
})

/** why someone holds a capability */
const permissionSourceShape = Schema.Struct({
  roleId: Schema.String,
  roleCode: Schema.String,
  grantId: Schema.String,
  target: grantTargetShape,
})

const typeOptionShape = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  name: Schema.String,
})

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
    // the ACTIVE catalog, not the table: a row left behind by a plugin that is
    // no longer loaded must never be offered as something to grant
    HttpApiEndpoint.get('listPermissions', '/iam/permissions', {
      query: Schema.Struct({
        target: Schema.optional(permissionTarget),
        plugin: Schema.optional(Schema.String.check(Schema.isMaxLength(127))),
        search: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
      success: Schema.Struct({
        permissions: Schema.Array(
          Schema.Struct({
            code: Schema.String,
            plugin: Schema.String,
            name: Schema.String,
            description: Schema.NullOr(Schema.String),
            groupKey: Schema.NullOr(Schema.String),
            target: permissionTarget,
          }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getRoleOptions', '/iam/role-options', {
      success: Schema.Struct({
        userTypes: Schema.Array(typeOptionShape),
        orgTypes: Schema.Array(typeOptionShape),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listRoles', '/iam/roles', {
      query: Schema.Struct({
        kind: Schema.optional(roleKind),
        status: Schema.optional(Schema.Literals(['draft', 'active', 'disabled'])),
      }),
      success: Schema.Struct({
        roles: Schema.Array(roleShape),
        // read and manage are separate grants, so a read-only administrator
        // gets a screen without buttons instead of buttons that answer 403
        capabilities: Schema.Struct({
          canManage: Schema.Boolean,
          canEscalate: Schema.Boolean,
        }),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getRole', '/iam/roles/:roleId', {
      params: Schema.Struct({ roleId: id }),
      success: Schema.Struct({ role: roleShape }),
      error: [RoleNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the management api creates drafts only; a role becomes usable through
    // activation, which is where completeness is checked
    HttpApiEndpoint.post('createRole', '/iam/roles', {
      payload: Schema.Struct({
        code: kebabCode,
        name: trimmedName(100),
        description: Schema.optional(boundedText(500)),
        kind: roleKind,
      }),
      success: Schema.Struct({
        id: Schema.String,
        status: Schema.Literals(['draft', 'active', 'disabled']),
        version: Schema.Number,
      }),
      error: [RoleConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateRole', '/iam/roles/:roleId', {
      params: Schema.Struct({ roleId: id }),
      payload: changed(
        {
          version: expectedVersion,
          name: Schema.optional(trimmedName(100)),
          description: Schema.optional(Schema.NullOr(boundedText(500))),
          assignable: Schema.optional(Schema.Boolean),
        },
        ['name', 'description', 'assignable'],
      ),
      success: Schema.Struct({ version: Schema.Number }),
      error: [RoleNotFound, RoleVersionConflict, RoleIsSystem, RoleConflict, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setRoleStatus', '/iam/roles/:roleId/status', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: expectedVersion,
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
      // the codes the role carries AND can still use. A code whose plugin is
      // unloaded grants nothing, and the contract answers only the usable set
      success: Schema.Struct({ codes: Schema.Array(Schema.String), version: Schema.Number }),
      error: [RoleNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setRolePermissions', '/iam/roles/:roleId/permissions', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: expectedVersion,
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
        eligibility: eligibilityView,
        anchor: anchorView,
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
        version: expectedVersion,
        // a full replacement names both policies: omitting one and having it
        // silently survive is how a replace quietly becomes a merge
        eligibility: eligibilityPolicy,
        anchor: anchorPolicy,
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
    // Which roles this one may appoint people to: the WHAT of appointment,
    // beside iam.grant.manage's WHERE. An empty list appoints nothing.
    HttpApiEndpoint.get('getRoleGrantableRoles', '/iam/roles/:roleId/grantable-roles', {
      params: Schema.Struct({ roleId: id }),
      success: Schema.Struct({
        roleIds: Schema.Array(Schema.String),
        /** the offices that appoint this one: what a duty edit will echo through */
        appointedBy: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        version: Schema.Number,
      }),
      error: [RoleNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setRoleGrantableRoles', '/iam/roles/:roleId/grantable-roles', {
      params: Schema.Struct({ roleId: id }),
      payload: Schema.Struct({
        version: expectedVersion,
        roleIds: Schema.Array(id),
      }),
      success: Schema.Struct({ version: Schema.Number }),
      error: [
        RoleNotFound,
        RoleVersionConflict,
        RoleIsSystem,
        RoleConflict,
        RoleAppointmentInvalid,
        RoleEscalationRefused,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteRole', '/iam/roles/:roleId', {
      params: Schema.Struct({ roleId: id }),
      query: Schema.Struct({ version: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [
        RoleNotFound,
        RoleVersionConflict,
        RoleIsSystem,
        RoleInUse,
        RoleConflict,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // Which roles this caller may actually grant to this person at this place.
    // Every rule is re-checked on write; this exists so a screen does not have
    // to reimplement eligibility and then disagree with the server about it.
    HttpApiEndpoint.get('getRoleGrantOptions', '/iam/role-grant-options', {
      query: Schema.Struct({
        userId: id,
        orgNodeId: Schema.optional(id),
        coverage: Schema.optional(coverage),
      }),
      success: Schema.Struct({
        roles: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            code: Schema.String,
            name: Schema.String,
            kind: roleKind,
          }),
        ),
      }),
      error: [GrantUserNotFound, GrantNodeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listRoleGrants', '/iam/role-grants', {
      query: Schema.Struct({ orgNodeId: Schema.optional(id), ...pageQuery }),
      success: pageOf(grantShape),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getUserRoleGrants', '/iam/users/:userId/role-grants', {
      params: Schema.Struct({ userId: id }),
      success: Schema.Struct({ grants: Schema.Array(grantShape) }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createRoleGrant', '/iam/role-grants', {
      payload: Schema.Struct({ userId: id, roleId: id, target: grantTarget }),
      success: Schema.Struct({ id: Schema.String }),
      error: [
        RoleNotFound,
        GrantExists,
        GrantUserNotFound,
        GrantNodeNotFound,
        GrantNotEligible,
        GrantEscalationRefused,
        GrantRuleRefused,
        TenantAdminRequired,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteRoleGrant', '/iam/role-grants/:grantId', {
      params: Schema.Struct({ grantId: id }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [GrantNotFound, RoleNotFound, TenantAdminRequired, LastAdministrator, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // why someone holds what they hold. Answering "allowed?" is easy; the
    // reason is what makes a wrong answer fixable, and what an audit needs
    HttpApiEndpoint.get('getUserEffectivePermissions', '/iam/users/:userId/effective-permissions', {
      params: Schema.Struct({ userId: id }),
      query: Schema.Struct({ orgNodeId: Schema.optional(id) }),
      success: Schema.Struct({
        permissions: Schema.Array(
          Schema.Struct({
            code: Schema.String,
            name: Schema.String,
            target: permissionTarget,
            sources: Schema.Array(permissionSourceShape),
          }),
        ),
      }),
      error: [GrantUserNotFound, GrantNodeNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('evaluateAccess', '/iam/access-evaluations', {
      payload: Schema.Struct({
        userId: id,
        permissionCode: Schema.String.check(Schema.isMaxLength(127)),
        orgNodeId: Schema.optional(id),
      }),
      success: Schema.Struct({
        allowed: Schema.Boolean,
        target: permissionTarget,
        sources: Schema.Array(permissionSourceShape),
      }),
      error: [
        GrantUserNotFound,
        GrantNodeNotFound,
        PermissionNotFound,
        AccessTargetRequired,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
