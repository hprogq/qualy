import { Context, Service } from 'cordis'
import type {} from '@qualy/plugin-ui-registry'
import type {
  AccessProfile,
  AssignmentInput,
  AuthorizationAnchor,
  PermissionDefinition,
  Principal,
  RbacDbHandle,
  RbacService,
} from '@qualy/rbac-contract'
import { Assignments } from './assignments.ts'
import { Authorization } from './authorization.ts'
import { PermissionRegistry } from './permission-registry.ts'
import { permissions as rbacCatalog } from './permissions.ts'

// composition root only: the registry owns the active catalog and its
// database mirror, authorization owns the checks, assignments own the
// eligibility rules. Effects register HERE so they belong to the calling
// plugin's fiber (this.ctx is caller-traceable inside service methods).
export default class Rbac extends Service implements RbacService {
  static inject = ['db']

  private registry: PermissionRegistry
  private authorization: Authorization
  private assignments: Assignments

  constructor(ctx: Context) {
    super(ctx, 'rbac')
    this.registry = new PermissionRegistry(ctx)
    this.authorization = new Authorization(ctx, this.registry)
    this.assignments = new Assignments(ctx)
    this.definePermissions('rbac', rbacCatalog)
    // the ui registry is optional: a headless deployment runs without it,
    // so the authorizer registers in a nested fiber that simply stays
    // pending when no registry is assembled
    ctx.inject(['ui'], (uiCtx) => {
      uiCtx.ui.setAuthorizer(async (principal) => {
        const profile = await this.getProfile(principal)
        return [...profile.tenantPermissions, ...profile.orgPermissions]
      })
    })
  }

  definePermissions(plugin: string, definitions: readonly PermissionDefinition[]) {
    this.registry.validate(definitions)
    this.ctx.effect(() => {
      const registration = this.registry.activate(plugin, definitions)
      return () => {
        this.registry.deactivate(registration)
      }
    }, `permissions:${plugin}`)
  }

  whenSynced(): Promise<void> {
    return this.registry.whenSynced()
  }

  hasPermission(principal: Principal, code: string): Promise<boolean> {
    return this.authorization.hasPermission(principal, code)
  }

  require(principal: Principal | undefined, code: string): Promise<void> {
    return this.authorization.require(principal, code)
  }

  canAt(principal: Principal, code: string, targetOrgNodeId: string): Promise<boolean> {
    return this.authorization.canAt(principal, code, targetOrgNodeId)
  }

  requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
  ): Promise<void> {
    return this.authorization.requireAt(principal, code, targetOrgNodeId)
  }

  getProfile(principal: Principal): Promise<AccessProfile> {
    return this.authorization.getProfile(principal)
  }

  listAuthorizedAnchors(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationAnchor[]> {
    return this.authorization.listAuthorizedAnchors(principal, code, handle)
  }

  assignmentsBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: RbacDbHandle,
  ): Promise<string[]> {
    return this.assignments.assignmentsBlockingOrgType(tenantId, orgNodeId, orgTypeId, handle)
  }

  createAssignment(input: AssignmentInput): Promise<string> {
    return this.assignments.createAssignment(input)
  }

  removeAssignment(tenantId: string, assignmentId: string): Promise<void> {
    return this.assignments.removeAssignment(tenantId, assignmentId)
  }
}
