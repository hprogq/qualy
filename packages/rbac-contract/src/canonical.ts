import { sql, type SQL } from 'drizzle-orm'

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
  system_key: string | null
  permission_mode: string
  kind: string
}

export const isCanonicalTenantAdmin = (role: CanonicalAdminShape): boolean =>
  role.system_key === CANONICAL_ADMIN_ROLE &&
  role.permission_mode === 'all-active' &&
  role.kind === 'tenant'

// the same test in sql, for the queries that decide over a set of rows
export const canonicalTenantAdmin = (alias: string): SQL => {
  const r = sql.raw(alias)
  return sql`(${r}.system_key = ${CANONICAL_ADMIN_ROLE}
    and ${r}.permission_mode = 'all-active' and ${r}.kind = 'tenant')`
}
