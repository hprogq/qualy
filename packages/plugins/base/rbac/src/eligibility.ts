import { sql } from 'drizzle-orm'
import type { GrantTarget, RbacDbHandle } from '@qualy/rbac-contract'
import { accessErrors } from './errors.ts'

// Whether one grant is permitted at all — before any question of who is
// doing the granting. Creation and revocation both come through here, so the
// rules cannot drift the way two hand-written copies already had (one
// refused disabled users, the other did not).
//
// Always runs on the caller's handle, which is always a transaction holding
// the tenant lock: the role's eligibility sets and the org topology it reads
// are exactly what a concurrent write would change underneath it.

export interface EligibleRole {
  id: string
  code: string
  kind: 'tenant' | 'org'
  system_key: string | null
  permission_mode: string
}

const one = async <T>(handle: RbacDbHandle, query: unknown) =>
  (await handle.execute(query)).rows[0] as T | undefined

export async function assertGrantEligible(
  handle: RbacDbHandle,
  tenantId: string,
  grant: { userId: string; roleId: string; target: GrantTarget },
): Promise<EligibleRole> {
  const role = await one<EligibleRole & { status: string; assignable: boolean }>(
    handle,
    sql`select id, code, kind, system_key, permission_mode, status, assignable from roles
        where tenant_id = ${tenantId} and id = ${grant.roleId}`,
  )
  if (!role) throw accessErrors.create('ROLE_NOT_FOUND')
  if (role.status !== 'active' || !role.assignable) {
    throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'role-unassignable' })
  }

  const user = await one<{ user_type_id: string; enabled: boolean }>(
    handle,
    sql`select user_type_id, enabled from users
        where tenant_id = ${tenantId} and id = ${grant.userId}`,
  )
  if (!user) throw accessErrors.create('GRANT_USER_NOT_FOUND')
  if (!user.enabled) throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'user-disabled' })

  // Who may hold this duty is a fact about the role, not about how it is
  // anchored, so it is asked of both kinds. Only org roles used to be
  // checked, which meant a tenant-wide role could be handed to anybody
  // regardless of what it declared: a reviewer role meant for teachers and
  // students would have gone to a system account just as readily.
  //
  // The canonical administrator is the exception, and the only one: it is
  // how a tenant is recovered, so it is grantable to whoever the tenant
  // designates rather than to a list configured in advance.
  if (role.system_key === null) {
    const allowsUserType = await one(
      handle,
      sql`select 1 from role_allowed_user_types
          where tenant_id = ${tenantId} and role_id = ${role.id}
            and user_type_id = ${user.user_type_id}`,
    )
    if (!allowsUserType) throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'user-type' })
  }

  // the kind of the role decides the shape of the grant: tenant authority
  // has nowhere to anchor, org authority has nowhere to apply without one
  if (role.kind === 'tenant') {
    if (grant.target.kind !== 'tenant') {
      throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'tenant-role-anchored' })
    }
    return role
  }
  if (grant.target.kind !== 'org-node') {
    throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'org-role-unanchored' })
  }

  const node = await one<{ org_type_id: string }>(
    handle,
    sql`select org_type_id from org_nodes
        where tenant_id = ${tenantId} and id = ${grant.target.orgNodeId}`,
  )
  if (!node) throw accessErrors.create('GRANT_NODE_NOT_FOUND')

  const allowsOrgType = await one(
    handle,
    sql`select 1 from role_allowed_org_types
        where tenant_id = ${tenantId} and role_id = ${role.id}
          and org_type_id = ${node.org_type_id}`,
  )
  if (!allowsOrgType) throw accessErrors.create('GRANT_NOT_ELIGIBLE', { reason: 'org-type' })
  return role
}
