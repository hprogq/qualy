import { sql } from 'drizzle-orm'
import type { Context } from 'cordis'
import { z } from 'zod'
import { defineDomainErrors } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import { assertTenantKeepsAdministrator } from './assignments.ts'

// Role and assignment administration. Every mutation runs in one
// transaction that first locks the tenant row — the same lock org
// structural writes and identity writes take — so an allowed-set change and
// the assignments it must stay compatible with can never race.

export const adminErrors = defineDomainErrors({
  ROLE_NOT_FOUND: { status: 404, message: 'role not found' },
  ROLE_CONFLICT: { status: 409, message: 'a role with that code already exists' },
  ROLE_IS_SYSTEM: { status: 409, message: 'system roles cannot be changed this way' },
  ROLE_IN_USE: {
    status: 409,
    message: 'the role is still assigned',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
  ROLE_NEEDS_ALLOWED_SETS: {
    status: 422,
    message: 'an org role needs at least one allowed user type and org type',
  },
  ROLE_PERMISSION_NOT_GRANTABLE: {
    status: 422,
    message: 'a permission cannot be granted to this role',
    data: z.object({ rejected: z.array(z.string()) }),
  },
  ASSIGNMENT_NOT_ELIGIBLE: {
    status: 409,
    message: 'existing assignments would become invalid',
    data: z.object({ assignmentCount: z.number().int().nonnegative() }),
  },
  ASSIGNMENT_NOT_FOUND: { status: 404, message: 'assignment not found' },
  ROLE_USER_TYPE_NOT_FOUND: { status: 404, message: 'user type not found' },
  ROLE_ORG_TYPE_NOT_FOUND: { status: 404, message: 'org type not found' },
  TENANT_ADMIN_REQUIRED: {
    status: 403,
    message: 'only a tenant administrator may grant or revoke that role',
  },
})

type Drizzle = Context['db']['drizzle']
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0]

const translateDbError: (error: unknown) => never = createConstraintTranslator({
  uq_roles_tenant_code: () => adminErrors.create('ROLE_CONFLICT'),
  uq_roles_tenant_name: () => adminErrors.create('ROLE_CONFLICT', 'that role name is taken'),
})

export type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  kind: string
  is_system: boolean
  assignable: boolean
  enabled: boolean
  assignment_count: number
  permissions: string[]
  allowed_user_types: string[]
  allowed_org_types: string[]
}

export type AssignmentRow = {
  id: string
  user_id: string
  user_display_name: string
  role_id: string
  role_code: string
  role_name: string
  org_node_id: string
  org_node_name: string
  scope: 'self' | 'subtree'
}

// the canonical administrator role is immutable in every respect that could
// lock a tenant out of its own administration: it cannot be deleted,
// disabled, renamed at the code level, re-kinded or stripped of its system
// flag. Only its display name and description stay editable.
const CANONICAL_ADMIN = 'tenant-admin'

export class Administration {
  constructor(private ctx: Context) {}

  private get db() {
    return this.ctx.db.drizzle
  }

  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work)
    } catch (error) {
      translateDbError(error)
    }
  }

  private async lockTenant(tx: Tx, tenantId: string) {
    const row = (await tx.execute(sql`select 1 from tenants where id = ${tenantId} for update`))
      .rows[0]
    if (!row) throw new Error(`tenant ${tenantId} does not exist`)
  }

  // --- roles ---

  async listRoles(tenantId: string): Promise<RoleRow[]> {
    const result = await this.db.execute<RoleRow>(sql`
      select r.id, r.code, r.name, r.description, r.kind, r.is_system, r.assignable, r.enabled,
        (select count(*)::int from user_role_assignments a
         where a.tenant_id = r.tenant_id and a.role_id = r.id) as assignment_count,
        coalesce((select array_agg(p.code order by p.code)
          from role_permissions rp join permissions p on p.id = rp.permission_id
          where rp.tenant_id = r.tenant_id and rp.role_id = r.id), '{}') as permissions,
        coalesce((select array_agg(t.user_type_id::text)
          from role_allowed_user_types t
          where t.tenant_id = r.tenant_id and t.role_id = r.id), '{}') as allowed_user_types,
        coalesce((select array_agg(t.org_type_id::text)
          from role_allowed_org_types t
          where t.tenant_id = r.tenant_id and t.role_id = r.id), '{}') as allowed_org_types
      from roles r
      where r.tenant_id = ${tenantId}
      order by r.kind, r.code`)
    return result.rows
  }

  // the ordinary management api creates org roles only; tenant roles decide
  // tenant-wide authority and are provisioned by the seed
  createOrgRole(
    tenantId: string,
    input: { code: string; name: string; description?: string },
  ): Promise<string> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into roles (tenant_id, code, name, description, kind)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null}, 'org')
        returning id`)
      return created.rows[0]!.id
    })
  }

  updateRole(
    tenantId: string,
    roleId: string,
    fields: { name?: string; description?: string | null; assignable?: boolean },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      // a system role keeps its assignability: making the administrator role
      // unassignable is a lockout by another name
      if (role.is_system && fields.assignable === false) {
        throw adminErrors.create('ROLE_IS_SYSTEM')
      }
      await tx.execute(sql`
        update roles set
          name = coalesce(${fields.name ?? null}, name),
          description = ${fields.description === undefined ? sql`description` : fields.description},
          assignable = coalesce(${fields.assignable ?? null}, assignable),
          updated_at = now()
        where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  setRoleEnabled(tenantId: string, roleId: string, enabled: boolean) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (!enabled && this.isCanonicalAdmin(role)) throw adminErrors.create('ROLE_IS_SYSTEM')
      await tx.execute(sql`
        update roles set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  deleteRole(tenantId: string, roleId: string) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (role.is_system) throw adminErrors.create('ROLE_IS_SYSTEM')
      const assignments = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from user_role_assignments
          where tenant_id = ${tenantId} and role_id = ${role.id}`)
      ).rows[0]!.count
      if (assignments > 0) {
        throw adminErrors.create('ROLE_IN_USE', { assignmentCount: assignments })
      }
      await tx.execute(sql`delete from roles where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  // an org role may only hold org-scope permissions, a tenant role only
  // tenant-scope ones, and every code must declare the role channel
  syncRolePermissions(tenantId: string, roleId: string, codes: readonly string[]) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (this.isCanonicalAdmin(role)) throw adminErrors.create('ROLE_IS_SYSTEM')
      const wanted = [...new Set(codes)]
      if (wanted.length > 0) {
        const grantable = (
          await tx.execute<{ code: string }>(sql`
            select code from permissions
            where code = any(string_to_array(${wanted.join(',')}, ','))
              and enabled and grant_to_role and scope = ${role.kind === 'org' ? 'org' : 'tenant'}`)
        ).rows.map((row) => row.code)
        const rejected = wanted.filter((code) => !grantable.includes(code))
        if (rejected.length > 0) {
          throw adminErrors.create('ROLE_PERMISSION_NOT_GRANTABLE', { rejected })
        }
      }
      await tx.execute(sql`
        delete from role_permissions
        where tenant_id = ${tenantId} and role_id = ${role.id}
          and permission_id not in (
            select id from permissions
            where code = any(string_to_array(${wanted.join(',')}, ',')))`)
      if (wanted.length > 0) {
        await tx.execute(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${tenantId}, ${role.id}, p.id from permissions p
          where p.code = any(string_to_array(${wanted.join(',')}, ','))
          on conflict do nothing`)
      }
    })
  }

  // narrowing an allowed set must not strand assignments that already exist
  syncRoleAllowedSets(
    tenantId: string,
    roleId: string,
    sets: { userTypeIds?: readonly string[]; orgTypeIds?: readonly string[] },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (role.kind !== 'org') throw adminErrors.create('ROLE_IS_SYSTEM')
      const userTypeIds = sets.userTypeIds ? [...new Set(sets.userTypeIds)] : undefined
      const orgTypeIds = sets.orgTypeIds ? [...new Set(sets.orgTypeIds)] : undefined
      if (userTypeIds?.length === 0 || orgTypeIds?.length === 0) {
        throw adminErrors.create('ROLE_NEEDS_ALLOWED_SETS')
      }
      if (userTypeIds) await this.requireAll(tx, tenantId, 'user_types', userTypeIds)
      if (orgTypeIds) await this.requireAll(tx, tenantId, 'org_types', orgTypeIds)

      if (userTypeIds) {
        await tx.execute(sql`
          delete from role_allowed_user_types
          where tenant_id = ${tenantId} and role_id = ${role.id}
            and user_type_id <> all(string_to_array(${userTypeIds.join(',')}, ',')::uuid[])`)
        await tx.execute(sql`
          insert into role_allowed_user_types (tenant_id, role_id, user_type_id)
          select ${tenantId}, ${role.id}, id
          from unnest(string_to_array(${userTypeIds.join(',')}, ',')::uuid[]) as id
          on conflict do nothing`)
      }
      if (orgTypeIds) {
        await tx.execute(sql`
          delete from role_allowed_org_types
          where tenant_id = ${tenantId} and role_id = ${role.id}
            and org_type_id <> all(string_to_array(${orgTypeIds.join(',')}, ',')::uuid[])`)
        await tx.execute(sql`
          insert into role_allowed_org_types (tenant_id, role_id, org_type_id)
          select ${tenantId}, ${role.id}, id
          from unnest(string_to_array(${orgTypeIds.join(',')}, ',')::uuid[]) as id
          on conflict do nothing`)
      }

      // the sets and the assignments are checked together under one lock, so
      // a narrowing that would orphan an assignment fails as a whole
      const stranded = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count
          from user_role_assignments a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
          join org_nodes n on n.tenant_id = a.tenant_id and n.id = a.org_node_id
          where a.tenant_id = ${tenantId} and a.role_id = ${role.id}
            and (not exists (
                  select 1 from role_allowed_user_types t
                  where t.tenant_id = a.tenant_id and t.role_id = a.role_id
                    and t.user_type_id = u.user_type_id)
              or not exists (
                  select 1 from role_allowed_org_types t
                  where t.tenant_id = a.tenant_id and t.role_id = a.role_id
                    and t.org_type_id = n.org_type_id))`)
      ).rows[0]!.count
      if (stranded > 0) {
        throw adminErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { assignmentCount: stranded })
      }
    })
  }

  // --- assignments ---

  async listAssignments(
    tenantId: string,
    filter: { userId?: string; orgNodeId?: string },
  ): Promise<AssignmentRow[]> {
    const result = await this.db.execute<AssignmentRow>(sql`
      select a.id, a.user_id, u.display_name as user_display_name,
        a.role_id, r.code as role_code, r.name as role_name,
        a.org_node_id, n.name as org_node_name, a.scope
      from user_role_assignments a
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
      join org_nodes n on n.tenant_id = a.tenant_id and n.id = a.org_node_id
      where a.tenant_id = ${tenantId}
        and (${filter.userId ?? null}::uuid is null or a.user_id = ${filter.userId ?? null})
        and (${filter.orgNodeId ?? null}::uuid is null
             or a.org_node_id = ${filter.orgNodeId ?? null})
      order by u.display_name, r.code`)
    return result.rows
  }

  // granting or revoking the canonical administrator role is reserved for
  // someone who already holds it: an org manager must not be able to
  // promote themselves through the ordinary assignment api
  async assertMayAdministerRole(tenantId: string, roleId: string, actorUserId: string) {
    const role = (
      await this.db.execute<{ code: string; is_system: boolean; kind: string }>(sql`
        select code, is_system, kind from roles
        where tenant_id = ${tenantId} and id = ${roleId}`)
    ).rows[0]
    if (!role) throw adminErrors.create('ROLE_NOT_FOUND')
    if (!this.isCanonicalAdmin(role)) return
    const holder = (
      await this.db.execute(sql`
        select 1 from user_role_assignments a
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        where a.tenant_id = ${tenantId} and a.user_id = ${actorUserId}
          and r.code = ${CANONICAL_ADMIN} and r.is_system and r.kind = 'tenant' and r.enabled`)
    ).rows[0]
    if (!holder) throw adminErrors.create('TENANT_ADMIN_REQUIRED')
  }

  // the assignments of one user, replaced as a set. Everything happens under
  // the tenant lock, so the last-administrator invariant sees the final
  // state rather than a snapshot.
  syncUserAssignments(
    tenantId: string,
    userId: string,
    wanted: readonly { roleId: string; orgNodeId: string; scope: 'self' | 'subtree' }[],
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const existing = (
        await tx.execute<{ id: string; role_id: string; org_node_id: string; scope: string }>(sql`
          select id, role_id, org_node_id, scope from user_role_assignments
          where tenant_id = ${tenantId} and user_id = ${userId}`)
      ).rows
      const key = (entry: {
        roleId?: string
        role_id?: string
        orgNodeId?: string
        org_node_id?: string
        scope: string
      }) =>
        `${entry.roleId ?? entry.role_id}:${entry.orgNodeId ?? entry.org_node_id}:${entry.scope}`
      const wantedKeys = new Set(wanted.map(key))
      const existingKeys = new Set(existing.map(key))

      for (const row of existing) {
        if (wantedKeys.has(key(row))) continue
        await tx.execute(sql`
          delete from user_role_assignments where tenant_id = ${tenantId} and id = ${row.id}`)
      }
      for (const entry of wanted) {
        if (existingKeys.has(key(entry))) continue
        await this.insertAssignment(tx, tenantId, userId, entry)
      }
      // one check at the end covers every removal in this batch
      await assertTenantKeepsAdministrator(tx, tenantId)
    })
  }

  private async insertAssignment(
    tx: Tx,
    tenantId: string,
    userId: string,
    entry: { roleId: string; orgNodeId: string; scope: 'self' | 'subtree' },
  ) {
    const role = await this.requireRole(tx, tenantId, entry.roleId)
    if (!role.enabled || !role.assignable) throw adminErrors.create('ROLE_IS_SYSTEM')
    const user = (
      await tx.execute<{ user_type_id: string; enabled: boolean }>(sql`
        select user_type_id, enabled from users
        where tenant_id = ${tenantId} and id = ${userId}`)
    ).rows[0]
    if (!user) throw adminErrors.create('ASSIGNMENT_NOT_FOUND', 'user not found in tenant')
    const node = (
      await tx.execute<{ org_type_id: string; parent_id: string | null }>(sql`
        select org_type_id, parent_id from org_nodes
        where tenant_id = ${tenantId} and id = ${entry.orgNodeId}`)
    ).rows[0]
    if (!node) throw adminErrors.create('ASSIGNMENT_NOT_FOUND', 'org node not found in tenant')

    if (role.kind === 'tenant') {
      if (node.parent_id !== null || entry.scope !== 'subtree') {
        throw adminErrors.create(
          'ASSIGNMENT_NOT_ELIGIBLE',
          { assignmentCount: 1 },
          'tenant roles bind to the root with subtree scope',
        )
      }
    } else {
      const eligible = (
        await tx.execute(sql`
          select 1 from role_allowed_user_types t
          where t.tenant_id = ${tenantId} and t.role_id = ${role.id}
            and t.user_type_id = ${user.user_type_id}`)
      ).rows[0]
      const nodeEligible = (
        await tx.execute(sql`
          select 1 from role_allowed_org_types t
          where t.tenant_id = ${tenantId} and t.role_id = ${role.id}
            and t.org_type_id = ${node.org_type_id}`)
      ).rows[0]
      if (!eligible || !nodeEligible) {
        throw adminErrors.create('ASSIGNMENT_NOT_ELIGIBLE', { assignmentCount: 1 })
      }
    }
    await tx.execute(sql`
      insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
      values (${tenantId}, ${userId}, ${role.id}, ${entry.orgNodeId}, ${entry.scope})
      on conflict do nothing`)
  }

  private isCanonicalAdmin(role: { code: string; is_system: boolean; kind: string }) {
    return role.code === CANONICAL_ADMIN && role.is_system && role.kind === 'tenant'
  }

  private async requireRole(tx: Tx, tenantId: string, roleId: string) {
    const row = (
      await tx.execute<{
        id: string
        code: string
        kind: string
        is_system: boolean
        enabled: boolean
        assignable: boolean
      }>(sql`
        select id, code, kind, is_system, enabled, assignable from roles
        where tenant_id = ${tenantId} and id = ${roleId}`)
    ).rows[0]
    if (!row) throw adminErrors.create('ROLE_NOT_FOUND')
    return row
  }

  private async requireAll(tx: Tx, tenantId: string, table: 'user_types' | 'org_types', ids: string[]) {
    const found = (
      await tx.execute<{ count: number }>(
        table === 'user_types'
          ? sql`select count(*)::int as count from user_types
                where tenant_id = ${tenantId}
                  and id = any(string_to_array(${ids.join(',')}, ',')::uuid[])`
          : sql`select count(*)::int as count from org_types
                where tenant_id = ${tenantId}
                  and id = any(string_to_array(${ids.join(',')}, ',')::uuid[])`,
      )
    ).rows[0]!.count
    if (found !== ids.length) {
      throw adminErrors.create(
        table === 'user_types' ? 'ROLE_USER_TYPE_NOT_FOUND' : 'ROLE_ORG_TYPE_NOT_FOUND',
      )
    }
  }
}
