import { Schema } from 'effect'

// Every failure this plugin's endpoints declare, with nothing behind them.
//
// Its own module because api.ts names these classes and api.ts is what the
// browser imports: leaving them beside the services that raise them dragged
// the database driver into the bundle. A failure is a declaration; raising one
// needs a connection, and only one of those belongs in a browser.

export class RoleNotFound extends Schema.TaggedErrorClass<RoleNotFound>()(
  'ROLE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'RoleNotFound' },
) {}

export class GrantNotFound extends Schema.TaggedErrorClass<GrantNotFound>()(
  'GRANT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'GrantNotFound' },
) {}

export class GrantUserNotFound extends Schema.TaggedErrorClass<GrantUserNotFound>()(
  'GRANT_USER_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'GrantUserNotFound' },
) {}

export class GrantNodeNotFound extends Schema.TaggedErrorClass<GrantNodeNotFound>()(
  'GRANT_NODE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'GrantNodeNotFound' },
) {}

/**
 * The same person already holds this role here.
 *
 * Reached through the unique indexes rather than a pre-read: nothing in the
 * write checks for it, and a pre-read would race the insert anyway.
 */
export class GrantExists extends Schema.TaggedErrorClass<GrantExists>()(
  'GRANT_EXISTS',
  {},
  { httpApiStatus: 409, identifier: 'GrantExists' },
) {}

/**
 * Granting or revoking the administrator role is reserved for its holders.
 *
 * Its own code rather than a plain denial: the client has a sentence for this
 * case, and collapsing it into ACCESS_DENIED made that sentence unreachable.
 */
export class TenantAdminRequired extends Schema.TaggedErrorClass<TenantAdminRequired>()(
  'TENANT_ADMIN_REQUIRED',
  {},
  { httpApiStatus: 403, identifier: 'TenantAdminRequired' },
) {}

/** the reason is a closed set, so a client can explain the refusal precisely */
export class GrantNotEligible extends Schema.TaggedErrorClass<GrantNotEligible>()(
  'GRANT_NOT_ELIGIBLE',
  {
    reason: Schema.Literals([
      'role-unassignable',
      'user-disabled',
      'user-type',
      'org-type',
      'tenant-role-anchored',
      'org-role-unanchored',
    ]),
  },
  { httpApiStatus: 409, identifier: 'GrantNotEligible' },
) {}

export class RoleIsSystem extends Schema.TaggedErrorClass<RoleIsSystem>()(
  'ROLE_IS_SYSTEM',
  {},
  { httpApiStatus: 409, identifier: 'RoleIsSystem' },
) {}

export class RoleInUse extends Schema.TaggedErrorClass<RoleInUse>()(
  'ROLE_IN_USE',
  { grantCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'RoleInUse' },
) {}

export class RoleVersionConflict extends Schema.TaggedErrorClass<RoleVersionConflict>()(
  'ROLE_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'RoleVersionConflict' },
) {}

export class RoleNotDraft extends Schema.TaggedErrorClass<RoleNotDraft>()(
  'ROLE_NOT_DRAFT',
  {},
  { httpApiStatus: 409, identifier: 'RoleNotDraft' },
) {}

export class RoleConflict extends Schema.TaggedErrorClass<RoleConflict>()(
  'ROLE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'RoleConflict' },
) {}

export class PermissionNotFound extends Schema.TaggedErrorClass<PermissionNotFound>()(
  'PERMISSION_NOT_FOUND',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 404, identifier: 'PermissionNotFound' },
) {}

/**
 * A capability whose calling convention does not match the role's kind.
 *
 * An org capability inside a tenant role would apply at every node without any
 * grant having said so, and reaching every node belongs to the canonical
 * administrator alone.
 */
export class RoleTargetMismatch extends Schema.TaggedErrorClass<RoleTargetMismatch>()(
  'ROLE_TARGET_MISMATCH',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 422, identifier: 'RoleTargetMismatch' },
) {}

export class RoleNeedsEligibility extends Schema.TaggedErrorClass<RoleNeedsEligibility>()(
  'ROLE_NEEDS_ELIGIBILITY',
  {},
  { httpApiStatus: 422, identifier: 'RoleNeedsEligibility' },
) {}

export class RoleUserTypeNotFound extends Schema.TaggedErrorClass<RoleUserTypeNotFound>()(
  'ROLE_USER_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'RoleUserTypeNotFound' },
) {}

export class RoleOrgTypeNotFound extends Schema.TaggedErrorClass<RoleOrgTypeNotFound>()(
  'ROLE_ORG_TYPE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'RoleOrgTypeNotFound' },
) {}

/** grants the eligibility sets, as requested, would leave nobody qualified for */
export class GrantStranded extends Schema.TaggedErrorClass<GrantStranded>()(
  'GRANT_STRANDED',
  { grantCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'GrantStranded' },
) {}

/**
 * The actor holds no role whose appointment rules name this one.
 *
 * Deliberately not the escalation refusal: that one measures how much
 * authority the role carries against the actor's own, and this one asks
 * whether the office is theirs to appoint at all. Holding every permission a
 * college administrator has does not make somebody the person who appoints
 * college administrators.
 */
export class GrantRuleRefused extends Schema.TaggedErrorClass<GrantRuleRefused>()(
  'GRANT_RULE_REFUSED',
  {},
  { httpApiStatus: 403, identifier: 'GrantRuleRefused' },
) {}

/**
 * Nobody hands a role to themselves, or takes their own away.
 *
 * Ordinary governance: authority is conferred by somebody else. A resignation
 * would be its own business action, not a self-edit on the grants screen.
 */
export class GrantSelfForbidden extends Schema.TaggedErrorClass<GrantSelfForbidden>()(
  'GRANT_SELF_FORBIDDEN',
  {},
  { httpApiStatus: 403, identifier: 'GrantSelfForbidden' },
) {}

export class RoleEscalationRefused extends Schema.TaggedErrorClass<RoleEscalationRefused>()(
  'ROLE_ESCALATION_REFUSED',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 403, identifier: 'RoleEscalationRefused' },
) {}

export class GrantEscalationRefused extends Schema.TaggedErrorClass<GrantEscalationRefused>()(
  'GRANT_ESCALATION_REFUSED',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 403, identifier: 'GrantEscalationRefused' },
) {}

/** an org capability asked about without saying where */
export class AccessTargetRequired extends Schema.TaggedErrorClass<AccessTargetRequired>()(
  'ACCESS_TARGET_REQUIRED',
  {},
  { httpApiStatus: 400, identifier: 'AccessTargetRequired' },
) {}

/** what a role still needs before it can be activated */
export class RoleIncomplete extends Schema.TaggedErrorClass<RoleIncomplete>()(
  'ROLE_INCOMPLETE',
  { missing: Schema.Array(Schema.Literals(['permissions', 'user-types', 'org-types'])) },
  { httpApiStatus: 422, identifier: 'RoleIncomplete' },
) {}
