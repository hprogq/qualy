import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { AssignmentInput } from '@qualy/rbac-contract'

type Tx = Parameters<Parameters<Context['db']['drizzle']['transaction']>[0]>[0]

// reusable domain invariant: a tenant must keep at least one enabled user
// holding the canonical tenant-admin role. Locks the role row FOR UPDATE so
// every admin-reducing mutation serializes — two concurrent removals cannot
// both observe the other assignment as a survivor.
export async function assertTenantKeepsAdministrator(
  tx: Tx,
  tenantId: string,
  excludeAssignmentId?: string,
): Promise<void> {
  const role = (
    await tx.execute<{ id: string }>(sql`
      select id from roles
      where tenant_id = ${tenantId} and code = 'tenant-admin' and is_system and kind = 'tenant'
      for update`)
  ).rows[0]
  if (!role) return
  const survivors = (
    await tx.execute<{ count: string }>(sql`
      select count(distinct a.user_id) as count
      from user_role_assignments a
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.enabled
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
      where a.tenant_id = ${tenantId} and a.role_id = ${role.id}
        and (${excludeAssignmentId ?? null}::uuid is null or a.id <> ${excludeAssignmentId ?? null})`)
  ).rows[0]
  if (Number(survivors?.count ?? 0) === 0) {
    throw new Error('assignment rejected: the last tenant administrator cannot be removed')
  }
}

// assignment lifecycle with eligibility validation; the management api
// session builds on these calls
export class Assignments {
  constructor(private ctx: Context) {}

  // validates and creates one role assignment inside a transaction: tenant
  // boundary, enabled/assignable state, tenant roles pinned to root/subtree
  // and org roles constrained by their allowed user and org types
  async createAssignment(input: AssignmentInput): Promise<string> {
    const db = this.ctx.db.drizzle
    return db.transaction(async (tx) => {
      const role = (
        await tx.execute<{ kind: string; enabled: boolean; assignable: boolean }>(
          sql`select kind, enabled, assignable from roles
              where tenant_id = ${input.tenantId} and id = ${input.roleId}`,
        )
      ).rows[0]
      if (!role) throw new Error('assignment rejected: role not found in tenant')
      if (!role.enabled || !role.assignable) {
        throw new Error('assignment rejected: role is not assignable')
      }
      const user = (
        await tx.execute<{ user_type_id: string; enabled: boolean }>(
          sql`select user_type_id, enabled from users
              where tenant_id = ${input.tenantId} and id = ${input.userId}`,
        )
      ).rows[0]
      if (!user) throw new Error('assignment rejected: user not found in tenant')
      if (!user.enabled) throw new Error('assignment rejected: user is disabled')
      const node = (
        await tx.execute<{ org_type_id: string; parent_id: string | null }>(
          sql`select org_type_id, parent_id from org_nodes
              where tenant_id = ${input.tenantId} and id = ${input.orgNodeId}`,
        )
      ).rows[0]
      if (!node) throw new Error('assignment rejected: org node not found in tenant')

      if (role.kind === 'tenant') {
        if (node.parent_id !== null || input.scope !== 'subtree') {
          throw new Error('assignment rejected: tenant roles bind to the root with subtree scope')
        }
      } else {
        const allowedType = (
          await tx.execute(sql`select 1 from role_allowed_user_types
            where tenant_id = ${input.tenantId} and role_id = ${input.roleId}
              and user_type_id = ${user.user_type_id}`)
        ).rows[0]
        if (!allowedType) {
          throw new Error('assignment rejected: user type is not allowed for this role')
        }
        const allowedOrg = (
          await tx.execute(sql`select 1 from role_allowed_org_types
            where tenant_id = ${input.tenantId} and role_id = ${input.roleId}
              and org_type_id = ${node.org_type_id}`)
        ).rows[0]
        if (!allowedOrg) {
          throw new Error('assignment rejected: org node type is not allowed for this role')
        }
      }

      const inserted = await tx.execute<{ id: string }>(sql`
        insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
        values (${input.tenantId}, ${input.userId}, ${input.roleId}, ${input.orgNodeId}, ${input.scope})
        on conflict do nothing
        returning id`)
      const id = inserted.rows[0]?.id
      if (!id) throw new Error('assignment rejected: identical assignment already exists')
      return id
    })
  }

  async removeAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const db = this.ctx.db.drizzle
    await db.transaction(async (tx) => {
      const target = (
        await tx.execute<{ code: string; is_system: boolean; kind: string }>(sql`
          select r.code, r.is_system, r.kind
          from user_role_assignments a
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
          where a.tenant_id = ${tenantId} and a.id = ${assignmentId}`)
      ).rows[0]
      if (!target) return
      if (target.code === 'tenant-admin' && target.is_system && target.kind === 'tenant') {
        await assertTenantKeepsAdministrator(tx, tenantId, assignmentId)
      }
      await tx.execute(sql`delete from user_role_assignments
        where tenant_id = ${tenantId} and id = ${assignmentId}`)
    })
  }
}
