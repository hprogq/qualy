import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import type { AssignmentInput, RbacDbHandle } from '@qualy/rbac-contract'
import { assertGrantEligible } from './eligibility.ts'
import { assertTenantKeepsAdministrator, CANONICAL_ADMIN_ROLE } from './invariants.ts'
import { accessErrors } from './errors.ts'

// assignment lifecycle for callers holding a service reference; the
// management api replaces whole sets instead and shares the same eligibility
// and lockout checks
export class Assignments {
  constructor(private ctx: Context) {}

  async createAssignment(input: AssignmentInput): Promise<string> {
    const db = this.ctx.db.drizzle
    return db.transaction(async (tx) => {
      // assignments read org topology (node, type); taking the tenant row
      // lock serializes them against org structural writes and identity
      // writes, which take the same lock, so neither side can validate
      // against a stale tree
      await tx.execute(sql`select 1 from tenants where id = ${input.tenantId} for update`)
      await assertGrantEligible(tx, input.tenantId, input)
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
        values (${input.tenantId}, ${input.userId}, ${input.roleId}, ${input.orgNodeId},
          ${input.scope})
        on conflict do nothing
        returning id`)
      const id = inserted.rows[0]?.id
      if (!id) throw accessErrors.create('ASSIGNMENT_NOT_FOUND', 'an identical grant already exists')
      return id
    })
  }

  // org-kind assignments at the node whose role does not allow the given
  // org type; a lock-holding caller must pass its own transaction handle
  // (a second pool connection under a held lock can deadlock the pool)
  async assignmentsBlockingOrgType(
    tenantId: string,
    orgNodeId: string,
    orgTypeId: string,
    handle?: RbacDbHandle,
  ): Promise<string[]> {
    const db = (handle ?? this.ctx.db.drizzle) as Context['db']['drizzle']
    const result = await db.execute<{ code: string }>(sql`
      select distinct r.code
      from user_role_assignments a
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id and r.kind = 'org'
      where a.tenant_id = ${tenantId} and a.org_node_id = ${orgNodeId}
        and not exists (
          select 1 from role_allowed_org_types t
          where t.tenant_id = a.tenant_id and t.role_id = a.role_id
            and t.org_type_id = ${orgTypeId}
        )
      order by r.code`)
    return result.rows.map((row) => row.code)
  }

  async removeAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const db = this.ctx.db.drizzle
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from tenants where id = ${tenantId} for update`)
      const target = (
        await tx.execute<{ code: string; is_system: boolean; kind: string }>(sql`
          select r.code, r.is_system, r.kind
          from user_role_assignments a
          join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
          where a.tenant_id = ${tenantId} and a.id = ${assignmentId}`)
      ).rows[0]
      if (!target) return
      await tx.execute(sql`delete from user_role_assignments
        where tenant_id = ${tenantId} and id = ${assignmentId}`)
      // checked against the state the deletion actually leaves behind
      if (target.code === CANONICAL_ADMIN_ROLE && target.is_system && target.kind === 'tenant') {
        await assertTenantKeepsAdministrator(tx, tenantId)
      }
    })
  }
}
