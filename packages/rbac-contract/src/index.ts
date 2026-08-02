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
  createAssignment(input: AssignmentInput): Promise<string>
  removeAssignment(tenantId: string, assignmentId: string): Promise<void>
}

declare module 'cordis' {
  interface Context {
    rbac: RbacService
  }
}
