import { entityManager, type ClosureEntityManager } from '@qualy/plugin-database/server'
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
