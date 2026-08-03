import { sql } from 'drizzle-orm'
import type { RbacDbHandle } from '@qualy/rbac-contract'
import { accessErrors } from './errors.ts'

// Whether one (user, role, node, scope) grant is permitted. Single-grant
// creation and whole-set replacement both come through here: two entry points
// that each carried their own copy of these rules had already drifted, one
// refusing disabled users and the other not.
//
// Always runs on the caller's handle, which is always a transaction holding
// the tenant lock: the role's eligibility sets and the org topology it reads
// are exactly what a concurrent write would change underneath it.

export interface GrantRequest {
  userId: string
  roleId: string
  orgNodeId: string
  scope: 'self' | 'subtree'
}

const one = async <T>(handle: RbacDbHandle, query: unknown) =>
  (await handle.execute(query)).rows[0] as T | undefined

export async function assertGrantEligible(
  handle: RbacDbHandle,
  tenantId: string,
  grant: GrantRequest,
): Promise<{ id: string; code: string; kind: string; is_system: boolean }> {
  const role = await one<{
    id: string
    code: string
    kind: string
    is_system: boolean
    enabled: boolean
    assignable: boolean
  }>(
    handle,
    sql`select id, code, kind, is_system, enabled, assignable from roles
        where tenant_id = ${tenantId} and id = ${grant.roleId}`,
  )
  if (!role) throw accessErrors.create('ROLE_NOT_FOUND')
  if (!role.enabled || !role.assignable) {
    throw accessErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { reason: 'role-unassignable' })
  }

  const user = await one<{ user_type_id: string; enabled: boolean }>(
    handle,
    sql`select user_type_id, enabled from users
        where tenant_id = ${tenantId} and id = ${grant.userId}`,
  )
  if (!user) throw accessErrors.create('ASSIGNMENT_USER_NOT_FOUND')
  if (!user.enabled) {
    throw accessErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { reason: 'user-disabled' })
  }

  const node = await one<{ org_type_id: string; parent_id: string | null }>(
    handle,
    sql`select org_type_id, parent_id from org_nodes
        where tenant_id = ${tenantId} and id = ${grant.orgNodeId}`,
  )
  if (!node) throw accessErrors.create('ASSIGNMENT_NODE_NOT_FOUND')

  if (role.kind === 'tenant') {
    // tenant authority is tenant-wide by definition; anchoring it anywhere
    // but the whole tree would silently mean something else
    if (node.parent_id !== null || grant.scope !== 'subtree') {
      throw accessErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { reason: 'tenant-role-anchor' })
    }
    return role
  }

  const allowsUserType = await one(
    handle,
    sql`select 1 from role_allowed_user_types
        where tenant_id = ${tenantId} and role_id = ${role.id}
          and user_type_id = ${user.user_type_id}`,
  )
  if (!allowsUserType) {
    throw accessErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { reason: 'user-type' })
  }
  const allowsOrgType = await one(
    handle,
    sql`select 1 from role_allowed_org_types
        where tenant_id = ${tenantId} and role_id = ${role.id}
          and org_type_id = ${node.org_type_id}`,
  )
  if (!allowsOrgType) {
    throw accessErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { reason: 'org-type' })
  }
  return role
}
