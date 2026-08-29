import { Effect } from 'effect'

import {
  transaction,
  withDatabase,
  type Orm,
  type QueryFailed,
} from '@qualy/plugin-database/server'
import { sql, type Expression } from 'kysely'
import { Audit } from '@qualy/audit-contract/effect'
import type { AuditActor } from '@qualy/audit-contract'
import { GrantCreated, GrantRevoked } from '../actions.ts'
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
import {
  db,
  admitsOrgType,
  admitsUserType,
  grantRuleTargets,
  inForce,
  lockTenant,
  orgNodeExists,
  rolePermissionCodes,
  rolePermissionMode,
  rolesOfTenant,
  ruleAllowsAppointment,
  userExists,
} from './db.ts'
import { REACH_RANK, type Reach } from './authorization.ts'
import { assertNoSelfEscalation, type Authority } from './escalation.ts'

import {
  GrantExists,
  GrantNodeNotFound,
  GrantNotEligible,
  GrantNotFound,
  GrantRuleRefused,
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
  GrantRuleRefused,
  GrantUserNotFound,
  RoleNotFound,
  TenantAdminRequired,
}

// Handing a role to somebody, and taking it back.
//
// Four separate questions, deliberately not merged. Whether the caller may
// touch grants of that reach at all (where); whether the office is theirs to
// appoint (what, by the role_grant_rules edges - the whole of appointment
// authority, settled when the edge was written); whether they may touch this
// particular role; and whether this role can be held by this person here.
// Only a SELF-grant asks a fifth: that the role adds no authority its taker
// does not already hold - the one grant that is an escalation. Holding a
// role's every permission says nothing about being the one who appoints it,
// and appointing an office does not require personally holding its duties.

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

export interface GrantScope {
  read: AuthorizationScope
  manage: AuthorizationScope
  /** a tenant-wide grant has no node, so node coverage cannot decide it */
  tenantGrants: { read: boolean; manage: boolean }
}

/** why a role cannot be given here, in words a screen can act on */
export type RoleRefusal = 'user-type' | 'authority' | 'self-escalation' | 'unavailable'

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
  tenantId: string,
  filter: { userId?: string; orgNodeId?: string },
  scope: GrantScope | undefined,
  page: { after?: string; limit: number } | undefined,
) =>
  db.query((k) => {
    let found = k
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
      // a withdrawn or expired grant is not authority, so it is not on the
      // screen that administers authority either
      .where((eb) =>
        inForce({
          revokedAt: eb.ref('g.revokedAt'),
          validFrom: eb.ref('g.validFrom'),
          validUntil: eb.ref('g.validUntil'),
        }),
      )
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

const roleForGrant = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => [
        'id',
        'code',
        'systemKey',
        'assignable',
        eb.ref('kind').$castTo<'tenant' | 'org'>().as('kind'),
        eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('permissionMode'),
        eb.ref('status').$castTo<'draft' | 'active' | 'disabled'>().as('status'),
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )

const roleSystemKey = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select('systemKey')
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )

const userForGrant = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User')
      .select(['userTypeId', 'enabled'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      // a deleted person is nobody to appoint, whatever their row still says
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
  )

/**
 * Whether the role admits this kind of person, and this kind of node.
 *
 * Asked of the role row so the mode is part of the answer: a role that admits
 * everyone has no rows to find, and a lookup in the list alone would read that
 * as admitting nobody.
 */
const roleAdmits = (
  tenantId: string,
  roleId: string,
  what: { userTypeId: string } | { orgTypeId: string },
) =>
  db
    .query((k) =>
      k
        .selectFrom('Role as r')
        .where('r.tenantId', '=', tenantId)
        .where('r.id', '=', roleId)
        .select((eb) => {
          const role = {
            tenantId: eb.ref('r.tenantId'),
            id: eb.ref('r.id'),
            eligibilityMode: eb.ref('r.eligibilityMode'),
            anchorMode: eb.ref('r.anchorMode'),
          }
          return (
            'userTypeId' in what
              ? admitsUserType(role, eb.val(what.userTypeId))
              : admitsOrgType(role, eb.val(what.orgTypeId))
          ).as('admitted')
        })
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.admitted === true))

/** the node type a grant would anchor on, which decides whether the role may */
const orgNodeType = (tenantId: string, orgNodeId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgNode')
      .select(['id', 'orgTypeId'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', orgNodeId)
      .executeTakeFirst(),
  )

/** whether the actor themselves holds the canonical administrator role */
const holdsCanonicalAdmin = (tenantId: string, userId: string, canonicalKey: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .innerJoin('Role as r', (join) =>
          join
            .onRef('r.tenantId', '=', 'g.tenantId')
            .onRef('r.id', '=', 'g.roleId')
            .on('r.systemKey', '=', canonicalKey)
            .on('r.status', '=', 'active'),
        )
        .innerJoin('User as u', (join) =>
          join
            .onRef('u.tenantId', '=', 'g.tenantId')
            .onRef('u.id', '=', 'g.userId')
            .on('u.enabled', '=', true),
        )
        .where('g.tenantId', '=', tenantId)
        .where('g.userId', '=', userId)
        .select('g.id')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

const oneGrant = (tenantId: string, grantId: string) =>
  db.query((k) =>
    k
      .selectFrom('RoleGrant as g')
      .select((eb) => [
        'g.userId',
        'g.roleId',
        'g.orgNodeId',
        eb.ref('g.coverage').$castTo<'self' | 'subtree' | null>().as('coverage'),
      ])
      .where('g.tenantId', '=', tenantId)
      .where('g.id', '=', grantId)
      // a grant already withdrawn has nothing left to revoke, and deleting the
      // row would erase the record of an authority that existed
      .where((eb) =>
        inForce({
          revokedAt: eb.ref('g.revokedAt'),
          validFrom: eb.ref('g.validFrom'),
          validUntil: eb.ref('g.validUntil'),
        }),
      )
      .executeTakeFirst(),
  )

const insertGrant = (input: {
  tenantId: string
  userId: string
  roleId: string
  orgNodeId: string | null
  coverage: 'self' | 'subtree' | null
  resource: { namespace: string; type: string; id: string } | null
  validUntil: number | null
  createdBy: string
}) =>
  db.query((k) =>
    k
      .insertInto('RoleGrant')
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: input.roleId,
        orgNodeId: input.orgNodeId,
        coverage: input.coverage,
        resourceNamespace: input.resource?.namespace ?? null,
        resourceType: input.resource?.type ?? null,
        resourceId: input.resource?.id ?? null,
        validUntil:
          input.validUntil === null ? null : sql`to_timestamp(${input.validUntil} / 1000.0)`,
        createdBy: input.createdBy,
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow(),
  )

const deleteGrant = (tenantId: string, grantId: string) =>
  db.query((k) =>
    k.deleteFrom('RoleGrant').where('tenantId', '=', tenantId).where('id', '=', grantId).execute(),
  )

export const make = Effect.fn('Rbac.grants.make')(function* (
  authorityFor: (actor: Principal) => Authority,
) {
  const withDb = yield* withDatabase
  const audit = yield* Audit
  const actorOf = (as: Principal): AuditActor => ({ kind: 'user', userId: as.userId })

  /**
   * What a statement can fail with before the write wrapper handles it.
   *
   * Named so the helper below can be annotated. Without the annotation the
   * error union here grew past what inference will carry, and TypeScript
   * widened the whole handler layer's requirement to `unknown` instead of
   * reporting anything at the site that caused it.
   */
  type SqlFailure = QueryFailed

  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

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
      const codes = yield* authority.tenantWide
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
   * Whether the office is the actor's to appoint (the WHAT beside the
   * grant-manage WHERE).
   *
   * The canonical administrator bypasses the table rather than owning edges
   * to every role: it is already the whole of the tenant's authority, and
   * seeding an edge per role would only be the same fact written out longhand.
   * Everything else needs a rule row, held through a live grant that stands
   * over the place the new grant would anchor.
   */
  const mayAppointRole = Effect.fn('Rbac.grants.mayAppointRole')(function* (
    actor: Principal,
    tenantId: string,
    roleId: string,
    target: GrantTarget,
  ) {
    if (yield* holdsCanonicalAdmin(tenantId, actor.userId, CANONICAL_ADMIN_ROLE)) return
    const allowed = yield* ruleAllowsAppointment({
      tenantId,
      actorUserId: actor.userId,
      targetRoleId: roleId,
      orgNodeId: target.kind === 'org-node' ? target.orgNodeId : null,
    })
    if (!allowed) return yield* new GrantRuleRefused()
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
    actor: Principal,
    tenantId: string,
    roleId: string,
  ) => Effect.Effect<void, RoleNotFound | TenantAdminRequired | SqlFailure, Orm> = Effect.fn(
    'Rbac.grants.mayAdministerRole',
  )(function* (actor: Principal, tenantId: string, roleId: string) {
    const role = yield* roleSystemKey(tenantId, roleId)
    if (!role) return yield* new RoleNotFound()
    if (role.systemKey !== CANONICAL_ADMIN_ROLE) return
    if (!(yield* holdsCanonicalAdmin(tenantId, actor.userId, CANONICAL_ADMIN_ROLE))) {
      return yield* new TenantAdminRequired()
    }
  })

  /** whether this role can be held by this person, here */
  const eligible = Effect.fn('Rbac.grants.eligible')(function* (
    tenantId: string,
    input: { userId: string; roleId: string; target: GrantTarget },
  ) {
    const role = yield* roleForGrant(tenantId, input.roleId)
    if (!role) return yield* new RoleNotFound()
    if (role.status !== 'active' || !role.assignable) {
      return yield* new GrantNotEligible({ reason: 'role-unassignable' })
    }

    const user = yield* userForGrant(tenantId, input.userId)
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
      // a live user always has a type (schema check); the column is only
      // nullable for deleted rows, which userForGrant already refuses
      if (user.userTypeId === null) return yield* new GrantUserNotFound()
      if (!(yield* roleAdmits(tenantId, role.id, { userTypeId: user.userTypeId }))) {
        return yield* new GrantNotEligible({ reason: 'user-type' })
      }
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
    const node = yield* orgNodeType(tenantId, input.target.orgNodeId)
    if (!node) return yield* new GrantNodeNotFound()
    if (!(yield* roleAdmits(tenantId, role.id, { orgTypeId: node.orgTypeId }))) {
      return yield* new GrantNotEligible({ reason: 'org-type' })
    }
    return role
  })

  /** the authority a role carries, as the self-grant guard measures it */
  const carriedBy = Effect.fn('Rbac.grants.carriedBy')(function* (
    actor: Principal,
    tenantId: string,
    roleId: string,
    target: GrantTarget,
  ) {
    const role = yield* rolePermissionMode(tenantId, roleId)
    if (!role) return yield* new RoleNotFound()
    // The offices this one appoints travel with it. Whether each is already
    // the actor's to appoint is asked through the same function the write
    // asks it with, so "already mine" cannot mean one thing while the guard
    // runs and another the moment the new role is used. Only the answer
    // leaves here: which offices exist is not this decision's to hand out.
    let gainsAppointments = false
    for (const office of yield* grantRuleTargets(tenantId, roleId)) {
      const mine = yield* mayAppointRole(actor, tenantId, office.id, target).pipe(
        Effect.as(true),
        Effect.catchTag('GRANT_RULE_REFUSED', () => Effect.succeed(false)),
      )
      if (!mine) {
        gainsAppointments = true
        break
      }
    }
    if (role.mode === 'all-active') return { codes: [], allActive: true, gainsAppointments }
    const codes = yield* rolePermissionCodes(tenantId, roleId)
    return { codes, allActive: false, gainsAppointments }
  })

  const refusalOf = (tag: string): RoleRefusal =>
    tag === 'GRANT_NOT_ELIGIBLE'
      ? 'user-type'
      : tag === 'ROLE_NOT_FOUND'
        ? 'unavailable'
        : // only a self-grant can raise it now, and "this would grow you" is
          // a different sentence from "this office is not yours to fill"
          tag === 'GRANT_ESCALATION_REFUSED'
          ? 'self-escalation'
          : // an office not this caller's to appoint, or a role they may not
            // administer: both read the same - it is not theirs to give
            'authority'

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
    {
      id: string
      code: string
      name: string
      kind: 'tenant' | 'org'
      refusal: RoleRefusal | null
    }[],
    GrantUserNotFound | GrantNodeNotFound,
    Orm
  > = Effect.fn('Rbac.grants.options')(function* (
    tenantId: string,
    request: { userId: string; target: GrantTarget },
    actor: Principal,
  ) {
    // Asked once, up front, so a request naming somebody who is not there
    // gets told so. Per-candidate probing treats every refusal alike, and a
    // mistyped id used to come back as "no role can be offered here", which
    // reads as a permission answer rather than a missing record.
    if (!(yield* userExists(tenantId, request.userId).pipe(Effect.orDie))) {
      return yield* new GrantUserNotFound()
    }
    if (request.target.kind === 'org-node') {
      const there = yield* orgNodeExists(tenantId, request.target.orgNodeId).pipe(Effect.orDie)
      if (!there) return yield* new GrantNodeNotFound()
    }
    const wantedKind = request.target.kind === 'tenant' ? 'tenant' : 'org'
    const candidates = (yield* rolesOfTenant(tenantId).pipe(Effect.orDie)).filter(
      (role) => role.kind === wantedKind && role.status === 'active' && role.assignable,
    )
    const offered: {
      id: string
      code: string
      name: string
      kind: 'tenant' | 'org'
      refusal: RoleRefusal | null
    }[] = []
    for (const role of candidates) {
      const verdict = yield* transaction(
        Effect.gen(function* () {
          yield* eligible(tenantId, {
            userId: request.userId,
            roleId: role.id,
            target: request.target,
          })
          yield* mayAdministerRole(actor, tenantId, role.id)
          yield* mayAppointRole(actor, tenantId, role.id, request.target)
          // one's own name in the recipient line is the one case where a
          // grant could grow its granter; everyone else is the graph's call
          if (actor.userId === request.userId) {
            yield* assertNoSelfEscalation(
              authorityFor(actor),
              yield* carriedBy(actor, tenantId, role.id, request.target),
              request.target,
            )
          }
          return true
        }),
      ).pipe(
        // the tag is kept rather than collapsed to false: an offer list that
        // shows why a role is out of reach lets somebody fix the reason,
        // where a shorter list only says "no" with no subject
        Effect.catchTag(
          [
            'GRANT_NOT_ELIGIBLE',
            // a self-grant that would grow its taker
            'GRANT_ESCALATION_REFUSED',
            // the office is not this caller's to appoint
            'GRANT_RULE_REFUSED',
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
          (error) => Effect.succeed<string | true>(error._tag),
        ),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
      offered.push({
        id: role.id,
        code: role.code,
        name: role.name,
        kind: role.kind,
        refusal: typeof verdict === 'string' ? refusalOf(verdict) : null,
      })
    }
    return offered
  })

  /**
   * The one road to a RoleGrant, whether or not it is confined to a resource.
   *
   * Every question is asked here, in order: the actor administers grants of
   * that reach there; the administrator role's own reservation (first among
   * the role questions, because its refusal has the more specific sentence
   * and a rule row must not shadow it); the office is theirs to appoint;
   * the role admits this person and this anchor; and - only when the
   * recipient is the actor - that it adds no authority they lack. A
   * resource changes none of it - confining authority to one object is not
   * a shorter route to holding it - so the org side and every consumer
   * share this one function, and cannot drift apart question by question.
   *
   * All of it inside the tenant lock: checked outside it, the role could be
   * disabled or the person re-typed in the gap and the insert would still
   * go through.
   */
  const grantRole = Effect.fn('Rbac.grants.grantRole')(function* (
    tenantId: string,
    input: {
      userId: string
      roleId: string
      target: GrantTarget
      resource?: { namespace: string; type: string; id: string }
      validUntil?: number
    },
    actor: Principal,
  ) {
    // The translation sits here rather than on the shared write wrapper: an
    // insert is the only statement that can violate these indexes, and a
    // delete declaring the failure would be a lie the endpoint has to carry.
    // It also has to precede the wrapper's die, since a translator is a
    // failure handler and cannot see a defect.
    return yield* write(tenantId, () =>
      Effect.gen(function* () {
        yield* mayAdministerGrantsAt(actor, input.target)
        yield* mayAdministerRole(actor, tenantId, input.roleId)
        yield* mayAppointRole(actor, tenantId, input.roleId, input.target)
        yield* eligible(tenantId, input)
        // Taking a role oneself is allowed exactly while it adds nothing:
        // identity may change, authority may not (re-ruled 2026-08-20).
        // Third-party grants compare nothing - the appointment edge is the
        // whole of that answer.
        if (actor.userId === input.userId) {
          yield* assertNoSelfEscalation(
            authorityFor(actor),
            yield* carriedBy(actor, tenantId, input.roleId, input.target),
            input.target,
          )
        }
        const anchor =
          input.target.kind === 'org-node'
            ? { nodeId: input.target.orgNodeId, coverage: input.target.coverage }
            : { nodeId: null, coverage: null }
        const created = yield* insertGrant({
          tenantId,
          userId: input.userId,
          roleId: input.roleId,
          orgNodeId: anchor.nodeId,
          coverage: anchor.coverage,
          resource: input.resource ?? null,
          validUntil: input.validUntil ?? null,
          // the row-level stamp every grant gets, not only the confined ones
          createdBy: actor.userId,
        })
        yield* audit.record(GrantCreated, {
          tenantId,
          actor: actorOf(actor),
          target: { id: created.id },
          ...(input.target.kind === 'org-node' ? { organizationId: input.target.orgNodeId } : {}),
          details: {
            userId: input.userId,
            roleId: input.roleId,
            scope: input.target.kind,
            orgNodeId: anchor.nodeId,
            coverage: anchor.coverage,
            resource: input.resource ?? null,
          },
        })
        return created.id
      }).pipe(translateConstraints(grantConstraints)),
    )
  })

  return {
    /** the grants the caller may see, with whether they may change each one */
    list: (
      tenantId: string,
      filter: { userId?: string; orgNodeId?: string },
      scope: GrantScope,
      page?: { after?: string; limit: number },
    ) => withDb(grantRows(tenantId, filter, scope, page).pipe(Effect.orDie)),

    options,

    /** a resource-confined grant: the same road, with the resource named */
    scoped: (input: {
      tenantId: string
      userId: string
      roleId: string
      orgNodeId: string
      includeDescendants: boolean
      resource: { namespace: string; type: string; id: string }
      validUntil?: number | undefined
      actor: Principal
    }) =>
      grantRole(
        input.tenantId,
        {
          userId: input.userId,
          roleId: input.roleId,
          target: {
            kind: 'org-node',
            orgNodeId: input.orgNodeId,
            coverage: input.includeDescendants ? 'subtree' : 'self',
          },
          resource: input.resource,
          ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        },
        input.actor,
      ),

    grant: (
      tenantId: string,
      input: { userId: string; roleId: string; target: GrantTarget },
      actor: Principal,
    ) => grantRole(tenantId, input, actor),

    revoke: Effect.fn('Rbac.grants.revoke')(function* (
      tenantId: string,
      grantId: string,
      actor: Principal,
      keepsAdministrator: (tenantId: string) => Effect.Effect<void, LastAdministrator>,
    ) {
      yield* write(tenantId, () =>
        Effect.gen(function* () {
          const grant = yield* oneGrant(tenantId, grantId)
          if (!grant) return yield* new GrantNotFound()
          // one's own grant is revocable like any other: shedding a role
          // never grows anybody, and the last administrator is still kept
          // by the check below reading the state this removal leaves
          const target: GrantTarget =
            grant.orgNodeId === null
              ? { kind: 'tenant' }
              : {
                  kind: 'org-node',
                  orgNodeId: grant.orgNodeId,
                  coverage: grant.coverage!,
                }
          yield* mayAdministerGrantsAt(actor, target)
          yield* mayAdministerRole(actor, tenantId, grant.roleId)
          yield* deleteGrant(tenantId, grantId)
          // checked against the state the removal actually leaves behind
          yield* keepsAdministrator(tenantId)
          yield* audit.record(GrantRevoked, {
            tenantId,
            actor: actorOf(actor),
            target: { id: grantId },
            ...(grant.orgNodeId === null ? {} : { organizationId: grant.orgNodeId }),
            details: { userId: grant.userId, roleId: grant.roleId },
          })
        }),
      )
    }),
  }
})
