import { plainText } from '@qualy/i18n-contract'
import { Effect } from 'effect'
import { db, type Db, admitsUserType, inForce } from './db.ts'
import { kyselyOf, query } from '@qualy/plugin-database/server'
import { sql, type Expression } from 'kysely'
import { canonicalTenantAdmin, type ActivePermission, type Principal } from '@qualy/rbac-contract'

// The authorization SQL.
//
// Everything that decides what somebody may do is here, once. Two copies of
// these statements would be two authorization systems that agree until the day
// one is edited, and the divergence would not look like a bug: it would look
// like an answer.

/** the roles row a predicate reads, wherever the query aliased it */
export interface RoleRef {
  readonly id: Expression<string>
  readonly tenantId: Expression<string>
  readonly permissionMode: Expression<string>
}

/** the grant row a reach predicate reads */
interface HeldRef {
  readonly coverage: Expression<string | null>
  readonly orgNodeId: Expression<string | null>
}

/**
 * A role that carries every active capability.
 *
 * The administrator branch, and the reason it is a fragment rather than a
 * boolean: diagnostics have to explain a decision with the same predicate that
 * made it, not a second one that agrees today.
 */
export const reachesEveryNode = (role: RoleRef) =>
  sql<boolean>`${role.permissionMode} = 'all-active'`

/**
 * Whether an active role carries this exact permission.
 *
 * Pinned to what the registry verified, so a permission row edited out of band
 * stops authorizing rather than starting to.
 */
const carries = (role: RoleRef, def: ActivePermission) => sql<boolean>`(
  ${reachesEveryNode(role)}
  or exists (
    select 1 from role_permissions rp
    join permissions p on p.id = rp.permission_id
      and p.code = ${def.code} and p.plugin = ${def.plugin}
      and p.target_kind = ${def.target}
    where rp.tenant_id = ${role.tenantId} and rp.role_id = ${role.id}
  )
)`

/**
 * Whether a role carries the permission row this query joined.
 *
 * The join condition of every "what do they effectively hold" question, which
 * is a different shape from `carries`: that one names a permission, this one
 * relates a role to whichever row the join is considering.
 */
const rolePermits = (role: RoleRef, permissionId: Expression<string>) => sql<boolean>`(
  ${reachesEveryNode(role)}
  or exists (
    select 1 from role_permissions rp
    where rp.tenant_id = ${role.tenantId} and rp.role_id = ${role.id}
      and rp.permission_id = ${permissionId}
  )
)`

/**
 * Whether a grant reaches one node.
 *
 * The same three branches everywhere it is asked, because an explanation that
 * disagrees with the decision is worse than no explanation.
 */
const reaches = (
  role: RoleRef,
  grant: HeldRef,
  path: { target: Expression<string | null>; anchor: Expression<string | null> },
  orgNodeId: string,
) => sql<boolean>`(
  ${reachesEveryNode(role)}
  or (${grant.coverage} = 'self' and ${grant.orgNodeId} = ${orgNodeId})
  or (${grant.coverage} = 'subtree' and ${path.target} <@ ${path.anchor})
)`

/**
 * Whether a (permission, grant) row counts once the question names a node.
 *
 * Reach decides an org capability. A tenant capability is anchored nowhere -
 * `hasTenantPermission` asks only whether an active tenant role carries it,
 * and never looks at a node - so measuring it against reach dropped every
 * ordinary tenant role the moment a node was mentioned, and the explanation
 * then contradicted the decision it exists to justify. One definition, because
 * the second copy of this ternary was already there and diverging from it
 * would be the same defect again.
 */
const countsAt = (
  role: RoleRef & { kind: Expression<string> },
  grant: HeldRef,
  path: { target: Expression<string | null>; anchor: Expression<string | null> },
  permissionTarget: Expression<string>,
  orgNodeId: string,
) => sql<boolean>`(
  ${reaches(role, grant, path, orgNodeId)}
  or (${role.kind} = 'tenant' and ${permissionTarget} = 'tenant')
)`

/**
 * The grants a principal holds, with where each one reaches.
 *
 * The user type gates this, because a disabled type means a person who cannot
 * act, but it contributes no roles of its own.
 *
 * One definition for every question below, including the explanation. There
 * used to be two - this one and a second spelled out inside the explain
 * statement - differing only in that the explanation also needed the grant id.
 * Two copies of "which grants does this person hold" is the drift this file
 * exists to prevent.
 */
/**
 * The grants a judgment may draw on.
 *
 * `general` is every judgment about the tenant or the org tree: a grant tied
 * to one resource carries no authority anywhere else, so it is excluded.
 * `any-context` is the discovery question - does this person hold the
 * capability in at least one context, a resource-bound one included - which
 * is what the manifest's qualification asks and nothing else may.
 */
const held = (k: Db, tenantId: string, userId: string, scope: 'general' | 'any-context') =>
  k.with('held', (db) => {
    const grants = db
      .selectFrom('RoleGrant as g')
      .innerJoin('User as u', (join) =>
        join
          .onRef('u.tenantId', '=', 'g.tenantId')
          .onRef('u.id', '=', 'g.userId')
          .on('u.enabled', '=', true),
      )
      .innerJoin('UserType as t', (join) =>
        join
          .onRef('t.tenantId', '=', 'u.tenantId')
          .onRef('t.id', '=', 'u.userTypeId')
          .on('t.enabled', '=', true),
      )
      .where('g.tenantId', '=', tenantId)
      .where('g.userId', '=', userId)
      .where((eb) =>
        inForce({
          revokedAt: eb.ref('g.revokedAt'),
          validFrom: eb.ref('g.validFrom'),
          validUntil: eb.ref('g.validUntil'),
        }),
      )
      .select([
        'g.roleId',
        'g.orgNodeId',
        'g.id as grantId',
        sql<'self' | 'subtree' | null>`g.coverage`.as('coverage'),
      ])
    return scope === 'general' ? grants.where('g.resourceId', 'is', null) : grants
  })

const forPrincipal = (k: Db, principal: Principal, scope: 'general' | 'any-context' = 'general') =>
  held(k, principal.tenantId, principal.userId, scope)

/** a tenant capability comes only from a tenant role: an org role is anchored somewhere */
export const hasTenantPermission = (principal: Principal, def: ActivePermission) =>
  db
    .query((k) =>
      forPrincipal(k, principal)
        .selectFrom('held')
        .innerJoin('Role as r', (join) =>
          join
            .on('r.tenantId', '=', principal.tenantId)
            .onRef('r.id', '=', 'held.roleId')
            .on('r.status', '=', 'active')
            .on('r.kind', '=', 'tenant'),
        )
        .where((eb) =>
          carries(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            def,
          ),
        )
        .select(sql<number>`1`.as('one'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const canAt = (principal: Principal, def: ActivePermission, targetOrgNodeId: string) =>
  db
    .query((k) =>
      forPrincipal(k, principal)
        .selectFrom('held')
        .innerJoin('Role as r', (join) =>
          join
            .on('r.tenantId', '=', principal.tenantId)
            .onRef('r.id', '=', 'held.roleId')
            .on('r.status', '=', 'active'),
        )
        // inner, not left: a node that does not exist is never authorized, and
        // the administrator branch would otherwise answer yes for one
        .innerJoin('OrgNode as target', (join) =>
          join.on('target.tenantId', '=', principal.tenantId).on('target.id', '=', targetOrgNodeId),
        )
        .leftJoin('OrgNode as anchor', (join) =>
          join
            .on('anchor.tenantId', '=', principal.tenantId)
            .onRef('anchor.id', '=', 'held.orgNodeId'),
        )
        .where((eb) =>
          carries(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            def,
          ),
        )
        .where((eb) =>
          reaches(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            { coverage: eb.ref('held.coverage'), orgNodeId: eb.ref('held.orgNodeId') },
            { target: eb.ref('target.path'), anchor: eb.ref('anchor.path') },
            targetOrgNodeId,
          ),
        )
        .select(sql<number>`1`.as('one'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** how far one org-node permission reaches for this principal */
export const authorizedScope = (principal: Principal, def: ActivePermission) =>
  db
    .query((k) =>
      forPrincipal(k, principal)
        .selectFrom('held')
        .innerJoin('Role as r', (join) =>
          join
            .on('r.tenantId', '=', principal.tenantId)
            .onRef('r.id', '=', 'held.roleId')
            .on('r.status', '=', 'active'),
        )
        .where((eb) =>
          carries(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            def,
          ),
        )
        .select((eb) => [
          reachesEveryNode({
            id: eb.ref('r.id'),
            tenantId: eb.ref('r.tenantId'),
            permissionMode: eb.ref('r.permissionMode'),
          }).as('everyNode'),
          'held.orgNodeId',
          'held.coverage',
        ])
        .distinct()
        .execute(),
    )
    .pipe(
      // the shape every caller folds into, so none of them invents its own
      Effect.map((rows) => ({
        tenantWide: rows.some((row) => row.everyNode),
        anchors: rows
          .filter((row) => row.orgNodeId !== null && row.coverage !== null)
          .map((row) => ({ orgNodeId: row.orgNodeId!, coverage: row.coverage! })),
      })),
    )

/**
 * Every permission a principal effectively holds, for one of three questions.
 *
 * They are deliberately distinct. With a node: what they hold AT it. Without
 * one: what they hold tenant-wide, which is what an escalation guard must
 * compare against. Anywhere: what they hold at all, which is what surface
 * discovery asks, since a capability held at one college is discoverable even
 * though it applies nowhere else.
 */
/**
 * Which assignments carry these capabilities anywhere inside these nodes.
 *
 * A question about the tenant's authority, asked without knowing what the
 * caller wants it for: it names permission codes and organizational nodes and
 * gets back grants. What the caller then does with a grant - copy it, watch
 * it, refuse it - is the caller's business, which is how this stays free of
 * any knowledge of assessments, batches or anything else downstream.
 *
 * "Inside" is an intersection, not containment: a grant anchored above the
 * nodes covers them, and one anchored below covers part of them. Both are
 * authority over people the caller cares about, and dropping either would
 * silently lose a college head or a class tutor.
 */
/**
 * Every duty one person currently holds, with the place it applies.
 *
 * No permission codes and no coverage arithmetic: this answers "what has this
 * person been given", which is a different question from "may they act here",
 * and mixing the two produced a list nobody could read.
 */
export const userRoleHoldings = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('RoleGrant as g')
      .innerJoin('Role as r', (join) =>
        join.onRef('r.tenantId', '=', 'g.tenantId').onRef('r.id', '=', 'g.roleId'),
      )
      .leftJoin('OrgNode as anchor', (join) =>
        join.onRef('anchor.tenantId', '=', 'g.tenantId').onRef('anchor.id', '=', 'g.orgNodeId'),
      )
      .select([
        'g.id as grantId',
        'g.orgNodeId as orgNodeId',
        'g.coverage as coverage',
        'g.resourceId as resourceId',
        'anchor.name as orgNodeName',
        'r.id as roleId',
        'r.code as roleCode',
        'r.name as roleName',
        'r.kind as kind',
      ])
      .where('g.tenantId', '=', tenantId)
      .where('g.userId', '=', userId)
      .where('r.status', '=', 'active')
      .where((eb) =>
        inForce({
          revokedAt: eb.ref('g.revokedAt'),
          validFrom: eb.ref('g.validFrom'),
          validUntil: eb.ref('g.validUntil'),
        }),
      )
      .orderBy('r.name')
      .execute(),
  )

export const applicableAssignments = (input: {
  tenantId: string
  codes: readonly string[]
  nodeIds: readonly string[]
  resource?: { namespace: string; type: string; id: string }
}) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .innerJoin('Role as r', (join) =>
          join
            .onRef('r.tenantId', '=', 'g.tenantId')
            .onRef('r.id', '=', 'g.roleId')
            .on('r.status', '=', 'active'),
        )
        // the catalog is the tenant's: a permission row is global, and what
        // makes it authority here is the role carrying it
        .innerJoin('Permission as p', (join) =>
          join.on((eb) =>
            rolePermits(
              {
                id: eb.ref('r.id'),
                tenantId: eb.ref('r.tenantId'),
                permissionMode: eb.ref('r.permissionMode'),
              },
              eb.ref('p.id'),
            ),
          ),
        )
        .leftJoin('OrgNode as anchor', (join) =>
          join.onRef('anchor.tenantId', '=', 'g.tenantId').onRef('anchor.id', '=', 'g.orgNodeId'),
        )
        .select([
          'g.id as assignmentId',
          'g.resourceId as resourceId',
          'g.userId as userId',
          'g.orgNodeId as orgNodeId',
          'g.coverage as coverage',
          'r.id as roleId',
          'r.code as roleCode',
          'r.name as roleName',
          'p.code as code',
        ])
        .where('g.tenantId', '=', input.tenantId)
        .where('p.code', 'in', input.codes as string[])
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        // either general authority, or authority over exactly this object
        .where((eb) =>
          input.resource === undefined
            ? eb('g.resourceId', 'is', null)
            : eb.or([
                eb('g.resourceId', 'is', null),
                eb.and([
                  eb('g.resourceNamespace', '=', input.resource.namespace),
                  eb('g.resourceType', '=', input.resource.type),
                  eb('g.resourceId', '=', input.resource.id),
                ]),
              ]),
        )
        .where(
          sql<boolean>`(
            g.org_node_id is null
            or exists (
              select 1 from org_nodes scope
              where scope.tenant_id = g.tenant_id
                and scope.id = any(${input.nodeIds as string[]}::uuid[])
                and (
                  case when g.coverage = 'subtree'
                    then anchor.path @> scope.path or scope.path @> anchor.path
                    else anchor.id = scope.id or scope.path @> anchor.path
                  end
                )
            )
          )`,
        )
        .execute(),
    )
    .pipe(
      Effect.map(
        (rows) =>
          rows as unknown as {
            assignmentId: string
            resourceId: string | null
            userId: string
            orgNodeId: string | null
            coverage: 'self' | 'subtree' | null
            roleId: string
            roleCode: string
            roleName: string
            code: string
          }[],
      ),
    )

export const effectiveRows = (
  principal: Principal,
  target: { orgNodeId: string } | 'anywhere' | undefined,
) =>
  db.query((k) => {
    const at = typeof target === 'object' ? target : undefined
    // 'anywhere' is the discovery question, so a resource-bound grant counts:
    // holding review authority inside one round is holding it somewhere
    return forPrincipal(k, principal, target === 'anywhere' ? 'any-context' : 'general')
      .selectFrom('held')
      .innerJoin('Role as r', (join) =>
        join
          .on('r.tenantId', '=', principal.tenantId)
          .onRef('r.id', '=', 'held.roleId')
          .on('r.status', '=', 'active'),
      )
      .leftJoin('OrgNode as anchor', (join) =>
        join
          .on('anchor.tenantId', '=', principal.tenantId)
          .onRef('anchor.id', '=', 'held.orgNodeId'),
      )
      .leftJoin('OrgNode as node', (join) =>
        join.on('node.tenantId', '=', principal.tenantId).on('node.id', '=', at?.orgNodeId ?? null),
      )
      .innerJoin('Permission as p', (join) =>
        join.on((eb) =>
          rolePermits(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            eb.ref('p.id'),
          ),
        ),
      )
      .where((eb) =>
        at
          ? countsAt(
              {
                id: eb.ref('r.id'),
                tenantId: eb.ref('r.tenantId'),
                permissionMode: eb.ref('r.permissionMode'),
                kind: eb.ref('r.kind'),
              },
              { coverage: eb.ref('held.coverage'), orgNodeId: eb.ref('held.orgNodeId') },
              { target: eb.ref('node.path'), anchor: eb.ref('anchor.path') },
              eb.ref('p.targetKind'),
              at.orgNodeId,
            )
          : target === 'anywhere'
            ? sql<boolean>`true`
            : eb('r.kind', '=', 'tenant'),
      )
      .select(['p.code', 'p.plugin', 'p.targetKind', 'r.kind'])
      .distinct()
      .execute()
  })

/**
 * The strongest reach the principal has for each permission at one node.
 *
 * A bind guard needs more than "do they hold it here": granting subtree
 * coverage from a self anchor would hand out more than the actor has.
 */
export const reachAt = (principal: Principal, orgNodeId: string) =>
  db.query((k) =>
    forPrincipal(k, principal)
      .selectFrom('held')
      .innerJoin('Role as r', (join) =>
        join
          .on('r.tenantId', '=', principal.tenantId)
          .onRef('r.id', '=', 'held.roleId')
          .on('r.status', '=', 'active'),
      )
      .innerJoin('OrgNode as node', (join) =>
        join.on('node.tenantId', '=', principal.tenantId).on('node.id', '=', orgNodeId),
      )
      .leftJoin('OrgNode as anchor', (join) =>
        join
          .on('anchor.tenantId', '=', principal.tenantId)
          .onRef('anchor.id', '=', 'held.orgNodeId'),
      )
      .innerJoin('Permission as p', (join) =>
        join.on((eb) =>
          rolePermits(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            eb.ref('p.id'),
          ),
        ),
      )
      .where((eb) =>
        reaches(
          {
            id: eb.ref('r.id'),
            tenantId: eb.ref('r.tenantId'),
            permissionMode: eb.ref('r.permissionMode'),
          },
          { coverage: eb.ref('held.coverage'), orgNodeId: eb.ref('held.orgNodeId') },
          { target: eb.ref('node.path'), anchor: eb.ref('anchor.path') },
          orgNodeId,
        ),
      )
      .select((eb) => [
        'p.code',
        'p.plugin',
        'p.targetKind',
        'r.kind',
        reachesEveryNode({
          id: eb.ref('r.id'),
          tenantId: eb.ref('r.tenantId'),
          permissionMode: eb.ref('r.permissionMode'),
        }).as('everyNode'),
        'held.coverage',
      ])
      .distinct()
      .execute(),
  )

/**
 * Why someone holds what they hold, one row per (permission, grant).
 *
 * The reach predicate is the one the decision uses, not a second copy: an
 * explanation that disagrees with the answer is worse than no explanation.
 */
export const explainRows = (tenantId: string, userId: string, orgNodeId: string | undefined) =>
  db.query((k) =>
    held(k, tenantId, userId, 'general')
      .selectFrom('held')
      .innerJoin('Role as r', (join) =>
        join
          .on('r.tenantId', '=', tenantId)
          .onRef('r.id', '=', 'held.roleId')
          .on('r.status', '=', 'active'),
      )
      .leftJoin('OrgNode as anchor', (join) =>
        join.on('anchor.tenantId', '=', tenantId).onRef('anchor.id', '=', 'held.orgNodeId'),
      )
      .leftJoin('OrgNode as node', (join) =>
        join.on('node.tenantId', '=', tenantId).on('node.id', '=', orgNodeId ?? null),
      )
      .innerJoin('Permission as p', (join) =>
        join.on((eb) =>
          rolePermits(
            {
              id: eb.ref('r.id'),
              tenantId: eb.ref('r.tenantId'),
              permissionMode: eb.ref('r.permissionMode'),
            },
            eb.ref('p.id'),
          ),
        ),
      )
      .where((eb) =>
        orgNodeId
          ? countsAt(
              {
                id: eb.ref('r.id'),
                tenantId: eb.ref('r.tenantId'),
                permissionMode: eb.ref('r.permissionMode'),
                kind: eb.ref('r.kind'),
              },
              { coverage: eb.ref('held.coverage'), orgNodeId: eb.ref('held.orgNodeId') },
              { target: eb.ref('node.path'), anchor: eb.ref('anchor.path') },
              eb.ref('p.targetKind'),
              orgNodeId,
            )
          : eb('r.kind', '=', 'tenant'),
      )
      .select([
        'p.code',
        'p.plugin',
        'p.targetKind',
        'p.name',
        'r.id as roleId',
        'r.code as roleCode',
        'held.grantId',
        'held.orgNodeId',
        'anchor.name as orgNodeName',
        'held.coverage',
      ])
      .orderBy('p.code')
      .execute(),
  )

/** holders of the administrator role who could still sign in */
export const administratorSurvivors = (tenantId: string, roleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .innerJoin('Role as r', (join) =>
          join
            .onRef('r.tenantId', '=', 'g.tenantId')
            .onRef('r.id', '=', 'g.roleId')
            .on('r.status', '=', 'active'),
        )
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'g.tenantId').onRef('u.id', '=', 'g.userId'),
        )
        .innerJoin('UserType as t', (join) =>
          join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
        )
        .where('g.tenantId', '=', tenantId)
        .where('g.roleId', '=', roleId)
        // An administrator who could actually sign in today. The sign-in channel
        // flags are part of it because a type that opens neither is what every
        // driver refuses. Bound identities deliberately are not: whether a user
        // needs one before their first sign-in is driver knowledge, so requiring
        // one here would state something the core cannot know.
        .where('u.enabled', '=', true)
        .where('t.enabled', '=', true)
        .where((eb) =>
          eb.or([eb('t.allowLocalLogin', '=', true), eb('t.allowSsoLogin', '=', true)]),
        )
        .select(sql<number>`count(distinct g.user_id)::int`.as('count'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

/**
 * The canonical administrator role, locked.
 *
 * Locking the row first serializes every admin-reducing mutation of a tenant,
 * so two concurrent ones cannot each observe the other's administrator as the
 * survivor. Pinned to the whole system-role shape rather than the key alone: a
 * row whose mode, kind or status was edited out of band is not the
 * administrator role any more, and counting its holders would let the last
 * real administrator be removed.
 */
export const lockAdministratorRole = (tenantId: string, systemKey: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('systemKey', '=', systemKey)
      .where('permissionMode', '=', 'all-active')
      .where('kind', '=', 'tenant')
      .where('status', '=', 'active')
      .forUpdate()
      .executeTakeFirst(),
  )

/** role codes of org-kind grants at the node whose role forbids the given org type */
export const grantsBlockingOrgType = (tenantId: string, orgNodeId: string, orgTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .innerJoin('Role as r', (join) =>
          join
            .onRef('r.tenantId', '=', 'g.tenantId')
            .onRef('r.id', '=', 'g.roleId')
            .on('r.kind', '=', 'org'),
        )
        .where('g.tenantId', '=', tenantId)
        .where('g.orgNodeId', '=', orgNodeId)
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('RoleAllowedOrgType as t')
                .select(sql<number>`1`.as('one'))
                .whereRef('t.tenantId', '=', 'g.tenantId')
                .whereRef('t.roleId', '=', 'g.roleId')
                .where('t.orgTypeId', '=', orgTypeId),
            ),
          ),
        )
        .select('r.code')
        .distinct()
        .orderBy('r.code')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.code)))

/** how far a grant reaches, ordered so a wider one can be compared to a narrower */
export const REACH_RANK = { self: 0, subtree: 1, tenant: 2 } as const
export type Reach = keyof typeof REACH_RANK

/** the catalog's row, inserted if absent; the stored row stays the single truth */
export const upsertPermission = (permission: ActivePermission) =>
  db.query((k) =>
    k
      .insertInto('Permission')
      .values({
        code: permission.code,
        plugin: permission.plugin,
        name: plainText(permission.name),
        description:
          permission.description === undefined ? null : plainText(permission.description),
        groupKey: permission.groupKey ?? null,
        targetKind: permission.target,
      })
      .onConflict((conflict) => conflict.column('code').doNothing())
      .execute(),
  )

export const permissionRow = (code: string) =>
  db.query((k) =>
    k
      .selectFrom('Permission')
      .select(['plugin', 'targetKind'])
      .where('code', '=', code)
      .executeTakeFirst(),
  )

/** display text follows the declaration freely, because it decides nothing */
export const refreshPermissionText = (permission: ActivePermission) =>
  db.query((k) =>
    k
      .updateTable('Permission')
      .set({
        name: plainText(permission.name),
        description:
          permission.description === undefined ? null : plainText(permission.description),
        groupKey: permission.groupKey ?? null,
        updatedAt: sql<Date>`now()`,
      })
      .where('code', '=', permission.code)
      .execute(),
  )

/**
 * Roles that would be left assignable to nobody if this user type went away.
 *
 * A role that admits this type and no other has nobody left who may hold it,
 * which is the inert state the lifecycle exists to prevent.
 */
export const rolesStrandedByUserType = (tenantId: string, userTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Role as r')
        .where('r.tenantId', '=', tenantId)
        .where('r.eligibilityMode', '=', 'allow-list')
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('RoleAllowedUserType as t')
              .select('t.userTypeId')
              .whereRef('t.tenantId', '=', 'r.tenantId')
              .whereRef('t.roleId', '=', 'r.id')
              .where('t.userTypeId', '=', userTypeId),
          ),
        )
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('RoleAllowedUserType as t')
                .select('t.userTypeId')
                .whereRef('t.tenantId', '=', 'r.tenantId')
                .whereRef('t.roleId', '=', 'r.id')
                .where('t.userTypeId', '!=', userTypeId),
            ),
          ),
        )
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

/**
 * Grants the new user type would not be eligible for.
 *
 * Asked of every kind of role, because a tenant role declares who may hold it
 * too: narrowing this to org roles would let a retype strand a tenant grant
 * instead of refusing.
 */
export const grantsBlockingUserType = (tenantId: string, userId: string, userTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .where('g.tenantId', '=', tenantId)
        .where('g.userId', '=', userId)
        .innerJoin('Role as r', (join) =>
          join.onRef('r.tenantId', '=', 'g.tenantId').onRef('r.id', '=', 'g.roleId'),
        )
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        // a role that admits every user type cannot be invalidated by a retype
        .where((eb) =>
          eb.not(
            admitsUserType(
              {
                tenantId: eb.ref('g.tenantId'),
                id: eb.ref('g.roleId'),
                eligibilityMode: eb.ref('r.eligibilityMode'),
                anchorMode: eb.ref('r.anchorMode'),
              },
              eb.val(userTypeId),
            ),
          ),
        )
        // the canonical administrator is exempt: its authority does not come
        // from eligibility, and it is recognised by shape rather than by having
        // a system key, which would exempt every system role added later
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('Role as r')
              .select('r.id')
              .whereRef('r.tenantId', '=', 'g.tenantId')
              .whereRef('r.id', '=', 'g.roleId')
              .where((inner) =>
                inner.not(
                  canonicalTenantAdmin({
                    systemKey: inner.ref('r.systemKey'),
                    permissionMode: inner.ref('r.permissionMode'),
                    kind: inner.ref('r.kind'),
                  }),
                ),
              ),
          ),
        )
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))
