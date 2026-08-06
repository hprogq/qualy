import { Effect } from 'effect'
import {
  entityManager,
  kyselyOf,
  query,
  type ClosureEntityManager,
} from '@qualy/plugin-database/server'
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

export type RbacEntityManager = ClosureEntityManager<typeof closure>

/** a manager for rbac's tables, joining an open transaction if there is one */
export const rbacEntityManager = () => entityManager<typeof closure>()

/** the same row org and auth lock, so the three cannot interleave */
export const lockTenant = (em: RbacEntityManager, tenantId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )

export const userExists = (em: RbacEntityManager, tenantId: string, userId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('User')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

export const orgNodeExists = (em: RbacEntityManager, tenantId: string, orgNodeId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgNode')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', orgNodeId)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

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

const roleProjection = (em: RbacEntityManager, tenantId: string) =>
  kyselyOf(em)
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

export const rolesOfTenant = (em: RbacEntityManager, tenantId: string) =>
  query(() => roleProjection(em, tenantId).execute())

export const oneRoleProjected = (em: RbacEntityManager, tenantId: string, roleId: string) =>
  query(() => roleProjection(em, tenantId).where('r.id', '=', roleId).executeTakeFirst())

/** what the projection returns, read off the query rather than restated */
export type RoleRow = Effect.Success<ReturnType<typeof rolesOfTenant>>[number]

/** the codes a role currently carries */
export const rolePermissionCodes = (em: RbacEntityManager, tenantId: string, roleId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('RolePermission as rp')
      .innerJoin('Permission as p', 'p.id', 'rp.permissionId')
      .where('rp.tenantId', '=', tenantId)
      .where('rp.roleId', '=', roleId)
      .select('p.code')
      .execute(),
  ).pipe(Effect.map((rows) => rows.map((row) => row.code)))

export const rolePermissionMode = (em: RbacEntityManager, tenantId: string, roleId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('Role')
      .select((eb) => eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('mode'))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )
