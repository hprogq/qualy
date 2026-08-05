import { Effect } from 'effect'
import { Database } from '@qualy/plugin-database/effect'
import { translateConstraints } from '@qualy/plugin-database/effect/constraints'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { canonicalTenantAdmin, type Principal } from '@qualy/rbac-contract'
import {
  assignableUserTypesQuery,
  deleteUserSessionsQuery,
  grantsBlockingUserTypeQuery,
  insertUserQuery,
  listUsersQuery,
  lockTenantQuery,
  orgNodeExistsQuery,
  placeableNodesQuery,
  placementAllowedQuery,
  setUserEnabledQuery,
  setUserPlacementQuery,
  updateUserQuery,
  userGuardQuery,
  userQuery,
  userTypeGuardQuery,
  type UserRow as UserProjection,
} from '../iam/queries.ts'
import {
  GrantIncompatible,
  PlacementNotAllowed,
  SystemAccountProtected,
  UserNotFound,
  UserPlacementNotFound,
  UserTypeDisabled,
  UserTypeNotFound,
  businessNoConstraints,
  userConstraints,
} from './errors.ts'

// People, and where they stand.
//
// Authority over a person is authority over the node they stand at, so every
// write here re-decides that on the locked connection rather than trusting a
// check made before the lock. A transfer needs it at both ends, because moving
// someone changes who administers them.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

interface UserRow extends Record<string, unknown> {
  id: string
  user_type_id: string
  primary_org_node_id: string
  is_system: boolean
}

interface TypeRow extends Record<string, unknown> {
  id: string
  code: string
  enabled: boolean
  is_system: boolean
  version: number
}

export const make = Effect.fn('Iam.users.make')(function* () {
  const database = yield* Database
  const rbac = yield* Rbac

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]

  const write = <A, E>(tenantId: string, body: (tx: Tx) => Effect.Effect<A, E>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          return yield* body(tx)
        }),
      )
      .pipe(
        translateConstraints(userConstraints),
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )

  /** authority over a person is authority over the node they stand at */
  const manages = Effect.fn('Iam.users.manages')(function* (as: Principal, orgNodeId: string) {
    if (!(yield* rbac.canAt(as, 'auth.user.manage', orgNodeId))) {
      return yield* new AccessDenied({ reason: 'not allowed to administer users at this node' })
    }
  })

  const requireUser = Effect.fn('Iam.users.require')(function* (
    tx: Tx,
    tenantId: string,
    userId: string,
  ) {
    const row = rows<UserRow>(yield* tx.execute(userGuardQuery(tenantId, userId)))[0]
    if (!row) return yield* new UserNotFound()
    return row
  })

  const requireType = Effect.fn('Iam.users.requireType')(function* (
    tx: Tx,
    tenantId: string,
    userTypeId: string,
  ) {
    const row = rows<TypeRow>(yield* tx.execute(userTypeGuardQuery(tenantId, userTypeId)))[0]
    if (!row) return yield* new UserTypeNotFound()
    return row
  })

  /** a system user type is provisioned, not assigned */
  const mayAssignType = Effect.fn('Iam.users.mayAssignType')(function* (type: TypeRow) {
    if (type.is_system) {
      return yield* new AccessDenied({ reason: 'a system user type is provisioned, not assigned' })
    }
  })

  const placementAllowed = Effect.fn('Iam.users.placementAllowed')(function* (
    tx: Tx,
    tenantId: string,
    userTypeId: string,
    orgNodeId: string,
  ) {
    const row = rows<{ legal: boolean }>(
      yield* tx.execute(placementAllowedQuery(tenantId, userTypeId, orgNodeId)),
    )[0]
    if (!row) return yield* new UserTypeNotFound()
    if (!row.legal) return yield* new PlacementNotAllowed()
  })

  const requireOrgNode = Effect.fn('Iam.users.requireOrgNode')(function* (
    tx: Tx,
    tenantId: string,
    orgNodeId: string,
  ) {
    const found = rows(yield* tx.execute(orgNodeExistsQuery(tenantId, orgNodeId)))
    if (found.length === 0) return yield* new UserPlacementNotFound()
  })

  /**
   * Which users the caller may see, and which they may change.
   *
   * Two permissions, two answers: a read-only administrator gets a screen
   * without buttons rather than buttons that answer 403. Both are resolved
   * once and pushed into the statement, so the page is never assembled and
   * then filtered.
   */
  const scopes = Effect.fn('Iam.users.scopes')(function* (principal: Principal) {
    return {
      read: yield* rbac.listAuthorizedScope(principal, 'auth.user.read'),
      manage: yield* rbac.listAuthorizedScope(principal, 'auth.user.manage'),
    }
  })

  const readable = (scope: { read: { tenantWide: boolean; anchors: readonly unknown[] } }) =>
    scope.read.tenantWide || scope.read.anchors.length > 0

  return {
    list: Effect.fn('Iam.users.list')(function* (
      principal: Principal,
      input: {
        orgNodeId: string
        scope: 'self' | 'subtree'
        search?: string
        after?: readonly string[]
        limit: number
      },
    ) {
      const held = yield* scopes(principal)
      if (!readable(held)) return []
      return rows<UserProjection & Record<string, unknown>>(
        yield* database
          .execute(listUsersQuery(principal.tenantId, held, input))
          .pipe(Effect.orDie),
      )
    }),

    get: Effect.fn('Iam.users.get')(function* (principal: Principal, userId: string) {
      const held = yield* scopes(principal)
      const row = rows<UserProjection & Record<string, unknown>>(
        yield* database
          .execute(userQuery(principal.tenantId, userId, held))
          .pipe(Effect.orDie),
      )[0]
      // not-found and not-readable are indistinguishable on purpose
      if (!row) return yield* new UserNotFound()
      return row
    }),

    /**
     * Where the caller may administer users, and which types they may hand out.
     *
     * One call, so the screen needs no permission but its own: making it also
     * carry the org-tree and user-type read permissions would sit a legitimate
     * org administrator in front of an empty picker.
     */
    options: Effect.fn('Iam.users.options')(function* (
      principal: Principal,
      search: string | undefined,
      limit: number,
    ) {
      const held = yield* scopes(principal)
      if (!readable(held)) return { nodes: [], truncated: false, userTypes: [] }
      const nodes = rows<{
        id: string
        name: string
        depth: number
        org_type_id: string
        manageable: boolean
      }>(
        yield* database
          .execute(placeableNodesQuery(principal.tenantId, held, search, limit))
          .pipe(Effect.orDie),
      )
      const userTypes = rows<{
        id: string
        code: string
        name: string
        placement_mode: 'unrestricted' | 'allow-list'
        allowed_org_type_ids: string[]
      }>(
        yield* database
          .execute(assignableUserTypesQuery(principal.tenantId))
          .pipe(Effect.orDie),
      )
      return {
        nodes: nodes.slice(0, limit).map((row) => ({
          orgNodeId: row.id,
          name: row.name,
          depth: row.depth,
          orgTypeId: row.org_type_id,
          manageable: row.manageable,
        })),
        // a picker that quietly showed the first five hundred of a large tree
        // looked complete; saying so lets the screen ask for a search instead
        truncated: nodes.length > limit,
        userTypes: userTypes.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          placementPolicy:
            row.placement_mode === 'allow-list'
              ? ({ mode: 'allow-list' as const, orgTypeIds: row.allowed_org_type_ids })
              : ({ mode: 'unrestricted' as const }),
        })),
      }
    }),

    create: Effect.fn('Iam.users.create')(function* (
      tenantId: string,
      input: {
        displayName: string
        userTypeId: string
        primaryOrgNodeId: string
        businessNo?: string
      },
      as: Principal,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          // authority follows the node the user will stand on
          yield* manages(as, input.primaryOrgNodeId)
          const type = yield* requireType(tx, tenantId, input.userTypeId)
          if (!type.enabled) return yield* new UserTypeDisabled()
          yield* mayAssignType(type)
          yield* requireOrgNode(tx, tenantId, input.primaryOrgNodeId)
          yield* placementAllowed(tx, tenantId, type.id, input.primaryOrgNodeId)
          return rows<{ id: string }>(
            yield* tx.execute(
              insertUserQuery({
                tenantId,
                displayName: input.displayName,
                userTypeId: type.id,
                primaryOrgNodeId: input.primaryOrgNodeId,
                businessNo: input.businessNo ?? null,
              }),
            ),
          )[0]!.id
          // the business-number index is only reachable from the two
          // statements that write it, so its translation lives with them
        }).pipe(translateConstraints(businessNoConstraints)),
      )
    }),

    /**
     * Changing someone's type is the cross-domain case.
     *
     * It has to stay compatible with the grants they already hold, and it must
     * not take away the tenant's last way in.
     */
    update: Effect.fn('Iam.users.update')(function* (
      tenantId: string,
      userId: string,
      fields: { displayName?: string; userTypeId?: string; businessNo?: string },
      as: Principal,
    ) {
      yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const user = yield* requireUser(tx, tenantId, userId)
          yield* manages(as, user.primary_org_node_id)
          const changingType =
            fields.userTypeId !== undefined && fields.userTypeId !== user.user_type_id
          if (changingType) {
            if (user.is_system) return yield* new SystemAccountProtected()
            const type = yield* requireType(tx, tenantId, fields.userTypeId!)
            if (!type.enabled) return yield* new UserTypeDisabled()
            yield* mayAssignType(type)
            // the new type must also permit where this person already stands
            yield* placementAllowed(tx, tenantId, type.id, user.primary_org_node_id)
            const blocking = rows<{ count: number }>(
              yield* tx.execute(
                grantsBlockingUserTypeQuery(tenantId, user.id, type.id, canonicalTenantAdmin('r')),
              ),
            )[0]!.count
            if (blocking > 0) return yield* new GrantIncompatible({ grantCount: blocking })
          }
          yield* tx.execute(updateUserQuery(tenantId, user.id, fields))
          // a type change can move the last administrator onto a type that
          // cannot sign in at all
          if (changingType) yield* rbac.assertTenantKeepsAdministrator(tenantId)
        }).pipe(translateConstraints(businessNoConstraints)),
      )
    }),

    /**
     * Moving someone is not an ordinary field edit.
     *
     * It changes who administers them, so both ends must be inside the
     * caller's own authority.
     */
    setPlacement: Effect.fn('Iam.users.setPlacement')(function* (
      tenantId: string,
      userId: string,
      primaryOrgNodeId: string,
      as: Principal,
    ) {
      yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const user = yield* requireUser(tx, tenantId, userId)
          if (user.is_system) return yield* new SystemAccountProtected()
          yield* manages(as, user.primary_org_node_id)
          yield* manages(as, primaryOrgNodeId)
          yield* requireOrgNode(tx, tenantId, primaryOrgNodeId)
          // a transfer may not put someone where their kind of person may not be
          yield* placementAllowed(tx, tenantId, user.user_type_id, primaryOrgNodeId)
          yield* tx.execute(setUserPlacementQuery(tenantId, user.id, primaryOrgNodeId))
        }),
      )
    }),

    setEnabled: Effect.fn('Iam.users.setEnabled')(function* (
      tenantId: string,
      userId: string,
      enabled: boolean,
      as: Principal,
    ) {
      yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const user = yield* requireUser(tx, tenantId, userId)
          if (!enabled && user.is_system) return yield* new SystemAccountProtected()
          yield* manages(as, user.primary_org_node_id)
          yield* tx.execute(setUserEnabledQuery(tenantId, user.id, enabled))
          if (!enabled) {
            // a disabled user loses access now, not when their session
            // happens to expire
            yield* tx.execute(deleteUserSessionsQuery(tenantId, user.id))
            yield* rbac.assertTenantKeepsAdministrator(tenantId)
          }
        }),
      )
    }),
  }
})
