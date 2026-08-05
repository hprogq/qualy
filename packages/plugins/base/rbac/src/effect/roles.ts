import { Effect, Schema } from 'effect'
import { Database } from '@qualy/plugin-database/effect'
import { translateConstraints } from '@qualy/plugin-database/effect/constraints'
import type { Principal } from '@qualy/rbac-contract'
import {
  addPermissionsQuery,
  bumpRoleQuery,
  countGrantsOfRoleQuery,
  deleteRoleQuery,
  insertRoleQuery,
  lockRoleQuery,
  lockTenantQuery,
  rolePermissionCodesQuery,
  prunePermissionsQuery,
  roleQuery,
  roleSetSizesQuery,
  setRoleStatusQuery,
  updateRoleQuery,
} from '../queries.ts'
import { RoleNotFound } from './grants.ts'
import { assertMayDefineRole, type Authority } from './escalation.ts'

// The role lifecycle: draft, active, disabled.
//
// The management api creates drafts only. A role becomes usable through
// activation, and that is where completeness is checked, once, instead of
// being demanded field by field while somebody is still filling it in. The
// point of the gate is that there is never a role which is enabled and can do
// nothing.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export class RoleIsSystem extends Schema.TaggedErrorClass<RoleIsSystem>()(
  'ROLE_IS_SYSTEM',
  {},
  { httpApiStatus: 409, identifier: 'RoleIsSystem' },
) {}

export class RoleInUse extends Schema.TaggedErrorClass<RoleInUse>()(
  'ROLE_IN_USE',
  { grantCount: Schema.Number },
  { httpApiStatus: 409, identifier: 'RoleInUse' },
) {}

export class RoleVersionConflict extends Schema.TaggedErrorClass<RoleVersionConflict>()(
  'ROLE_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'RoleVersionConflict' },
) {}

export class RoleNotDraft extends Schema.TaggedErrorClass<RoleNotDraft>()(
  'ROLE_NOT_DRAFT',
  {},
  { httpApiStatus: 409, identifier: 'RoleNotDraft' },
) {}

/** what a role still needs before it can be activated */
export class RoleIncomplete extends Schema.TaggedErrorClass<RoleIncomplete>()(
  'ROLE_INCOMPLETE',
  { missing: Schema.Array(Schema.Literals(['permissions', 'user-types', 'org-types'])) },
  { httpApiStatus: 422, identifier: 'RoleIncomplete' },
) {}

export class RoleConflict extends Schema.TaggedErrorClass<RoleConflict>()(
  'ROLE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'RoleConflict' },
) {}

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

export class PermissionNotFound extends Schema.TaggedErrorClass<PermissionNotFound>()(
  'PERMISSION_NOT_FOUND',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 404, identifier: 'PermissionNotFound' },
) {}

/**
 * A capability whose calling convention does not match the role's kind.
 *
 * An org capability inside a tenant role would apply at every node without any
 * grant having said so, and reaching every node belongs to the canonical
 * administrator alone.
 */
export class RoleTargetMismatch extends Schema.TaggedErrorClass<RoleTargetMismatch>()(
  'ROLE_TARGET_MISMATCH',
  { permissions: Schema.Array(Schema.String) },
  { httpApiStatus: 422, identifier: 'RoleTargetMismatch' },
) {}

export const make = Effect.fn('Rbac.roles.make')(function* (
  authorityFor: (actor: Principal) => Authority,
  keepsAdministrator: (tenantId: string) => Effect.Effect<void, never>,
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

  return {
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
