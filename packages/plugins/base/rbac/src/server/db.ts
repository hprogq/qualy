import { Effect } from 'effect'
import {
  entityManager,
  kyselyOf,
  query,
  type ClosureEntityManager,
} from '@qualy/plugin-database/server'
import { sql } from 'kysely'
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
