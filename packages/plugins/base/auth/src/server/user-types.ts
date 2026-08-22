import { Effect } from 'effect'
import { kyselyOf, query, transaction, withDatabase } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { db, lockTenant, userTypeGuard, type Db } from './db.ts'
import { sql } from 'kysely'
import { Rbac } from '@qualy/rbac-contract/effect'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
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

/**
 * The ids, deduplicated, or nothing if any of them is not a uuid.
 *
 * A malformed id names no org type, which is the same answer as one that does
 * not exist - and saying so here keeps a typo from reaching postgres as a cast
 * error nobody declared.
 */
const uniqueUuids = (ids: readonly string[]): string[] | undefined => {
  const unique = [...new Set(ids)]
  const shaped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return unique.some((id) => !shaped.test(id)) ? undefined : unique
}

/**
 * A user type as an administrator sees it.
 *
 * The allowed org types come along because they are the whole of what a type
 * decides: a type confers no authority, only where its holders may stand.
 */
const userTypeProjection = (k: Db) =>
  k
    .selectFrom('UserType as t')
    .select((eb) => [
      't.id',
      't.code',
      't.name',
      't.description',
      't.enabled',
      't.isSystem',
      't.sortOrder',
      't.version',
      't.placementMode',
      sql<number>`(select count(*)::int from users u
        where u.tenant_id = ${eb.ref('t.tenantId')} and u.user_type_id = ${eb.ref('t.id')})`.as(
        'userCount',
      ),
      sql<string[]>`coalesce(
        (select array_agg(a.org_type_id::text) from user_type_allowed_org_types a
         where a.tenant_id = ${eb.ref('t.tenantId')} and a.user_type_id = ${eb.ref('t.id')}),
        '{}')`.as('allowedOrgTypes'),
    ])
    .orderBy('t.sortOrder')
    .orderBy('t.code')

const userTypesOfTenant = (tenantId: string) =>
  db.query((k) => userTypeProjection(k).where('t.tenantId', '=', tenantId).execute())

const oneUserType = (tenantId: string, userTypeId: string) =>
  db.query((k) =>
    userTypeProjection(k)
      .where('t.tenantId', '=', tenantId)
      .where('t.id', '=', userTypeId)
      .executeTakeFirst(),
  )

/** what the projection returns, read off the query rather than restated */
export type UserTypeRow = NonNullable<Effect.Success<ReturnType<typeof oneUserType>>>

/** the type's own row, locked, with what a policy edit needs to decide */
const lockUserType = (tenantId: string, userTypeId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserType')
      .select(['id', 'version', 'isSystem', 'placementMode'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .forUpdate()
      .executeTakeFirst(),
  )

const countUsersOfType = (tenantId: string, userTypeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('userTypeId', '=', userTypeId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.count ?? 0),
    )

const insertUserType = (input: {
  tenantId: string
  code: string
  name: string
  description: string | null
  sortOrder: number
  placementMode: 'unrestricted' | 'allow-list'
}) =>
  db.query((k) => k.insertInto('UserType').values(input).returning('id').executeTakeFirstOrThrow())

const updateUserType = (
  tenantId: string,
  userTypeId: string,
  fields: {
    name?: string
    description?: string | null
    sortOrder?: number
  },
) =>
  db.query((k) =>
    k
      .updateTable('UserType')
      // only what the caller stated: a field left out keeps its value, and a
      // description explicitly set to null is a caller clearing it rather than
      // a caller saying nothing
      .set((eb) => ({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.sortOrder === undefined ? {} : { sortOrder: fields.sortOrder }),
        version: eb('version', '+', 1),
        updatedAt: sql<Date>`now()`,
      }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .execute(),
  )

const setUserTypeEnabled = (tenantId: string, userTypeId: string, enabled: boolean) =>
  db.query((k) =>
    k
      .updateTable('UserType')
      .set((eb) => ({ enabled, version: eb('version', '+', 1), updatedAt: sql<Date>`now()` }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .execute(),
  )

const setPlacementMode = (
  tenantId: string,
  userTypeId: string,
  mode: 'unrestricted' | 'allow-list',
) =>
  db.query((k) =>
    k
      .updateTable('UserType')
      .set((eb) => ({
        placementMode: mode,
        version: eb('version', '+', 1),
        updatedAt: sql<Date>`now()`,
      }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .execute(),
  )

const deleteUserType = (tenantId: string, userTypeId: string) =>
  db.query((k) =>
    k
      .deleteFrom('UserType')
      .where('tenantId', '=', tenantId)
      .where('id', '=', userTypeId)
      .execute(),
  )

/**
 * The org types a user type screen picks from.
 *
 * Its own endpoint rather than the role screen's, so stating where a kind of
 * person may stand needs no permission over roles.
 */
const orgTypeOptions = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgType')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .orderBy('name')
      .execute(),
  )

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

const currentAllowedOrgTypes = (tenantId: string, userTypeId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserTypeAllowedOrgType')
      .select('orgTypeId')
      .where('tenantId', '=', tenantId)
      .where('userTypeId', '=', userTypeId)
      .execute(),
  )

const addAllowedOrgTypes = (tenantId: string, userTypeId: string, ids: readonly string[]) =>
  db.query((k) =>
    k
      .insertInto('UserTypeAllowedOrgType')
      .values(ids.map((orgTypeId) => ({ tenantId, userTypeId, orgTypeId })))
      .onConflict((conflict) => conflict.doNothing())
      .execute(),
  )

/** everything this type allows that the new list does not */
const pruneAllowedOrgTypes = (tenantId: string, userTypeId: string, keep: readonly string[]) =>
  db.query((k) => {
    const rest = k
      .deleteFrom('UserTypeAllowedOrgType')
      .where('tenantId', '=', tenantId)
      .where('userTypeId', '=', userTypeId)
    // an empty list keeps nothing, and `not in ()` is not sql
    return (keep.length === 0 ? rest : rest.where('orgTypeId', 'not in', keep)).execute()
  })

export const make = Effect.fn('Iam.userTypes.make')(function* () {
  const rbac = yield* Rbac
  // the writes get their database from the transaction they open; a plain read
  // opens nothing, so it is supplied here rather than left in the caller's
  // requirements - what this builds is a service, and a service that demands
  // the orm has handed the orm to everybody who calls it
  const withDb = yield* withDatabase

  /** the type, with the version the caller expected still holding */
  const guard = Effect.fn('Iam.userTypes.guard')(function* (
    tenantId: string,
    userTypeId: string,
    expectedVersion: number,
  ) {
    const row = yield* userTypeGuard(tenantId, userTypeId).pipe(Effect.orDie)
    if (!row) return yield* new UserTypeNotFound()
    if (row.version !== expectedVersion) {
      // the current version travels with the refusal so a client can re-read
      // and retry instead of guessing
      return yield* new UserTypeVersionConflict({ currentVersion: row.version })
    }
    return row
  })

  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(
      translateConstraints(userTypeConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
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
        sortOrder?: number
        placementPolicy:
          { mode: 'unrestricted' } | { mode: 'allow-list'; orgTypeIds: readonly string[] }
      },
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const policy = input.placementPolicy
          const { id } = yield* insertUserType({
            tenantId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder ?? 0,
            placementMode: policy.mode,
          })
          if (policy.mode === 'allow-list') {
            const wanted = uniqueUuids(policy.orgTypeIds)
            if (!wanted) return yield* new UserTypeOrgTypeNotFound()
            if (wanted.length > 0) {
              const found = yield* countOrgTypes(tenantId, wanted)
              if (found !== wanted.length) return yield* new UserTypeOrgTypeNotFound()
              yield* addAllowedOrgTypes(tenantId, id, wanted)
            }
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
      withDb(
        orgTypeOptions(tenantId).pipe(
          Effect.orDie,
          Effect.withSpan('Iam.userTypes.orgTypeOptions'),
        ),
      ),

    list: (tenantId: string) =>
      withDb(userTypesOfTenant(tenantId).pipe(Effect.orDie, Effect.withSpan('Iam.userTypes.list'))),

    get: (tenantId: string, userTypeId: string) =>
      withDb(
        Effect.gen(function* () {
          const row = yield* oneUserType(tenantId, userTypeId).pipe(Effect.orDie)
          if (!row) return yield* new UserTypeNotFound()
          return row
        }).pipe(Effect.withSpan('Iam.userTypes.get')),
      ),

    update: Effect.fn('Iam.userTypes.update')(function* (
      tenantId: string,
      userTypeId: string,
      fields: {
        name?: string
        description?: string | null
        sortOrder?: number
      },
      expectedVersion: number,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const type = yield* guard(tenantId, userTypeId, expectedVersion)
          // a request that changes nothing must not invalidate every open
          // editor: the version is optimistic concurrency, and bumping it for
          // a re-saved unchanged form refuses a concurrent genuine edit
          const same =
            (fields.name === undefined || fields.name === type.name) &&
            (fields.description === undefined || fields.description === type.description) &&
            (fields.sortOrder === undefined || fields.sortOrder === type.sortOrder)
          if (same) return type.version
          yield* updateUserType(tenantId, type.id, fields)
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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const type = yield* guard(tenantId, userTypeId, expectedVersion)
          // asking for the state it is already in is not an edit, so it
          // neither spends a version nor invalidates another edit in flight
          if (type.enabled === enabled) return type.version
          if (!enabled) {
            // Disabling a type people still hold is refused outright. It used
            // to be allowed and did two wrong things at once: it revoked
            // sign-in for every holder without ending a single session, so
            // re-enabling handed those sessions straight back.
            const inUse = yield* countUsersOfType(tenantId, type.id)
            if (inUse > 0) return yield* new UserTypeInUse({ userCount: inUse })
          }
          yield* setUserTypeEnabled(tenantId, type.id, enabled)
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
      const wanted = uniqueUuids(policy.mode === 'allow-list' ? policy.orgTypeIds : [])
      if (!wanted) return yield* new UserTypeOrgTypeNotFound()

      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const type = yield* lockUserType(tenantId, userTypeId)
          if (!type) return yield* new UserTypeNotFound()
          // every other part of a system type is frozen; this one was the way in
          if (type.isSystem) return yield* new UserTypeIsSystem()
          if (type.version !== expectedVersion) {
            return yield* new UserTypeVersionConflict({ currentVersion: type.version })
          }

          if (wanted.length > 0) {
            const found = yield* countOrgTypes(tenantId, wanted)
            if (found !== wanted.length) return yield* new UserTypeOrgTypeNotFound()
          }

          const current = (yield* currentAllowedOrgTypes(tenantId, type.id)).map(
            (row) => row.orgTypeId,
          )
          // an unchanged policy is not an edit, so it spends no version and
          // does not invalidate another edit against this row
          const unchanged =
            type.placementMode === policy.mode &&
            current.length === wanted.length &&
            wanted.every((id) => current.includes(id))
          if (unchanged) return type.version

          yield* pruneAllowedOrgTypes(tenantId, type.id, wanted)
          if (wanted.length > 0) {
            yield* addAllowedOrgTypes(tenantId, type.id, wanted)
          }
          yield* setPlacementMode(tenantId, type.id, policy.mode)

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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const type = yield* guard(tenantId, userTypeId, expectedVersion)
          if (type.isSystem || type.code === SYSTEM_ACCOUNT_USER_TYPE) {
            return yield* new UserTypeIsSystem()
          }
          const inUse = yield* countUsersOfType(tenantId, type.id)
          if (inUse > 0) return yield* new UserTypeInUse({ userCount: inUse })
          // eligibility rows cascade with the type, which would silently empty
          // a role's allowed set and leave that role assignable to nobody.
          // Asked of rbac rather than read here: they are its tables, and it
          // answers on this transaction because the connection is in the fiber
          const stranded = yield* rbac.rolesStrandedByUserType(tenantId, type.id)
          if (stranded > 0) return yield* new UserTypeLastForRole({ roleCount: stranded })
          yield* deleteUserType(tenantId, type.id)
        }),
      )
    }),
  }
})
