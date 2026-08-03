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

// The administrator role is identified by its system key rather than by its
// code, so renaming it for display cannot detach the protection from it.
export const CANONICAL_ADMIN_ROLE = 'tenant-admin'

// An administrator who could actually sign in today. The sign-in channel
// flags are part of the check because a type that opens neither is exactly
// what every driver refuses. Bound identities deliberately are NOT: whether
// a user needs one before their first sign-in is driver knowledge (an sso
// driver may provision on arrival), so requiring one here would state
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
  // Pinned to the whole system-role shape, not just the key. A row whose
  // mode, kind or status was edited out of band is not the administrator
  // role any more, and counting its holders as survivors would let the last
  // real administrator be removed.
  const role = (
    await handle.execute(sql`
      select id from roles
      where tenant_id = ${tenantId} and system_key = ${CANONICAL_ADMIN_ROLE}
        and permission_mode = 'all-active' and kind = 'tenant' and status = 'active'
      for update`)
  ).rows[0] as { id: string } | undefined
  // fail closed: returning here would let every admin-reducing write through
  // on exactly the tenants least able to survive one
  if (!role) {
    throw new Error(
      `tenant ${tenantId} has no canonical administrator role; refusing to change access`,
    )
  }
  const survivors = (
    await handle.execute(sql`
      select count(distinct g.user_id) as count
      from role_grants g
      join roles r on r.tenant_id = g.tenant_id and r.id = g.role_id and r.status = 'active'
      join users u on u.tenant_id = g.tenant_id and u.id = g.user_id
      join user_types t on t.tenant_id = u.tenant_id and t.id = u.user_type_id
      where g.tenant_id = ${tenantId} and g.role_id = ${role.id} and ${LOGIN_CAPABLE}`)
  ).rows[0] as { count: string } | undefined
  if (Number(survivors?.count ?? 0) === 0) {
    throw accessInvariantErrors.create('LAST_ADMINISTRATOR')
  }
}
