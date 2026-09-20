import { sql } from 'kysely'
import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities } from '../db/entities.ts'

// What this plugin's queries may reach: its own history, org's units (a
// row's path and the reader's reach are judged there), auth's people (what
// a provisioned person is now) and rbac's grants (what a reversal would
// take away) - all read only. Writes to those go through their owners' ports.

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

export const db = Db.scope(closure)

export type Db = ScopedKysely<typeof closure>

/**
 * Serializes every structural write of one tenant.
 *
 * The same row org, auth and rbac lock, so an import cannot interleave with
 * a retype, a transfer or a grant: the tree it resolved against is the tree
 * it writes into.
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
