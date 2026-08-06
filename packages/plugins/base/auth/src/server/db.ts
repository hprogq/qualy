import { entityManager, type ClosureEntityManager } from '@qualy/plugin-database/server'
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

export type AuthEntityManager = ClosureEntityManager<typeof closure>

/** a manager for auth's tables, joining an open transaction if there is one */
export const authEntityManager = () => entityManager<typeof closure>()
