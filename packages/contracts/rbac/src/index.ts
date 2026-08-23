// the rbac service contract: plugins that declare permissions or consume
// authorization depend on this package instead of the rbac implementation,
// which keeps the package graph acyclic (the implementation itself depends
// on auth/org schemas)

import type { UiText } from '@qualy/i18n-contract'
export { isSystemActor, type SystemActor } from './system-actor.ts'
export { scopeCoverage, type OrgNodeRef } from './scope.ts'

// one grant of one role to one user. A tenant role reaches the whole tenant
// and carries no node; an org role is anchored and carries both.
export type GrantTarget =
  { kind: 'tenant' } | { kind: 'org-node'; orgNodeId: string; coverage: 'self' | 'subtree' }

export interface GrantInput {
  tenantId: string
  userId: string
  roleId: string
  target: GrantTarget
}

export {
  CANONICAL_ADMIN_ROLE,
  canonicalTenantAdmin,
  isCanonicalTenantAdmin,
  type CanonicalAdminShape,
} from './canonical.ts'

// What a permission protects, and therefore how it is checked. This is the
// permission's calling convention, not a policy knob: a tenant-target code
// is checked with require(), an org-target one with requireAt() against a
// node. An administrator who could flip it would not change how the handler
// asks — they would only break the ask. Named `target` because this codebase
// already has two other things a reader would call a scope: a role's kind
// and a grant's coverage.
export type PermissionTarget = 'tenant' | 'org-node'

// Everything a plugin declares about one capability. Deliberately absent:
// which channel may carry it (permissions reach people through roles and
// nothing else) and who holds it by default (that is a property of the
// administrator role, not of every permission in the system).
export interface PermissionDefinition {
  code: string
  /**
   * What a person administering roles sees on the tick box.
   *
   * UiText, not a string: this is authored product copy that crosses to a
   * browser, and the boundary says the server carries the semantics while
   * the reader's own language is chosen there. The declaring plugin owns
   * the message id, so a permission is named by whoever defined it.
   */
  name: UiText
  description?: UiText
  /**
   * Which part of the product this permission belongs to.
   *
   * The key is stable and machine-facing; the name is what a reader sees on
   * the group heading, and it is UiText for the same reason `name` is - the
   * plugin that declares the permission is the one that gets to name the
   * section it appears under, and the language is chosen in the browser.
   */
  groupKey?: string
  group?: UiText
  target: PermissionTarget
}

// a definition plus the plugin that owns it, as the registry serves it
export interface ActivePermission extends PermissionDefinition {
  plugin: string
}

export interface AccessProfile {
  tenantPermissions: string[]
  orgPermissions: string[]
}

export interface Principal {
  tenantId: string
  userId: string
  sessionId: string
}

// where a principal's grants for one org-target permission are anchored
export interface AuthorizationAnchor {
  orgNodeId: string
  coverage: 'self' | 'subtree'
}

// How far a principal's grants for one permission reach. A tenant role is
// not anchored anywhere — it applies across the tenant — so an anchor list
// alone cannot express it, and a consumer that only looked at anchors would
// silently under-serve a tenant administrator.
export interface AuthorizationScope {
  tenantWide: boolean
  anchors: AuthorizationAnchor[]
}

// minimal query surface a caller may pass so an rbac read runs on the
// caller's own transaction connection. Never omit it while holding a lock:
// a second pool connection under a held lock can exhaust the pool and
// deadlock the whole process.
