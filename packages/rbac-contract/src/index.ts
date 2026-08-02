// the rbac service contract: plugins that declare permissions or consume
// authorization depend on this package instead of the rbac implementation,
// which keeps the package graph acyclic (the implementation itself depends
// on auth/org schemas)
import type {} from 'cordis'

export interface PermissionDefinition {
  code: string
  name: string
  description?: string
  groupKey?: string
  scope: 'tenant' | 'org'
  grantToUserType: boolean
  grantToRole: boolean
  defaultTenantAdmin: boolean
}

export interface AccessProfile {
  tenantPermissions: string[]
  orgPermissions: string[]
}

export interface AssignmentInput {
  tenantId: string
  userId: string
  roleId: string
  orgNodeId: string
  scope: 'self' | 'subtree'
}

export interface Principal {
  tenantId: string
  userId: string
  sessionId: string
}

// where a principal's grants for one org-scope permission are anchored;
// consumers project subtree coverage onto their own structures
export interface AuthorizationAnchor {
  orgNodeId: string
  scope: 'self' | 'subtree'
}

// minimal query surface a caller may pass so an rbac read runs on the
// caller's own transaction connection. Never omit it while holding a lock:
// a second pool connection under a held lock can exhaust the pool and
// deadlock the whole process.
export interface RbacDbHandle {
  execute(query: unknown): Promise<{ rows: unknown[] }>
}

export interface RbacService {
  definePermissions(plugin: string, definitions: readonly PermissionDefinition[]): void
  whenSynced(): Promise<void>
  hasPermission(principal: Principal, code: string): Promise<boolean>
  require(principal: Principal | undefined, code: string): Promise<void>
  canAt(principal: Principal, code: string, targetOrgNodeId: string): Promise<boolean>
  requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
  ): Promise<void>
  getProfile(principal: Principal): Promise<AccessProfile>
  listAuthorizedAnchors(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationAnchor[]>
  createAssignment(input: AssignmentInput): Promise<string>
  removeAssignment(tenantId: string, assignmentId: string): Promise<void>
  // role codes of org-kind assignments at the node whose role does not allow
  // the given org type; used by org before a node type change
  assignmentsBlockingOrgType(
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
