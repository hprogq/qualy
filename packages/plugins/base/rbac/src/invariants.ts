import { sql } from 'drizzle-orm'
import { accessInvariantErrors } from '@qualy/rbac-contract'
import type { RbacDbHandle } from '@qualy/rbac-contract'

// The one place that answers "can this tenant still administer itself?".
//
// Both plugins can break it and neither can see the whole picture alone:
// auth disables users, disables user types and rewrites their sign-in
// policy; rbac revokes the administrator role. Every one of those paths ends
// here so they cannot drift apart, and every one of them calls it AFTER its
// own write so the check reads the transaction's final state rather than a
// prediction of it — a failure simply rolls the whole thing back.

export const CANONICAL_ADMIN_ROLE = 'tenant-admin'

// An administrator who could actually sign in today. The sign-in channel
// flags are part of the check because a type that opens neither is exactly
// what every driver refuses. Bound identities deliberately are NOT: whether
// a user needs one before their first sign-in is driver knowledge (an sso
// driver may provision on first arrival), so requiring one here would state
// something the core cannot know. This is therefore a necessary condition,
// and the strongest one that stays true for drivers not written yet.
const LOGIN_CAPABLE = sql`
  u.enabled
  and t.enabled
  and (t.allow_local_login or t.allow_sso_login)`

export async function assertTenantKeepsAdministrator(
  handle: RbacDbHandle,
  tenantId: string,
): Promise<void> {
  // locking the role row first serializes every admin-reducing mutation of
  // this tenant: two concurrent ones cannot each observe the other's
  // administrator as the survivor
  const role = (
    await handle.execute(sql`
      select id from roles
      where tenant_id = ${tenantId} and code = ${CANONICAL_ADMIN_ROLE}
        and is_system and kind = 'tenant'
      for update`)
  ).rows[0] as { id: string } | undefined
  if (!role) return
  const survivors = (
    await handle.execute(sql`
      select count(distinct a.user_id) as count
      from user_role_assignments a
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      where a.tenant_id = ${tenantId} and a.role_id = ${role.id} and ${LOGIN_CAPABLE}`)
  ).rows[0] as { count: string } | undefined
  if (Number(survivors?.count ?? 0) === 0) {
    throw accessInvariantErrors.create('LAST_ADMINISTRATOR')
  }
}
