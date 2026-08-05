import { Effect, Layer } from 'effect'
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
  return shape
})

/**
 * What this plugin contributes to the running application.
 *
 * It requires the database and the resolved catalog, and nothing else. No
 * server and no ui registry: handler layers are provided into the server
 * rather than the other way round, which is what keeps rbac deployable with a
 * database alone.
 */
export const layer: Layer.Layer<Rbac, never, Database | PermissionCatalog> = Layer.effect(
  Rbac,
  make(),
)
