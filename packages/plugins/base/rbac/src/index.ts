import { Context, Service } from 'cordis'
import type {} from '@qualy/plugin-ui-registry'
import type {
  AccessProfile,
  ActivePermission,
  AuthorizationScope,
  GrantInput,
  PermissionDefinition,
  PermissionTarget,
  Principal,
  RbacDbHandle,
  RbacService,
} from '@qualy/rbac-contract'
import { Authorization } from './authorization.ts'
import { PermissionRegistry } from './permission-registry.ts'
import { permissions as accessCatalog } from './permissions.ts'
import { Administration } from './administration.ts'
import { assertTenantKeepsAdministrator } from './invariants.ts'
import { createAccessRouter } from './router.ts'
import { rolesPage } from './ui.ts'
import { rbacNavigation } from './messages.ts'
import { ADMIN_SHELL, permissionOf } from '@qualy/ui-contract'

// composition root only: the registry owns the active catalog and its
// database mirror, authorization owns the checks, administration owns the
// writes. Effects register HERE so they belong to the calling plugin's fiber
// (this.ctx is caller-traceable inside service methods).
export default class Rbac extends Service implements RbacService {
  static inject = ['db']

  private registry: PermissionRegistry
  private authorization: Authorization
  readonly administration: Administration

  constructor(ctx: Context) {
    super(ctx, 'rbac')
    this.registry = new PermissionRegistry(ctx)
    this.authorization = new Authorization(ctx, this.registry)
    this.administration = new Administration(ctx, this.authorization)
    this.definePermissions('rbac', accessCatalog)
    ctx.inject(['server'], (serverCtx) => {
      serverCtx.server.contribute(
        'access',
        createAccessRouter(serverCtx, this.administration, this.authorization, this.registry),
      )
      // an instance whose permission catalogs did not sync would authorize
      // against an incomplete registry, so it must not take traffic
      serverCtx.server.readiness('permissions', () => this.whenSynced())
    })
    // the ui registry is optional: a headless deployment runs without it, so
    // the page and the authorizer register in a nested fiber that simply
    // stays pending when no registry is assembled
    ctx.inject(['ui'], (uiCtx) => {
      uiCtx.ui.addPage({
        page: rolesPage,
        component: 'rbac/RolesPage',
        layout: ADMIN_SHELL,
        visibility: permissionOf('iam.role.read'),
        navigation: { label: rbacNavigation.rolesNav, order: 32 },
      })
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

  listPermissions(filter?: { target?: PermissionTarget; plugin?: string }): ActivePermission[] {
    return this.registry.list(filter)
  }

  getPermission(code: string): ActivePermission | undefined {
    return this.registry.get(code)
  }

  hasPermission(principal: Principal, code: string): Promise<boolean> {
    return this.authorization.hasPermission(principal, code)
  }

  require(principal: Principal | undefined, code: string): Promise<void> {
    return this.authorization.require(principal, code)
  }

  canAt(
    principal: Principal,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<boolean> {
    return this.authorization.canAt(principal, code, targetOrgNodeId, handle)
  }

  requireAt(
    principal: Principal | undefined,
    code: string,
    targetOrgNodeId: string,
    handle?: RbacDbHandle,
  ): Promise<void> {
    return this.authorization.requireAt(principal, code, targetOrgNodeId, handle)
  }

  getProfile(principal: Principal): Promise<AccessProfile> {
    return this.authorization.getProfile(principal)
  }

  listAuthorizedScope(
    principal: Principal,
    code: string,
    handle?: RbacDbHandle,
  ): Promise<AuthorizationScope> {
    return this.authorization.listAuthorizedScope(principal, code, handle)
  }

  // the cross-domain lockout invariant; auth calls it inside its own
  // identity transactions, which take the same tenant lock
  assertTenantKeepsAdministrator(tenantId: string, handle: RbacDbHandle): Promise<void> {
    return assertTenantKeepsAdministrator(handle, tenantId)
  }

  grant(actor: Principal, input: GrantInput): Promise<string> {
    return this.administration.grant(
      input.tenantId,
      { userId: input.userId, roleId: input.roleId, target: input.target },
      actor,
    )
  }

  revoke(actor: Principal, tenantId: string, grantId: string): Promise<void> {
    return this.administration.revoke(tenantId, grantId, actor)
  }

  grantsBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: RbacDbHandle,
  ): Promise<string[]> {
    return this.administration.grantsBlockingOrgType(tenantId, orgNodeId, orgTypeId, handle)
  }
}
