import { sql, type Expression, type RawBuilder } from 'kysely'

// The one role that is exempt from the rules every other role obeys, named
// in one place because three plugins ask the question and each of them was
// asking a slightly different one.
//
// It is identified by its whole shape, not by merely having a system key.
// "Has a system key" reads as "is the administrator" only while exactly one
// system role exists; the next one to be introduced would silently inherit
// the exemption, which is how a role nobody meant to be universal ends up
// grantable to anyone.

export const CANONICAL_ADMIN_ROLE = 'tenant-admin'

export interface CanonicalAdminShape {
  systemKey: string | null
  permissionMode: string
  kind: string
}

export const isCanonicalTenantAdmin = (role: CanonicalAdminShape): boolean =>
  role.systemKey === CANONICAL_ADMIN_ROLE &&
  role.permissionMode === 'all-active' &&
  role.kind === 'tenant'

/**
 * The columns the predicate reads, wherever the caller aliased them.
 *
 * References rather than an alias string, for the same reason the scope
 * predicate takes them: a query that renamed its join stops compiling instead
 * of describing a table that is not there.
 */
export interface CanonicalAdminRef {
  readonly systemKey: Expression<string | null>
  readonly permissionMode: Expression<string>
  readonly kind: Expression<string>
}

/** the same test in sql, for the queries that decide over a set of rows */
export const canonicalTenantAdmin = (role: CanonicalAdminRef): RawBuilder<boolean> =>
  sql<boolean>`(${role.systemKey} = ${CANONICAL_ADMIN_ROLE}
    and ${role.permissionMode} = 'all-active' and ${role.kind} = 'tenant')`
