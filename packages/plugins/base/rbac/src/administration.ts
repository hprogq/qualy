import { sql, type SQL } from 'drizzle-orm'
import type { Context } from 'cordis'
import { AccessDeniedError } from '@qualy/api-contract'
import type {} from '@qualy/plugin-database'
import { createConstraintTranslator } from '@qualy/plugin-database/pg-errors'
import { anchorCoverage, type AuthorizationAnchor, type Principal } from '@qualy/rbac-contract'
import type { Authorization } from './authorization.ts'
import { assertGrantEligible } from './eligibility.ts'
import { accessErrors } from './errors.ts'
import { assertTenantKeepsAdministrator, CANONICAL_ADMIN_ROLE } from './invariants.ts'

// Role and grant administration. Every mutation runs in one transaction that
// first locks the tenant row — the same lock org structural writes and
// identity writes take — so an eligibility change and the grants it must stay
// compatible with can never race. Authorization is re-decided on that same
// locked connection: the router's fast-path check ran before the lock, and
// the org tree can move underneath it.

type Drizzle = Context['db']['drizzle']
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0]

const translateDbError: (error: unknown) => never = createConstraintTranslator({
  uq_roles_tenant_code: () => accessErrors.create('ROLE_CONFLICT'),
  uq_roles_tenant_name: () => accessErrors.create('ROLE_CONFLICT', 'that role name is taken'),
})

export type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  kind: 'tenant' | 'org'
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
  manageable: boolean
}

export interface RoleInput {
  code: string
  name: string
  description?: string
  permissionCodes?: readonly string[]
  allowedUserTypeIds?: readonly string[]
  allowedOrgTypeIds?: readonly string[]
}

export interface GrantInput {
  roleId: string
  orgNodeId: string
  scope: 'self' | 'subtree'
}

export class Administration {
  constructor(
    private ctx: Context,
    private authorization: Authorization,
  ) {}

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

  private roleProjection(where: SQL) {
    return sql`
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
      where ${where}
      order by r.kind, r.code`
  }

  async listRoles(tenantId: string): Promise<RoleRow[]> {
    return (await this.db.execute<RoleRow>(this.roleProjection(sql`r.tenant_id = ${tenantId}`)))
      .rows
  }

  async getRole(tenantId: string, roleId: string): Promise<RoleRow> {
    const row = (
      await this.db.execute<RoleRow>(
        this.roleProjection(sql`r.tenant_id = ${tenantId} and r.id = ${roleId}`),
      )
    ).rows[0]
    if (!row) throw accessErrors.create('ROLE_NOT_FOUND')
    return row
  }

  // the ordinary management api creates org roles only; tenant roles decide
  // tenant-wide authority and are provisioned by the seed. A role is created
  // complete — permissions and eligibility in the same transaction — because
  // an org role without them is enabled, assignable and useless.
  createOrgRole(tenantId: string, input: RoleInput): Promise<string> {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const created = await tx.execute<{ id: string }>(sql`
        insert into roles (tenant_id, code, name, description, kind)
        values (${tenantId}, ${input.code}, ${input.name}, ${input.description ?? null}, 'org')
        returning id`)
      const roleId = created.rows[0]!.id
      await this.replacePermissions(
        tx,
        tenantId,
        { id: roleId, kind: 'org' },
        input.permissionCodes ?? [],
      )
      await this.replaceEligibility(tx, tenantId, roleId, {
        userTypeIds: input.allowedUserTypeIds ?? [],
        orgTypeIds: input.allowedOrgTypeIds ?? [],
      })
      return roleId
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
        throw accessErrors.create('ROLE_IS_SYSTEM')
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
      if (!enabled && this.isCanonicalAdmin(role)) throw accessErrors.create('ROLE_IS_SYSTEM')
      await tx.execute(sql`
        update roles set enabled = ${enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  deleteRole(tenantId: string, roleId: string) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (role.is_system) throw accessErrors.create('ROLE_IS_SYSTEM')
      const assignments = (
        await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from user_role_assignments
          where tenant_id = ${tenantId} and role_id = ${role.id}`)
      ).rows[0]!.count
      if (assignments > 0) {
        throw accessErrors.create('ROLE_IN_USE', { assignmentCount: assignments })
      }
      await tx.execute(sql`delete from roles where tenant_id = ${tenantId} and id = ${role.id}`)
    })
  }

  syncRolePermissions(tenantId: string, roleId: string, codes: readonly string[]) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (this.isCanonicalAdmin(role)) throw accessErrors.create('ROLE_IS_SYSTEM')
      await this.replacePermissions(tx, tenantId, role, codes)
    })
  }

  // an org role may only hold org-scope permissions, a tenant role only
  // tenant-scope ones, and every code must declare the role channel
  private async replacePermissions(
    tx: Tx,
    tenantId: string,
    role: { id: string; kind: string },
    codes: readonly string[],
  ) {
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
        throw accessErrors.create('ROLE_PERMISSION_NOT_GRANTABLE', { rejected })
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
  }

  // which user types may hold the role and at which org node types it may be
  // anchored; narrowing must not strand grants that already exist
  syncRoleEligibility(
    tenantId: string,
    roleId: string,
    sets: { userTypeIds?: readonly string[]; orgTypeIds?: readonly string[] },
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const role = await this.requireRole(tx, tenantId, roleId)
      if (role.kind !== 'org') throw accessErrors.create('ROLE_IS_SYSTEM')
      const userTypeIds = sets.userTypeIds ? [...new Set(sets.userTypeIds)] : undefined
      const orgTypeIds = sets.orgTypeIds ? [...new Set(sets.orgTypeIds)] : undefined
      if (userTypeIds?.length === 0 || orgTypeIds?.length === 0) {
        throw accessErrors.create('ROLE_NEEDS_ELIGIBILITY')
      }
      await this.replaceEligibility(tx, tenantId, role.id, { userTypeIds, orgTypeIds })

      // the sets and the grants are checked together under one lock, so a
      // narrowing that would orphan a grant fails as a whole
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
        throw accessErrors.create('ASSIGNMENT_STRANDED', { assignmentCount: stranded })
      }
    })
  }

  private async replaceEligibility(
    tx: Tx,
    tenantId: string,
    roleId: string,
    sets: { userTypeIds?: readonly string[]; orgTypeIds?: readonly string[] },
  ) {
    const replace = async (
      table: 'role_allowed_user_types' | 'role_allowed_org_types',
      column: 'user_type_id' | 'org_type_id',
      source: 'user_types' | 'org_types',
      ids: readonly string[],
    ) => {
      await this.requireAll(tx, tenantId, source, ids)
      const list = sql.raw(uuidArray(ids))
      await tx.execute(sql`
        delete from ${sql.raw(table)}
        where tenant_id = ${tenantId} and role_id = ${roleId}
          and ${sql.raw(column)} <> all(${list})`)
      if (ids.length > 0) {
        await tx.execute(sql`
          insert into ${sql.raw(table)} (tenant_id, role_id, ${sql.raw(column)})
          select ${tenantId}, ${roleId}, id from unnest(${list}) as id
          on conflict do nothing`)
      }
    }
    if (sets.userTypeIds) {
      await replace('role_allowed_user_types', 'user_type_id', 'user_types', sets.userTypeIds)
    }
    if (sets.orgTypeIds) {
      await replace('role_allowed_org_types', 'org_type_id', 'org_types', sets.orgTypeIds)
    }
  }

  // the tables a role's eligibility may point at, read here so the role
  // screen does not need permissions belonging to other domains
  async listEligibilityOptions(tenantId: string): Promise<{
    userTypes: { id: string; code: string; name: string }[]
    orgTypes: { id: string; code: string; name: string }[]
  }> {
    const [userTypes, orgTypes] = await Promise.all([
      this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from user_types where tenant_id = ${tenantId}
        order by sort_order, code`),
      this.db.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from org_types where tenant_id = ${tenantId}
        order by sort_order, code`),
    ])
    return { userTypes: userTypes.rows, orgTypes: orgTypes.rows }
  }

  // --- grants ---

  // only the grants anchored where the caller may read them; the filter is
  // pushed into the statement instead of being applied row by row afterwards
  async listAssignments(
    tenantId: string,
    filter: { userId?: string; orgNodeId?: string },
    scope?: { read: readonly AuthorizationAnchor[]; manage: readonly AuthorizationAnchor[] },
    page?: { after?: string; limit: number },
  ): Promise<AssignmentRow[]> {
    const visible = scope ? anchorCoverage(scope.read, 'n') : sql`true`
    const manageable = scope ? anchorCoverage(scope.manage, 'n') : sql`true`
    // grant ids are uuidv7, so ordering by id is creation order and a
    // single-column keyset cursor is enough
    const after = page?.after
    const result = await this.db.execute<AssignmentRow>(sql`
      select a.id, a.user_id, u.display_name as user_display_name,
        a.role_id, r.code as role_code, r.name as role_name,
        a.org_node_id, n.name as org_node_name, a.scope,
        ${manageable} as manageable
      from user_role_assignments a
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
      join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
      join org_nodes n on n.tenant_id = a.tenant_id and n.id = a.org_node_id
      where a.tenant_id = ${tenantId}
        and (${filter.userId ?? null}::uuid is null or a.user_id = ${filter.userId ?? null})
        and (${filter.orgNodeId ?? null}::uuid is null
             or a.org_node_id = ${filter.orgNodeId ?? null})
        and (${after ?? null}::uuid is null or a.id > ${after ?? null}::uuid)
        and ${visible}
      order by a.id
      ${page ? sql`limit ${page.limit}` : sql``}`)
    return result.rows
  }

  // the grants of one user, replaced as a set. Authorization, the diff and
  // the lockout invariant all happen under the same tenant lock, so the
  // caller can neither be authorized against a tree that has since moved nor
  // delete a grant that appeared after their snapshot was taken.
  syncUserAssignments(
    tenantId: string,
    userId: string,
    wanted: readonly GrantInput[],
    actor?: Principal,
  ) {
    return this.write(async (tx) => {
      await this.lockTenant(tx, tenantId)
      const existing = (
        await tx.execute<{ id: string; role_id: string; org_node_id: string; scope: string }>(sql`
          select id, role_id, org_node_id, scope from user_role_assignments
          where tenant_id = ${tenantId} and user_id = ${userId}`)
      ).rows
      const key = (entry: { roleId: string; orgNodeId: string; scope: string }) =>
        `${entry.roleId}:${entry.orgNodeId}:${entry.scope}`
      const asKey = (row: { role_id: string; org_node_id: string; scope: string }) =>
        `${row.role_id}:${row.org_node_id}:${row.scope}`
      const wantedKeys = new Set(wanted.map(key))
      const existingKeys = new Set(existing.map(asKey))
      const removed = existing.filter((row) => !wantedKeys.has(asKey(row)))
      const added = wanted.filter((entry) => !existingKeys.has(key(entry)))

      if (actor) {
        // every node this batch touches, before and after, read from the
        // locked connection rather than from the request's own snapshot
        const nodes = new Set([
          ...removed.map((row) => row.org_node_id),
          ...added.map((entry) => entry.orgNodeId),
        ])
        for (const node of nodes) {
          const allowed = await this.authorization.canAt(
            actor,
            'rbac.assignment.manage',
            node,
            tx,
          )
          if (!allowed) throw new AccessDeniedError('not allowed to administer grants at this node')
        }
        // and the canonical administrator role stays reserved for its holders
        for (const roleId of new Set([
          ...removed.map((row) => row.role_id),
          ...added.map((entry) => entry.roleId),
        ])) {
          await this.assertMayAdministerRole(tx, tenantId, roleId, actor.userId)
        }
      }

      for (const row of removed) {
        await tx.execute(sql`
          delete from user_role_assignments where tenant_id = ${tenantId} and id = ${row.id}`)
      }
      for (const entry of added) {
        await assertGrantEligible(tx, tenantId, { ...entry, userId })
        await tx.execute(sql`
          insert into user_role_assignments (tenant_id, user_id, role_id, org_node_id, scope)
          values (${tenantId}, ${userId}, ${entry.roleId}, ${entry.orgNodeId}, ${entry.scope})
          on conflict do nothing`)
      }
      // one check at the end, against the state this batch actually leaves
      await assertTenantKeepsAdministrator(tx, tenantId)
    })
  }

  // granting or revoking the canonical administrator role is reserved for
  // someone who already holds it: an org manager must not be able to promote
  // themselves through the ordinary grant api
  private async assertMayAdministerRole(
    tx: Tx,
    tenantId: string,
    roleId: string,
    actorUserId: string,
  ) {
    const role = (
      await tx.execute<{ code: string; is_system: boolean; kind: string }>(sql`
        select code, is_system, kind from roles
        where tenant_id = ${tenantId} and id = ${roleId}`)
    ).rows[0]
    if (!role) throw accessErrors.create('ROLE_NOT_FOUND')
    if (!this.isCanonicalAdmin(role)) return
    const holder = (
      await tx.execute(sql`
        select 1 from user_role_assignments a
        join roles r on r.tenant_id = a.tenant_id and r.id = a.role_id
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id and u.enabled
        where a.tenant_id = ${tenantId} and a.user_id = ${actorUserId}
          and r.code = ${CANONICAL_ADMIN_ROLE} and r.is_system and r.kind = 'tenant' and r.enabled`)
    ).rows[0]
    if (!holder) throw accessErrors.create('TENANT_ADMIN_REQUIRED')
  }

  private isCanonicalAdmin(role: { code: string; is_system: boolean; kind: string }) {
    return role.code === CANONICAL_ADMIN_ROLE && role.is_system && role.kind === 'tenant'
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
    if (!row) throw accessErrors.create('ROLE_NOT_FOUND')
    return row
  }

  private async requireAll(
    tx: Tx,
    tenantId: string,
    table: 'user_types' | 'org_types',
    ids: readonly string[],
  ) {
    if (ids.length === 0) return
    const list = sql.raw(uuidArray(ids))
    const found = (
      await tx.execute<{ count: number }>(
        table === 'user_types'
          ? sql`select count(*)::int as count from user_types
                where tenant_id = ${tenantId} and id = any(${list})`
          : sql`select count(*)::int as count from org_types
                where tenant_id = ${tenantId} and id = any(${list})`,
      )
    ).rows[0]!.count
    if (found !== new Set(ids).size) {
      throw accessErrors.create(
        table === 'user_types' ? 'ROLE_USER_TYPE_NOT_FOUND' : 'ROLE_ORG_TYPE_NOT_FOUND',
      )
    }
  }
}

// uuid lists reach postgres as an array literal rather than as a joined
// string, so an empty set stays an empty array instead of a one-element list
// containing the empty string. Every id is re-validated first: these come
// from request input, and sql.raw does not parameterize.
function uuidArray(ids: readonly string[]): string {
  const unique = [...new Set(ids)]
  for (const id of unique) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw accessErrors.create('ROLE_USER_TYPE_NOT_FOUND', `malformed identifier ${id}`)
    }
  }
  return unique.length === 0 ? `'{}'::uuid[]` : `array['${unique.join("','")}']::uuid[]`
}
