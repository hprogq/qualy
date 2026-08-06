import { Context, Effect, Layer } from 'effect'
import {
  AccessDenied,
  LastAdministrator,
  PermissionCatalog,
  Rbac,
  type RbacShape,
} from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Assembled } from '@qualy/api-kit/assembled'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { CANONICAL_ADMIN_ROLE } from '@qualy/rbac-contract'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { UiAuthorizer } from '@qualy/plugin-ui-registry/server/authorizer'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { accessApiGroup } from '../api.ts'
import { make as makeGrants, type GrantRow } from './grants.ts'
import { rbacEntityManager } from './db.ts'
import { REACH_RANK, type Reach } from './authorization.ts'
import {
  administratorSurvivors,
  authorizedScope,
  canAt as canAtQuery,
  effectiveRows as effectiveRowsQuery,
  grantsBlockingOrgType,
  grantsBlockingUserType,
  hasTenantPermission as hasTenantPermissionQuery,
  lockAdministratorRole,
  permissionRow,
  refreshPermissionText,
  upsertPermission,
  reachAt as reachAtQuery,
  rolesStrandedByUserType,
} from './authorization.ts'
import { make as makeRoles } from './roles.ts'
import { make as makeDiagnostics } from './diagnostics.ts'
import { ESCALATE, type Authority } from './escalation.ts'
import { type GrantScope } from './grants.ts'
import { type RoleRow as RoleProjection } from './db.ts'

// rbac as an Effect layer, and the root of the graph.
//
// It reads auth's and org's tables by raw SQL and holds neither service, which
// is what keeps the service graph acyclic. That must stay true: turning any of
// those reads into a call on Auth or Org is the single change that would make
// the graph genuinely cyclic, and no incident asks for it.
//
// The catalog arrives complete: the assembler compiles every plugin's
// declaration before any service layer builds, so this layer is handed a
// finished value and is downstream of nobody. The mirror into the table
// still runs at the assembled barrier - a database write belongs after
// every layer and before the port.
//
// No handle parameter anywhere. A call made inside a caller's transaction joins
// it because the connection travels in the fiber, so the authorization checks
// that must see the caller's uncommitted state do, by construction rather than
// by remembering an argument.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export const make = Effect.fn('Rbac.make')(function* (declared: readonly ActivePermission[]) {
  // this layer's database, closed over: what it builds is a service, and a
  // service that demands the orm has handed the orm to every caller
  const withDb = yield* withDatabase

  /** the same effect, with that database supplied */
  const bound =
    <Args extends unknown[], A, E, R>(fn: (...args: Args) => Effect.Effect<A, E, R>) =>
    (...args: Args) =>
      withDb(fn(...args))

  // The catalog is mirrored into the permissions table before anything reads
  // it, because the authorization statements join that table: a code the
  // declaration knows and the table does not authorizes nothing.
  //
  // Mirrored at the assembled barrier rather than while this layer is built:
  // contributors declare their codes while THEIR layers are built, and they
  // build on top of this one. The barrier is after every layer and before the
  // port binds, so the order requests observe is unchanged - a complete table,
  // or no server. A stable container rather than a reassigned field, filled
  // once the declarations are complete.
  const catalog = new Map<string, ActivePermission>()
  const mirror = withDb(
    Effect.gen(function* () {
      for (const permission of declared) {
        // Ownership and calling convention are the stable semantics, so a
        // stored row that disagrees with the declaration is refused rather
        // than overwritten: live grants already assume the old meaning, and a
        // changed meaning needs a new code. Failing here stops the boot
        // instead of an instance authorizing against a half-synced table.
        const em = yield* rbacEntityManager()
        yield* upsertPermission(em, permission).pipe(Effect.orDie)
        const stored = yield* permissionRow(em, permission.code).pipe(Effect.orDie)
        if (
          !stored ||
          stored.plugin !== permission.plugin ||
          stored.targetKind !== permission.target
        ) {
          return yield* Effect.die(
            new Error(
              `permission ${permission.code} conflicts with its stored row; changed ownership or ` +
                'calling convention needs a new code',
            ),
          )
        }
        yield* refreshPermissionText(em, permission).pipe(Effect.orDie)
        catalog.set(permission.code, permission)
      }
    }),
  )

  // a code the catalog does not serve authorizes nothing, whatever a stored
  // row says
  const definitionOf = (code: string) => catalog.get(code)

  const hasTenantPermission = bound(
    Effect.fn('Rbac.hasTenantPermission')(function* (
      principal: Principal,
      definition: ActivePermission,
    ) {
      const em = yield* rbacEntityManager()
      return yield* hasTenantPermissionQuery(em, principal, definition).pipe(Effect.orDie)
    }),
  )

  const scopeOf = bound(
    Effect.fn('Rbac.scopeOf')(function* (principal: Principal, definition: ActivePermission) {
      const em = yield* rbacEntityManager()
      return yield* authorizedScope(em, principal, definition).pipe(Effect.orDie)
    }),
  )

  /**
   * Rows pinned to what the catalog serves.
   *
   * A stored permission row whose plugin or target no longer matches the
   * declaration contributes nothing, so a row edited out of band stops
   * authorizing rather than starting to.
   */
  const effectiveRows = bound(
    Effect.fn('Rbac.effectiveRows')(function* (
      principal: Principal,
      target: { orgNodeId: string } | 'anywhere' | undefined,
    ) {
      const em = yield* rbacEntityManager()
      const found = yield* effectiveRowsQuery(em, principal, target).pipe(Effect.orDie)
      const kept: { definition: ActivePermission; roleKind: 'tenant' | 'org' }[] = []
      for (const row of found) {
        const definition = catalog.get(row.code)
        if (!definition) continue
        if (row.plugin !== definition.plugin || row.targetKind !== definition.target) continue
        kept.push({ definition, roleKind: row.kind as 'tenant' | 'org' })
      }
      return kept
    }),
  )

  /** the strongest reach the principal has for each code at one node */
  const reachAt = bound(
    Effect.fn('Rbac.reachAt')(function* (principal: Principal, orgNodeId: string) {
      const em = yield* rbacEntityManager()
      const found = yield* reachAtQuery(em, principal, orgNodeId).pipe(Effect.orDie)
      const reach = new Map<string, Reach>()
      for (const row of found) {
        const definition = catalog.get(row.code)
        if (!definition) continue
        if (row.plugin !== definition.plugin || row.targetKind !== definition.target) continue
        const here: Reach = row.everyNode ? 'tenant' : (row.coverage ?? 'self')
        const known = reach.get(definition.code)
        if (known === undefined || REACH_RANK[here] > REACH_RANK[known]) {
          reach.set(definition.code, here)
        }
      }
      return reach
    }),
  )

  const canAt: RbacShape['canAt'] = bound(
    Effect.fn('Rbac.canAt')(function* (principal, code, targetOrgNodeId) {
      const definition = definitionOf(code)
      if (!definition) return false
      if (definition.target !== 'org-node') {
        // a tenant code checked against a node is a caller mistake rather than a
        // denial, and answering false would hide it
        return yield* Effect.die(
          new Error(`canAt() got a tenant permission ${code}, use require()`),
        )
      }
      const em = yield* rbacEntityManager()
      return yield* canAtQuery(em, principal, definition, targetOrgNodeId).pipe(Effect.orDie)
    }),
  )

  const listAuthorizedScope: RbacShape['listAuthorizedScope'] = Effect.fn(
    'Rbac.listAuthorizedScope',
  )(function* (principal, code) {
    const definition = definitionOf(code)
    if (!definition || definition.target !== 'org-node') {
      return { tenantWide: false, anchors: [] }
    }
    return yield* scopeOf(principal, definition)
  })

  const hasPermission: RbacShape['hasPermission'] = Effect.fn('Rbac.hasPermission')(
    function* (principal, code) {
      const definition = definitionOf(code)
      if (!definition) return false
      if (definition.target === 'tenant') return yield* hasTenantPermission(principal, definition)
      const scope = yield* scopeOf(principal, definition)
      return scope.tenantWide || scope.anchors.length > 0
    },
  )

  /** what the guards ask about an actor, answered from this layer's own reads */
  const authorityFor = (actor: Principal): Authority => ({
    tenantWide: () =>
      effectiveRows(actor, undefined).pipe(
        Effect.map((held) => new Set(held.map(({ definition }) => definition.code))),
      ),
    reachAt: (orgNodeId: string) => reachAt(actor, orgNodeId),
    activeCodes: () => [...catalog.keys()],
    catalog: () => catalog,
  })

  // not orDie: the refusal is a declared 409 on three endpoints, and a defect
  // would answer 500 with no code. auth calls the same port without orDie,
  // which is what made this a slip rather than a policy.
  const keepsAdministrator = (tenantId: string) => shapeRef.assertTenantKeepsAdministrator(tenantId)

  const grants = yield* makeGrants(authorityFor)
  const roles = yield* makeRoles(authorityFor, keepsAdministrator)
  const diagnostics = yield* makeDiagnostics(() => catalog)

  /**
   * Which grants a caller may see and change.
   *
   * A tenant-wide grant has no node, so node coverage cannot decide it: those
   * answer to their own tenant permissions. Read is implied by manage, because
   * being unable to see what you may revoke is not a narrower permission, it
   * is a broken screen.
   */
  const grantScopeFor = Effect.fn('Rbac.grantScope')(function* (actor: Principal) {
    const held = new Set(
      (yield* effectiveRows(actor, undefined)).map(({ definition }) => definition.code),
    )
    return {
      read: yield* listAuthorizedScope(actor, 'iam.grant.read'),
      manage: yield* listAuthorizedScope(actor, 'iam.grant.manage'),
      tenantGrants: {
        read: held.has('iam.tenant-grant.read') || held.has('iam.tenant-grant.manage'),
        manage: held.has('iam.tenant-grant.manage'),
      },
    }
  })

  // eslint-disable-next-line prefer-const -- assigned below, read lazily by
  // the role lifecycle, which needs the invariant this shape exposes
  let shapeRef: RbacShape

  const shape: RbacShape = {
    listPermissions: (filter) =>
      Effect.succeed(
        [...catalog.values()].filter(
          (permission) =>
            (filter?.target === undefined || permission.target === filter.target) &&
            (filter?.plugin === undefined || permission.plugin === filter.plugin),
        ),
      ),
    getPermission: (code) => Effect.succeed(definitionOf(code)),
    hasPermission,
    canAt,
    listAuthorizedScope,
    require: Effect.fn('Rbac.require')(function* (principal, code) {
      const definition = definitionOf(code)
      if (!definition) return yield* new AccessDenied({ reason: 'unknown permission' })
      if (definition.target !== 'tenant') {
        return yield* Effect.die(
          new Error(`require() got an org-node permission ${code}, use requireAt()`),
        )
      }
      if (!(yield* hasTenantPermission(principal, definition))) {
        return yield* new AccessDenied({ reason: 'permission not held' })
      }
    }),
    requireAt: Effect.fn('Rbac.requireAt')(function* (principal, code, targetOrgNodeId) {
      if (!definitionOf(code)) return yield* new AccessDenied({ reason: 'unknown permission' })
      if (!(yield* canAt(principal, code, targetOrgNodeId))) {
        return yield* new AccessDenied({ reason: 'permission not held at this node' })
      }
    }),
    grantsBlockingOrgType: bound(
      Effect.fn('Rbac.grantsBlockingOrgType')(function* (tenantId, orgNodeId, orgTypeId) {
        const em = yield* rbacEntityManager()
        return yield* grantsBlockingOrgType(em, tenantId, orgNodeId, orgTypeId).pipe(Effect.orDie)
      }),
    ),
    rolesStrandedByUserType: bound(
      Effect.fn('Rbac.rolesStrandedByUserType')(function* (tenantId: string, userTypeId: string) {
        const em = yield* rbacEntityManager()
        return yield* rolesStrandedByUserType(em, tenantId, userTypeId).pipe(Effect.orDie)
      }),
    ),
    grantsBlockingUserType: bound(
      Effect.fn('Rbac.grantsBlockingUserType')(function* (
        tenantId: string,
        userId: string,
        userTypeId: string,
      ) {
        const em = yield* rbacEntityManager()
        return yield* grantsBlockingUserType(em, tenantId, userId, userTypeId).pipe(Effect.orDie)
      }),
    ),
    assertTenantKeepsAdministrator: bound(
      Effect.fn('Rbac.assertTenantKeepsAdministrator')(function* (tenantId: string) {
        // runs on the caller's connection because the connection is in the
        // fiber, which is what lets it read the final state of the caller's
        // transaction rather than a prediction of it
        const em = yield* rbacEntityManager()
        const role = yield* lockAdministratorRole(em, tenantId, CANONICAL_ADMIN_ROLE).pipe(
          Effect.orDie,
        )
        // fail closed: carrying on here would let every admin-reducing write
        // through on exactly the tenants least able to survive one
        if (!role) {
          return yield* Effect.die(
            new Error(
              `tenant ${tenantId} has no canonical administrator role; refusing to change access`,
            ),
          )
        }
        const survivors = yield* administratorSurvivors(em, tenantId, role.id).pipe(Effect.orDie)
        if (survivors === 0) return yield* new LastAdministrator()
      }),
    ),
    getProfile: Effect.fn('Rbac.getProfile')(function* (principal) {
      // "anywhere at all" rather than "here": the manifest asks what a viewer
      // may discover, and an org capability held at one node is discoverable
      // even though it applies at no other.
      //
      // One statement rather than one per code, and the same statement the
      // cordis service runs. Rebuilding this from the scope projection gave a
      // different answer: that requires an anchor with both a node and a
      // coverage, where this includes a code as soon as any active role
      // carries it.
      const rows_ = yield* effectiveRows(principal, 'anywhere')
      const tenantPermissions: string[] = []
      const orgPermissions: string[] = []
      for (const { definition, roleKind } of rows_) {
        if (definition.target === 'tenant') {
          if (roleKind === 'tenant') tenantPermissions.push(definition.code)
        } else {
          orgPermissions.push(definition.code)
        }
      }
      return {
        tenantPermissions: [...new Set(tenantPermissions)].sort(),
        orgPermissions: [...new Set(orgPermissions)].sort(),
      }
    }),
  }
  shapeRef = shape
  return { ...shape, grants, roles, diagnostics, grantScopeFor, mirror }
})

/**
 * What this plugin contributes to the running application.
 *
 * It requires the database and the resolved catalog, and nothing else. No
 * server and no ui registry: handler layers are provided into the server
 * rather than the other way round, which is what keeps rbac deployable with a
 * database alone.
 */
export class Access extends Context.Service<
  Access,
  {
    readonly grants: Effect.Success<ReturnType<typeof makeGrants>>
    readonly roles: Effect.Success<ReturnType<typeof makeRoles>>
    readonly diagnostics: Effect.Success<ReturnType<typeof makeDiagnostics>>
    readonly grantScopeFor: (actor: Principal) => Effect.Effect<GrantScope>
  }
>()('@qualy/plugin-rbac/Access') {}

/**
 * What this plugin contributes.
 *
 * Two tags from one construction: the port peers hold, and rbac's own
 * administration surface, which no peer reaches through a tag.
 */
/** the service alone; the entry composes it with the screen it registers */
export const serviceLayer: Layer.Layer<
  Rbac | Access | UiAuthorizer,
  never,
  Orm | PermissionCatalog | Assembled
> = Layer.effectContext(
  Effect.gen(function* () {
    const declared = yield* PermissionCatalog
    const { grants, roles, diagnostics, grantScopeFor, mirror, ...shape } = yield* make(declared)
    // the mirror runs at the barrier; a failure there stops the boot, which
    // is the same outcome mirroring at construction had
    const assembled = yield* Assembled
    yield* assembled.register({ name: 'rbac/permission-catalog', run: mirror })
    return Context.empty().pipe(
      Context.add(Rbac, shape),
      Context.add(Access, { grants, roles, diagnostics, grantScopeFor }),
      // The one live registration the shell needs: which codes a viewer holds
      // anywhere in their tenant. It is published from here because rbac is
      // the only thing that can answer it, and it is a required service, so an
      // assembly that serves a manifest without one fails to build rather than
      // quietly showing every signed-in viewer nothing but public pages.
      Context.add(UiAuthorizer, {
        permissionsFor: (principal) =>
          shape
            .getProfile(principal)
            .pipe(
              Effect.map(
                (profile) => new Set([...profile.tenantPermissions, ...profile.orgPermissions]),
              ),
            ),
      }),
    )
  }),
)

// --- api ---

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(accessApiGroup).prefix(QUALY_API_PREFIX)

/** the projection a role screen reads, assembled from the row and the catalog */
const toRoleShape = (
  role: RoleProjection,
  permissions: { active: readonly string[]; unavailable: readonly string[] },
) => ({
  id: role.id,
  code: role.code,
  name: role.name,
  description: role.description,
  kind: role.kind,
  status: role.status,
  holdsEveryPermission: role.permissionMode === 'all-active',
  systemKey: role.systemKey,
  assignable: role.assignable,
  version: role.version,
  grantCount: role.grantCount,
  permissions: permissions.active,
  unavailablePermissions: permissions.unavailable,
  eligibility:
    role.eligibilityMode === 'unrestricted'
      ? { mode: 'unrestricted' as const }
      : { mode: 'allow-list' as const, userTypeIds: role.allowedUserTypes },
  anchor:
    role.anchorMode === 'unrestricted'
      ? { mode: 'unrestricted' as const }
      : { mode: 'allow-list' as const, orgTypeIds: role.allowedOrgTypes },
})

const toGrantShape = (row: GrantRow) => ({
  id: row.id,
  userId: row.userId,
  userDisplayName: row.userDisplayName,
  roleId: row.roleId,
  roleCode: row.roleCode,
  roleName: row.roleName,
  roleKind: row.roleKind,
  target:
    row.orgNodeId === null
      ? ({ kind: 'tenant' } as const)
      : ({
          kind: 'org-node',
          orgNodeId: row.orgNodeId,
          orgNodeName: row.orgNodeName ?? '',
          coverage: row.coverage ?? 'self',
        } as const),
  manageable: row.manageable,
})

export const accessApiHandlers = HttpApiBuilder.group(local, 'access', (handlers) =>
  handlers
    .handle(
      'listPermissions',
      Effect.fn('access.listPermissions.handler')(function* ({ query }) {
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        const search = query.search?.trim().toLowerCase()
        const permissions = (yield* rbac.listPermissions({
          target: query.target,
          plugin: query.plugin,
        })).filter(
          (definition) =>
            !search ||
            definition.code.toLowerCase().includes(search) ||
            definition.name.toLowerCase().includes(search),
        )
        return {
          // sorted by code, as the registry's own reads are: the checkbox list
          // a client renders is in whatever order it receives
          permissions: [...permissions]
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((definition) => ({
              code: definition.code,
              plugin: definition.plugin,
              name: definition.name,
              description: definition.description ?? null,
              groupKey: definition.groupKey ?? null,
              target: definition.target,
            })),
        }
      }),
    )
    .handle(
      'getRoleOptions',
      Effect.fn('access.getRoleOptions.handler')(function* () {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        return yield* access.roles.options(principal.tenantId)
      }),
    )
    .handle(
      'listRoles',
      Effect.fn('access.listRoles.handler')(function* ({ query }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        const found = yield* access.roles.list(principal.tenantId, query, principal)
        return {
          roles: found.map(({ role, permissions }) => toRoleShape(role, permissions)),
          capabilities: {
            canManage: yield* rbac.hasPermission(principal, 'iam.role.manage'),
            canEscalate: yield* rbac.hasPermission(principal, ESCALATE),
          },
        }
      }),
    )
    .handle(
      'getRole',
      Effect.fn('access.getRole.handler')(function* ({ params }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        const { role, permissions } = yield* access.roles.get(
          principal.tenantId,
          params.roleId,
          principal,
        )
        return { role: toRoleShape(role, permissions) }
      }),
    )
    .handle(
      'getRoleGrantOptions',
      Effect.fn('access.getRoleGrantOptions.handler')(function* ({ query }) {
        const access = yield* Access
        const principal = yield* CurrentUser
        const target =
          query.orgNodeId === undefined
            ? ({ kind: 'tenant' } as const)
            : ({
                kind: 'org-node',
                orgNodeId: query.orgNodeId,
                coverage: query.coverage ?? 'self',
              } as const)
        return {
          roles: yield* access.grants.options(
            principal.tenantId,
            { userId: query.userId, target },
            principal,
          ),
        }
      }),
    )
    .handle(
      'listRoleGrants',
      Effect.fn('access.listRoleGrants.handler')(function* ({ query }) {
        const access = yield* Access
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        // the cursor belongs to this filter and no other
        const fingerprint = `grants:${query.orgNodeId ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, 1)
        if (key === null) return yield* cursorUnusable()
        const found = yield* access.grants.list(
          principal.tenantId,
          { orgNodeId: query.orgNodeId },
          yield* access.grantScopeFor(principal),
          { after: key?.[0], limit: limit + 1 },
        )
        const items = found.slice(0, limit)
        const last = items.at(-1)
        return {
          items: items.map(toGrantShape),
          nextCursor:
            found.length > limit && last ? encodeQueryCursor(fingerprint, [last.id]) : null,
        }
      }),
    )
    .handle(
      'getUserRoleGrants',
      Effect.fn('access.getUserRoleGrants.handler')(function* ({ params }) {
        const access = yield* Access
        const principal = yield* CurrentUser
        const found = yield* access.grants.list(
          principal.tenantId,
          { userId: params.userId },
          yield* access.grantScopeFor(principal),
        )
        return { grants: found.map(toGrantShape) }
      }),
    )
    .handle(
      'getUserEffectivePermissions',
      Effect.fn('access.getUserEffectivePermissions.handler')(function* ({ params, query }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.authorization.inspect')
        return {
          permissions: yield* access.diagnostics.explain(
            principal.tenantId,
            params.userId,
            query.orgNodeId,
          ),
        }
      }),
    )
    .handle(
      'evaluateAccess',
      Effect.fn('access.evaluateAccess.handler')(function* ({ payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.authorization.inspect')
        return yield* access.diagnostics.evaluate(principal.tenantId, payload)
      }),
    )
    .handle(
      'createRole',
      Effect.fn('access.createRole.handler')(function* ({ payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        // the created row's status and version travel back, so a client can
        // continue without a read: the management api creates drafts only
        return {
          id: yield* access.roles.create(principal.tenantId, payload),
          status: 'draft' as const,
          version: 1,
        }
      }),
    )
    .handle(
      'updateRole',
      Effect.fn('access.updateRole.handler')(function* ({ params, payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        const { version, ...fields } = payload
        return {
          version: yield* access.roles.update(principal.tenantId, params.roleId, fields, version),
        }
      }),
    )
    .handle(
      'setRoleStatus',
      Effect.fn('access.setRoleStatus.handler')(function* ({ params, payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        return {
          version: yield* access.roles.setStatus(
            principal.tenantId,
            params.roleId,
            payload.status,
            payload.version,
            principal,
          ),
        }
      }),
    )
    .handle(
      'getRolePermissions',
      Effect.fn('access.getRolePermissions.handler')(function* ({ params }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        const carried = yield* access.roles.getPermissions(
          principal.tenantId,
          params.roleId,
          principal,
        )
        return { codes: carried.active, version: carried.version }
      }),
    )
    .handle(
      'setRolePermissions',
      Effect.fn('access.setRolePermissions.handler')(function* ({ params, payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        return {
          version: yield* access.roles.setPermissions(
            principal.tenantId,
            params.roleId,
            payload.codes,
            payload.version,
            principal,
          ),
        }
      }),
    )
    .handle(
      'getRoleEligibility',
      Effect.fn('access.getRoleEligibility.handler')(function* ({ params }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.read')
        return yield* access.roles.getEligibility(principal.tenantId, params.roleId)
      }),
    )
    .handle(
      'setRoleEligibility',
      Effect.fn('access.setRoleEligibility.handler')(function* ({ params, payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        return {
          version: yield* access.roles.setEligibility(
            principal.tenantId,
            params.roleId,
            payload,
            payload.version,
          ),
        }
      }),
    )
    .handle(
      'deleteRole',
      Effect.fn('access.deleteRole.handler')(function* ({ params, query }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        yield* access.roles.remove(principal.tenantId, params.roleId, Number(query.version))
        return { ok: true as const }
      }),
    )
    .handle(
      'createRoleGrant',
      Effect.fn('access.createRoleGrant.handler')(function* ({ payload }) {
        const access = yield* Access
        const principal = yield* CurrentUser
        // every check lives in the service, on the locked connection: which
        // grants this caller may touch, which role, whether the person is
        // eligible, and how much power the role carries
        return {
          id: yield* access.grants.grant(
            principal.tenantId,
            { userId: payload.userId, roleId: payload.roleId, target: payload.target },
            principal,
          ),
        }
      }),
    )
    .handle(
      'deleteRoleGrant',
      Effect.fn('access.deleteRoleGrant.handler')(function* ({ params }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* access.grants.revoke(principal.tenantId, params.grantId, principal, (tenantId) =>
          rbac.assertTenantKeepsAdministrator(tenantId).pipe(Effect.orDie),
        )
        return { ok: true as const }
      }),
    ),
)
