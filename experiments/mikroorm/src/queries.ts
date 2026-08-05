import { sql } from 'kysely'
import { kyselyOf, type Em } from './orm.ts'

// The three shapes the decision turns on, written the way an assembly would.
//
// A: an ordinary typed read, where the question is whether the hand-written
//    Row interface and the hand-written column list both disappear.
// B: a postgres-specific read - ltree, a recursive CTE - where the question is
//    how much of it stays raw SQL. If the answer is "all of it", the exchange
//    is only which executor runs the string.
// C: a cross-plugin write inside one transaction, where the question is
//    whether a peer's refusal rolls back the caller's uncommitted work.

/** A: every org type in a tenant, ordered the way the ui lists them */
export const listTypes = (em: Em, tenantId: string) =>
  kyselyOf(em)
    .selectFrom('OrgType')
    .select(['id', 'code', 'name', 'sortOrder'])
    .where('tenantId', '=', tenantId)
    .orderBy('sortOrder')
    .orderBy('name')
    .execute()

/**
 * A: how many of these type ids the tenant actually has.
 *
 * The drizzle version reads
 * `id = any(string_to_array(${typeIds.join(',')}, ',')::uuid[])`, which is a
 * workaround for array binding rather than something the query wanted to say.
 */
export const countTypes = (em: Em, tenantId: string, typeIds: readonly string[]) =>
  kyselyOf(em)
    .selectFrom('OrgType')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('tenantId', '=', tenantId)
    .where('id', 'in', typeIds)
    .executeTakeFirstOrThrow()

/**
 * B: the subtree under a node, by ltree containment.
 *
 * `<@` has no builder form, so the predicate stays raw - but only the
 * predicate. Which table, which columns, and what comes back are still the
 * builder's, which is the distinction this measures.
 */
export const readSubtree = (em: Em, tenantId: string, path: string) =>
  kyselyOf(em)
    .selectFrom('OrgNode')
    .select(['id', 'parentId', 'orgTypeId', 'name', 'path', 'depth', 'sortOrder'])
    .where('tenantId', '=', tenantId)
    .where(sql<boolean>`path <@ ${path}::ltree`)
    .orderBy('path')
    .execute()

/** B: the children of a node whose own type the given parent type forbids */
export const incompatibleChildTypes = (
  em: Em,
  tenantId: string,
  nodeId: string,
  parentTypeId: string,
) =>
  kyselyOf(em)
    .selectFrom('OrgNode as child')
    .innerJoin('OrgType as childType', (join) =>
      join
        .onRef('childType.id', '=', 'child.orgTypeId')
        .onRef('childType.tenantId', '=', 'child.tenantId'),
    )
    .select(['childType.id as typeId', 'childType.name as typeName'])
    .distinct()
    .where('child.tenantId', '=', tenantId)
    .where('child.parentId', '=', nodeId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('OrgTypeRule')
            .select('OrgTypeRule.parentTypeId')
            .whereRef('OrgTypeRule.childTypeId', '=', 'child.orgTypeId')
            .where('OrgTypeRule.tenantId', '=', tenantId)
            .where('OrgTypeRule.parentTypeId', '=', parentTypeId),
        ),
      ),
    )
    .execute()

/** C: the users whose placement policy the new org type would strand */
export const usersBlockingOrgType = (
  em: Em,
  tenantId: string,
  nodeId: string,
  orgTypeId: string,
) =>
  kyselyOf(em)
    .selectFrom('User as u')
    .innerJoin('UserType as ut', (join) =>
      join.onRef('ut.id', '=', 'u.userTypeId').onRef('ut.tenantId', '=', 'u.tenantId'),
    )
    .select(['u.id as userId', 'ut.code as userTypeCode'])
    .where('u.tenantId', '=', tenantId)
    .where('u.primaryOrgNodeId', '=', nodeId)
    .where('ut.placementMode', '=', 'allow-list')
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('UserTypeAllowedOrgType as allowed')
            .select('allowed.orgTypeId')
            .whereRef('allowed.userTypeId', '=', 'ut.id')
            .where('allowed.tenantId', '=', tenantId)
            .where('allowed.orgTypeId', '=', orgTypeId),
        ),
      ),
    )
    .execute()

/** C: the role grants anchored at a node whose roles the new type disallows */
export const grantsBlockingOrgType = (
  em: Em,
  tenantId: string,
  nodeId: string,
  orgTypeId: string,
) =>
  kyselyOf(em)
    .selectFrom('RoleGrant as g')
    .innerJoin('Role as r', (join) =>
      join.onRef('r.id', '=', 'g.roleId').onRef('r.tenantId', '=', 'g.tenantId'),
    )
    .select(['g.id as grantId', 'r.code as roleCode'])
    .where('g.tenantId', '=', tenantId)
    .where('g.orgNodeId', '=', nodeId)
    .where('r.kind', '=', 'org')
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('RoleAllowedOrgType as allowed')
            .select('allowed.orgTypeId')
            .whereRef('allowed.roleId', '=', 'r.id')
            .where('allowed.tenantId', '=', tenantId)
            .where('allowed.orgTypeId', '=', orgTypeId),
        ),
      ),
    )
    .execute()

/** C: the tenant row lock every structural write takes first */
export const lockTenant = (em: Em, tenantId: string) =>
  kyselyOf(em)
    .selectFrom('Tenant')
    .select('id')
    .where('id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst()

/** C: the write itself */
export const setNodeType = (em: Em, nodeId: string, orgTypeId: string) =>
  kyselyOf(em)
    .updateTable('OrgNode')
    .set({ orgTypeId })
    .where('id', '=', nodeId)
    .returning(['id', 'orgTypeId'])
    .executeTakeFirstOrThrow()
