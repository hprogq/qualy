import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { sql } from 'kysely'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../db/entities.ts'

// What this plugin's queries may reach: its own table and org's, because the
// row points at the tenant.

const closure = [...orgEntities, ...entities] as const

export const db = Db.scope(closure)

export type Db = ScopedKysely<typeof closure>

/** Serialize terminology writes with changes to the caller's authority. */
export const lockTenant = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )
