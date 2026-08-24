import { Effect, Schema } from 'effect'
import { kyselyOf, query, transaction, withDatabase } from '@qualy/plugin-database/server'
import { sql } from 'kysely'
import {
  db,
  admitsOrgType,
  admitsUserType,
  appointmentCycleExists,
  grantRuleSources,
  grantRuleTargets,
  inForce,
  lockTenant,
  oneRoleProjected,
  replaceGrantRuleTargets,
  rolePermissionCodes,
  rolesForAppointment,
  rolesOfTenant,
  type RoleRow as RoleProjection,
} from './db.ts'
import { Audit } from '@qualy/audit-contract/effect'
import type { AuditActor } from '@qualy/audit-contract'
import {
  RoleAppointmentUpdated,
  RoleCreated,
  RoleDeleted,
  RoleDisabled,
  RoleEligibilityUpdated,
  RoleEnabled,
  RolePermissionsUpdated,
  RoleUpdated,
} from '../actions.ts'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import type { LastAdministrator } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { RoleNotFound } from './grants.ts'
import { assertMayDefineRole, type Authority } from './escalation.ts'

import {
  RoleAppointmentInvalid,
  GrantStranded,
  PermissionNotFound,
  RoleConflict,
  RoleInUse,
  RoleAnchorMismatch,
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

const insertRole = (input: {
  tenantId: string
  code: string
  name: string
  description: string | null
  kind: 'tenant' | 'org'
}) =>
  db.query((k) =>
    k
      .insertInto('Role')
      // a new role grants nothing until it is activated, and activation is
      // where completeness is checked; the anchor policy exists exactly when
      // the kind gives it something to say
      .values({
        ...input,
        status: 'draft',
        permissionMode: 'explicit',
        anchorMode: input.kind === 'org' ? 'allow-list' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow(),
  )

const updateRole = (
  tenantId: string,
  roleId: string,
  fields: { name?: string; description?: string | null; assignable?: boolean },
) =>
  db.query((k) =>
    k
      .updateTable('Role')
      // only what the caller named: a field left out keeps its value, and a
      // description set to null is a caller clearing it rather than saying
      // nothing
      .set((eb) => ({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.assignable === undefined ? {} : { assignable: fields.assignable }),
        version: eb('version', '+', 1),
        updatedAt: sql<Date>`now()`,
      }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .execute(),
  )

const setRoleStatus = (tenantId: string, roleId: string, status: 'draft' | 'active' | 'disabled') =>
  db.query((k) =>
    k
      .updateTable('Role')
      .set((eb) => ({ status, version: eb('version', '+', 1), updatedAt: sql<Date>`now()` }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .execute(),
  )

const bumpRole = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .updateTable('Role')
      .set((eb) => ({ version: eb('version', '+', 1), updatedAt: sql<Date>`now()` }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .execute(),
  )

const deleteRole = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k.deleteFrom('Role').where('tenantId', '=', tenantId).where('id', '=', roleId).execute(),
  )

const countGrantsOfRole = (tenantId: string, roleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('g.tenantId', '=', tenantId)
        .where('g.roleId', '=', roleId)
        // nobody holds a withdrawn grant, so it is not a holder standing in
        // the way of deleting the role
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

/** who may hold a role: everyone, or exactly these user types */
export type HolderPolicy =
  | { readonly mode: 'unrestricted' }
  | { readonly mode: 'allow-list'; readonly userTypeIds: readonly string[] }

/** where an org role's duty applies: any node type, or exactly these */
export type AnchorPolicy =
  | { readonly mode: 'unrestricted' }
  | { readonly mode: 'allow-list'; readonly orgTypeIds: readonly string[] }

/** what the role says about who may hold it and where it applies */
const roleModes = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => [
        eb.ref('eligibilityMode').$castTo<'unrestricted' | 'allow-list'>().as('eligibilityMode'),
        eb.ref('anchorMode').$castTo<'unrestricted' | 'allow-list' | null>().as('anchorMode'),
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirstOrThrow(),
  )

const setRoleModes = (
  tenantId: string,
  roleId: string,
  modes: { eligibilityMode: string; anchorMode: string | null },
) =>
  db.query((k) =>
    k
      .updateTable('Role')
      .set(modes)
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .execute(),
  )

const roleSetSizes = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectNoFrom((eb) => [
        eb
          .selectFrom('RoleAllowedUserType')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('tenantId', '=', tenantId)
          .where('roleId', '=', roleId)
          .as('userTypes'),
        eb
          .selectFrom('RoleAllowedOrgType')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('tenantId', '=', tenantId)
          .where('roleId', '=', roleId)
          .as('orgTypes'),
      ])
      .executeTakeFirstOrThrow(),
  )

const lockRoleRow = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => [
        'id',
        'code',
        'systemKey',
        'assignable',
        'version',
        // the editable columns travel with the lock so an update that changes
        // nothing can be recognised before it bumps the version
        'name',
        'description',
        eb.ref('kind').$castTo<'tenant' | 'org'>().as('kind'),
        eb.ref('status').$castTo<'draft' | 'active' | 'disabled'>().as('status'),
        eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('permissionMode'),
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .forUpdate()
      .executeTakeFirst(),
  )

/**
 * Replace a role's permissions, but only within what is currently on offer.
 *
 * A row whose plugin is unloaded was never offered, so the caller did not
 * decline it by omitting it, and deleting it would quietly discard authority
 * that unloading a plugin is meant to suspend rather than destroy. Removing
 * one is a separate decision needing its own operation.
 */
const prunePermissions = (
  tenantId: string,
  roleId: string,
  offered: readonly string[],
  wanted: readonly string[],
) =>
  db.query((k) => {
    // nothing on offer is nothing this may remove
    if (offered.length === 0) return Promise.resolve([])
    let removing = k
      .deleteFrom('RolePermission')
      .where('tenantId', '=', tenantId)
      .where('roleId', '=', roleId)
      .where((eb) =>
        eb(
          'permissionId',
          'in',
          eb.selectFrom('Permission').select('id').where('code', 'in', offered),
        ),
      )
    if (wanted.length > 0) {
      removing = removing.where((eb) =>
        eb(
          'permissionId',
          'not in',
          eb.selectFrom('Permission').select('id').where('code', 'in', wanted),
        ),
      )
    }
    return removing.execute()
  })

const addPermissions = (tenantId: string, roleId: string, wanted: readonly string[]) =>
  db.query((k) => {
    if (wanted.length === 0) return Promise.resolve([])
    return k
      .insertInto('RolePermission')
      .columns(['tenantId', 'roleId', 'permissionId'])
      .expression((eb) =>
        eb
          .selectFrom('Permission as p')
          .select([sql.val(tenantId).as('tenantId'), sql.val(roleId).as('roleId'), 'p.id'])
          .where('p.code', 'in', wanted),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute()
  })

const oneRole = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role')
      .select((eb) => [
        'id',
        'code',
        'name',
        'description',
        'systemKey',
        'assignable',
        'version',
        eb.ref('kind').$castTo<'tenant' | 'org'>().as('kind'),
        eb.ref('status').$castTo<'draft' | 'active' | 'disabled'>().as('status'),
        eb.ref('permissionMode').$castTo<'explicit' | 'all-active'>().as('permissionMode'),
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', roleId)
      .executeTakeFirst(),
  )

const countUserTypes = (tenantId: string, ids: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('UserType')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('id', 'in', ids)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

const countOrgTypes = (tenantId: string, ids: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgType')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('id', 'in', ids)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

const countRoles = (tenantId: string, ids: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('Role')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('id', 'in', ids)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

const pruneAllowedUserTypes = (tenantId: string, roleId: string, keep: readonly string[]) =>
  db.query((k) => {
    const rest = k
      .deleteFrom('RoleAllowedUserType')
      .where('tenantId', '=', tenantId)
      .where('roleId', '=', roleId)
    // an empty list keeps nothing, and `not in ()` is not sql
    return (keep.length === 0 ? rest : rest.where('userTypeId', 'not in', keep)).execute()
  })

const pruneAllowedOrgTypes = (tenantId: string, roleId: string, keep: readonly string[]) =>
  db.query((k) => {
    const rest = k
      .deleteFrom('RoleAllowedOrgType')
      .where('tenantId', '=', tenantId)
      .where('roleId', '=', roleId)
    return (keep.length === 0 ? rest : rest.where('orgTypeId', 'not in', keep)).execute()
  })

const addAllowedUserTypes = (tenantId: string, roleId: string, ids: readonly string[]) =>
  db.query((k) => {
    if (ids.length === 0) return Promise.resolve([])
    return k
      .insertInto('RoleAllowedUserType')
      .values(ids.map((userTypeId) => ({ tenantId, roleId, userTypeId })))
      .onConflict((conflict) => conflict.doNothing())
      .execute()
  })

const addAllowedOrgTypes = (tenantId: string, roleId: string, ids: readonly string[]) =>
  db.query((k) => {
    if (ids.length === 0) return Promise.resolve([])
    return k
      .insertInto('RoleAllowedOrgType')
      .values(ids.map((orgTypeId) => ({ tenantId, roleId, orgTypeId })))
      .onConflict((conflict) => conflict.doNothing())
      .execute()
  })

/**
 * Grants that the eligibility sets, as written, would orphan.
 *
 * The node is joined outward because a tenant grant has none: an inner join
 * dropped every one of them, so narrowing a tenant role's user types would
 * have stranded its holders silently.
 */
const grantsStrandedByEligibility = (tenantId: string, roleId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RoleGrant as g')
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'g.tenantId').onRef('u.id', '=', 'g.userId'),
        )
        .leftJoin('OrgNode as n', (join) =>
          join.onRef('n.tenantId', '=', 'g.tenantId').onRef('n.id', '=', 'g.orgNodeId'),
        )
        .where('g.tenantId', '=', tenantId)
        .where('g.roleId', '=', roleId)
        // a withdrawn grant has nobody to strand
        .where((eb) =>
          inForce({
            revokedAt: eb.ref('g.revokedAt'),
            validFrom: eb.ref('g.validFrom'),
            validUntil: eb.ref('g.validUntil'),
          }),
        )
        .innerJoin('Role as r', (join) =>
          join.onRef('r.tenantId', '=', 'g.tenantId').onRef('r.id', '=', 'g.roleId'),
        )
        .where((eb) => {
          const role = {
            tenantId: eb.ref('r.tenantId'),
            id: eb.ref('r.id'),
            eligibilityMode: eb.ref('r.eligibilityMode'),
            anchorMode: eb.ref('r.anchorMode'),
          }
          return sql<boolean>`(
          not ${admitsUserType(
            role,
            // nullable since soft deletion, but never null here: only live
            // grants reach this predicate, and a live grant holds a live
            // user, whom the schema requires to have a type
            sql<string>`${eb.ref('u.userTypeId')}`,
          )}
          or (${eb.ref('n.id')} is not null
              and not ${admitsOrgType(role, eb.ref('n.orgTypeId'))})
        )`
        })
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

/**
 * An office may only claim to appoint people while it can administer grants.
 *
 * Asked when an edge is drawn and again whenever the granter's permissions are
 * replaced, because both moments can produce the thing errors.ts calls a
 * latent edge: an appointment that only works when its holder happens to hold
 * some other role, unreadable off the configuration. Stripping the capability
 * used to leave the edges standing and, worse, hid them from the editor that
 * could have cleared them, so the removal an administrator asked for silently
 * did not take.
 */
const assertGranterCapability = (
  role: { kind: 'tenant' | 'org' },
  edgeCount: number,
  codes: ReadonlySet<string>,
) =>
  edgeCount === 0 ||
  codes.has(role.kind === 'tenant' ? 'iam.tenant-grant.manage' : 'iam.grant.manage')
    ? Effect.void
    : Effect.fail(new RoleAppointmentInvalid({ reason: 'granter-capability' }))

const roleEligibility = (tenantId: string, roleId: string) =>
  db.query((k) =>
    k
      .selectFrom('Role as r')
      .where('r.tenantId', '=', tenantId)
      .where('r.id', '=', roleId)
      .select((eb) => [
        eb.ref('r.eligibilityMode').$castTo<'unrestricted' | 'allow-list'>().as('eligibilityMode'),
        eb.ref('r.anchorMode').$castTo<'unrestricted' | 'allow-list' | null>().as('anchorMode'),
        sql<string[]>`coalesce((select array_agg(user_type_id::text)
          from role_allowed_user_types
          where tenant_id = ${tenantId} and role_id = ${roleId}), '{}')`.as('userTypeIds'),
        sql<string[]>`coalesce((select array_agg(org_type_id::text)
          from role_allowed_org_types
          where tenant_id = ${tenantId} and role_id = ${roleId}), '{}')`.as('orgTypeIds'),
      ])
      .executeTakeFirstOrThrow(),
  )

/** the user types and node types a role's eligibility may name */
const userTypeOptions = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserType')
      .select(['id', 'code', 'name'])
      .where('tenantId', '=', tenantId)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
  )

const orgTypeOptions = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgType')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
  )

export const make = Effect.fn('Rbac.roles.make')(function* (
  authorityFor: (actor: Principal) => Authority,
  keepsAdministrator: (tenantId: string) => Effect.Effect<void, LastAdministrator>,
) {
  // this layer's database, closed over: the transaction supplies it to its
  // body, and this supplies it to the transaction, so the service keeps
  // declaring no requirements of its own
  const withDb = yield* withDatabase
  const audit = yield* Audit
  const actorOf = (as: Principal): AuditActor => ({ kind: 'user', userId: as.userId })

  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(
      translateConstraints(roleConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )

  const lockRole = Effect.fn('Rbac.roles.lock')(function* (
    tenantId: string,
    roleId: string,
    expectedVersion?: number,
  ) {
    const row = yield* lockRoleRow(tenantId, roleId)
    if (!row) return yield* new RoleNotFound()
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return yield* new RoleVersionConflict({ currentVersion: row.version })
    }
    return row
  })

  const codesOf = (tenantId: string, roleId: string) => rolePermissionCodes(tenantId, roleId)

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
    tenantId: string,
    role: { id: string; kind: 'tenant' | 'org' },
    active: ReadonlySet<string>,
  ) {
    const missing: ('permissions' | 'user-types' | 'org-types')[] = []
    const codes = yield* codesOf(tenantId, role.id)
    if (codes.filter((code) => active.has(code)).length === 0) missing.push('permissions')
    const counts = yield* roleSetSizes(tenantId, role.id)
    const modes = yield* roleModes(tenantId, role.id)
    if (modes.eligibilityMode === 'allow-list' && counts.userTypes === 0) missing.push('user-types')
    if (role.kind === 'org' && modes.anchorMode === 'allow-list' && counts.orgTypes === 0) {
      missing.push('org-types')
    }
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
    role.permissionMode === 'all-active'
      ? { active: [...active].sort(), unavailable: [] }
      : {
          active: role.permissions.filter((code) => active.has(code)),
          unavailable: role.permissions.filter((code) => !active.has(code)),
        }

  const project = (tenantId: string, roleId?: string) =>
    Effect.gen(function* () {
      if (roleId === undefined) return yield* rolesOfTenant(tenantId).pipe(Effect.orDie)
      const one = yield* oneRoleProjected(tenantId, roleId).pipe(Effect.orDie)
      return one ? [one] : []
    })

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
      return {
        userTypes: yield* userTypeOptions(tenantId).pipe(Effect.orDie),
        orgTypes: yield* orgTypeOptions(tenantId).pipe(Effect.orDie),
      }
    }),

    create: Effect.fn('Rbac.roles.create')(function* (
      tenantId: string,
      input: { code: string; name: string; description?: string; kind: 'tenant' | 'org' },
      actor: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const created = yield* insertRole({
            tenantId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            kind: input.kind,
          })
          yield* audit.record(RoleCreated, {
            tenantId,
            actor: actorOf(actor),
            target: { id: created.id, label: input.name },
            details: { kind: input.kind },
          })
          return created.id
        }),
      )
    }),

    update: Effect.fn('Rbac.roles.update')(function* (
      tenantId: string,
      roleId: string,
      fields: { name?: string; description?: string | null; assignable?: boolean },
      expectedVersion: number,
      actor: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          // the administrator role keeps its assignability: making it
          // unassignable is a lockout by another name
          if (role.systemKey !== null && fields.assignable === false) {
            return yield* new RoleIsSystem()
          }
          // a request that changes nothing must not invalidate every open
          // editor: the version is optimistic concurrency, and bumping it for
          // a re-saved unchanged form refuses a concurrent genuine edit
          const same =
            (fields.name === undefined || fields.name === role.name) &&
            (fields.description === undefined || fields.description === role.description) &&
            (fields.assignable === undefined || fields.assignable === role.assignable)
          if (same) return role.version
          yield* updateRole(tenantId, role.id, fields)
          yield* audit.record(RoleUpdated, {
            tenantId,
            actor: actorOf(actor),
            target: { id: role.id, label: fields.name ?? role.name },
            details: {
              fields: (['name', 'description', 'assignable'] as const).filter(
                (field) => fields[field] !== undefined,
              ),
            },
          })
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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          if (role.systemKey !== null && status === 'disabled') {
            return yield* new RoleIsSystem()
          }
          if (status === 'active' && role.status !== 'active') {
            if (role.status !== 'draft' && role.status !== 'disabled') {
              return yield* new RoleNotDraft()
            }
            yield* assertComplete(tenantId, role, new Set(authority.activeCodes()))
            // activating is where a definition becomes real, so it is where
            // the author's own authority is measured
            yield* assertMayDefineRole(authority, yield* codesOf(tenantId, role.id))
          }
          // a request that changes nothing must not invalidate every open editor
          if (role.status === status) return role.version
          yield* setRoleStatus(tenantId, role.id, status)
          // a role losing its permissions can remove the last administrator
          if (status === 'disabled') yield* keepsAdministrator(tenantId)
          yield* audit.record(status === 'active' ? RoleEnabled : RoleDisabled, {
            tenantId,
            actor: actorOf(actor),
            target: { id: role.id, label: role.name },
            details: {},
          })
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
      const role = yield* oneRole(tenantId, roleId).pipe(Effect.orDie)
      if (!role) return yield* new RoleNotFound()
      // an all-active role carries whatever the assembly serves, and stores no
      // rows at all: reading the join alone reported the administrator role as
      // carrying nothing
      if (role.permissionMode === 'all-active') {
        return { active: [...active.keys()].sort(), unavailable: [], version: role.version }
      }
      const codes = yield* rolePermissionCodes(tenantId, roleId).pipe(Effect.orDie)
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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          if (role.permissionMode === 'all-active') return yield* new RoleIsSystem()
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
          // the edges this office already owns are part of what it is: taking
          // away the capability that makes them sound is a decision about the
          // appointment graph, and it has to be made there first
          yield* assertGranterCapability(
            role,
            (yield* grantRuleTargets(tenantId, role.id)).length,
            new Set(wanted),
          )

          const before = yield* rolePermissionCodes(tenantId, role.id)
          yield* prunePermissions(tenantId, role.id, [...active.keys()], wanted)
          yield* addPermissions(tenantId, role.id, wanted)
          yield* bumpRole(tenantId, role.id)
          yield* audit.record(RolePermissionsUpdated, {
            tenantId,
            actor: actorOf(actor),
            target: { id: role.id, label: role.name },
            details: {
              added: wanted.filter((code) => !before.includes(code)).sort(),
              removed: before.filter((code) => !wanted.includes(code)).sort(),
            },
          })
          // an active role that just lost everything would be live and grant
          // nothing, so activation's completeness rule applies here too
          if (role.status === 'active') {
            yield* assertComplete(tenantId, role, new Set(active.keys()))
          }
          yield* keepsAdministrator(tenantId)
          return role.version + 1
        }),
      )
    }),

    /** who may hold the role and, for an org role, where it may be anchored */
    getEligibility: Effect.fn('Rbac.roles.getEligibility')(function* (
      tenantId: string,
      roleId: string,
    ) {
      const role = yield* oneRole(tenantId, roleId).pipe(Effect.orDie)
      if (!role) return yield* new RoleNotFound()
      const sets = yield* roleEligibility(tenantId, roleId).pipe(Effect.orDie)
      return {
        holderPolicy:
          sets.eligibilityMode === 'unrestricted'
            ? ({ mode: 'unrestricted' } as const)
            : ({ mode: 'allow-list', userTypeIds: [...sets.userTypeIds].sort() } as const),
        // null, not an empty list: a tenant role has no anchor policy at all
        anchorPolicy:
          sets.anchorMode === null
            ? null
            : sets.anchorMode === 'unrestricted'
              ? ({ mode: 'unrestricted' } as const)
              : ({ mode: 'allow-list', orgTypeIds: [...sets.orgTypeIds].sort() } as const),
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
      policy: { holderPolicy: HolderPolicy; anchorPolicy: AnchorPolicy | null },
      expectedVersion: number,
      actor: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          // the canonical administrator is grantable to whoever the tenant
          // designates; everything else declares who may hold it
          if (role.systemKey !== null) return yield* new RoleIsSystem()
          const holders = policy.holderPolicy
          // The anchor policy exists exactly when the kind gives it something
          // to say. A tenant role sent one, or an org role sent none, is a
          // caller talking about a different role than the one it named -
          // silently repairing that is how a replace becomes a lie.
          if ((role.kind === 'org') === (policy.anchorPolicy === null)) {
            return yield* new RoleAnchorMismatch({ roleKind: role.kind })
          }
          const anchors = policy.anchorPolicy
          const userTypeIds = holders.mode === 'allow-list' ? [...new Set(holders.userTypeIds)] : []
          const orgTypeIds =
            anchors !== null && anchors.mode === 'allow-list'
              ? [...new Set(anchors.orgTypeIds)]
              : []
          // An active role has to be holdable and, if anchored, anchorable. A
          // mode that admits everything satisfies that without a list; an empty
          // allow-list does not, which is the whole reason the mode is stated
          // rather than read off the list's size.
          if (
            role.status === 'active' &&
            ((holders.mode === 'allow-list' && userTypeIds.length === 0) ||
              (anchors !== null && anchors.mode === 'allow-list' && orgTypeIds.length === 0))
          ) {
            return yield* new RoleNeedsEligibility()
          }

          const replace = Effect.fn('Rbac.roles.replaceEligibility')(function* (
            source: 'user-types' | 'org-types',
            ids: readonly string[],
          ) {
            const missing = () =>
              source === 'user-types' ? new RoleUserTypeNotFound() : new RoleOrgTypeNotFound()
            if (ids.length > 0) {
              const found =
                source === 'user-types'
                  ? yield* countUserTypes(tenantId, ids)
                  : yield* countOrgTypes(tenantId, ids)
              if (found !== ids.length) return yield* missing()
            }
            if (source === 'user-types') {
              yield* pruneAllowedUserTypes(tenantId, role.id, ids)
              yield* addAllowedUserTypes(tenantId, role.id, ids)
            } else {
              yield* pruneAllowedOrgTypes(tenantId, role.id, ids)
              yield* addAllowedOrgTypes(tenantId, role.id, ids)
            }
          })
          yield* replace('user-types', userTypeIds)
          yield* replace('org-types', orgTypeIds)
          yield* setRoleModes(tenantId, role.id, {
            eligibilityMode: holders.mode,
            anchorMode: anchors === null ? null : anchors.mode,
          })

          // The sets and the grants are checked together under one lock, so a
          // narrowing that would orphan a grant fails as a whole. The node is
          // joined outward because a tenant grant has none: an inner join
          // dropped every one of them, so narrowing a tenant role's user types
          // would have stranded its holders silently.
          const stranded = yield* grantsStrandedByEligibility(tenantId, role.id)
          if (stranded > 0) return yield* new GrantStranded({ grantCount: stranded })
          yield* bumpRole(tenantId, role.id)
          return role.version + 1
        }),
      )
    }),

    /** the roles this role may appoint people to, and the ones that appoint it */
    getGrantableRoles: Effect.fn('Rbac.roles.getGrantableRoles')(function* (
      tenantId: string,
      roleId: string,
    ) {
      const role = yield* oneRole(tenantId, roleId).pipe(Effect.orDie)
      if (!role) return yield* new RoleNotFound()
      const edges = yield* grantRuleTargets(tenantId, roleId).pipe(Effect.orDie)
      // the other direction too: editing this role's duties changes what
      // those offices will hand out from now on, and the editor says so
      const appointedBy = yield* grantRuleSources(tenantId, roleId).pipe(Effect.orDie)
      return { roleIds: edges.map((edge) => edge.id).sort(), appointedBy, version: role.version }
    }),

    /**
     * The appointment edges, replaced whole - and held to what an edge now
     * means (re-ruled 2026-08-20): a persistent grant of appointment
     * authority, not a hint the grant re-litigates against permission sets.
     * So the edge itself must be sound when written. Self-edges and cycles
     * are refused (the graph stays the DAG it claims to be); an office may
     * only appoint offices of its own kind, because an org office held
     * somewhere can never execute a tenant-wide appointment; and the
     * granter must itself carry the matching grant administration - an edge
     * that only works when its holder happens to hold some other role is a
     * latent promise nobody can read off the configuration. New edges are
     * also measured against their author: declaring that an office appoints
     * a role is handing that role out at one remove, so it takes the same
     * authority defining the role would - everything the target carries, or
     * `iam.role.escalate`.
     *
     * The canonical administrator has none to edit: it bypasses the table
     * because it is already the whole of the tenant's authority, and a list
     * here would only restate that or quietly disagree with it.
     */
    setGrantableRoles: Effect.fn('Rbac.roles.setGrantableRoles')(function* (
      tenantId: string,
      roleId: string,
      targetRoleIds: readonly string[],
      expectedVersion: number,
      actor: Principal,
    ) {
      const authority = authorityFor(actor)
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          if (role.systemKey !== null) return yield* new RoleIsSystem()
          const wanted = [...new Set(targetRoleIds)]
          if (wanted.includes(role.id)) {
            return yield* new RoleAppointmentInvalid({ reason: 'self' })
          }
          const targets = yield* rolesForAppointment(tenantId, wanted)
          if (targets.length !== wanted.length) return yield* new RoleNotFound()
          for (const target of targets) {
            if (target.kind !== role.kind) {
              return yield* new RoleAppointmentInvalid({ reason: 'kind' })
            }
          }
          yield* assertGranterCapability(
            role,
            wanted.length,
            new Set(yield* rolePermissionCodes(tenantId, role.id)),
          )
          // only what this save ADDS is measured against its author: edges
          // already standing are policy in force, not this edit's doing
          const standing = new Set(
            (yield* grantRuleTargets(tenantId, role.id)).map((edge) => edge.id),
          )
          const added = targets.filter((target) => !standing.has(target.id))
          if (added.length > 0) {
            yield* assertMayDefineRole(authority, [
              ...new Set(added.flatMap((target) => target.codes)),
            ])
          }
          yield* replaceGrantRuleTargets(tenantId, role.id, wanted)
          if (yield* appointmentCycleExists(tenantId, role.id)) {
            return yield* new RoleAppointmentInvalid({ reason: 'cycle' })
          }
          yield* bumpRole(tenantId, role.id)
          yield* audit.record(RoleAppointmentUpdated, {
            tenantId,
            actor: actorOf(actor),
            target: { id: role.id, label: role.name },
            details: { targetRoleIds: wanted },
          })
          return role.version + 1
        }),
      )
    }),

    remove: Effect.fn('Rbac.roles.remove')(function* (
      tenantId: string,
      roleId: string,
      expectedVersion: number,
      actor: Principal,
    ) {
      yield* write(tenantId, () =>
        Effect.gen(function* () {
          const role = yield* lockRole(tenantId, roleId, expectedVersion)
          if (role.systemKey !== null) return yield* new RoleIsSystem()
          const grants = yield* countGrantsOfRole(tenantId, role.id)
          if (grants > 0) return yield* new RoleInUse({ grantCount: grants })
          yield* deleteRole(tenantId, role.id)
          yield* audit.record(RoleDeleted, {
            tenantId,
            actor: actorOf(actor),
            target: { id: role.id, label: role.name },
            details: {},
          })
        }),
      )
    }),
  }
})
