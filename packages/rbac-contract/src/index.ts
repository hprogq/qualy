// the rbac service contract: plugins that declare permissions or consume
// authorization depend on this package instead of the rbac implementation,
// which keeps the package graph acyclic (the implementation itself depends
// on auth/org schemas)
import type {} from 'cordis'

export { accessInvariantErrors } from './errors.ts'
export { isSystemActor, type SystemActor } from './system-actor.ts'
export { scopeCoverage } from './scope.ts'
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
  name: string
  description?: string
  groupKey?: string
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
export interface RbacDbHandle {
  execute(query: unknown): Promise<{ rows: unknown[] }>
}

// one grant of one role to one user. A tenant role reaches the whole tenant
// and carries no node; an org role is anchored and carries both.
export type GrantTarget =
  | { kind: 'tenant' }
  | { kind: 'org-node'; orgNodeId: string; coverage: 'self' | 'subtree' }

export interface GrantInput {
  tenantId: string
  userId: string
  roleId: string
  target: GrantTarget
}

export interface RbacService {
  definePermissions(plugin: string, definitions: readonly PermissionDefinition[]): void
  whenSynced(): Promise<void>
  // the active catalog: definitions whose plugin is loaded and whose stored
  // row still agrees with it. A code outside this set authorizes nothing.
  listPermissions(filter?: { target?: PermissionTarget; plugin?: string }): ActivePermission[]
  getPermission(code: string): ActivePermission | undefined

  hasPermission(principal: Principal, code: string): Promise<boolean>
  require(principal: Principal | undefined, code: string): Promise<void>
  canAt(
    principal: Principal,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<boolean>
  requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<void>
  getProfile(principal: Principal): Promise<AccessProfile>
  // how far one org-target permission reaches for this principal; consumers
  // project it onto their own structures
  listAuthorizedScope(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationScope>

  // the cross-domain invariant: after the caller's own writes, the tenant
  // must still have at least one administrator who can sign in. Always runs
  // inside the caller's transaction — it takes row locks and must see the
  // uncommitted final state, so the handle is required.
  assertTenantKeepsAdministrator(tenantId: string, handle: RbacDbHandle): Promise<void>

  // the actor is required, not optional: an entry point that silently skips
  // authorization when a caller omits an argument is one every caller
  // eventually omits
  grant(actor: Principal, input: GrantInput): Promise<string>
  revoke(actor: Principal, tenantId: string, grantId: string): Promise<void>
  // role codes of org-kind grants at the node whose role does not allow the
  // given org type; used by org before a node type change
  grantsBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: RbacDbHandle,
  ): Promise<string[]>
}

declare module 'cordis' {
  interface Context {
    rbac: RbacService
  }
}
