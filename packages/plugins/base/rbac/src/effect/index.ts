import { Context, Effect, Layer } from 'effect'
import {
  AccessDenied,
  LastAdministrator,
  PermissionCatalog,
  Rbac,
  type RbacShape,
} from '@qualy/rbac-contract/effect'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Database } from '@qualy/plugin-database/effect'
import { CANONICAL_ADMIN_ROLE } from '@qualy/rbac-contract'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { CurrentUser } from '@qualy/plugin-auth/effect/session'
import { accessApiGroup } from '../api.ts'
import { make as makeGrants } from './grants.ts'
import { make as makeRoles } from './roles.ts'
import type { Authority } from './escalation.ts'
import {
  REACH_RANK,
  type Reach,
  administratorSurvivorsQuery,
  permissionRowQuery,
  refreshPermissionTextQuery,
  upsertPermissionQuery,
  authorizedScopeQuery,
  effectiveRowsQuery,
  reachAtQuery,
  canAtQuery,
  foldScope,
  grantsBlockingOrgTypeQuery,
  hasTenantPermissionQuery,
  lockAdministratorRoleQuery,
  type ScopeRow,
} from '../queries.ts'

// rbac as an Effect layer, and the root of the graph.
//
// It reads auth's and org's tables by raw SQL and holds neither service, which
// is what keeps the service graph acyclic. That must stay true: turning any of
// those reads into a call on Auth or Org is the single change that would make
// the graph genuinely cyclic, and no incident asks for it.
//
// The catalog arrives rather than being collected. Contributors used to push
// their codes in from their own constructors, which a static graph cannot
// express, so the host resolves it from the manifest and hands it over.
//
// No handle parameter anywhere. A call made inside a caller's transaction joins
// it because the connection travels in the fiber, so the authorization checks
// that must see the caller's uncommitted state do, by construction rather than
// by remembering an argument.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export const make = Effect.fn('Rbac.make')(function* () {
  const database = yield* Database
  const declared = yield* PermissionCatalog

  // The catalog is mirrored into the permissions table before anything reads
  // it, because the authorization statements join that table: a code the
  // declaration knows and the table does not authorizes nothing.
  //
  // Ownership and calling convention are the stable semantics, so a stored row
  // that disagrees with the declaration is refused rather than overwritten:
  // live grants already assume the old meaning, and a changed meaning needs a
  // new code. Doing this while the layer is built means drift stops the
  // assembly instead of an instance authorizing against a half-synced table.
  const catalog = new Map<string, ActivePermission>()
  for (const permission of declared) {
    yield* database.execute(upsertPermissionQuery(permission)).pipe(Effect.orDie)
    const stored = rows<{ plugin: string; target_kind: string }>(
      yield* database.execute(permissionRowQuery(permission.code)).pipe(Effect.orDie),
    )[0]
    if (!stored || stored.plugin !== permission.plugin || stored.target_kind !== permission.target) {
      return yield* Effect.die(
        new Error(
          `permission ${permission.code} conflicts with its stored row; changed ownership or ` +
            'calling convention needs a new code',
        ),
      )
    }
    yield* database.execute(refreshPermissionTextQuery(permission)).pipe(Effect.orDie)
    catalog.set(permission.code, permission)
  }

  // a code the catalog does not serve authorizes nothing, whatever a stored
  // row says
  const definitionOf = (code: string) => catalog.get(code)

  const hasTenantPermission = Effect.fn('Rbac.hasTenantPermission')(function* (
    principal: Principal,
    definition: ActivePermission,
  ) {
    const result = yield* database
      .execute(hasTenantPermissionQuery(principal, definition))
      .pipe(Effect.orDie)
    return rows<{ allowed: boolean }>(result)[0]?.allowed ?? false
  })

  const scopeOf = Effect.fn('Rbac.scopeOf')(function* (
    principal: Principal,
    definition: ActivePermission,
  ) {
    const result = yield* database
      .execute(authorizedScopeQuery(principal, definition))
      .pipe(Effect.orDie)
    return foldScope(rows<ScopeRow>(result))
  })

  /**
   * Rows pinned to what the catalog serves.
   *
   * A stored permission row whose plugin or target no longer matches the
   * declaration contributes nothing, so a row edited out of band stops
   * authorizing rather than starting to.
   */
  const effectiveRows = Effect.fn('Rbac.effectiveRows')(function* (
    principal: Principal,
    target: { orgNodeId: string } | 'anywhere' | undefined,
  ) {
    const result = yield* database
      .execute(effectiveRowsQuery(principal, target))
      .pipe(Effect.orDie)
    const kept: { definition: ActivePermission; roleKind: 'tenant' | 'org' }[] = []
    for (const row of rows<{
      code: string
      plugin: string
      target_kind: string
      kind: 'tenant' | 'org'
    }>(result)) {
      const definition = catalog.get(row.code)
      if (!definition) continue
      if (row.plugin !== definition.plugin || row.target_kind !== definition.target) continue
      kept.push({ definition, roleKind: row.kind })
    }
    return kept
  })

  /** the strongest reach the principal has for each code at one node */
  const reachAt = Effect.fn('Rbac.reachAt')(function* (principal: Principal, orgNodeId: string) {
    const result = yield* database
      .execute(reachAtQuery(principal, orgNodeId))
      .pipe(Effect.orDie)
    const reach = new Map<string, Reach>()
    for (const row of rows<{
      code: string
      plugin: string
      target_kind: string
      every_node: boolean
      coverage: 'self' | 'subtree' | null
    }>(result)) {
      const definition = catalog.get(row.code)
      if (!definition) continue
      if (row.plugin !== definition.plugin || row.target_kind !== definition.target) continue
      const here: Reach = row.every_node ? 'tenant' : (row.coverage ?? 'self')
      const known = reach.get(definition.code)
      if (known === undefined || REACH_RANK[here] > REACH_RANK[known]) {
        reach.set(definition.code, here)
      }
    }
    return reach
  })

  const canAt: RbacShape['canAt'] = Effect.fn('Rbac.canAt')(function* (
    principal,
    code,
    targetOrgNodeId,
  ) {
    const definition = definitionOf(code)
    if (!definition) return false
    if (definition.target !== 'org-node') {
      // a tenant code checked against a node is a caller mistake rather than a
      // denial, and answering false would hide it
      return yield* Effect.die(
        new Error(`canAt() got a tenant permission ${code}, use require()`),
      )
    }
    const result = yield* database
      .execute(canAtQuery(principal, definition, targetOrgNodeId))
      .pipe(Effect.orDie)
    return rows<{ allowed: boolean }>(result)[0]?.allowed ?? false
  })

  const listAuthorizedScope: RbacShape['listAuthorizedScope'] = Effect.fn(
    'Rbac.listAuthorizedScope',
  )(function* (principal, code) {
    const definition = definitionOf(code)
    if (!definition || definition.target !== 'org-node') {
      return { tenantWide: false, anchors: [] }
    }
    return yield* scopeOf(principal, definition)
  })

  const hasPermission: RbacShape['hasPermission'] = Effect.fn('Rbac.hasPermission')(function* (
    principal,
    code,
  ) {
    const definition = definitionOf(code)
    if (!definition) return false
    if (definition.target === 'tenant') return yield* hasTenantPermission(principal, definition)
    const scope = yield* scopeOf(principal, definition)
    return scope.tenantWide || scope.anchors.length > 0
  })

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

  const keepsAdministrator = (tenantId: string) =>
    shapeRef.assertTenantKeepsAdministrator(tenantId).pipe(Effect.orDie)

  const grants = yield* makeGrants(authorityFor)
  const roles = yield* makeRoles(authorityFor, keepsAdministrator)

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
    grantsBlockingOrgType: Effect.fn('Rbac.grantsBlockingOrgType')(function* (
      tenantId,
      orgNodeId,
      orgTypeId,
    ) {
      const result = yield* database
        .execute(grantsBlockingOrgTypeQuery(tenantId, orgNodeId, orgTypeId))
        .pipe(Effect.orDie)
      return rows<{ code: string }>(result).map((row) => row.code)
    }),
    assertTenantKeepsAdministrator: Effect.fn('Rbac.assertTenantKeepsAdministrator')(function* (
      tenantId,
    ) {
      // runs on the caller's connection because the connection is in the
      // fiber, which is what lets it read the final state of the caller's
      // transaction rather than a prediction of it
      const locked = yield* database
        .execute(lockAdministratorRoleQuery(tenantId, CANONICAL_ADMIN_ROLE))
        .pipe(Effect.orDie)
      const role = rows<{ id: string }>(locked)[0]
      // fail closed: carrying on here would let every admin-reducing write
      // through on exactly the tenants least able to survive one
      if (!role) {
        return yield* Effect.die(
          new Error(
            `tenant ${tenantId} has no canonical administrator role; refusing to change access`,
          ),
        )
      }
      const counted = yield* database
        .execute(administratorSurvivorsQuery(tenantId, role.id))
        .pipe(Effect.orDie)
      const survivors = Number(rows<{ count: string }>(counted)[0]?.count ?? 0)
      if (survivors === 0) return yield* new LastAdministrator()
    }),
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
  return { ...shape, grants, roles }
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
  }
>()('@qualy/plugin-rbac/Access') {}

/**
 * What this plugin contributes.
 *
 * Two tags from one construction: the port peers hold, and rbac's own
 * administration surface, which no peer reaches through a tag.
 */
export const layer: Layer.Layer<Rbac | Access, never, Database | PermissionCatalog> =
  Layer.effectContext(
    Effect.gen(function* () {
      const { grants, roles, ...shape } = yield* make()
      return Context.empty().pipe(
        Context.add(Rbac, shape),
        Context.add(Access, { grants, roles }),
      )
    }),
  )


// --- api ---

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(accessApiGroup).prefix(QUALY_API_PREFIX)

export const accessApiHandlers = HttpApiBuilder.group(local, 'access', (handlers) =>
  handlers
    .handle(
      'createRole',
      Effect.fn('access.createRole.handler')(function* ({ payload }) {
        const access = yield* Access
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'iam.role.manage')
        return { id: yield* access.roles.create(principal.tenantId, payload) }
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
          version: yield* access.roles.update(
            principal.tenantId,
            params.roleId,
            fields,
            version,
          ),
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
        return yield* access.roles.getPermissions(principal.tenantId, params.roleId, principal)
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
