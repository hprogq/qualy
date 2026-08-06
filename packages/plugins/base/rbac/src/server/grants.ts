import { Effect } from 'effect'
import { LegacySql, kyselyOf, query, withDatabase } from '@qualy/plugin-database/server'
import { sql, type Expression } from 'kysely'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { AccessDenied, LastAdministrator } from '@qualy/rbac-contract/effect'
import {
  CANONICAL_ADMIN_ROLE,
  isCanonicalTenantAdmin,
  scopeCoverage,
  type AuthorizationScope,
  type GrantTarget,
  type OrgNodeRef,
  type Principal,
} from '@qualy/rbac-contract'
import { rbacEntityManager, type RbacEntityManager } from './db.ts'
import {
  REACH_RANK,
  type Reach,
  deleteGrantQuery,
  grantQuery,
  holdsCanonicalAdminQuery,
  insertGrantQuery,
  lockTenantQuery,
  orgNodeTypeQuery,
  roleAllowsOrgTypeQuery,
  roleAllowsUserTypeQuery,
  roleForGrantQuery,
  roleProjectionQuery,
  rolePermissionCodesQuery,
  rolePermissionModeQuery,
  roleSystemKeyQuery,
  userExistsQuery,
  userForGrantQuery,
  orgNodeExistsQuery,
  type GrantScope,
  type RoleRow as RoleProjection,
} from '../queries.ts'
import { assertMayGrantRole, type Authority } from './escalation.ts'

import {
  GrantExists,
  GrantNodeNotFound,
  GrantNotEligible,
  GrantNotFound,
  GrantUserNotFound,
  RoleNotFound,
  TenantAdminRequired,
} from './errors.ts'

// re-exported so a service and its failures still read as one module
export {
  GrantExists,
  GrantNodeNotFound,
  GrantNotEligible,
  GrantNotFound,
  GrantUserNotFound,
  RoleNotFound,
  TenantAdminRequired,
}

// Handing a role to somebody, and taking it back.
//
// Four separate questions, deliberately not merged. Whether the caller may
// touch grants of that reach at all; whether they may touch this particular
// role; whether this role can be held by this person here; and how much power
// the role carries relative to the caller's own. Being allowed to edit
// someone's grants says nothing about how strong a role may be put in them.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

type ErrorOf<T> = T extends Effect.Effect<unknown, infer E, unknown> ? E : never

const grantConstraints: Record<string, () => GrantExists> = {
  uq_role_grants_anchored: () => new GrantExists(),
  uq_role_grants_tenant_wide: () => new GrantExists(),
}

interface RoleRow extends Record<string, unknown> {
  id: string
  code: string
  kind: 'tenant' | 'org'
  system_key: string | null
  permission_mode: string
  status: string
  assignable: boolean
}

/**
 * Whether a grant is inside a scope, for a query that has outer-joined its node.
 *
 * Takes expressions rather than a builder, so it composes into both the filter
 * and the projection without either having to name the closure's table types.
 */
const withinScope = (
  refs: OrgNodeRef & { orgNodeId: Expression<string | null> },
  held: AuthorizationScope,
  /** a tenant-wide grant has no node, so node coverage cannot decide it */
  tenantWide: boolean,
) =>
  sql<boolean>`case when ${refs.orgNodeId} is null then ${tenantWide}
    else ${scopeCoverage(held, refs)} end`

/**
 * The grants a caller may see, with whether they may change each one.
 *
 * The visibility filter is pushed into the statement rather than applied row
 * by row afterwards, which is also what makes the keyset page correct: a page
 * assembled and then filtered returns short pages and a cursor that skips.
 */
const grantRows = (
  em: RbacEntityManager,
  tenantId: string,
  filter: { userId?: string; orgNodeId?: string },
  scope: GrantScope | undefined,
  page: { after?: string; limit: number } | undefined,
) =>
  query(() => {
    let found = kyselyOf(em)
      .selectFrom('RoleGrant as g')
      .innerJoin('User as u', (join) =>
        join.onRef('u.tenantId', '=', 'g.tenantId').onRef('u.id', '=', 'g.userId'),
      )
      .innerJoin('Role as r', (join) =>
        join.onRef('r.tenantId', '=', 'g.tenantId').onRef('r.id', '=', 'g.roleId'),
      )
      .leftJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'g.tenantId').onRef('n.id', '=', 'g.orgNodeId'),
      )
      .where('g.tenantId', '=', tenantId)
      .where((eb) =>
        scope === undefined
          ? sql<boolean>`true`
          : withinScope(
              {
                orgNodeId: eb.ref('g.orgNodeId'),
                id: eb.ref('n.id'),
                tenantId: eb.ref('n.tenantId'),
                path: eb.ref('n.path'),
              },
              scope.read,
              scope.tenantGrants.read,
            ),
      )
      .select((eb) => [
        'g.id',
        'g.userId',
        'u.displayName as userDisplayName',
        'g.roleId',
        'r.code as roleCode',
        'r.name as roleName',
        // the check constraint is what makes these two closed sets; the column
        // is a string as far as the schema's type is concerned
        sql<'tenant' | 'org'>`r.kind`.as('roleKind'),
        'g.orgNodeId',
        'n.name as orgNodeName',
        sql<'self' | 'subtree' | null>`g.coverage`.as('coverage'),
        (scope === undefined
          ? sql<boolean>`true`
          : withinScope(
              {
                orgNodeId: eb.ref('g.orgNodeId'),
                id: eb.ref('n.id'),
                tenantId: eb.ref('n.tenantId'),
                path: eb.ref('n.path'),
              },
              scope.manage,
              scope.tenantGrants.manage,
            )
        ).as('manageable'),
      ])
      .orderBy('g.id')

    // stated only when asked for, rather than `(? is null or ...)` wrapped
    // around each: an absent filter is now an absent clause
    if (filter.userId !== undefined) found = found.where('g.userId', '=', filter.userId)
    if (filter.orgNodeId !== undefined) found = found.where('g.orgNodeId', '=', filter.orgNodeId)
    if (page?.after !== undefined) found = found.where('g.id', '>', page.after)
    if (page) found = found.limit(page.limit)
    return found.execute()
  })

export type GrantRow = Effect.Success<ReturnType<typeof grantRows>>[number]

export const make = Effect.fn('Rbac.grants.make')(function* (
  authorityFor: (actor: Principal) => Authority,
) {
  const database = yield* LegacySql
  const withDb = yield* withDatabase

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]
  /**
   * What a raw statement can fail with before the write wrapper handles it.
   *
   * Named so the helper below can be annotated. Without the annotation the
   * error union here grew past what inference will carry, and TypeScript
   * widened the whole handler layer's requirement to `unknown` instead of
   * reporting anything at the site that caused it.
   */
  type SqlFailure = ErrorOf<ReturnType<Tx['execute']>>

  const write = <A, E, R>(tenantId: string, body: (tx: Tx) => Effect.Effect<A, E, R>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          return yield* body(tx)
        }),
      )
      .pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

  /**
   * Authority over the grant itself: which grants the caller may touch.
   *
   * Coverage matters here, not just the node. Someone who administers grants
   * at one node alone must not be able to create, or quietly revoke, a grant
   * that reaches its whole subtree.
   */
  const mayAdministerGrantsAt = Effect.fn('Rbac.grants.mayAdministerAt')(function* (
    actor: Principal,
    target: GrantTarget,
  ) {
    const authority = authorityFor(actor)
    if (target.kind === 'tenant') {
      const codes = yield* authority.tenantWide()
      if (!codes.has('iam.tenant-grant.manage')) {
        return yield* new AccessDenied({ reason: 'not allowed to administer tenant-wide grants' })
      }
      return
    }
    const reach = yield* authority.reachAt(target.orgNodeId)
    const mine = reach.get('iam.grant.manage')
    if (mine === undefined || REACH_RANK[mine] < REACH_RANK[target.coverage as Reach]) {
      return yield* new AccessDenied({ reason: 'not allowed to administer grants of that reach' })
    }
  })

  /**
   * Granting or revoking the administrator role is reserved for someone who
   * already holds it.
   *
   * The generic escalation rule nearly covers this, since an all-active role
   * carries everything and only someone with everything passes the
   * comparison, but the bind escape hatch is a single tenant-wide permission
   * and it must not be a route to becoming superuser.
   */
  const mayAdministerRole: (
    tx: Tx,
    actor: Principal,
    tenantId: string,
    roleId: string,
  ) => Effect.Effect<void, RoleNotFound | TenantAdminRequired | SqlFailure> = Effect.fn(
    'Rbac.grants.mayAdministerRole',
  )(function* (tx: Tx, actor: Principal, tenantId: string, roleId: string) {
    const role = rows<{ system_key: string | null }>(
      yield* tx.execute(roleSystemKeyQuery(tenantId, roleId)),
    )[0]
    if (!role) return yield* new RoleNotFound()
    if (role.system_key !== CANONICAL_ADMIN_ROLE) return
    const holder = rows(
      yield* tx.execute(holdsCanonicalAdminQuery(tenantId, actor.userId, CANONICAL_ADMIN_ROLE)),
    )
    if (holder.length === 0) return yield* new TenantAdminRequired()
  })

  /** whether this role can be held by this person, here */
  const eligible = Effect.fn('Rbac.grants.eligible')(function* (
    tx: Tx,
    tenantId: string,
    input: { userId: string; roleId: string; target: GrantTarget },
  ) {
    const role = rows<RoleRow>(yield* tx.execute(roleForGrantQuery(tenantId, input.roleId)))[0]
    if (!role) return yield* new RoleNotFound()
    if (role.status !== 'active' || !role.assignable) {
      return yield* new GrantNotEligible({ reason: 'role-unassignable' })
    }

    const user = rows<{ user_type_id: string; enabled: boolean }>(
      yield* tx.execute(userForGrantQuery(tenantId, input.userId)),
    )[0]
    if (!user) return yield* new GrantUserNotFound()
    if (!user.enabled) return yield* new GrantNotEligible({ reason: 'user-disabled' })

    // Who may hold this duty is a fact about the role, not about how it is
    // anchored, so it is asked of both kinds. Checking only org roles meant a
    // tenant-wide role could be handed to anybody regardless of what it
    // declared. The canonical administrator is the one exception, because it
    // is how a tenant is recovered, and it is recognised by shape rather than
    // by having a system key, which would exempt every system role added
    // later.
    if (!isCanonicalTenantAdmin(role)) {
      const allowed = rows(
        yield* tx.execute(roleAllowsUserTypeQuery(tenantId, role.id, user.user_type_id)),
      )
      if (allowed.length === 0) return yield* new GrantNotEligible({ reason: 'user-type' })
    }

    // the kind of the role decides the shape of the grant: tenant authority
    // has nowhere to anchor, org authority has nowhere to apply without one
    if (role.kind === 'tenant') {
      if (input.target.kind !== 'tenant') {
        return yield* new GrantNotEligible({ reason: 'tenant-role-anchored' })
      }
      return role
    }
    if (input.target.kind !== 'org-node') {
      return yield* new GrantNotEligible({ reason: 'org-role-unanchored' })
    }
    const node = rows<{ org_type_id: string }>(
      yield* tx.execute(orgNodeTypeQuery(tenantId, input.target.orgNodeId)),
    )[0]
    if (!node) return yield* new GrantNodeNotFound()
    const allowedHere = rows(
      yield* tx.execute(roleAllowsOrgTypeQuery(tenantId, role.id, node.org_type_id)),
    )
    if (allowedHere.length === 0) return yield* new GrantNotEligible({ reason: 'org-type' })
    return role
  })

  /** the permissions a role carries, as the escalation guard measures them */
  const carriedBy = Effect.fn('Rbac.grants.carriedBy')(function* (
    tx: Tx,
    tenantId: string,
    roleId: string,
  ) {
    const role = rows<{ permission_mode: string }>(
      yield* tx.execute(rolePermissionModeQuery(tenantId, roleId)),
    )[0]
    if (!role) return yield* new RoleNotFound()
    if (role.permission_mode === 'all-active') return { codes: [], allActive: true }
    const codes = rows<{ code: string }>(
      yield* tx.execute(rolePermissionCodesQuery(tenantId, roleId)),
    ).map((row) => row.code)
    return { codes, allActive: false }
  })

  /**
   * The roles that could be granted to this person here, right now.
   *
   * Each candidate goes through the same checks the write performs, so the
   * list cannot promise something the write refuses. Only a refusal removes
   * a candidate: anything else is a fault, and swallowing it would render an
   * empty list and call that an answer. The refusals are named here, so a
   * failure this does not name propagates instead of silently shortening the
   * list. A missing user or node is deliberately not among them: it says the
   * request named something that does not exist, which is an answer of its
   * own.
   */
  const options: (
    tenantId: string,
    request: { userId: string; target: GrantTarget },
    actor: Principal,
  ) => Effect.Effect<
    { id: string; code: string; name: string; kind: 'tenant' | 'org' }[],
    GrantUserNotFound | GrantNodeNotFound
  > = Effect.fn('Rbac.grants.options')(function* (
    tenantId: string,
    request: { userId: string; target: GrantTarget },
    actor: Principal,
  ) {
    // Asked once, up front, so a request naming somebody who is not there
    // gets told so. Per-candidate probing treats every refusal alike, and a
    // mistyped id used to come back as "no role can be offered here", which
    // reads as a permission answer rather than a missing record.
    const user = rows(
      yield* database.execute(userExistsQuery(tenantId, request.userId)).pipe(Effect.orDie),
    )
    if (user.length === 0) return yield* new GrantUserNotFound()
    if (request.target.kind === 'org-node') {
      const node = rows(
        yield* database
          .execute(orgNodeExistsQuery(tenantId, request.target.orgNodeId))
          .pipe(Effect.orDie),
      )
      if (node.length === 0) return yield* new GrantNodeNotFound()
    }
    const wantedKind = request.target.kind === 'tenant' ? 'tenant' : 'org'
    const candidates = rows<RoleProjection & Record<string, unknown>>(
      yield* database.execute(roleProjectionQuery(tenantId)).pipe(Effect.orDie),
    ).filter((role) => role.kind === wantedKind && role.status === 'active' && role.assignable)
    const offered: { id: string; code: string; name: string; kind: 'tenant' | 'org' }[] = []
    for (const role of candidates) {
      const verdict = yield* database
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* eligible(tx, tenantId, {
              userId: request.userId,
              roleId: role.id,
              target: request.target,
            })
            yield* mayAdministerRole(tx, actor, tenantId, role.id)
            yield* assertMayGrantRole(
              authorityFor(actor),
              yield* carriedBy(tx, tenantId, role.id),
              request.target,
            )
            return true
          }),
        )
        .pipe(
          Effect.catchTag(
            [
              'GRANT_NOT_ELIGIBLE',
              'GRANT_ESCALATION_REFUSED',
              // in the oRPC refusal set too: a role the caller may not
              // administer is one they cannot be offered. ACCESS_DENIED is not
              // listed because nothing in this probe raises it any more - the
              // grant-reach check belongs to the write, not to the offer - and
              // naming a tag the union does not contain collapses the whole
              // expression to unknown instead of reporting anything.
              'TENANT_ADMIN_REQUIRED',
              // the candidate came from the projection a moment ago, so this
              // is a concurrent deletion: it is not offerable, which is an
              // answer rather than a fault
              'ROLE_NOT_FOUND',
            ],
            () => Effect.succeed(false),
          ),
          Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        )
      if (verdict) {
        offered.push({ id: role.id, code: role.code, name: role.name, kind: role.kind })
      }
    }
    return offered
  })

  return {
    /** the grants the caller may see, with whether they may change each one */
    list: (
      tenantId: string,
      filter: { userId?: string; orgNodeId?: string },
      scope: GrantScope,
      page?: { after?: string; limit: number },
    ) =>
      withDb(
        Effect.gen(function* () {
          const em = yield* rbacEntityManager()
          return yield* grantRows(em, tenantId, filter, scope, page).pipe(Effect.orDie)
        }),
      ),

    options,
    grant: Effect.fn('Rbac.grants.grant')(function* (
      tenantId: string,
      input: { userId: string; roleId: string; target: GrantTarget },
      actor: Principal,
    ) {
      // The translation sits here rather than on the shared write wrapper: an
      // insert is the only statement that can violate these indexes, and a
      // delete declaring the failure would be a lie the endpoint has to carry.
      // It also has to precede the wrapper's die, since a translator is a
      // failure handler and cannot see a defect.
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          yield* mayAdministerGrantsAt(actor, input.target)
          yield* mayAdministerRole(tx, actor, tenantId, input.roleId)
          yield* eligible(tx, tenantId, input)
          yield* assertMayGrantRole(
            authorityFor(actor),
            yield* carriedBy(tx, tenantId, input.roleId),
            input.target,
          )
          const anchor =
            input.target.kind === 'org-node'
              ? { nodeId: input.target.orgNodeId, coverage: input.target.coverage }
              : { nodeId: null, coverage: null }
          return rows<{ id: string }>(
            yield* tx.execute(
              insertGrantQuery({
                tenantId,
                userId: input.userId,
                roleId: input.roleId,
                orgNodeId: anchor.nodeId,
                coverage: anchor.coverage,
              }),
            ),
          )[0]!.id
        }).pipe(translateConstraints(grantConstraints)),
      )
    }),

    revoke: Effect.fn('Rbac.grants.revoke')(function* (
      tenantId: string,
      grantId: string,
      actor: Principal,
      keepsAdministrator: (tenantId: string) => Effect.Effect<void, LastAdministrator>,
    ) {
      yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const grant = rows<{
            role_id: string
            org_node_id: string | null
            coverage: 'self' | 'subtree' | null
          }>(yield* tx.execute(grantQuery(tenantId, grantId)))[0]
          if (!grant) return yield* new GrantNotFound()
          const target: GrantTarget =
            grant.org_node_id === null
              ? { kind: 'tenant' }
              : {
                  kind: 'org-node',
                  orgNodeId: grant.org_node_id,
                  coverage: grant.coverage!,
                }
          yield* mayAdministerGrantsAt(actor, target)
          yield* mayAdministerRole(tx, actor, tenantId, grant.role_id)
          yield* tx.execute(deleteGrantQuery(tenantId, grantId))
          // checked against the state the removal actually leaves behind
          yield* keepsAdministrator(tenantId)
        }),
      )
    }),
  }
})
