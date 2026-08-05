import { Effect } from 'effect'
import { Database } from '@qualy/plugin-database/effect'
import { translateConstraints } from '@qualy/plugin-database/effect/constraints'
import { Rbac } from '@qualy/rbac-contract/effect'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
import {
  countUsersOfTypeQuery,
  lockTenantQuery,
  oneUserType,
  setUserTypeEnabledQuery,
  updateUserTypeQuery,
  deleteUserTypeQuery,
  rolesStrandedByUserTypeQuery,
  userTypeGuardQuery,
  userTypesOfTenant,
} from '../iam/queries.ts'
import {
  RecoveryChannelRequired,
  UserTypeInUse,
  UserTypeIsSystem,
  UserTypeNotFound,
  UserTypeLastForRole,
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
  const database = yield* Database
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

  const write = <A, E>(tenantId: string, body: (tx: Tx) => Effect.Effect<A, E>) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(lockTenantQuery(tenantId))
          return yield* body(tx)
        }),
      )
      .pipe(
        translateConstraints(userTypeConstraints),
        Effect.catchTag(['SqlError', 'EffectDrizzleQueryError'], (error) => Effect.die(error)),
      )

  const countHolders = (tx: Tx, tenantId: string, userTypeId: string) =>
    tx
      .execute(countUsersOfTypeQuery(tenantId, userTypeId))
      .pipe(Effect.orDie, Effect.map((r) => rows<{ count: number }>(r)[0]!.count))

  return {
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
