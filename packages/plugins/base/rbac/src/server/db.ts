import { Effect } from 'effect'
import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { sql, type Expression } from 'kysely'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities } from '../db/entities.ts'

// What rbac's queries may reach.
//
// Its own tables plus org's and auth's, because rbac declares database
// dependencies on both and its rows point at theirs: a grant names a user and
// a node. Nothing else - the assembly's manager knows every table in the
// deployment, and naming the closure here is what keeps a query from reaching
// a plugin rbac has no relationship with.

const closure = [...orgEntities, ...authEntities, ...entities] as const

export const db = Db.scope(closure)

/** the builder fragment helpers receive, inside a query's callback */
export type Db = ScopedKysely<typeof closure>

/** the same row org and auth lock, so the three cannot interleave */
export const lockTenant = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )

export const userExists = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', '=', userId)
        // a deleted person cannot be granted anything: for authorization
        // they have left, whatever history still names them
        .where('deletedAt', 'is', null)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Withdraws every live grant one person holds, in one statement.
 *
 * The rows stay - who could do what, and until when, is history - and the
 * revocation is attributed to whoever deleted the user. Returns how many
 * fell, which the audit event records.
 */
export const revokeAllGrantsOfUser = (tenantId: string, userId: string, actorId: string | null) =>
  db
    .query((k) =>
      k
        .updateTable('RoleGrant')
        .set({ revokedAt: sql`now()`, revokedBy: actorId } as never)
        .where('tenantId', '=', tenantId)
        .where('userId', '=', userId)
        .where('revokedAt', 'is', null)
        .returning('id')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.length))

export const orgNodeExists = (tenantId: string, orgNodeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('id', '=', orgNodeId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * One role or all of a tenant's, with the sets a role screen needs.
 *
 * Shared because the role screen and the grant picker both read it, and a
 * second projection would eventually disagree about what a role currently
 * carries.
 */
/**
 * The role columns the eligibility predicates read, wherever a query aliased
 * them.
 *
 * References rather than an alias string, for the same reason the scope
 * predicate takes them: a query that renamed its join stops compiling instead
 * of describing a table that is not there.
 */
export interface RoleEligibilityRef {
  readonly tenantId: Expression<string>
  readonly id: Expression<string>
  readonly eligibilityMode: Expression<string>
  // null on a tenant role, which has no anchor dimension; the comparison
  // against 'unrestricted' is null-safe, and no tenant grant carries a node
  // for the org-type test to ever run against
  readonly anchorMode: Expression<string | null>
}

/**
 * Whether a role admits this kind of person, and this kind of node.
 *
 * One definition each, because four questions are asked of them - may this
 * grant be created, would this edit strand a grant, would deleting this user
 * type leave a role nobody can hold, would retyping this person invalidate a
 * grant - and four hand-written copies of "is it in the list, unless the mode
 * says everything" is four chances to forget the mode.
 */
export const admitsUserType = (role: RoleEligibilityRef, userTypeId: Expression<string>) =>
  sql<boolean>`(${role.eligibilityMode} = 'unrestricted' or exists (
    select 1 from role_allowed_user_types t
    where t.tenant_id = ${role.tenantId} and t.role_id = ${role.id}
      and t.user_type_id = ${userTypeId}))`

/**
 * Nullable, because the node is outer-joined wherever a tenant grant may be in
 * the same result set. Such a row has no node for this to decide, and the
 * caller says so with a null test rather than by handing over a node that is
 * not there.
 */
export const admitsOrgType = (role: RoleEligibilityRef, orgTypeId: Expression<string | null>) =>
  sql<boolean>`(${role.anchorMode} = 'unrestricted' or exists (
    select 1 from role_allowed_org_types t
    where t.tenant_id = ${role.tenantId} and t.role_id = ${role.id}
      and t.org_type_id = ${orgTypeId}))`

/** the grant columns that say whether it still stands, wherever a query aliased them */
export interface GrantValidityRef {
  readonly revokedAt: Expression<Date | null>
  readonly validFrom: Expression<Date | null>
  readonly validUntil: Expression<Date | null>
}

/**
 * A grant that is in force right now.
 *
 * One definition, because "withdrawn" has to mean the same thing to the
 * decision and to everything that administers or displays it. It did not: the
 * deciding statements honoured `revoked_at`, the administration queries did
 * not, and a grant withdrawn when a batch unstaffed somebody went on refusing
 * that person's user-type change, blocking their role's deletion and showing
 * on the grants screen as authority they no longer had. The partial unique
 * indexes on role_grants say the same thing about a revoked row: it is inert.
 */
export const inForce = (grant: GrantValidityRef) => sql<boolean>`(
  ${grant.revokedAt} is null
  and (${grant.validFrom} is null or ${grant.validFrom} <= now())
  and (${grant.validUntil} is null or ${grant.validUntil} > now())
)`

const roleProjection = (k: Db, tenantId: string) =>
  k
    .selectFrom('Role as r')
    .select((eb) => [
      'r.id',
      'r.code',
      'r.name',
      'r.description',
      'r.systemKey',
      'r.assignable',
      'r.version',
      eb.ref('r.kind').$castTo<'tenant' | 'org'>().as('kind'),
      eb.ref('r.status').$castTo<'draft' | 'active' | 'disabled'>().as('status'),
      eb.ref('r.permissionMode').$castTo<'explicit' | 'all-active'>().as('permissionMode'),
      // coalesced because a scalar subquery is nullable to the type system,
      // where count(*) is not: the projection promises a number
      sql<number>`coalesce(${eb
        .selectFrom('RoleGrant as g')
        .select(sql<number>`count(*)::int`.as('count'))
        .whereRef('g.tenantId', '=', 'r.tenantId')
        .whereRef('g.roleId', '=', 'r.id')
        .where((grant) =>
          inForce({
            revokedAt: grant.ref('g.revokedAt'),
            validFrom: grant.ref('g.validFrom'),
            validUntil: grant.ref('g.validUntil'),
          }),
        )}, 0)`.as('grantCount'),
      sql<string[]>`coalesce((select array_agg(p.code order by p.code)
        from role_permissions rp join permissions p on p.id = rp.permission_id
        where rp.tenant_id = ${eb.ref('r.tenantId')} and rp.role_id = ${eb.ref('r.id')}), '{}')`.as(
        'permissions',
      ),
      eb.ref('r.eligibilityMode').$castTo<'unrestricted' | 'allow-list'>().as('eligibilityMode'),
      eb.ref('r.anchorMode').$castTo<'unrestricted' | 'allow-list'>().as('anchorMode'),
      sql<string[]>`coalesce((select array_agg(t.user_type_id::text) from role_allowed_user_types t
        where t.tenant_id = ${eb.ref('r.tenantId')} and t.role_id = ${eb.ref('r.id')}), '{}')`.as(
        'allowedUserTypes',
      ),
      sql<string[]>`coalesce((select array_agg(t.org_type_id::text) from role_allowed_org_types t
        where t.tenant_id = ${eb.ref('r.tenantId')} and t.role_id = ${eb.ref('r.id')}), '{}')`.as(
        'allowedOrgTypes',
      ),
    ])
    .where('r.tenantId', '=', tenantId)
    .orderBy('r.kind')
    .orderBy('r.code')

export const rolesOfTenant = (tenantId: string) =>
  db.query((k) => roleProjection(k, tenantId).execute())

export const oneRoleProjected = (tenantId: string, roleId: string) =>
  db.query((k) => roleProjection(k, tenantId).where('r.id', '=', roleId).executeTakeFirst())

/** what the projection returns, read off the query rather than restated */
export type RoleRow = Effect.Success<ReturnType<typeof rolesOfTenant>>[number]

/** the codes a role currently carries */
export const rolePermissionCodes = (tenantId: string, roleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RolePermission as rp')
        .innerJoin('Permission as p', 'p.id', 'rp.permissionId')
        .where('rp.tenantId', '=', tenantId)
        .where('rp.roleId', '=', roleId)
        .select('p.code')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.code)))

/**
 * Authority over one object.
 *
 * Written here rather than through the ordinary grant path because it answers
 * a different question: not "what does this person do in the organization" but
 * "what may they do to this one thing". The scope is set once - changing it
 * means revoking and granting again - so nothing a consumer has accepted can
 * widen underneath it.
 */
/** withdrawn, not deleted: an authority that once existed is a fact */
/**
 * Whether the actor holds a role whose appointment rules name this one, with
 * that holding in force where the new grant would anchor.
 *
 * The rule is read against the actor's live, general grants: revoked or
 * expired holdings appoint nobody, and authority confined to one resource
 * appoints nobody outside it. The holding also has to stand over the target
 * node - a college administrator's edge to "counsellor" is an edge for their
 * own college's subtree, not a licence to appoint counsellors anywhere. A
 * tenant-wide holding (no anchor) stands everywhere.
 */
export const ruleAllowsAppointment = (input: {
  tenantId: string
  actorUserId: string
  targetRoleId: string
  /** where the new grant anchors; null for a tenant-wide grant */
  orgNodeId: string | null
}) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrantRule as rule')
        .innerJoin('RoleGrant as g', (join) =>
          join
            .onRef('g.tenantId', '=', 'rule.tenantId')
            .onRef('g.roleId', '=', 'rule.granterRoleId'),
        )
        .innerJoin('Role as gr', (join) =>
          join
            .onRef('gr.tenantId', '=', 'g.tenantId')
            .onRef('gr.id', '=', 'g.roleId')
            .on('gr.status', '=', 'active'),
        )
        .leftJoin('OrgNode as held', (join) =>
          join.onRef('held.tenantId', '=', 'g.tenantId').onRef('held.id', '=', 'g.orgNodeId'),
        )
        .where('rule.tenantId', '=', input.tenantId)
        .where('rule.targetRoleId', '=', input.targetRoleId)
        .where('g.userId', '=', input.actorUserId)
        .where('g.resourceId', 'is', null)
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        .where(
          input.orgNodeId === null
            ? sql<boolean>`g.org_node_id is null`
            : sql<boolean>`(
                g.org_node_id is null
                or (g.coverage = 'self' and g.org_node_id = ${input.orgNodeId})
                or (g.coverage = 'subtree' and (
                  select target.path from org_nodes target
                  where target.tenant_id = g.tenant_id and target.id = ${input.orgNodeId}
                ) <@ held.path)
              )`,
        )
        .select('g.id')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * The offices a role appoints, named.
 *
 * The code travels with the id because these edges are read for three
 * different answers - what the editor shows, what a save already had, and
 * which appointment authority a self-grant would add - and the last one has to
 * say which office in words.
 */
export const grantRuleTargets = (tenantId: string, granterRoleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrantRule as rule')
        .innerJoin('Role as r', (join) =>
          join.onRef('r.tenantId', '=', 'rule.tenantId').onRef('r.id', '=', 'rule.targetRoleId'),
        )
        .select(['r.id', 'r.code'])
        .where('rule.tenantId', '=', tenantId)
        .where('rule.granterRoleId', '=', granterRoleId)
        .orderBy('r.code')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => ({ id: row.id as string, code: row.code }))))

/** the offices that appoint this one, for the editor and the impact dialog */
export const grantRuleSources = (tenantId: string, targetRoleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrantRule as rule')
        .innerJoin('Role as r', (join) =>
          join.onRef('r.tenantId', '=', 'rule.tenantId').onRef('r.id', '=', 'rule.granterRoleId'),
        )
        .select(['r.id', 'r.name'])
        .where('rule.tenantId', '=', tenantId)
        .where('rule.targetRoleId', '=', targetRoleId)
        .orderBy('r.name')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => ({ id: row.id as string, name: row.name }))))

/**
 * Whether the appointment graph, as it stands, lets this role reach itself.
 *
 * The DAG invariant, checked after the write inside the same tenant-locked
 * transaction: role mutations are serialized on that lock, so two edits
 * cannot each look acyclic and land a cycle together. Any new cycle must
 * pass through the role whose edges were just replaced, so walking out from
 * that one role is the whole question.
 */
export const appointmentCycleExists = (tenantId: string, roleId: string) =>
  db
    .query((k) =>
      sql<{ cycled: boolean }>`
        with recursive walk (role_id) as (
          select rule.target_role_id
          from role_grant_rules rule
          where rule.tenant_id = ${tenantId} and rule.granter_role_id = ${roleId}
          union
          select rule.target_role_id
          from role_grant_rules rule
          join walk on walk.role_id = rule.granter_role_id
          where rule.tenant_id = ${tenantId}
        )
        select exists (select 1 from walk where walk.role_id = ${roleId}) as cycled
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.cycled)))

/** what appointment validation needs to know about each named target */
export const rolesForAppointment = (tenantId: string, roleIds: readonly string[]) =>
  roleIds.length === 0
    ? Effect.succeed([] as readonly { id: string; kind: 'tenant' | 'org'; codes: string[] }[])
    : db
        .query((k) =>
          k
            .selectFrom('Role as r')
            .leftJoin('RolePermission as rp', (join) =>
              join.onRef('rp.tenantId', '=', 'r.tenantId').onRef('rp.roleId', '=', 'r.id'),
            )
            .leftJoin('Permission as p', (join) => join.onRef('p.id', '=', 'rp.permissionId'))
            .select(['r.id', 'r.kind', 'p.code'])
            .where('r.tenantId', '=', tenantId)
            .where('r.id', 'in', [...roleIds])
            .execute(),
        )
        .pipe(
          Effect.map((rows) => {
            const byId = new Map<string, { id: string; kind: 'tenant' | 'org'; codes: string[] }>()
            for (const row of rows) {
              const held = byId.get(row.id) ?? {
                id: row.id,
                kind: row.kind as 'tenant' | 'org',
                codes: [],
              }
              if (row.code !== null) held.codes.push(row.code)
              byId.set(row.id, held)
            }
            return [...byId.values()]
          }),
        )

/** the appointment edges, replaced whole like every other role set */
export const replaceGrantRuleTargets = (
  tenantId: string,
  granterRoleId: string,
  targetRoleIds: readonly string[],
) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      targetRoleIds.length === 0
        ? k
            .deleteFrom('RoleGrantRule')
            .where('tenantId', '=', tenantId)
            .where('granterRoleId', '=', granterRoleId)
            .execute()
        : k
            .deleteFrom('RoleGrantRule')
            .where('tenantId', '=', tenantId)
            .where('granterRoleId', '=', granterRoleId)
            .where('targetRoleId', 'not in', [...targetRoleIds])
            .execute(),
    )
    for (const targetRoleId of new Set(targetRoleIds)) {
      yield* db.query((k) =>
        k
          .insertInto('RoleGrantRule')
          .values({ tenantId, granterRoleId, targetRoleId } as never)
          .onConflict((oc) => oc.doNothing())
          .execute(),
      )
    }
  })

export const revokeGrant = (tenantId: string, grantId: string, actorId: string | null) =>
  db.query((k) =>
    k
      .updateTable('RoleGrant')
      .set({ revokedAt: sql`now()`, revokedBy: actorId } as never)
      .where('tenantId', '=', tenantId)
      .where('id', '=', grantId)
      .where('revokedAt', 'is', null)
      // who lost what, so the port can record the withdrawal it performed
      .returning(['id', 'userId', 'roleId', 'orgNodeId'])
      .executeTakeFirst(),
  )

export const rolePermissionMode = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('mode'))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )
