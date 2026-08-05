import { Effect, Schema } from 'effect'
import { Database } from '@qualy/plugin-database/effect'
import { translateConstraints } from '@qualy/plugin-database/effect/constraints'
import type { LastAdministrator } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import {
  addEligibilityQuery,
  addPermissionsQuery,
  bumpRoleQuery,
  countIdsQuery,
  countGrantsOfRoleQuery,
  deleteRoleQuery,
  eligibilityOptionsQuery,
  insertRoleQuery,
  grantsStrandedByEligibilityQuery,
  lockRoleQuery,
  lockTenantQuery,
  pruneEligibilityQuery,
  rolePermissionCodesQuery,
  prunePermissionsQuery,
  roleEligibilityQuery,
  roleProjectionQuery,
  roleQuery,
  roleSetSizesQuery,
  setRoleStatusQuery,
  updateRoleQuery,
  uuidArrayLiteral,
  type RoleRow as RoleProjection,
} from '../queries.ts'
import { RoleNotFound } from './grants.ts'
import { assertMayDefineRole, type Authority } from './escalation.ts'

import {
  GrantStranded,
  PermissionNotFound,
  RoleConflict,
  RoleInUse,
  RoleIncomplete,
  RoleIsSystem,
  RoleNeedsEligibility,
  RoleNotDraft,
  RoleOrgTypeNotFound,
  RoleTargetMismatch,
  RoleUserTypeNotFound,
  RoleVersionConflict,
} from './errors.ts'

// re-exported so a service and its failures still read as one module
export {
  GrantStranded,
  PermissionNotFound,
  RoleConflict,
  RoleInUse,
  RoleIncomplete,
  RoleIsSystem,
  RoleNeedsEligibility,
  RoleNotDraft,
  RoleOrgTypeNotFound,
  RoleTargetMismatch,
  RoleUserTypeNotFound,
  RoleVersionConflict,
}

// The role lifecycle: draft, active, disabled.
//
// The management api creates drafts only. A role becomes usable through
// activation, and that is where completeness is checked, once, instead of
// being demanded field by field while somebody is still filling it in. The
// point of the gate is that there is never a role which is enabled and can do
// nothing.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

const roleConstraints: Record<string, () => RoleConflict> = {
  uq_roles_tenant_code: () => new RoleConflict(),
  uq_roles_tenant_name: () => new RoleConflict(),
}

interface RoleRow extends Record<string, unknown> {
  id: string
  code: string
  kind: 'tenant' | 'org'
  status: 'draft' | 'active' | 'disabled'
  permission_mode: 'explicit' | 'all-active'
  system_key: string | null
  assignable: boolean
  version: number
}

export const make = Effect.fn('Rbac.roles.make')(function* (
  authorityFor: (actor: Principal) => Authority,
  keepsAdministrator: (tenantId: string) => Effect.Effect<void, LastAdministrator>,
) {
  const database = yield* Database

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]

  const write = <A, E>(tenantId: string, body: (tx: Tx) => Effect.Effect<A, E>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          return yield* body(tx)
        }),
      )
      .pipe(
        translateConstraints(roleConstraints),
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )

  const lockRole = Effect.fn('Rbac.roles.lock')(function* (
    tx: Tx,
    tenantId: string,
    roleId: string,
    expectedVersion?: number,
  ) {
    const row = rows<RoleRow>(yield* tx.execute(lockRoleQuery(tenantId, roleId)))[0]
    if (!row) return yield* new RoleNotFound()
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return yield* new RoleVersionConflict({ currentVersion: row.version })
    }
    return row
  })

  const codesOf = (tx: Tx, tenantId: string, roleId: string) =>
    tx
      .execute(rolePermissionCodesQuery(tenantId, roleId))
      .pipe(Effect.map((r) => rows<{ code: string }>(r).map((row) => row.code)))

  /**
   * Everything a usable role needs, checked at the moment it becomes usable.
   *
   * A role whose only capabilities come from a plugin nobody loaded grants
   * nothing, so it counts as having none. Every role says who may hold it,
   * whatever its kind: one nobody is eligible for is as inert as one with no
   * permissions, and leaving that set empty for tenant roles is what let the
   * grant check skip it. Only an anchored role must say what it may anchor to.
   */
  const assertComplete = Effect.fn('Rbac.roles.assertComplete')(function* (
    tx: Tx,
    tenantId: string,
    role: RoleRow,
    active: ReadonlySet<string>,
  ) {
    const missing: ('permissions' | 'user-types' | 'org-types')[] = []
    const codes = yield* codesOf(tx, tenantId, role.id)
    if (codes.filter((code) => active.has(code)).length === 0) missing.push('permissions')
    const counts = rows<{ user_types: number; org_types: number }>(
      yield* tx.execute(roleSetSizesQuery(tenantId, role.id)),
    )[0]!
    if (counts.user_types === 0) missing.push('user-types')
    if (role.kind === 'org' && counts.org_types === 0) missing.push('org-types')
    if (missing.length > 0) return yield* new RoleIncomplete({ missing })
  })

  /**
   * What a role actually grants, and what it merely names.
   *
   * A configured code whose plugin is no longer loaded authorizes nothing, so
   * presenting it as effective would tell an administrator the role does
   * something it does not; dropping it would tell them it was taken away.
   */
  const permissionsOf = (role: RoleProjection, active: ReadonlySet<string>) =>
    role.permission_mode === 'all-active'
      ? { active: [...active].sort(), unavailable: [] }
      : {
          active: role.permissions.filter((code) => active.has(code)),
          unavailable: role.permissions.filter((code) => !active.has(code)),
        }

  const project = (tenantId: string, roleId?: string) =>
    database
      .execute(roleProjectionQuery(tenantId, roleId))
      .pipe(
        Effect.orDie,
        Effect.map((result) => rows<RoleProjection & Record<string, unknown>>(result)),
      )

  return {
    /** the roles of a tenant, with what each one carries */
    list: Effect.fn('Rbac.roles.list')(function* (
      tenantId: string,
      filter: { kind?: 'tenant' | 'org'; status?: 'draft' | 'active' | 'disabled' },
      actor: Principal,
    ) {
      const active = new Set(authorityFor(actor).activeCodes())
      return (yield* project(tenantId))
        .filter((role) => filter.kind === undefined || role.kind === filter.kind)
        .filter((role) => filter.status === undefined || role.status === filter.status)
        .map((role) => ({ role, permissions: permissionsOf(role, active) }))
    }),

    get: Effect.fn('Rbac.roles.get')(function* (
      tenantId: string,
      roleId: string,
      actor: Principal,
    ) {
      const role = (yield* project(tenantId, roleId))[0]
      if (!role) return yield* new RoleNotFound()
      return { role, permissions: permissionsOf(role, new Set(authorityFor(actor).activeCodes())) }
    }),

    /**
     * The user types and node types a role's eligibility may name.
     *
     * Its own endpoint because a role administrator does not necessarily hold
     * the user-type or org-tree read permissions, and an empty picker is a
     * worse answer than a scoped one.
     */
    options: Effect.fn('Rbac.roles.options')(function* (tenantId: string) {
      const read = (table: 'user_types' | 'org_types') =>
        database
          .execute(eligibilityOptionsQuery(tenantId, table))
          .pipe(
            Effect.orDie,
            Effect.map((result) => rows<{ id: string; code: string; name: string }>(result)),
          )
      return {
        userTypes: yield* read('user_types'),
        orgTypes: yield* read('org_types'),
      }
    }),

    create: Effect.fn('Rbac.roles.create')(function* (
      tenantId: string,
      input: { code: string; name: string; description?: string; kind: 'tenant' | 'org' },
    ) {
      return yield* write(tenantId, (tx) =>
        tx
          .execute(
            insertRoleQuery({
              tenantId,
              code: input.code,
              name: input.name,
              description: input.description ?? null,
              kind: input.kind,
            }),
          )
          .pipe(Effect.map((r) => rows<{ id: string }>(r)[0]!.id)),
      )
    }),

    update: Effect.fn('Rbac.roles.update')(function* (
      tenantId: string,
      roleId: string,
      fields: { name?: string; description?: string | null; assignable?: boolean },
      expectedVersion: number,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const role = yield* lockRole(tx, tenantId, roleId, expectedVersion)
          // the administrator role keeps its assignability: making it
          // unassignable is a lockout by another name
          if (role.system_key !== null && fields.assignable === false) {
            return yield* new RoleIsSystem()
          }
          yield* tx.execute(updateRoleQuery(tenantId, role.id, fields))
          return role.version + 1
        }),
      )
    }),

    setStatus: Effect.fn('Rbac.roles.setStatus')(function* (
      tenantId: string,
      roleId: string,
      status: 'active' | 'disabled',
      expectedVersion: number,
      actor: Principal,
    ) {
      const authority = authorityFor(actor)
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const role = yield* lockRole(tx, tenantId, roleId, expectedVersion)
          if (role.system_key !== null && status === 'disabled') {
            return yield* new RoleIsSystem()
          }
          if (status === 'active' && role.status !== 'active') {
            if (role.status !== 'draft' && role.status !== 'disabled') {
              return yield* new RoleNotDraft()
            }
            yield* assertComplete(tx, tenantId, role, new Set(authority.activeCodes()))
            // activating is where a definition becomes real, so it is where
            // the author's own authority is measured
            yield* assertMayDefineRole(authority, yield* codesOf(tx, tenantId, role.id))
          }
          // a request that changes nothing must not invalidate every open editor
          if (role.status === status) return role.version
          yield* tx.execute(setRoleStatusQuery(tenantId, role.id, status))
          // a role losing its permissions can remove the last administrator
          if (status === 'disabled') yield* keepsAdministrator(tenantId)
          return role.version + 1
        }),
      )
    }),

    /**
     * What the role carries, split by whether it can still be used.
     *
     * A code whose plugin is unloaded grants nothing, but it has not been
     * taken away either, so it is reported rather than hidden.
     */
    getPermissions: Effect.fn('Rbac.roles.getPermissions')(function* (
      tenantId: string,
      roleId: string,
      actor: Principal,
    ) {
      const active = authorityFor(actor).catalog()
      const role = rows<RoleRow>(
        yield* database.execute(roleQuery(tenantId, roleId)).pipe(Effect.orDie),
      )[0]
      if (!role) return yield* new RoleNotFound()
      // an all-active role carries whatever the assembly serves, and stores no
      // rows at all: reading the join alone reported the administrator role as
      // carrying nothing
      if (role.permission_mode === 'all-active') {
        return { active: [...active.keys()].sort(), unavailable: [], version: role.version }
      }
      const codes = yield* database
        .execute(rolePermissionCodesQuery(tenantId, roleId))
        .pipe(Effect.orDie, Effect.map((r) => rows<{ code: string }>(r).map((row) => row.code)))
      return {
        active: codes.filter((code) => active.has(code)).sort(),
        unavailable: codes.filter((code) => !active.has(code)).sort(),
        version: role.version,
      }
    }),

    /** which capabilities the role carries, replaced whole */
    setPermissions: Effect.fn('Rbac.roles.setPermissions')(function* (
      tenantId: string,
      roleId: string,
      codes: readonly string[],
      expectedVersion: number,
      actor: Principal,
    ) {
      const authority = authorityFor(actor)
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const role = yield* lockRole(tx, tenantId, roleId, expectedVersion)
          if (role.permission_mode === 'all-active') return yield* new RoleIsSystem()
          const wanted = [...new Set(codes)]

          // only codes the catalog currently serves: a row left behind by an
          // unloaded plugin is not something anyone may grant
          const active = authority.catalog()
          const unknown = wanted.filter((code) => !active.has(code))
          if (unknown.length > 0) {
            return yield* new PermissionNotFound({ permissions: unknown.sort() })
          }
          const wantedTarget = role.kind === 'org' ? 'org-node' : 'tenant'
          const mismatched = wanted.filter((code) => active.get(code)!.target !== wantedTarget)
          if (mismatched.length > 0) {
            return yield* new RoleTargetMismatch({ permissions: mismatched.sort() })
          }
          yield* assertMayDefineRole(authority, wanted)

          yield* tx.execute(
            prunePermissionsQuery(tenantId, role.id, [...active.keys()], wanted),
          )
          if (wanted.length > 0) {
            yield* tx.execute(addPermissionsQuery(tenantId, role.id, wanted))
          }
          yield* tx.execute(bumpRoleQuery(tenantId, role.id))
          // an active role that just lost everything would be live and grant
          // nothing, so activation's completeness rule applies here too
          if (role.status === 'active') {
            yield* assertComplete(tx, tenantId, role, new Set(active.keys()))
          }
          yield* keepsAdministrator(tenantId)
          return role.version + 1
        }),
      )
    }),

    /** which user types may hold the role, and which node types it may anchor to */
    getEligibility: Effect.fn('Rbac.roles.getEligibility')(function* (
      tenantId: string,
      roleId: string,
    ) {
      const role = rows<RoleRow>(
        yield* database.execute(roleQuery(tenantId, roleId)).pipe(Effect.orDie),
      )[0]
      if (!role) return yield* new RoleNotFound()
      const sets = rows<{ user_type_ids: string[]; org_type_ids: string[] }>(
        yield* database.execute(roleEligibilityQuery(tenantId, roleId)).pipe(Effect.orDie),
      )[0]!
      return {
        userTypeIds: [...sets.user_type_ids].sort(),
        orgTypeIds: [...sets.org_type_ids].sort(),
        version: role.version,
      }
    }),

    /**
     * Both eligibility sets, replaced whole.
     *
     * A full replacement names both: omitting one and having it silently
     * survive is how a replace quietly becomes a merge.
     */
    setEligibility: Effect.fn('Rbac.roles.setEligibility')(function* (
      tenantId: string,
      roleId: string,
      sets: { userTypeIds: readonly string[]; orgTypeIds: readonly string[] },
      expectedVersion: number,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const role = yield* lockRole(tx, tenantId, roleId, expectedVersion)
          // the canonical administrator is grantable to whoever the tenant
          // designates; everything else declares who may hold it
          if (role.system_key !== null) return yield* new RoleIsSystem()
          const userTypeIds = [...new Set(sets.userTypeIds)]
          // A tenant role reaches the whole tenant, so it anchors to nothing
          // and admits no org types: the field is not part of its policy.
          const orgTypeIds = role.kind === 'org' ? [...new Set(sets.orgTypeIds)] : []
          if (
            role.status === 'active' &&
            (userTypeIds.length === 0 || (role.kind === 'org' && orgTypeIds.length === 0))
          ) {
            return yield* new RoleNeedsEligibility()
          }

          const replace = Effect.fn('Rbac.roles.replaceEligibility')(function* (
            table: 'role_allowed_user_types' | 'role_allowed_org_types',
            column: 'user_type_id' | 'org_type_id',
            source: 'user_types' | 'org_types',
            ids: readonly string[],
          ) {
            // the api validates the shape; this is the layer that must not
            // interpolate anything it has not checked itself
            const list = uuidArrayLiteral(ids)
            if (list === undefined) {
              return yield* source === 'user_types'
                ? new RoleUserTypeNotFound()
                : new RoleOrgTypeNotFound()
            }
            if (ids.length > 0) {
              const found = rows<{ count: number }>(
                yield* tx.execute(countIdsQuery(tenantId, source, list)),
              )[0]!.count
              if (found !== ids.length) {
                return yield* source === 'user_types'
                  ? new RoleUserTypeNotFound()
                  : new RoleOrgTypeNotFound()
              }
            }
            yield* tx.execute(pruneEligibilityQuery(tenantId, role.id, table, column, list))
            if (ids.length > 0) {
              yield* tx.execute(addEligibilityQuery(tenantId, role.id, table, column, list))
            }
          })
          yield* replace('role_allowed_user_types', 'user_type_id', 'user_types', userTypeIds)
          yield* replace('role_allowed_org_types', 'org_type_id', 'org_types', orgTypeIds)

          // The sets and the grants are checked together under one lock, so a
          // narrowing that would orphan a grant fails as a whole. The node is
          // joined outward because a tenant grant has none: an inner join
          // dropped every one of them, so narrowing a tenant role's user types
          // would have stranded its holders silently.
          const stranded = rows<{ count: number }>(
            yield* tx.execute(grantsStrandedByEligibilityQuery(tenantId, role.id)),
          )[0]!.count
          if (stranded > 0) return yield* new GrantStranded({ grantCount: stranded })
          yield* tx.execute(bumpRoleQuery(tenantId, role.id))
          return role.version + 1
        }),
      )
    }),

    remove: Effect.fn('Rbac.roles.remove')(function* (
      tenantId: string,
      roleId: string,
      expectedVersion: number,
    ) {
      yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const role = yield* lockRole(tx, tenantId, roleId, expectedVersion)
          if (role.system_key !== null) return yield* new RoleIsSystem()
          const grants = rows<{ count: number }>(
            yield* tx.execute(countGrantsOfRoleQuery(tenantId, role.id)),
          )[0]!.count
          if (grants > 0) return yield* new RoleInUse({ grantCount: grants })
          yield* tx.execute(deleteRoleQuery(tenantId, role.id))
        }),
      )
    }),
  }
})
