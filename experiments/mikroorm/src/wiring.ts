import type { EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { OrgNode, OrgType, OrgTypeRule, Tenant } from './org-entities.ts'
import { Role, RoleGrant, User, UserType } from './entities.ts'

// What the assembly would generate, and nothing else.
//
// This is the shape of the file `pnpm gen` would write - imports from each
// selected plugin's own tuple, concatenated in a fixed order - written by hand
// here because the point is to prove the type chain survives the
// concatenation, not to build the generator inside a spike.
//
// A plugin exports its own tuple and never imports this file. That direction
// is the whole reason the aggregate can exist: the host depends on plugins,
// so a plugin reaching back for the aggregate's type would close the same
// cycle the api aggregate already refuses.

/** what @qualy/plugin-org would export from its own ./db subpath */
export const orgEntities = [Tenant, OrgType, OrgTypeRule, OrgNode] as const

/** what @qualy/plugin-auth would export */
export const authEntities = [UserType, User] as const

/** what @qualy/plugin-rbac would export */
export const rbacEntities = [Role, RoleGrant] as const

/**
 * The aggregate, in the retained order the database capability decides.
 *
 * `as const` is load-bearing twice over: it keeps the tuple a tuple, and a
 * tuple is what `'~entities'` carries into `getKysely()`. Widened to
 * `EntitySchema[]` every table name becomes `never` and every query stops
 * compiling, pointing at the call site rather than at this line.
 */
export const entities = [...orgEntities, ...authEntities, ...rbacEntities] as const

export type Database = typeof entities

/** the manager type the host hands to plugins, knowing the whole assembly */
export type AssemblyEntityManager = PostgresEntityManager & { '~entities': Database }

/**
 * The manager type a single plugin's queries are written against.
 *
 * A plugin's own closure, not the aggregate: org's queries may reach org's
 * tables and the tables of the plugins it declares a database dependency on,
 * and nothing else. Taking the aggregate type here would let org query rbac by
 * accident and would make the plugin depend on the host.
 */
export type ClosureEntityManager<T extends readonly unknown[]> = PostgresEntityManager & {
  '~entities': T
}

export type OrgEntityManager = ClosureEntityManager<typeof orgEntities>
