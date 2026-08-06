import { Effect } from 'effect'
import { LegacySql } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { Rbac } from '@qualy/rbac-contract/effect'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
import {
  addAllowedOrgTypesQuery,
  countOrgTypesQuery,
  countUsersOfTypeQuery,
  currentAllowedOrgTypesQuery,
  insertUserTypeQuery,
  orgTypeOptionsQuery,
  seedAllowedOrgTypesQuery,
  lockUserTypeQuery,
  pruneAllowedOrgTypesQuery,
  setPlacementModeQuery,
  uuidArrayLiteral,
  lockTenantQuery,
  oneUserType,
  setUserTypeEnabledQuery,
  updateUserTypeQuery,
  deleteUserTypeQuery,
  rolesStrandedByUserTypeQuery,
  userTypeGuardQuery,
  userTypesOfTenant,
} from '../iam/queries.ts'
import { strandedByPolicy } from './placement.ts'
import {
  RecoveryChannelRequired,
  UserTypeInUse,
  UserTypeIsSystem,
  UserTypeNotFound,
  UserTypeLastForRole,
  UserTypeOrgTypeNotFound,
  UserTypePlacementInUse,
  UserTypeVersionConflict,
  userTypeConstraints,
} from './errors.ts'

// What a user type is allowed to be, and who may still sign in afterwards.
//
// A type carries no authority: it decides who someone is and where they may
// stand, and nothing else. The rules worth reading twice are the ones that
// keep a tenant able to administer itself, because both of them fail quietly
// rather than loudly.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export interface UserTypeRow extends Record<string, unknown> {
  id: string
  code: string
  name: string
  description: string | null
  allow_local_login: boolean
  allow_sso_login: boolean
  enabled: boolean
  is_system: boolean
  sort_order: number
  version: number
  placement_mode: string
  user_count: number
  allowed_org_types: string[]
}

interface GuardRow extends Record<string, unknown> {
  id: string
  code: string
  enabled: boolean
  is_system: boolean
  version: number
}

export const make = Effect.fn('Iam.userTypes.make')(function* () {
  const database = yield* LegacySql
  const rbac = yield* Rbac

  type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0]

  /** the type, with the version the caller expected still holding */
  const guard = Effect.fn('Iam.userTypes.guard')(function* (
    tx: Tx,
    tenantId: string,
    userTypeId: string,
    expectedVersion: number,
  ) {
    const row = rows<GuardRow>(
      yield* tx.execute(userTypeGuardQuery(tenantId, userTypeId)).pipe(Effect.orDie),
    )[0]
    if (!row) return yield* new UserTypeNotFound()
    if (row.version !== expectedVersion) {
      // the current version travels with the refusal so a client can re-read
      // and retry instead of guessing
      return yield* new UserTypeVersionConflict({ currentVersion: row.version })
    }
    return row
  })

  const write = <A, E, R>(tenantId: string, body: (tx: Tx) => Effect.Effect<A, E, R>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          return yield* body(tx)
        }),
      )
      .pipe(
        translateConstraints(userTypeConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )

  const countHolders = (tx: Tx, tenantId: string, userTypeId: string) =>
    tx.execute(countUsersOfTypeQuery(tenantId, userTypeId)).pipe(
      Effect.orDie,
      Effect.map((r) => rows<{ count: number }>(r)[0]!.count),
    )

  return {
    /**
     * A new type, with its placement policy stated from the start.
     *
     * The policy is required rather than defaulted: a type created without one
     * constrains nothing, and "not configured yet" would be
     * indistinguishable from "deliberately open".
     */
    create: Effect.fn('Iam.userTypes.create')(function* (
      tenantId: string,
      input: {
        code: string
        name: string
        description?: string
        allowLocalLogin?: boolean
        allowSsoLogin?: boolean
        sortOrder?: number
        placementPolicy:
          { mode: 'unrestricted' } | { mode: 'allow-list'; orgTypeIds: readonly string[] }
      },
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const policy = input.placementPolicy
          const id = rows<{ id: string }>(
            yield* tx.execute(
              insertUserTypeQuery({
                tenantId,
                code: input.code,
                name: input.name,
                description: input.description ?? null,
                allowLocalLogin: input.allowLocalLogin ?? false,
                allowSsoLogin: input.allowSsoLogin ?? false,
                sortOrder: input.sortOrder ?? 0,
                placementMode: policy.mode,
              }),
            ),
          )[0]!.id
          if (policy.mode === 'allow-list') {
            const wanted = [...new Set(policy.orgTypeIds)]
            const literal = uuidArrayLiteral(wanted)
            if (!literal) return yield* new UserTypeOrgTypeNotFound()
            const found = rows<{ count: number }>(
              yield* tx.execute(countOrgTypesQuery(tenantId, literal.sql)),
            )[0]!.count
            if (found !== literal.ids.length) return yield* new UserTypeOrgTypeNotFound()
            yield* tx.execute(seedAllowedOrgTypesQuery(tenantId, id, literal.sql))
          }
          return id
        }),
      )
    }),

    /**
     * The org types a user type screen picks from.
     *
     * Its own endpoint rather than the role screen's, so stating where a kind
     * of person may stand needs no permission over roles.
     */
    orgTypeOptions: (tenantId: string) =>
      database.execute(orgTypeOptionsQuery(tenantId)).pipe(
        Effect.orDie,
        Effect.map((result) => rows<{ id: string; code: string; name: string }>(result)),
      ),

    list: Effect.fn('Iam.userTypes.list')(function* (tenantId: string) {
      return rows<UserTypeRow>(
        yield* database.execute(userTypesOfTenant(tenantId)).pipe(Effect.orDie),
      )
    }),

    get: Effect.fn('Iam.userTypes.get')(function* (tenantId: string, userTypeId: string) {
      const row = rows<UserTypeRow>(
        yield* database.execute(oneUserType(tenantId, userTypeId)).pipe(Effect.orDie),
      )[0]
      if (!row) return yield* new UserTypeNotFound()
      return row
    }),

    update: Effect.fn('Iam.userTypes.update')(function* (
      tenantId: string,
      userTypeId: string,
      fields: {
        name?: string
        description?: string | null
        allowLocalLogin?: boolean
        allowSsoLogin?: boolean
        sortOrder?: number
      },
      expectedVersion: number,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const type = yield* guard(tx, tenantId, userTypeId, expectedVersion)
          // the system account keeps password sign-in. The generic survivor
          // invariant cannot protect it: that check is satisfied by any open
          // channel, so closing local login while sso is nominally allowed
          // would pass even with no sso provider configured anywhere.
          if (fields.allowLocalLogin === false && type.code === SYSTEM_ACCOUNT_USER_TYPE) {
            return yield* new RecoveryChannelRequired()
          }
          yield* tx.execute(updateUserTypeQuery(tenantId, type.id, fields))
          // closing a sign-in channel can lock a tenant out just as surely as
          // disabling the people who use it, and this runs after the write so
          // it reads the state being committed rather than predicting it
          if (fields.allowLocalLogin === false || fields.allowSsoLogin === false) {
            yield* rbac.assertTenantKeepsAdministrator(tenantId)
          }
          return type.version + 1
        }),
      )
    }),

    setEnabled: Effect.fn('Iam.userTypes.setEnabled')(function* (
      tenantId: string,
      userTypeId: string,
      enabled: boolean,
      expectedVersion: number,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const type = yield* guard(tx, tenantId, userTypeId, expectedVersion)
          // asking for the state it is already in is not an edit, so it
          // neither spends a version nor invalidates another edit in flight
          if (type.enabled === enabled) return type.version
          if (!enabled) {
            // Disabling a type people still hold is refused outright. It used
            // to be allowed and did two wrong things at once: it revoked
            // sign-in for every holder without ending a single session, so
            // re-enabling handed those sessions straight back.
            const inUse = yield* countHolders(tx, tenantId, type.id)
            if (inUse > 0) return yield* new UserTypeInUse({ userCount: inUse })
          }
          yield* tx.execute(setUserTypeEnabledQuery(tenantId, type.id, enabled))
          return type.version + 1
        }),
      )
    }),

    /**
     * Where this kind of person may stand, replaced whole.
     *
     * The policy is stated rather than inferred from an empty list. Reading
     * "no rows" as "anywhere" meant unchecking the last box widened the rule
     * instead of narrowing it, silently and with no stranded-user check, which
     * is how a school could end up with students standing under colleges.
     */
    setPlacementPolicy: Effect.fn('Iam.userTypes.setPlacementPolicy')(function* (
      tenantId: string,
      userTypeId: string,
      policy: { mode: 'unrestricted' | 'allow-list'; orgTypeIds: readonly string[] },
      expectedVersion: number,
    ) {
      const wanted = policy.mode === 'allow-list' ? [...new Set(policy.orgTypeIds)] : []
      // a malformed id names no org type, which is the same answer as one
      // that does not exist
      const literal = uuidArrayLiteral(wanted)
      if (!literal) return yield* new UserTypeOrgTypeNotFound()
      const list = literal.sql

      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const type = rows<{
            id: string
            version: number
            is_system: boolean
            placement_mode: string
          }>(yield* tx.execute(lockUserTypeQuery(tenantId, userTypeId)))[0]
          if (!type) return yield* new UserTypeNotFound()
          // every other part of a system type is frozen; this one was the way in
          if (type.is_system) return yield* new UserTypeIsSystem()
          if (type.version !== expectedVersion) {
            return yield* new UserTypeVersionConflict({ currentVersion: type.version })
          }

          if (wanted.length > 0) {
            const found = rows<{ count: number }>(
              yield* tx.execute(countOrgTypesQuery(tenantId, list)),
            )[0]!.count
            if (found !== wanted.length) return yield* new UserTypeOrgTypeNotFound()
          }

          const current = rows<{ org_type_id: string }>(
            yield* tx.execute(currentAllowedOrgTypesQuery(tenantId, type.id)),
          ).map((row) => row.org_type_id)
          // an unchanged policy is not an edit, so it spends no version and
          // does not invalidate another edit against this row
          const unchanged =
            type.placement_mode === policy.mode &&
            current.length === wanted.length &&
            wanted.every((id) => current.includes(id))
          if (unchanged) return type.version

          yield* tx.execute(pruneAllowedOrgTypesQuery(tenantId, type.id, list))
          if (wanted.length > 0) {
            yield* tx.execute(addAllowedOrgTypesQuery(tenantId, type.id, list))
          }
          yield* tx.execute(setPlacementModeQuery(tenantId, type.id, policy.mode))

          // After the write, against the state that would result, and
          // UNCONDITIONALLY. The old code only looked when the new list was
          // non-empty, so clearing it entirely skipped the check outright.
          const left = yield* strandedByPolicy(tenantId, type.id)
          if (left > 0) return yield* new UserTypePlacementInUse({ userCount: left })
          return type.version + 1
        }),
      )
    }),

    remove: Effect.fn('Iam.userTypes.remove')(function* (
      tenantId: string,
      userTypeId: string,
      expectedVersion: number,
    ) {
      return yield* write(tenantId, (tx) =>
        Effect.gen(function* () {
          const type = yield* guard(tx, tenantId, userTypeId, expectedVersion)
          if (type.is_system || type.code === SYSTEM_ACCOUNT_USER_TYPE) {
            return yield* new UserTypeIsSystem()
          }
          const inUse = yield* countHolders(tx, tenantId, type.id)
          if (inUse > 0) return yield* new UserTypeInUse({ userCount: inUse })
          // eligibility rows cascade with the type, which would silently empty
          // a role's allowed set and leave that role assignable to nobody.
          // Asked of every kind of role, because a tenant role declares who
          // may hold it too.
          const stranded = rows<{ count: number }>(
            yield* tx.execute(rolesStrandedByUserTypeQuery(tenantId, type.id)),
          )[0]!.count
          if (stranded > 0) return yield* new UserTypeLastForRole({ roleCount: stranded })
          yield* tx.execute(deleteUserTypeQuery(tenantId, type.id))
        }),
      )
    }),
  }
})
