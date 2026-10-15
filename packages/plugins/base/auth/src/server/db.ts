import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { expressionBuilder, sql, type Expression, type Kysely } from 'kysely'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../db/entities.ts'

// What auth's queries may reach.
//
// Its own tables and org's, because auth declares a database dependency on org
// and its rows point at org's - and nothing else. The assembly's manager knows
// every table in the deployment, so a query written against it could reach
// rbac by accident; naming the closure here is what stops that, and it is a
// narrowing rather than a claim, so it cannot be wrong in the unsafe direction.

const closure = [...orgEntities, ...entities] as const

export const db = Db.scope(closure)

/** the builder fragment helpers receive, inside a query's callback */
export type Db = ScopedKysely<typeof closure>

/** the tables the closure names, for a predicate that builds its own subquery */
export type Schema = Db extends Kysely<infer Tables> ? Tables : never

/**
 * The tenant row, held for the rest of the transaction.
 *
 * The first statement of every structural write: two callers racing to change
 * the same tenant serialize here, so the checks each of them runs afterwards
 * are decided against a state nobody else is moving.
 */
export const lockTenant = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )

/**
 * The columns a guard needs off a user type, without the projection's aggregates.
 *
 * Here rather than beside either caller because both the type screen and the
 * people screen decide by it, and a second copy is a second answer to "may
 * this type be handed out".
 */
export const userTypeGuard = (tenantId: string, userTypeId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserType')
      // the editable columns travel with the guard so an update that changes
      // nothing can be recognised before it bumps the version
      .select(['id', 'code', 'enabled', 'isSystem', 'version', 'name', 'description', 'sortOrder'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .executeTakeFirst(),
  )

/** the node types a user type's allow-list names, as text ids; empty for none */
export const allowedOrgTypeIds = (type: {
  readonly tenantId: Expression<string>
  readonly id: Expression<string>
}) => {
  const eb = expressionBuilder<Schema>()
  return eb.fn.coalesce(
    eb
      .selectFrom('UserTypeAllowedOrgType as a')
      .select((agg) =>
        agg.fn.agg<string[]>('array_agg', [agg.cast('a.orgTypeId', 'text')]).as('ids'),
      )
      .where('a.tenantId', '=', type.tenantId)
      .where('a.userTypeId', '=', type.id),
    sql<string[]>`'{}'::text[]`,
  )
}

/** how many living people one column of theirs points at a given row, as a number */
export const livingUsersCount = (
  tenantId: Expression<string>,
  column: 'userTypeId' | 'primaryOrgNodeId',
  value: Expression<string>,
) => {
  const eb = expressionBuilder<Schema>()
  return eb
    .selectFrom('User as u')
    .select((count) => count.cast<number>(count.fn.countAll(), 'integer').as('count'))
    .where('u.tenantId', '=', tenantId)
    .where(`u.${column}`, '=', value)
    .where('u.deletedAt', 'is', null)
}
