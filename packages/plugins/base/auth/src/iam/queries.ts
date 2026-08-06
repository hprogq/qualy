import { sql, type SQL } from 'drizzle-orm'

// What auth still asks the old runtime.
//
// Both of these read rbac's tables, which are not in this plugin's entity
// closure and should not be: the questions belong to rbac, and move to ports
// on its service when rbac migrates. Until then they run through the shim, on
// the same connection as everything else.

/**
 * Roles that would be left assignable to nobody if this type went away.
 *
 * Eligibility rows cascade with the type, which would silently empty a role's
 * allowed set. The count says how many roles must be fixed first. Asked of
 * every kind of role, because a tenant role declares who may hold it too:
 * looking only at org roles once left a live tenant role behind with nobody
 * eligible for it, which is the inert state the lifecycle exists to prevent.
 */
export const rolesStrandedByUserTypeQuery = (tenantId: string, userTypeId: string): SQL => sql`
  select count(*)::int as count from roles r
  where r.tenant_id = ${tenantId}
    and exists (select 1 from role_allowed_user_types t
                where t.tenant_id = r.tenant_id and t.role_id = r.id
                  and t.user_type_id = ${userTypeId})
    and not exists (select 1 from role_allowed_user_types t
                    where t.tenant_id = r.tenant_id and t.role_id = r.id
                      and t.user_type_id <> ${userTypeId})`

/**
 * Grants the new type would not be eligible for.
 *
 * Asked of every kind of role, because a tenant role declares who may hold it
 * too: narrowing this to org roles would let a retype strand a tenant grant
 * instead of refusing. The canonical administrator is exempt, since its
 * authority does not come from eligibility.
 */
export const grantsBlockingUserTypeQuery = (
  tenantId: string,
  userId: string,
  userTypeId: string,
  canonicalAdmin: SQL,
): SQL => sql`
  select count(*)::int as count
  from role_grants g
  where g.tenant_id = ${tenantId} and g.user_id = ${userId}
    and not exists (
      select 1 from role_allowed_user_types t
      where t.tenant_id = g.tenant_id and t.role_id = g.role_id
        and t.user_type_id = ${userTypeId})
    and exists (
      select 1 from roles r
      where r.tenant_id = g.tenant_id and r.id = g.role_id
        and not ${canonicalAdmin})`

// --- reads both runtimes serve ---
