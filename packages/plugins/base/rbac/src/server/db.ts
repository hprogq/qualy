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
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

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
  readonly anchorMode: Expression<string>
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
      sql<number>`(select count(*)::int from role_grants g
        where g.tenant_id = ${eb.ref('r.tenantId')} and g.role_id = ${eb.ref('r.id')})`.as(
        'grantCount',
      ),
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
export const insertScopedGrant = (input: {
  tenantId: string
  userId: string
  roleId: string
  orgNodeId: string
  coverage: 'self' | 'subtree'
  resource: { namespace: string; type: string; id: string }
  validUntil: number | null
  createdBy: string | null
}) =>
  db
    .query((k) =>
      k
        .insertInto('RoleGrant')
        .values({
          tenantId: input.tenantId,
          userId: input.userId,
          roleId: input.roleId,
          orgNodeId: input.orgNodeId,
          coverage: input.coverage,
          resourceNamespace: input.resource.namespace,
          resourceType: input.resource.type,
          resourceId: input.resource.id,
          validUntil:
            input.validUntil === null ? null : sql`to_timestamp(${input.validUntil} / 1000.0)`,
          createdBy: input.createdBy,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => row.id as string))

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
        .where(
          sql<boolean>`(
            g.revoked_at is null
            and (g.valid_from is null or g.valid_from <= now())
            and (g.valid_until is null or g.valid_until > now())
          )`,
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

/** the roles a role may appoint, for the editor to read back */
export const grantRuleTargets = (tenantId: string, granterRoleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrantRule')
        .select('targetRoleId')
        .where('tenantId', '=', tenantId)
        .where('granterRoleId', '=', granterRoleId)
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.targetRoleId as string)))

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
  db
    .query((k) =>
      k
        .updateTable('RoleGrant')
        .set({ revokedAt: sql`now()`, revokedBy: actorId } as never)
        .where('tenantId', '=', tenantId)
        .where('id', '=', grantId)
        .where('revokedAt', 'is', null)
        .returning('id')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const rolePermissionMode = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('mode'))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )
