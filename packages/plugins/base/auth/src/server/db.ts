import { Postgres, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { sql } from 'kysely'
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

export const db = Postgres.scope(closure)

/** the builder fragment helpers receive, inside a query's callback */
export type Db = ScopedKysely<typeof closure>

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
      .select(['id', 'code', 'enabled', 'isSystem', 'version'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .executeTakeFirst(),
  )
